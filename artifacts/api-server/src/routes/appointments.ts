import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  AppointmentModel,
  CaseModel,
  ClientModel,
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUSES,
} from "@workspace/db";
import {
  CheckConflictQueryParams,
  CreateAppointmentBody,
  CreateAppointmentResponse,
  DeleteAppointmentParams,
  GetAppointmentParams,
  GetAppointmentResponse,
  GetCalendarAppointmentsQueryParams,
  GetCalendarAppointmentsResponse,
  ListAppointmentsQueryParams,
  ListAppointmentsResponse,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  UpdateAppointmentResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const tenantOf = (res: { locals: Record<string, unknown> }): string =>
  String(res.locals.tenantId ?? "");

// ─── helpers ─────────────────────────────────────────────────────────────────

async function enrichAppointments(
  tenantId: string,
  appointments: Array<{
    id: string; tenantId: string; clientId?: string | null; caseId?: string | null;
    title: string; type: string; startAt: Date; endAt: Date;
    location?: string | null; notes?: string | null;
    status: string; reminderSent: boolean; createdAt: Date; updatedAt: Date;
  }>,
) {
  const clientIds = Array.from(new Set(
    appointments.map((a) => a.clientId).filter((x): x is string => !!x),
  ));
  const caseIds = Array.from(new Set(
    appointments.map((a) => a.caseId).filter((x): x is string => !!x),
  ));

  const [clients, cases] = await Promise.all([
    clientIds.length
      ? ClientModel.find({ tenantId, id: { $in: clientIds } }).select("id fullName").lean()
      : [],
    caseIds.length
      ? CaseModel.find({ tenantId, id: { $in: caseIds } }).select("id caseNumber clientId").lean()
      : [],
  ]);

  const clientNameById  = new Map(clients.map((c) => [c.id, c.fullName]));
  const caseNumberById  = new Map(cases.map((c) => [c.id, c.caseNumber]));
  // Also resolve clientId from case when missing
  const caseClientById  = new Map(cases.map((c) => [c.id, c.clientId]));

  return appointments.map((a) => {
    const effectiveClientId = a.clientId ?? (a.caseId ? (caseClientById.get(a.caseId) ?? null) : null);
    return {
      id:           a.id,
      tenantId:     a.tenantId,
      clientId:     effectiveClientId,
      clientName:   effectiveClientId ? (clientNameById.get(effectiveClientId) ?? null) : null,
      caseId:       a.caseId ?? null,
      caseNumber:   a.caseId ? (caseNumberById.get(a.caseId) ?? null) : null,
      title:        a.title,
      type:         a.type,
      startAt:      a.startAt,
      endAt:        a.endAt,
      location:     a.location ?? null,
      notes:        a.notes ?? null,
      status:       a.status,
      reminderSent: Boolean(a.reminderSent),
      createdAt:    a.createdAt,
      updatedAt:    a.updatedAt,
    };
  });
}

/** Check for overlapping appointments (excluding a given id for updates) */
async function findConflicts(
  tenantId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
) {
  const query: Record<string, unknown> = {
    tenantId,
    isDeleted: { $ne: true },
    status: { $nin: ["cancelled", "no_show"] },
    // Overlap: existing.startAt < newEndAt AND existing.endAt > newStartAt
    startAt: { $lt: endAt },
    endAt:   { $gt: startAt },
  };
  if (excludeId) (query as any)._id = { $exists: true }; // placeholder — filter by id below
  const raw = await AppointmentModel.find(query).lean();
  return excludeId ? raw.filter((a) => a.id !== excludeId) : raw;
}

// ─── GET /appointments/calendar ──────────────────────────────────────────────
// MUST be before /:id
router.get("/appointments/calendar", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetCalendarAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { year, month } = parsed.data;

  // Edge case: validate month range
  if (month < 1 || month > 12) { res.status(400).json({ error: "month must be 1-12" }); return; }

  // Include full weeks around the month (for calendar grid)
  const firstDay  = new Date(year, month - 1, 1);
  const lastDay   = new Date(year, month, 0, 23, 59, 59, 999);
  // Extend to Mon before first day and Sun after last day
  const startPad  = new Date(firstDay);
  startPad.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7)); // Monday
  const endPad    = new Date(lastDay);
  const dayOfWeek = lastDay.getDay();
  endPad.setDate(lastDay.getDate() + (dayOfWeek === 0 ? 0 : 7 - dayOfWeek)); // Sunday

  const appointments = await AppointmentModel.find({
    tenantId,
    isDeleted: { $ne: true },
    startAt: { $gte: startPad, $lte: endPad },
  }).sort({ startAt: 1 }).lean();

  const enriched = await enrichAppointments(tenantId, appointments as any);
  res.json(GetCalendarAppointmentsResponse.parse(enriched));
});

