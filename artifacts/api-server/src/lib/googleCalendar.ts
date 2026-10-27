import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  AppointmentModel,
  CalendarConnectionModel,
  CaseModel,
  ClientModel,
} from "@workspace/db";

/**
 * Google Calendar two-way sync.
 *
 * Design notes:
 *  - Docketline pushes every appointment into a calendar it owns ("Docketline"),
 *    so the lawyer's personal calendar is never polluted and every event in that
 *    calendar is provably ours.
 *  - Pulls use Google's incremental `syncToken`, so a sync after the first one
 *    costs a single request.
 *  - Everything is stored in Mongo: the API runs serverless, so nothing may live
 *    in memory between requests. Refresh tokens are encrypted with AES-256-GCM.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * `calendar.app.created` is the least privilege that still does the job: it may
 * create a secondary calendar and manage events on calendars this app created,
 * but cannot read the lawyer's personal calendars. It is also not a sensitive
 * scope, so the consent screen stays a single tick box.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.app.created",
  // Lets the schedule show the lawyer's own Google meetings. Read-only on
  // purpose: nothing Docketline does can alter the lawyer's real calendar.
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * Scopes that allow writing to our own calendar. The full `calendar` scope is
 * still accepted so connections authorised before the switch keep working.
 */
const CALENDAR_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.app.created",
];

/** Did Google actually grant calendar access? A user can untick the box. */
export function scopeHasCalendar(scope?: string | null): boolean {
  return String(scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .some((granted) => CALENDAR_WRITE_SCOPES.includes(granted));
}

const CALENDAR_READ_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

/** Can we read the lawyer's own (primary) calendar? */
export function scopeCanReadPrimary(scope?: string | null): boolean {
  return String(scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .some((granted) => CALENDAR_READ_SCOPES.includes(granted));
}

/** Marks rows mirrored from a calendar Docketline does not own. */
export const EXTERNAL_SOURCE_PRIMARY = "google:primary";

/**
 * A traffic lawyer's own calendar is mostly court work, so the obvious ones get
 * the Court Appearance colour instead of arriving as a wall of "Other". The
 * title is the only signal Google gives us: ER = early resolution, MER = ministry
 * early resolution, S9/#NN are courthouse and information numbers.
 */
const COURT_TITLE = /\b(first appearance|appearance|disclosure|disclo|early resolution|remand|court|crown|trial|jp|er|mer)\b/i;
const guessType = (summary: string) =>
  COURT_TITLE.test(summary) ? "Court Appearance" : "Other";

export const GOOGLE_CALENDAR_NAME = "Docketline — Court & Client";
export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";

/**
 * Where Google sends the browser back to. It must match a redirect URI on the
 * OAuth client byte for byte, so it is configurable: clients that only register
 * the bare origin return to the SPA, whose inline relay hands `?code&state` on
 * to GOOGLE_CALLBACK_PATH.
 */
export function googleRedirectUri(appBaseUrl: string): string {
  const configured = (process.env.GOOGLE_REDIRECT_URI || "").trim();
  return configured || `${appBaseUrl}${GOOGLE_CALLBACK_PATH}`;
}

const timezone = () => process.env.CALENDAR_TIMEZONE || "America/Toronto";

const clientId = () => process.env.GOOGLE_CLIENT_ID || "";
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || "";

export const googleConfigured = () => !!clientId() && !!clientSecret();

// ─── token encryption ────────────────────────────────────────────────────────
const keyMaterial = () =>
  createHash("sha256")
    .update(process.env.TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_CLIENT_SECRET || "docketline-local-key")
    .digest();

function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, data, cipher.getAuthTag()].map((b) => b.toString("base64url")).join(".");
}

