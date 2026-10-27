import { randomUUID } from "node:crypto";
import {
  AppointmentModel,
  CaseModel,
  ClientModel,
  CourtDateModel,
} from "@workspace/db";
import { pushAppointment, removeAppointmentEvent } from "./googleCalendar";

/**
 * Court dates live on the case (CourtDate rows), but a lawyer plans the week
 * from one schedule. Every court date is therefore projected into an all-day
 * appointment row, which is what the calendar grid, the KPIs and the Google
 * sync all read.
 *
 * The mirror is one-way: the court date is the source of truth, the
 * appointment is the projection. An edit made in Google Calendar can change
 * the reminder or the notes, but it never rewrites the case file.
 */

// A court date is a date, not an instant: materialise it at UTC midnight so the
// day never shifts with the server's own timezone.
const dayStart = (date: string) => new Date(`${date}T00:00:00.000Z`);

function dayAfter(date: string) {
  const d = dayStart(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function mirrorTitle(caseNumber?: number | null, clientName?: string | null) {
  const file = caseNumber ? `#${caseNumber}` : "file";
  return clientName ? `Court — ${clientName} (${file})` : `Court — Case ${file}`;
}

function mirrorLocation(caseItem: any) {
  if (!caseItem) return null;
  const room = caseItem.courtRoomNumber ? `Room ${caseItem.courtRoomNumber}` : "";
  return [caseItem.courtLocation, room].filter(Boolean).join(" · ") || null;
}

function mirrorNotes(courtDate: any) {
  return [
    courtDate.outcome ? `Outcome: ${courtDate.outcome}` : "",
    courtDate.notes ?? "",
    "Mirrored from the case court date",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Create or refresh the all-day appointment for one court date.
 * Returns the mirror row id, or null when the court date is gone.
 */
export async function mirrorCourtDate(
  tenantId: string,
  courtDateId: string,
): Promise<string | null> {
  const courtDate: any = await CourtDateModel.findOne({ id: courtDateId, tenantId }).lean();
  if (!courtDate) return null;

  const caseItem: any = await CaseModel.findOne({ tenantId, id: courtDate.caseId })
    .select("caseNumber clientId courtLocation courtRoomNumber isDeleted")
    .lean();
  // Deleting a matter soft-deletes the case but leaves its court dates in the
  // database — a projection of those rows would resurrect the case on the
  // calendar, so drop any stale mirror instead.
  if (!caseItem || caseItem.isDeleted) {
    await removeCourtMirror(tenantId, courtDate.id);
    return null;
  }
  const client: any = caseItem?.clientId
    ? await ClientModel.findOne({ tenantId, id: caseItem.clientId })
        .select("fullName")
        .lean()
    : null;

  const patch: Record<string, unknown> = {
    tenantId,
    courtDateId: courtDate.id,
    clientId: caseItem?.clientId ?? null,
    caseId: courtDate.caseId,
    title: mirrorTitle(caseItem?.caseNumber, client?.fullName),
    type: "Court Appearance",
    allDay: true,
    startAt: dayStart(courtDate.date),
    endAt: dayAfter(courtDate.date),
    location: mirrorLocation(caseItem),
    notes: mirrorNotes(courtDate),
    // A court date is a fixed commitment, not a tentative booking: out of the
    // "awaiting confirmation" bucket, but always visible on the day.
    status: courtDate.outcome ? "completed" : "confirmed",
    isDeleted: false,
    updatedAt: new Date(),
  };

  const existing: any = await AppointmentModel.findOne({
    tenantId,
    courtDateId: courtDate.id,
  }).lean();

  const id = existing?.id ?? randomUUID();
  if (existing) {
    await AppointmentModel.updateOne({ id }, { $set: patch });
  } else {
    await AppointmentModel.create({
      id,
      ...patch,
      reminderSent: false,
      createdAt: new Date(),
    });
  }

  await pushAppointment(tenantId, id);
  return id;
}

/** Soft-delete the mirror (and its Google event) when the court date is removed. */
export async function removeCourtMirror(tenantId: string, courtDateId: string): Promise<void> {
  const mirror: any = await AppointmentModel.findOne({ tenantId, courtDateId }).lean();
  if (!mirror) return;
  await removeAppointmentEvent(tenantId, mirror.id);
  await AppointmentModel.deleteOne({ id: mirror.id });
}

/**
 * Older workspaces have court dates but no mirrors. Create whatever is
 * missing, and realign mirrors built before all-day rows were pinned to UTC
 * midnight — those sit an offset early and would show the wrong day on a host
 * in another timezone. Bounded per call so a huge practice never blocks a
 * request.
 */
export async function backfillCourtMirrors(tenantId: string, limit = 200): Promise<number> {
  const [courtDates, mirrors] = await Promise.all([
    CourtDateModel.find({ tenantId }).select("id caseId date").sort({ date: -1 }).limit(limit * 4).lean(),
    AppointmentModel.find({ tenantId, courtDateId: { $ne: null } })
      .select("courtDateId startAt")
      .lean(),
  ]);
  if (courtDates.length === 0) return 0;

  // Court dates of a deleted matter are still in the database; they must not
  // come back as calendar rows.
  const caseIds = [...new Set(courtDates.map((c: any) => c.caseId).filter(Boolean))];
  const alive = caseIds.length
    ? await CaseModel.find({ tenantId, id: { $in: caseIds }, isDeleted: { $ne: true } })
        .select("id")
        .lean()
    : [];
  const aliveIds = new Set(alive.map((c: any) => c.id));

  const mirrored = new Map<string, any>(mirrors.map((m: any) => [m.courtDateId, m.startAt]));
  const live = courtDates.filter((c: any) => aliveIds.has(c.caseId));
  const missing = live.filter((c: any) => !mirrored.has(c.id)).slice(0, limit);
  const drifted = live
    .filter(
      (c: any) =>
        mirrored.has(c.id) &&
        new Date(mirrored.get(c.id)).getTime() !== dayStart(c.date).getTime(),
    )
    .slice(0, limit);
  const todo = [...missing, ...drifted];
  if (todo.length === 0) return 0;

  let created = 0;
  for (const courtDate of todo) {
    const id = await mirrorCourtDate(tenantId, courtDate.id);
    if (id) created += 1;
  }
  return created;
}

/** Rebuild a mirror after its source court date changed (date, outcome, notes, court). */
export async function refreshCourtMirrorForCase(
  tenantId: string,
  caseId: string,
): Promise<void> {
  const courtDates = await CourtDateModel.find({ tenantId, caseId }).select("id").lean();
  for (const courtDate of courtDates) {
    await mirrorCourtDate(tenantId, courtDate.id);
  }
}

/** A deleted matter must not keep court rows on the calendar. */
export async function removeCourtMirrorsForCase(
  tenantId: string,
  caseId: string,
): Promise<void> {
  const mirrors = await AppointmentModel.find({ tenantId, caseId, courtDateId: { $ne: null } })
    .select("id")
    .lean();
  for (const mirror of mirrors) {
    await removeAppointmentEvent(tenantId, (mirror as any).id);
  }
  await AppointmentModel.deleteMany({ tenantId, caseId, courtDateId: { $ne: null } });
}