// ─── GET /appointments/conflicts ─────────────────────────────────────────────
router.get("/appointments/conflicts", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CheckConflictQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const startAt = new Date(parsed.data.startAt);
  const endAt   = new Date(parsed.data.endAt);

  // Edge: endAt must be after startAt
  if (endAt <= startAt) {
    res.status(400).json({ error: "endAt must be after startAt" });
    return;
  }

  const raw = await findConflicts(tenantId, startAt, endAt, parsed.data.excludeId);
  const enriched = await enrichAppointments(tenantId, raw as any);
  res.json({ hasConflict: enriched.length > 0, conflicts: enriched });
});

// ─── GET /appointments ────────────────────────────────────────────────────────
router.get("/appointments", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { clientId, caseId, type, status, dateFrom, dateTo, upcoming, page: rawPage, limit: rawLimit } = parsed.data;
  const page  = Math.max(1, Math.floor(rawPage  ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(rawLimit ?? 50)));

  const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (clientId) query.clientId = clientId;
  if (caseId)   query.caseId   = caseId;
  if (type)     query.type     = type;
  if (status)   query.status   = status;
  if (upcoming) query.startAt  = { $gte: new Date() };
  if (dateFrom || dateTo) {
    const df: Record<string, Date> = {};
    if (dateFrom) df.$gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      df.$lte = end;
    }
    query.startAt = df;
  }

  const [total, appointments] = await Promise.all([
    AppointmentModel.countDocuments(query),
    AppointmentModel.find(query)
      .sort({ startAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const enriched = await enrichAppointments(tenantId, appointments as any);
  res.json(ListAppointmentsResponse.parse({ data: enriched, total, page, pageSize: limit }));
});

// ─── POST /appointments ───────────────────────────────────────────────────────
router.post("/appointments", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data = parsed.data;
  const startAt = new Date(data.startAt);
  const endAt   = new Date(data.endAt);

  // Edge: endAt must be after startAt
  if (endAt <= startAt) {
    res.status(422).json({ error: "endAt must be after startAt" });
    return;
  }

  // Edge: appointment can't be in the past (warn — don't block, just flag)
  // We allow past appointments for retroactive logging

  // Edge: max duration 12 hours
  const durationMs = endAt.getTime() - startAt.getTime();
  if (durationMs > 12 * 60 * 60 * 1000) {
    res.status(422).json({ error: "Appointment duration cannot exceed 12 hours" });
    return;
  }

  // Validate type
  if (!(APPOINTMENT_TYPES as readonly string[]).includes(data.type)) {
    res.status(400).json({ error: `Invalid type. Valid: ${APPOINTMENT_TYPES.join(", ")}` });
    return;
  }

  // Validate status
  if (data.status && !(APPOINTMENT_STATUSES as readonly string[]).includes(data.status)) {
    res.status(400).json({ error: `Invalid status. Valid: ${APPOINTMENT_STATUSES.join(", ")}` });
    return;
  }

  // Validate clientId
  let resolvedClientId = data.clientId ?? null;
  if (data.clientId) {
    const client = await ClientModel.findOne({ id: data.clientId, tenantId, isDeleted: { $ne: true } }).lean();
    if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  }

  // Validate caseId + auto-resolve clientId
  if (data.caseId) {
    const caseItem = await CaseModel.findOne({ id: data.caseId, tenantId }).lean();
    if (!caseItem) { res.status(404).json({ error: "Case not found" }); return; }
    if (!resolvedClientId) resolvedClientId = caseItem.clientId;
  }

  // Conflict check (non-blocking — return 409 with conflicts)
  const conflicts = await findConflicts(tenantId, startAt, endAt);
  if (conflicts.length > 0) {
    const enrichedConflicts = await enrichAppointments(tenantId, conflicts as any);
    res.status(409).json({
      error: "Time slot has conflicts",
      hasConflict: true,
      conflicts: enrichedConflicts,
    });
    return;
  }

  const appointment = await AppointmentModel.create({
    id:       randomUUID(),
    tenantId,
    clientId: resolvedClientId,
    caseId:   data.caseId ?? null,
    title:    data.title.trim(),
    type:     data.type,
    startAt,
    endAt,
    location: data.location?.trim() || null,
    notes:    data.notes?.trim()    || null,
    status:   data.status ?? "scheduled",
  });

  const [enriched] = await enrichAppointments(tenantId, [appointment.toObject() as any]);
  res.status(201).json(CreateAppointmentResponse.parse(enriched));
});

// ─── GET /appointments/:id ────────────────────────────────────────────────────
router.get("/appointments/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetAppointmentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const appt = await AppointmentModel.findOne({ id: parsed.data.id, tenantId, isDeleted: { $ne: true } }).lean();
  if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

  const [enriched] = await enrichAppointments(tenantId, [appt as any]);
  res.json(GetAppointmentResponse.parse(enriched));
});