function decryptToken(payload: string): string {
  const [iv, data, tag] = payload.split(".");
  if (!iv || !data || !tag) throw new Error("Stored Google token is malformed — reconnect the calendar");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// ─── OAuth state (signed, so the public callback can trust tenant + user) ────
const stateSecret = () =>
  process.env.GOOGLE_STATE_SECRET || process.env.CLERK_SECRET_KEY || clientSecret() || "docketline-state";

export function createOAuthState(input: { tenantId: string; userId: string; appBaseUrl: string }): string {
  const body = Buffer.from(
    JSON.stringify({ t: input.tenantId, u: input.userId, b: input.appBaseUrl, ts: Date.now() }),
  ).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readOAuthState(
  state: string,
): { tenantId: string; userId: string; appBaseUrl: string | null } | null {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed?.t || !parsed?.u) return null;
    if (Date.now() - Number(parsed.ts) > 15 * 60 * 1000) return null;
    return {
      tenantId: String(parsed.t),
      userId: String(parsed.u),
      appBaseUrl: parsed.b ? String(parsed.b).replace(/\/+$/, "") : null,
    };
  } catch {
    return null;
  }
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export function baseUrlFromRequest(req: {
  protocol?: string;
  headers: Record<string, unknown>;
}): string {
  const configured = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  if (configured) return configured;
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:5000").split(",")[0].trim();
  return `${proto}://${host}`;
}

// ─── connection store ────────────────────────────────────────────────────────
export async function getConnection(tenantId: string, userId?: string) {
  const query: Record<string, unknown> = { tenantId };
  if (userId) query.userId = userId;
  return CalendarConnectionModel.findOne(query).sort({ updatedAt: -1 }).lean();
}

export async function disconnect(tenantId: string, userId?: string) {
  const query: Record<string, unknown> = { tenantId };
  if (userId) query.userId = userId;
  const conn = await CalendarConnectionModel.findOne(query).lean();
  if (conn) await CalendarConnectionModel.deleteOne({ id: conn.id });
  // Keep the events in Google: the lawyer may still want them on their phone.
  await AppointmentModel.updateMany(
    { tenantId, googleEventId: { $ne: null } },
    { $set: { googleEventId: null, googleSyncedAt: null, googleSyncError: null } },
  );
  return !!conn;
}

export async function saveConnection(input: {
  tenantId: string;
  userId: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  scope?: string | null;
  accountEmail?: string | null;
}) {
  const $set = {
    tenantId: input.tenantId,
    userId: input.userId,
    accountEmail: input.accountEmail ?? null,
    refreshToken: encryptToken(input.refreshToken),
    accessToken: input.accessToken,
    accessTokenExpiresAt: new Date(Date.now() + Math.max(0, input.expiresIn - 60) * 1000),
    scope: input.scope ?? null,
    lastError: null,
    updatedAt: new Date(),
  };
  const existing = await CalendarConnectionModel.findOne({
    tenantId: input.tenantId,
    userId: input.userId,
  }).lean();
  if (existing) {
    // A new consent may not resend a refresh token; keep the old one then.
    if (!input.refreshToken && existing.refreshToken) delete ($set as Record<string, unknown>).refreshToken;
    if (!input.refreshToken) ($set as Record<string, unknown>).refreshToken = existing.refreshToken;
    await CalendarConnectionModel.updateOne(
      { id: existing.id },
      { $set, $setOnInsert: { syncToken: null, calendarId: existing.calendarId ?? null } },
    );
    return CalendarConnectionModel.findOne({ id: existing.id }).lean();
  }
  await CalendarConnectionModel.create({
    id: randomUUID(),
    ...$set,
    syncToken: null,
    calendarId: null,
    calendarName: null,
    lastSyncedAt: null,
    createdAt: new Date(),
  });
  return getConnection(input.tenantId, input.userId);
}

// ─── Google HTTP ─────────────────────────────────────────────────────────────
async function refreshAccessToken(conn: any): Promise<string> {
  const refreshToken = decryptToken(conn.refreshToken);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const reason = json?.error_description || json?.error || `HTTP ${res.status}`;
    throw new Error(`Google token refresh failed: ${reason}`);
  }
  await CalendarConnectionModel.updateOne(
    { id: conn.id },
    {
      $set: {
        accessToken: json.access_token,
        accessTokenExpiresAt: new Date(Date.now() + Math.max(0, Number(json.expires_in ?? 3600) - 60) * 1000),
        updatedAt: new Date(),
      },
    },
  );
  conn.accessToken = json.access_token;
  conn.accessTokenExpiresAt = new Date(Date.now() + 3300 * 1000);
  return json.access_token;
}

