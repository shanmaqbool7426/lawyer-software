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
  GetAppointmentSummaryQueryParams,
  GetAppointmentSummaryResponse,
  UpdateAppointmentBody,
  UpdateAppointmentParams,
  UpdateAppointmentResponse,
} from "@workspace/api-zod";
import { pushAppointment, removeAppointmentEvent } from "../lib/googleCalendar";
import { backfillCourtMirrors } from "../lib/courtSchedule";
import { addDays, firmClock, firmDay, firmDayStart, utcDayStart } from "../lib/firmTime";

const router: IRouter = Router();

const tenantOf = (res: { locals: Record<string, unknown> }): string =>
  String(res.locals.tenantId ?? "");

function escapeRegExp(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An all-day row is a date: pin it at UTC midnight so it never shifts. */
function pinAllDay(d: Date): Date {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/**
 * Date-range bounds. A plain YYYY-MM-DD is a day in the office, so the window
 * runs from UTC midnight (where all-day rows sit) to the end of that day in
 * Toronto. A full ISO datetime is kept as-is, so callers can send an
 * offset-aware instant.
 */
function parseDayBound(value: string, endOfDay: boolean): Date | null {
  if (value.includes("T")) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const day = match[0];
  if (!endOfDay) return utcDayStart(day);
  // One millisecond before the next office midnight: a Toronto evening meeting
  // (which lands on the next UTC day) still belongs to the day asked for.
  return new Date(firmDayStart(addDays(day, 1)).getTime() - 1);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function enrichAppointments(
  tenantId: string,
  appointments: Array<{
    id: string; tenantId: string; clientId?: string | null; caseId?: string | null;
    title: string; type: string; startAt: Date; endAt: Date;
    location?: string | null; notes?: string | null;
    status: string; reminderSent: boolean; createdAt: Date; updatedAt: Date;
    allDay?: boolean | null; courtDateId?: string | null; externalSource?: string | null;
    googleEventId?: string | null; googleSyncedAt?: Date | null; googleSyncError?: string | null;
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
      allDay:       Boolean(a.allDay),
      courtDateId:  a.courtDateId ?? null,
      externalSource: a.externalSource ?? null,
      googleEventId:   a.googleEventId ?? null,
      googleSyncedAt:  a.googleSyncedAt ?? null,
      googleSyncError: a.googleSyncError ?? null,
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
    // All-day rows are court dates covering the whole day: they never hold a
    // time slot, so a 9 am meeting is not "in conflict" with a hearing.
    allDay: { $ne: true },
    // Cancelled, no-show and completed rows are history, not held slots — they
    // must not block a booking (or a retroactive log of a meeting).
    status: { $nin: ["cancelled", "no_show", "completed"] },
    // Overlap: existing.startAt < newEndAt AND existing.endAt > newStartAt
    startAt: { $lt: endAt },
    endAt:   { $gt: startAt },
  };
  const raw = await AppointmentModel.find(query).lean();
  return excludeId ? raw.filter((a) => a.id !== excludeId) : raw;
}

// ─── GET /appointments/calendar ──────────────────────────────────────────────
// MUST be before /:id
router.get("/appointments/calendar", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetCalendarAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { year, month, caseId } = parsed.data;

  // Edge case: validate month range
  if (month < 1 || month > 12) { res.status(400).json({ error: "month must be 1-12" }); return; }

  // Court dates saved before this feature have no mirror row yet.
  await backfillCourtMirrors(tenantId);

  // Include full weeks around the month (for calendar grid). Boundaries are
  // UTC so an all-day row on the first Monday is never clipped away.
  const firstDay  = new Date(Date.UTC(year, month - 1, 1));
  const lastDay   = new Date(Date.UTC(year, month, 1) - 1);
  // Extend to Mon before first day and Sun after last day
  const startPad  = new Date(firstDay);
  startPad.setUTCDate(firstDay.getUTCDate() - ((firstDay.getUTCDay() + 6) % 7)); // Monday
  const endPad    = new Date(lastDay);
  const dayOfWeek = lastDay.getUTCDay();
  endPad.setUTCDate(lastDay.getUTCDate() + (dayOfWeek === 0 ? 0 : 7 - dayOfWeek)); // Sunday
  // A Sunday-evening meeting in Toronto is already Monday in UTC; keep a day of
  // slack so the last column is never short of rows.
  endPad.setUTCDate(endPad.getUTCDate() + 1);

  const appointments = await AppointmentModel.find({
    tenantId,
    isDeleted: { $ne: true },
    ...(caseId ? { caseId } : {}),
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

// ─── GET /appointments/summary ────────────────────────────────────────────────
// MUST be before /:id — counters for the schedule header, computed server-side
// so they can never disagree with the register after pagination.
router.get("/appointments/summary", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetAppointmentSummaryQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const caseId = parsed.data.caseId;

  const now      = new Date();
  // "Today" is today in Toronto, whatever zone the host runs in. An all-day row
  // sits at UTC midnight of that date, a timed one inside the office day, so a
  // day is the union of the two windows.
  const today    = firmDay(now);
  const tomorrow = addDays(today, 1);
  const weekEnd  = addDays(today, 8);
  const last30   = firmDayStart(addDays(today, -30));

  const dayWindow = (day: string, next: string) => ({
    $or: [
      { allDay: true, startAt: { $gte: utcDayStart(day), $lt: utcDayStart(next) } },
      { allDay: { $ne: true }, startAt: { $gte: firmDayStart(day), $lt: firmDayStart(next) } },
    ],
  });

  const base = { tenantId, isDeleted: { $ne: true }, ...(caseId ? { caseId } : {}) };
  const live = { $nin: ["cancelled", "no_show"] };

  const [todayCount, next7Count, awaitingCount, completedCount] = await Promise.all([
    AppointmentModel.countDocuments({ ...base, status: live, ...dayWindow(today, tomorrow) }),
    AppointmentModel.countDocuments({ ...base, status: live, ...dayWindow(tomorrow, weekEnd) }),
    AppointmentModel.countDocuments({ ...base, status: "scheduled", startAt: { $gte: now } }),
    AppointmentModel.countDocuments({ ...base, status: "completed", startAt: { $gte: last30, $lte: now } }),
  ]);

  res.json(GetAppointmentSummaryResponse.parse({ todayCount, next7Count, awaitingCount, completedCount }));
});

// ─── GET /appointments ────────────────────────────────────────────────────────
// Shared by the register and the CSV export so the file always matches the
// screen. Returns the mongo filter plus the effective window for messages.
type ListFilters = ReturnType<typeof ListAppointmentsQueryParams.parse>;

async function buildListQuery(tenantId: string, f: ListFilters) {
  const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (f.clientId) query.clientId = f.clientId;
  if (f.caseId)   query.caseId   = f.caseId;
  if (f.type)     query.type     = f.type;
  if (f.status)   query.status   = f.status;
  // Who owns the row: imported mirrors are read-only, so they are worth hiding
  // when the lawyer only wants the bookings made in Docketline.
  if (f.source === "google")     query.externalSource = { $ne: null };
  if (f.source === "docketline") query.externalSource = null;

  // ── Date window ────────────────────────────────────────────────────────────
  // "upcoming" used to overwrite the explicit range, so a day-filtered call that
  // also asked for upcoming silently returned every future row. Merge both.
  // A day has two edges as well: an all-day row is pinned at UTC midnight of
  // its date, a timed one lives inside the office day. One $gte/$lte pair can
  // not hold both (stretching to the office midnight would drag in the next
  // day's all-day rows), so each window gets its own clause.
  const now = new Date();
  const from = f.dateFrom ? parseDayBound(f.dateFrom, false) : null;
  const to   = f.dateTo   ? parseDayBound(f.dateTo,   true)  : null;
  if (f.dateFrom && !from) throw new Error("dateFrom must be YYYY-MM-DD or an ISO datetime");
  if (f.dateTo   && !to)   throw new Error("dateTo must be YYYY-MM-DD or an ISO datetime");
  if (from && to && to < from) throw new Error("dateTo must not be before dateFrom");

  const dayOnly = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const later = (a: Date | null, b: Date) => (a && a > b ? a : b);
  const DAY = 86_400_000;

  let lowerAllDay: Date | null = null;
  let lowerTimed: Date | null = null;
  let upperAllDay: Date | null = null;
  let upperTimed: Date | null = null;
  if (f.dateFrom) {
    lowerAllDay = dayOnly(f.dateFrom) ? utcDayStart(f.dateFrom) : new Date(f.dateFrom);
    lowerTimed  = dayOnly(f.dateFrom) ? firmDayStart(f.dateFrom) : new Date(f.dateFrom);
  }
  if (f.dateTo) {
    upperAllDay = dayOnly(f.dateTo) ? new Date(utcDayStart(f.dateTo).getTime() + DAY - 1) : new Date(f.dateTo);
    upperTimed  = dayOnly(f.dateTo) ? to : new Date(f.dateTo);
  }
  if (f.upcoming) {
    lowerAllDay = later(lowerAllDay, now);
    lowerTimed  = later(lowerTimed, now);
  }

  const edge = (lo: Date | null, hi: Date | null) => {
    const range: Record<string, Date> = {};
    if (lo) range.$gte = lo;
    if (hi) range.$lte = hi;
    return range;
  };
  const allDayWindow = edge(lowerAllDay, upperAllDay);
  const timedWindow   = edge(lowerTimed, upperTimed);
  if (Object.keys(allDayWindow).length || Object.keys(timedWindow).length) {
    query.$and = [
      ...((query.$and as unknown[]) ?? []),
      {
        $or: [
          { allDay: true, startAt: allDayWindow },
          { allDay: { $ne: true }, startAt: timedWindow },
        ],
      },
    ];
  }

  // ── Free text ──────────────────────────────────────────────────────────────
  // Appointments only store ids, so resolve the matching clients/cases first and
  // fold them into the same $or — otherwise searching a client name finds nothing.
  const term = f.search?.trim();
  if (term) {
    const rx = new RegExp(escapeRegExp(term), "i");
    const numeric = Number(term.replace(/^#/, ""));
    const caseOr: Record<string, unknown>[] = [
      { offenceDescription: rx },
      { courtLocation: rx },
      { ticketNumber: rx },
    ];
    if (Number.isFinite(numeric)) caseOr.push({ caseNumber: numeric });

    const [clients, cases] = await Promise.all([
      ClientModel.find({ tenantId, isDeleted: { $ne: true }, fullName: rx }).select("id").limit(200).lean(),
      CaseModel.find({ tenantId, $or: caseOr }).select("id").limit(200).lean(),
    ]);

    const or: Record<string, unknown>[] = [{ title: rx }, { location: rx }, { notes: rx }];
    if (clients.length) or.push({ clientId: { $in: clients.map((c) => c.id) } });
    if (cases.length)   or.push({ caseId:   { $in: cases.map((c) => c.id) } });
    query.$or = or;
  }

  return query;
}

router.get("/appointments", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { sort, page: rawPage, limit: rawLimit } = parsed.data;
  const page  = Math.max(1, Math.floor(rawPage  ?? 1));
  const limit = Math.min(200, Math.max(1, Math.floor(rawLimit ?? 50)));

  let query: Record<string, unknown>;
  try {
    query = await buildListQuery(tenantId, parsed.data);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const direction = sort === "latest" ? -1 : 1;
  const [total, appointments] = await Promise.all([
    AppointmentModel.countDocuments(query),
    AppointmentModel.find(query)
      .sort({ startAt: direction, createdAt: direction })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const enriched = await enrichAppointments(tenantId, appointments as any);
  res.json(ListAppointmentsResponse.parse({ data: enriched, total, page, pageSize: limit }));
});

// ─── GET /appointments/export.csv ────────────────────────────────────────────
router.get("/appointments/export.csv", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListAppointmentsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let query: Record<string, unknown>;
  try {
    query = await buildListQuery(tenantId, parsed.data);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const direction = parsed.data.sort === "latest" ? -1 : 1;
  const rows = await AppointmentModel.find(query).sort({ startAt: direction }).limit(2000).lean();
  const enriched = await enrichAppointments(tenantId, rows as any);

  const q = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  // The file is read next to the schedule, so the day and the clock are the
  // office's. An all-day row prints the date it was pinned to.
  const day  = (d: Date) => firmDay(d);
  const time = (d: Date) => {
    const c = firmClock(d);
    return `${String(c.h).padStart(2, "0")}:${String(c.mi).padStart(2, "0")}`;
  };
  const rowDay = (a: { allDay?: boolean | null; startAt: Date }) =>
    a.allDay ? new Date(a.startAt).toISOString().slice(0, 10) : day(a.startAt);

  const lines = [
    ["Date", "Start", "End", "Title", "Type", "Status", "Client", "Case #", "Location", "Notes"].map(q).join(","),
    ...enriched.map((a) =>
      [
        rowDay(a),
        time(a.startAt),
        time(a.endAt),
        a.title,
        a.type,
        a.status.replace("_", " "),
        a.clientName ?? "",
        a.caseNumber ? `#${a.caseNumber}` : "",
        a.location ?? "",
        a.notes ?? "",
      ].map(q).join(","),
    ),
  ];

  res
    .type("text/csv")
    .set("Content-Disposition", 'attachment; filename="appointments.csv"')
    .send(lines.join("\n"));
});

// ─── POST /appointments ───────────────────────────────────────────────────────
router.post("/appointments", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data = parsed.data;
  const startAt = new Date(data.startAt);
  const endAt   = new Date(data.endAt);
  const isAllDay = data.allDay === true;

  // Edge: endAt must be after startAt
  if (endAt <= startAt) {
    res.status(422).json({ error: "endAt must be after startAt" });
    return;
  }

  if (isAllDay) {
    // An all-day row is pinned to the calendar day it starts on.
    startAt.setTime(pinAllDay(startAt).getTime());
    const nextDay = new Date(startAt);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    endAt.setTime(nextDay.getTime());
  }

  // Edge: appointment can't be in the past (warn — don't block, just flag)
  // We allow past appointments for retroactive logging

  // Edge: max duration 12 hours (an all-day row is one 24-hour block by design)
  const durationMs = endAt.getTime() - startAt.getTime();
  if (!isAllDay && durationMs > 12 * 60 * 60 * 1000) {
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

  // You cannot have already attended a meeting that has not started yet.
  if ((data.status === "completed" || data.status === "no_show") && startAt > new Date()) {
    res.status(422).json({ error: `A future appointment cannot be marked ${data.status === "no_show" ? "no-show" : "completed"}` });
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

  // Conflict check — a cancelled booking never holds a slot, so skip it there.
  if (data.status !== "cancelled" && !isAllDay) {
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
    allDay:   isAllDay,
  });

  await pushAppointment(tenantId, appointment.id);

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

  // A court row is a projection of the case file. Letting it be edited here
  // would only desync the two, so point the lawyer at the source instead.
  if ((existing as any).courtDateId) {
    res.status(409).json({
      error: "This entry mirrors a court date. Update the court date on the case file instead.",
      courtDateId: (existing as any).courtDateId,
    });
    return;
  }

  // Rows imported from the lawyer's own Google Calendar belong to Google.
  if ((existing as any).externalSource) {
    res.status(409).json({
      error: "This entry comes from your Google Calendar. Change it in Google — the schedule follows it.",
    });
    return;
  }

  const data = body.data;

  // Edge: cannot un-complete a completed appointment (status guard)
  if (existing.status === "completed" && data.status && data.status !== "completed") {
    res.status(422).json({ error: "Completed appointments cannot be re-opened" });
    return;
  }

  // Compute effective start/end for conflict check
  const newStartAt = data.startAt ? new Date(data.startAt) : new Date(existing.startAt);
  const newEndAt   = data.endAt   ? new Date(data.endAt)   : new Date(existing.endAt);
  const nextAllDay = data.allDay ?? Boolean(existing.allDay);

  // An all-day row spans exactly its calendar day; switching it off falls back
  // to a one-hour block so it still satisfies the duration rules.
  if (nextAllDay) {
    newStartAt.setTime(pinAllDay(newStartAt).getTime());
    const nextDay = new Date(newStartAt);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    newEndAt.setTime(nextDay.getTime());
  } else if (data.allDay === false) {
    newEndAt.setTime(newStartAt.getTime() + 60 * 60 * 1000);
  }

  if (newEndAt <= newStartAt) {
    res.status(422).json({ error: "endAt must be after startAt" });
    return;
  }

  const durationMs = newEndAt.getTime() - newStartAt.getTime();
  if (!nextAllDay && durationMs > 12 * 60 * 60 * 1000) {
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

  // ── Status guards ──────────────────────────────────────────────────────────
  const effectiveStatus = data.status ?? existing.status;

  // A cancelled booking cannot have been attended.
  if (existing.status === "cancelled" && (data.status === "completed" || data.status === "no_show")) {
    res.status(422).json({ error: "A cancelled appointment cannot be marked completed or no-show — reopen it as scheduled first" });
    return;
  }

  // Attendance is a thing you record after the fact, never in advance.
  if ((data.status === "completed" || data.status === "no_show") && newStartAt > new Date()) {
    res.status(422).json({ error: `A future appointment cannot be marked ${data.status === "no_show" ? "no-show" : "completed"}` });
    return;
  }

  // Re-opening a cancelled / no-show row puts the slot back in play, so it needs
  // the same conflict check as a fresh booking — not just when the time moved.
  const reopening =
    (existing.status === "cancelled" || existing.status === "no_show") &&
    effectiveStatus !== "cancelled" && effectiveStatus !== "no_show";

  // If time changed (or the slot is being revived) — re-check conflicts (exclude self)
  if (!nextAllDay && (data.startAt || data.endAt || reopening)) {
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
  if (data.allDay   !== undefined || (nextAllDay && (data.startAt !== undefined || data.endAt !== undefined))) {
    $set.allDay  = nextAllDay;
    // Re-pin the row to the day shape chosen above.
    $set.startAt = newStartAt;
    $set.endAt   = newEndAt;
  }

  const updated = await AppointmentModel.findOneAndUpdate(
    { id: params.data.id, tenantId },
    { $set },
    { new: true },
  ).lean();

  if (!updated) { res.status(404).json({ error: "Appointment not found" }); return; }
  await pushAppointment(tenantId, updated.id);
  const [enriched] = await enrichAppointments(tenantId, [updated as any]);
  res.json(UpdateAppointmentResponse.parse(enriched));
});

// ─── DELETE /appointments/:id ─────────────────────────────────────────────────
router.delete("/appointments/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteAppointmentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = await AppointmentModel.findOne({
    id: parsed.data.id, tenantId, isDeleted: { $ne: true },
  }).lean();
  if (!existing) { res.status(404).json({ error: "Appointment not found" }); return; }
  // The calendar row follows the court date, so deleting it here would only be
  // undone by the next court-date refresh.
  if ((existing as any).courtDateId) {
    res.status(409).json({
      error: "This entry mirrors a court date. Remove the court date on the case file instead.",
      courtDateId: (existing as any).courtDateId,
    });
    return;
  }
  if ((existing as any).externalSource) {
    res.status(409).json({
      error: "This entry comes from your Google Calendar. Delete it in Google — the schedule follows it.",
    });
    return;
  }

  const updated = await AppointmentModel.findOneAndUpdate(
    { id: parsed.data.id, tenantId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, updatedAt: new Date() } },
  ).lean();

  if (!updated) { res.status(404).json({ error: "Appointment not found" }); return; }
  await removeAppointmentEvent(tenantId, updated.id);
  res.sendStatus(204);
});

export default router;