// ─── PATCH /appointments/:id ──────────────────────────────────────────────────
router.patch("/appointments/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = UpdateAppointmentParams.safeParse(req.params);
  const body   = UpdateAppointmentBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success)   { res.status(400).json({ error: body.error.message });   return; }

  const existing = await AppointmentModel.findOne({
    id: params.data.id, tenantId, isDeleted: { $ne: true },
  }).lean();
  if (!existing) { res.status(404).json({ error: "Appointment not found" }); return; }

  const data = body.data;

  // Edge: cannot un-complete a completed appointment (status guard)
  if (existing.status === "completed" && data.status && data.status !== "completed") {
    res.status(422).json({ error: "Completed appointments cannot be re-opened" });
    return;
  }

  // Compute effective start/end for conflict check
  const newStartAt = data.startAt ? new Date(data.startAt) : existing.startAt;
  const newEndAt   = data.endAt   ? new Date(data.endAt)   : existing.endAt;

  if (newEndAt <= newStartAt) {
    res.status(422).json({ error: "endAt must be after startAt" });
    return;
  }

  const durationMs = newEndAt.getTime() - newStartAt.getTime();
  if (durationMs > 12 * 60 * 60 * 1000) {
    res.status(422).json({ error: "Appointment duration cannot exceed 12 hours" });
    return;
  }

  // Validate type/status if changing
  if (data.type && !(APPOINTMENT_TYPES as readonly string[]).includes(data.type)) {
    res.status(400).json({ error: `Invalid type. Valid: ${APPOINTMENT_TYPES.join(", ")}` });
    return;
  }
  if (data.status && !(APPOINTMENT_STATUSES as readonly string[]).includes(data.status)) {
    res.status(400).json({ error: `Invalid status. Valid: ${APPOINTMENT_STATUSES.join(", ")}` });
    return;
  }

  // If time changed — re-check conflicts (exclude self)
  if (data.startAt || data.endAt) {
    const conflicts = await findConflicts(tenantId, newStartAt, newEndAt, existing.id);
    if (conflicts.length > 0) {
      const enrichedConflicts = await enrichAppointments(tenantId, conflicts as any);
      res.status(409).json({ error: "Time slot has conflicts", hasConflict: true, conflicts: enrichedConflicts });
      return;
    }
  }

  // Resolve clientId from new caseId
  let resolvedClientId = existing.clientId;
  if (data.caseId !== undefined) {
    if (data.caseId) {
      const caseItem = await CaseModel.findOne({ id: data.caseId, tenantId }).lean();
      if (!caseItem) { res.status(404).json({ error: "Case not found" }); return; }
      resolvedClientId = caseItem.clientId;
    } else {
      resolvedClientId = data.clientId ?? null;
    }
  }
  if (data.clientId !== undefined && data.caseId === undefined) {
    resolvedClientId = data.clientId ?? null;
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.title    !== undefined) $set.title    = data.title?.trim();
  if (data.type     !== undefined) $set.type     = data.type;
  if (data.startAt  !== undefined) $set.startAt  = newStartAt;
  if (data.endAt    !== undefined) $set.endAt    = newEndAt;
  if (data.location !== undefined) $set.location = data.location?.trim() || null;
  if (data.notes    !== undefined) $set.notes    = data.notes?.trim()    || null;
  if (data.status   !== undefined) $set.status   = data.status;
  if (data.caseId   !== undefined) { $set.caseId = data.caseId ?? null; $set.clientId = resolvedClientId; }
  if (data.clientId !== undefined && data.caseId === undefined) $set.clientId = resolvedClientId;

  const updated = await AppointmentModel.findOneAndUpdate(
    { id: params.data.id, tenantId },
    { $set },
    { new: true },
  ).lean();

  if (!updated) { res.status(404).json({ error: "Appointment not found" }); return; }
  const [enriched] = await enrichAppointments(tenantId, [updated as any]);
  res.json(UpdateAppointmentResponse.parse(enriched));
});

// ─── DELETE /appointments/:id ─────────────────────────────────────────────────
router.delete("/appointments/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteAppointmentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updated = await AppointmentModel.findOneAndUpdate(
    { id: parsed.data.id, tenantId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, updatedAt: new Date() } },
  ).lean();

  if (!updated) { res.status(404).json({ error: "Appointment not found" }); return; }
  res.sendStatus(204);
});

export default router;