async function accessTokenFor(conn: any, force = false): Promise<string> {
  const expiresAt = conn.accessTokenExpiresAt ? new Date(conn.accessTokenExpiresAt).getTime() : 0;
  if (!force && conn.accessToken && expiresAt > Date.now()) return conn.accessToken;
  return refreshAccessToken(conn);
}

async function googleFetch(conn: any, path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GOOGLE_API}${path}`;
  const send = async (force: boolean) => {
    const token = await accessTokenFor(conn, force);
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  };
  let res = await send(false);
  if (res.status === 401) res = await send(true);
  return res;
}

async function googleJson(conn: any, path: string, init: RequestInit = {}) {
  const res = await googleFetch(conn, path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // A token granted without the calendar box ticked produces a bare 403 deep
    // in a sync; name the fix rather than leaking Google's JSON.
    if (res.status === 403 && text.includes("insufficientPermissions")) {
      throw new Error(
        "Google refused the request because this connection has no calendar access. " +
          "Disconnect, then Connect again and tick the calendar permission on Google's screen.",
      );
    }
    throw new Error(`Google Calendar ${init.method ?? "GET"} ${path.replace(GOOGLE_API, "")} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return {};
  return res.json().catch(() => ({}));
}

/** Create the dedicated calendar once, then reuse its id forever. */
async function ensureCalendar(conn: any): Promise<string> {
  if (conn.calendarId) return conn.calendarId;
  const created: any = await googleJson(conn, "/calendars", {
    method: "POST",
    body: JSON.stringify({
      summary: GOOGLE_CALENDAR_NAME,
      description: "Court dates and client meetings created by Docketline",
      timeZone: timezone(),
    }),
  });
  await CalendarConnectionModel.updateOne(
    { id: conn.id },
    { $set: { calendarId: created.id, calendarName: created.summary ?? GOOGLE_CALENDAR_NAME, updatedAt: new Date() } },
  );
  conn.calendarId = created.id;
  return created.id;
}

// ─── mapping ─────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
// All-day rows carry a date, not an instant: they are stored at UTC midnight so
// the day never drifts with the server's own timezone (Vercel runs in UTC, a
// laptop usually does not).
const localDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const allDayDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

function nextDay(dateStr: string) {
  const d = allDayDate(dateStr);
  d.setUTCDate(d.getUTCDate() + 1);
  return localDay(d);
}

function appointmentBody(appt: any, ctx: { clientName?: string | null; caseNumber?: number | null }) {
  const start = new Date(appt.startAt);
  const end = new Date(appt.endAt);
  const cancelled = appt.status === "cancelled";
  const description = [
    ctx.clientName ? `Client: ${ctx.clientName}` : "",
    ctx.caseNumber ? `Case #${ctx.caseNumber}` : "",
    appt.notes ? String(appt.notes) : "",
    "",
    "Filed with Docketline",
  ].filter((line, i) => i < 3 || line === "" || line === "Filed with Docketline").join("\n").trim();

  const body: Record<string, unknown> = {
    summary: appt.title,
    description,
    status: cancelled ? "cancelled" : "confirmed",
    transparency: cancelled ? "transparent" : "opaque",
    reminders: { useDefault: true },
    extendedProperties: {
      private: { docketlineId: appt.id, docketlineKind: "appointment" },
    },
  };
  if (appt.location) body.location = appt.location;

  if (appt.allDay) {
    const day = localDay(start);
    body.start = { date: day };
    body.end = { date: nextDay(day) };
  } else {
    body.start = { dateTime: start.toISOString(), timeZone: timezone() };
    body.end = { dateTime: end.toISOString(), timeZone: timezone() };
  }
  return body;
}

async function contextFor(tenantId: string, appt: any) {
  const [client, caseItem] = await Promise.all([
    appt.clientId ? ClientModel.findOne({ tenantId, id: appt.clientId }).select("fullName").lean() : null,
    appt.caseId ? CaseModel.findOne({ tenantId, id: appt.caseId }).select("caseNumber").lean() : null,
  ]);
  return { clientName: client?.fullName ?? null, caseNumber: caseItem?.caseNumber ?? null };
}

async function markSync(apptId: string, tenantId: string, patch: Record<string, unknown>) {
  await AppointmentModel.updateOne({ id: apptId, tenantId }, { $set: patch });
}

/** Push one appointment (create or update its Google event). */
export async function pushAppointment(tenantId: string, appointmentId: string): Promise<boolean> {
  if (!googleConfigured()) return false;
  const conn = await getConnection(tenantId);
  if (!conn) return false;
  const appt: any = await AppointmentModel.findOne({
    id: appointmentId,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!appt) return false;

  try {
    const calendarId = await ensureCalendar(conn);
    const body = appointmentBody(appt, await contextFor(tenantId, appt));
    let eventId: string | null = appt.googleEventId ?? null;

    if (eventId) {
      try {
        await googleJson(conn, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } catch (error: any) {
        // Deleted on the Google side — recreate rather than lose the booking.
        if (!/\((404|410)\)/.test(String(error?.message))) throw error;
        eventId = null;
      }
    }
    if (!eventId) {
      const created: any = await googleJson(
        conn,
        `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
        { method: "POST", body: JSON.stringify(body) },
      );
      eventId = created.id;
    }

    await markSync(appt.id, tenantId, {
      googleEventId: eventId,
      googleSyncedAt: new Date(),
      googleSyncError: null,
    });
    return true;
  } catch (error: any) {
    await markSync(appt.id, tenantId, {
      googleSyncError: String(error?.message ?? "Google sync failed").slice(0, 400),
    });
    return false;
  }
}

/** Remove the Google event for a deleted appointment. */
export async function removeAppointmentEvent(tenantId: string, appointmentId: string): Promise<void> {
  if (!googleConfigured()) return;
  const conn = await getConnection(tenantId);
  if (!conn) return;
  const appt: any = await AppointmentModel.findOne({ id: appointmentId, tenantId }).lean();
  if (!appt?.googleEventId) return;
  try {
    const calendarId = await ensureCalendar(conn);
    await googleFetch(
      conn,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(appt.googleEventId)}?sendUpdates=none`,
      { method: "DELETE" },
    );
  } catch {
    // A missing event is fine — the goal is that it is gone.
  }
}

// ─── pull ────────────────────────────────────────────────────────────────────
function eventWindow() {
  const timeMin = new Date(Date.now() - 45 * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 365 * 86400000).toISOString();
  return { timeMin, timeMax };
}

async function pullFromGoogle(conn: any): Promise<{ pulled: number; updated: number }> {
  const calendarId = await ensureCalendar(conn);
  let pageToken: string | undefined;
  let syncToken: string | undefined = conn.syncToken || undefined;
  let nextSyncToken: string | undefined;
  let pulled = 0;
  let updated = 0;

  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      maxResults: "2500",
      showDeleted: "true",
      singleEvents: "false",
    });
    if (syncToken) params.set("syncToken", syncToken);
    else {
      const { timeMin, timeMax } = eventWindow();
      params.set("timeMin", timeMin);
      params.set("timeMax", timeMax);
    }
    if (pageToken) params.set("pageToken", pageToken);

    const res = await googleFetch(
      conn,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    );
    if (res.status === 410) {
      // Cursor expired — start over with a clean full sync.
      await CalendarConnectionModel.updateOne({ id: conn.id }, { $set: { syncToken: null } });
      conn.syncToken = null;
      syncToken = undefined;
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google Calendar pull failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const json: any = await res.json();
    for (const event of json.items ?? []) {
      const marker = event?.extendedProperties?.private?.docketlineId as string | undefined;
      if (marker) {
        const appt: any = await AppointmentModel.findOne({ id: marker, tenantId: conn.tenantId }).lean();
        if (!appt) {
          // Orphan: the row is gone (typically an ephemeral local database was
          // reset) while the event lingers. Delete it so a reconnect cannot
          // stack a duplicate next to it.
          await googleFetch(
            conn,
            `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
            { method: "DELETE" },
          ).catch(() => undefined);
          continue;
        }
        if (event.status === "cancelled") {
          if (appt.status !== "cancelled") {
            await markSync(appt.id, conn.tenantId, { status: "cancelled", googleSyncedAt: new Date(), updatedAt: new Date() });
            updated += 1;
          }
          continue;
        }
        const eventUpdated = new Date(event.updated).getTime();
        const localUpdated = new Date(appt.updatedAt).getTime();
        if (Number.isFinite(eventUpdated) && eventUpdated <= localUpdated) continue;

        // A court-date mirror is a projection of the case file: its content is
        // owned by Docketline, so only the sync timestamp is refreshed.
        if (appt.courtDateId) {
          await markSync(appt.id, conn.tenantId, { googleSyncedAt: new Date() });
          continue;
        }

        const start = event.start?.date ? allDayDate(event.start.date) : new Date(event.start?.dateTime);
        const end = event.end?.date ? allDayDate(event.end.date) : new Date(event.end?.dateTime);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
        await markSync(appt.id, conn.tenantId, {
          title: event.summary?.trim() || appt.title,
          startAt: start,
          endAt: end,
          allDay: !!event.start?.date,
          location: event.location ?? null,
          notes: event.description ?? null,
          googleSyncedAt: new Date(),
          updatedAt: new Date(),
        });
        updated += 1;
        continue;
      }

      // An event the lawyer created directly inside the Docketline calendar.
      if (event.status === "cancelled") continue;
      const startRaw = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00.000Z` : null);
      const endRaw = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00.000Z` : null);
      if (!startRaw || !endRaw) continue;
      const start = new Date(startRaw);
      const end = new Date(endRaw);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

      const created: any = await AppointmentModel.create({
        id: randomUUID(),
        tenantId: conn.tenantId,
        clientId: null,
        caseId: null,
        title: event.summary?.trim() || "Google Calendar event",
        type: "Other",
        startAt: start,
        endAt: end,
        allDay: !!event.start?.date,
        location: event.location ?? null,
        notes: event.description ?? null,
        status: "scheduled",
        googleEventId: event.id,
        googleSyncedAt: new Date(),
      });
      // Tag it so the next incremental pull maps it back to this row.
      await googleFetch(
        conn,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}?sendUpdates=none`,
        {
          method: "PATCH",
          body: JSON.stringify({
            extendedProperties: { private: { docketlineId: created.id, docketlineKind: "appointment" } },
          }),
        },
      ).catch(() => undefined);
      pulled += 1;
    }

    pageToken = json.nextPageToken;
    if (json.nextSyncToken) nextSyncToken = json.nextSyncToken;
    if (!pageToken) break;
  }

  if (nextSyncToken) {
    await CalendarConnectionModel.updateOne({ id: conn.id }, { $set: { syncToken: nextSyncToken } });
    conn.syncToken = nextSyncToken;
  }
  return { pulled, updated };
}

/** Push everything that has never reached Google (first connect / retries). */
async function pushPending(conn: any): Promise<number> {
  const pending: any[] = await AppointmentModel.find({
    tenantId: conn.tenantId,
    isDeleted: { $ne: true },
    // Imports carry an id from the lawyer's own calendar and are read-only here.
    externalSource: null,
    $or: [{ googleEventId: null }, { googleSyncError: { $ne: null } }],
  })
    .sort({ startAt: 1 })
    // Kept small: a sync runs inside a request and must not hit the 30 s
    // serverless ceiling. The next sync picks up whatever is left.
    .limit(120)
    .lean();

  let pushed = 0;
  for (const appt of pending) {
    const ok = await pushAppointment(conn.tenantId, appt.id);
    if (ok) pushed += 1;
  }
  return pushed;
}

/**
 * An all-day booking is a date, not an instant. Builds before this one stored
 * it at the server's own local midnight, so the same row read as a different
 * day on a host in another timezone. Snap those rows to the nearest UTC
 * midnight and push again, so Google keeps the same date. Court mirrors are
 * rebuilt from the case file instead, and imported rows belong to Google.
 */
async function repinAllDayRows(tenantId: string): Promise<number> {
  const DAY = 86400000;
  const rows: any[] = await AppointmentModel.find({
    tenantId,
    isDeleted: { $ne: true },
    allDay: true,
    courtDateId: null,
    externalSource: null,
  })
    .select("id startAt endAt")
    .limit(200)
    .lean();

  let fixed = 0;
  for (const row of rows) {
    const start = new Date(row.startAt);
    const end = new Date(row.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const startDay = Math.round(start.getTime() / DAY) * DAY;
    const endDay = Math.round(end.getTime() / DAY) * DAY;
    if (startDay === start.getTime() && endDay === end.getTime()) continue;
    await AppointmentModel.updateOne(
      { id: row.id },
      { $set: { startAt: new Date(startDay), endAt: new Date(endDay), updatedAt: new Date() } },
    );
    await pushAppointment(tenantId, row.id);
    fixed += 1;
  }
  return fixed;
}

// ─── primary calendar import ─────────────────────────────────────────────────
/**
 * Mirror the lawyer's own Google Calendar into the schedule so meetings that
 * live there — the client calls the lawyer already keeps in Google — show up
 * next to court dates. These rows are read-only: the push path skips them and
 * the appointment routes refuse edits, so nothing here can reach the real
 * calendar. Full refresh per sync; the event ids are the join key.
 */
async function importFromPrimary(conn: any): Promise<{ imported: number; removed: number }> {
  const timeMin = new Date(Date.now() - 45 * 86400000);
  const timeMax = new Date(Date.now() + 365 * 86400000);
  const seen: string[] = [];
  let imported = 0;
  let pageToken: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      maxResults: "2500",
      singleEvents: "true",
      orderBy: "startTime",
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const json: any = await googleJson(conn, `/calendars/primary/events?${params.toString()}`);

    for (const event of json.items ?? []) {
      if (event.status === "cancelled") continue;
      // Our own bookings already live in the Docketline calendar.
      if (event?.extendedProperties?.private?.docketlineId) continue;

      const startRaw = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00.000Z` : null);
      const endRaw = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T00:00:00.000Z` : null);
      if (!startRaw || !endRaw) continue;
      const startAt = new Date(startRaw);
      const endAt = new Date(endRaw);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) continue;
      seen.push(event.id);

      const fields = {
        title: event.summary?.trim() || "(no title)",
        type: guessType(event.summary ?? ""),
        startAt,
        endAt,
        allDay: !!event.start?.date,
        location: event.location ?? null,
        notes: event.description ?? null,
        googleSyncedAt: new Date(),
        updatedAt: new Date(),
      };

      const existing: any = await AppointmentModel.findOne({
        tenantId: conn.tenantId,
        externalSource: EXTERNAL_SOURCE_PRIMARY,
        googleEventId: event.id,
      }).lean();

      if (!existing) {
        await AppointmentModel.create({
          id: randomUUID(),
          tenantId: conn.tenantId,
          clientId: null,
          caseId: null,
          status: "confirmed",
          externalSource: EXTERNAL_SOURCE_PRIMARY,
          googleEventId: event.id,
          ...fields,
        });
        imported += 1;
        continue;
      }

      const moved = new Date(existing.startAt).getTime() !== startAt.getTime()
        || new Date(existing.endAt).getTime() !== endAt.getTime()
        || existing.title !== fields.title
        || existing.type !== fields.type
        || Boolean(existing.allDay) !== fields.allDay
        || existing.isDeleted;
      await AppointmentModel.updateOne(
        { id: existing.id },
        { $set: moved ? { ...fields, isDeleted: false } : { googleSyncedAt: fields.googleSyncedAt } },
      );
      if (moved) imported += 1;
    }

    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  // Anything Google no longer returns within the window was deleted or moved.
  const gone = await AppointmentModel.updateMany(
    {
      tenantId: conn.tenantId,
      externalSource: EXTERNAL_SOURCE_PRIMARY,
      isDeleted: { $ne: true },
      googleEventId: { $nin: seen },
      startAt: { $gte: timeMin, $lte: timeMax },
    },
    { $set: { isDeleted: true, updatedAt: new Date() } },
  );

  return { imported, removed: gone.modifiedCount ?? 0 };
}

// ─── public status + sync ────────────────────────────────────────────────────
export async function googleStatus(tenantId: string) {
  const conn = await getConnection(tenantId);
  const [syncedCount, errorCount] = await Promise.all([
    AppointmentModel.countDocuments({ tenantId, isDeleted: { $ne: true }, externalSource: null, googleEventId: { $ne: null } }),
    AppointmentModel.countDocuments({ tenantId, isDeleted: { $ne: true }, externalSource: null, googleSyncError: { $ne: null } }),
  ]);
  return {
    configured: googleConfigured(),
    connected: !!conn,
    accountEmail: conn?.accountEmail ?? null,
    calendarName: conn?.calendarName ?? null,
    lastSyncedAt: conn?.lastSyncedAt ?? null,
    lastError: conn?.lastError ?? null,
    syncedCount,
    errorCount,
  };
}

export async function runGoogleSync(tenantId: string) {
  const conn: any = await getConnection(tenantId);
  if (!conn) return { connected: false, pushed: 0, pulled: 0, updated: 0 };
  try {
    const pushed = await pushPending(conn);
    await repinAllDayRows(tenantId);
    const pulled = await pullFromGoogle(conn);
    // A missing read scope (or a Google hiccup) must not take the Docketline sync
    // down with it, but it must be visible: the lawyer's own meetings are the
    // whole point of this half of the integration.
    let primary = { imported: 0, removed: 0 };
    let note: string | null = null;
    if (scopeCanReadPrimary(conn.scope)) {
      try {
        primary = await importFromPrimary(conn);
      } catch (error: any) {
        note = `Your own Google Calendar could not be read: ${String(error?.message ?? error).slice(0, 200)}`;
      }
    } else {
      note = "Your own Google Calendar is not readable yet — click Connect again and leave the calendar permission ticked.";
    }
    await CalendarConnectionModel.updateOne(
      { id: conn.id },
      { $set: { lastSyncedAt: new Date(), lastError: note, updatedAt: new Date() } },
    );
    return { connected: true, pushed, ...pulled, ...primary, ...(note ? { error: note } : {}) };
  } catch (error: any) {
    const message = String(error?.message ?? "Sync failed").slice(0, 400);
    await CalendarConnectionModel.updateOne(
      { id: conn.id },
      { $set: { lastError: message, updatedAt: new Date() } },
    );
    return { connected: true, pushed: 0, pulled: 0, updated: 0, error: message };
  }
}

// ─── OAuth exchange ──────────────────────────────────────────────────────────
export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json?.error_description || json?.error || `Google token exchange failed (${res.status})`);
  }
  return {
    accessToken: json.access_token as string,
    refreshToken: (json.refresh_token as string) || "",
    expiresIn: Number(json.expires_in ?? 3600),
    scope: (json.scope as string) || null,
  };
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_USERINFO, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    return json?.email ?? null;
  } catch {
    return null;
  }
}

