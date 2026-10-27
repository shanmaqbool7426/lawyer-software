import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'wouter';
import {
  AlertCircle, AlertTriangle, CalendarClock, Check, ChevronLeft,
  ChevronRight, Clock, FolderOpen, Loader2, MapPin, Pencil,
  Plus, Trash2, User, X, Calendar, Search, ArrowDownToLine,
  ExternalLink, Briefcase, RotateCcw, UserX, RefreshCw, Link2, Unlink, Landmark,
} from 'lucide-react';
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUSES,
  getCalendarAppointmentsQueryKey,
  getGetAppointmentSummaryQueryKey,
  getGetCaseQueryKey,
  getListAppointmentsQueryKey,
  useCalendarAppointments,
  useCheckConflict,
  useCreateAppointment,
  useDeleteAppointment,
  useGetAppointmentSummary,
  useGetCase,
  useListAppointments,
  useUpdateAppointment,
  useListClients,
  useListCases,
  getListClientsQueryKey,
  getListCasesQueryKey,
  useGoogleIntegration,
  useStartGoogleIntegration,
  useSyncGoogleIntegration,
  useDisconnectGoogleIntegration,
  getGoogleIntegrationQueryKey,
} from '@workspace/api-client-react';
import type {
  Appointment,
  AppointmentInput,
  AppointmentList,
  AppointmentStatus,
  AppointmentUpdate,
  ListAppointmentsParams,
} from '@workspace/api-client-react';

// ─── Constants ───────────────────────────────────────────────────────────────
const DAY_START_HOUR = 7;   // 7 AM — grid default, stretched earlier only when needed
const DAY_END_HOUR   = 20;  // 8 PM — grid default, stretched later only when needed
const SLOT_HEIGHT_PX = 56;  // pixels per hour
const MIN_DAY_WIDTH  = 88;  // below this a title is unreadable, so the grid scrolls instead
const GUTTER_WIDTH   = 52;  // time-label rail
const HEADER_HEIGHT  = 40;  // weekday header row
const ALLDAY_HEIGHT  = 38;  // all-day band — where court dates live

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS     = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ─── Type colour map ──────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'Consultation':    { bg: '#c957431a', border: '#c95743', text: '#c95743' },
  'Court Appearance':{ bg: '#b8403f1a', border: '#b8403f', text: '#b8403f' },
  'Client Meeting':  { bg: '#2e8f7b1a', border: '#2e8f7b', text: '#2e8f7b' },
  'Phone Call':      { bg: '#4b7bb51a', border: '#4b7bb5', text: '#4b7bb5' },
  'Video Call':      { bg: '#7a5ca01a', border: '#7a5ca0', text: '#7a5ca0' },
  'Document Review': { bg: '#e8a83e1a', border: '#e8a83e', text: '#c8881e' },
  'Mediation':       { bg: '#3d6b8f1a', border: '#3d6b8f', text: '#3d6b8f' },
  'Deposition':      { bg: '#8f3d5a1a', border: '#8f3d5a', text: '#8f3d5a' },
  'Site Visit':      { bg: '#6b8f3d1a', border: '#6b8f3d', text: '#6b8f3d' },
  'Other':           { bg: '#6470801a', border: '#647080', text: '#647080' },
};
const typeColor = (t: string) =>
  TYPE_COLORS[t] ?? { bg: '#6470801a', border: '#647080', text: '#647080' };

// ─── Status colours ───────────────────────────────────────────────────────────
const STATUS_COLORS: Record<AppointmentStatus, { color: string; bg: string }> = {
  scheduled: { color: '#4b7bb5', bg: '#4b7bb514' },
  confirmed:  { color: '#2e8f7b', bg: '#2e8f7b14' },
  completed:  { color: '#647080', bg: '#64708014' },
  cancelled:  { color: '#b8403f', bg: '#b8403f12' },
  no_show:    { color: '#c97043', bg: '#c9704312' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');

/** The office clock, whatever timezone the laptop is set to. */
const FIRM_TZ = 'America/Toronto';

function firmClock(d: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FIRM_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const at = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: at('year'), m: at('month'), d: at('day'), h: at('hour') % 24, mi: at('minute') };
}

/** A Date whose local getters read as the office wall clock — display maths only. */
const asFirm = (d: Date) => {
  const c = firmClock(d);
  return new Date(c.y, c.m - 1, c.d, c.h, c.mi);
};

/** "2026-11-04T09:00" typed in the office → the instant it really means. */
const firmToInstant = (wall: string) => {
  const [day, time = '00:00'] = wall.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const seen  = firmClock(new Date(guess));
  return new Date(guess + (guess - Date.UTC(seen.y, seen.m - 1, seen.d, seen.h, seen.mi)));
};

/** All-day rows carry a date at UTC midnight; read that day back unchanged. */
const utcDate = (iso: string | Date) => {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const fmtTimeAmPm = (d: Date) => {
  const wall = asFirm(d);
  const h = wall.getHours();
  const m = wall.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${pad(m)} ${ampm}`;
};

const fmtDateLong = (d: Date) =>
  d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const fmtDateShort = (d: Date) =>
  d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const startOfWeek = (d: Date): Date => {
  const day = new Date(d);
  const dow = (day.getDay() + 6) % 7; // Mon=0
  day.setDate(day.getDate() - dow);
  day.setHours(0, 0, 0, 0);
  return day;
};

const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

const toLocalISODate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const toLocalISODatetime = (d: Date) =>
  `${toLocalISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Every appointment query lives under this prefix, so one call refreshes the
 *  calendar grid, the register, the counters and the detail card together. */
const invalidateAppointments = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['/api/appointments'] });

/** Court dates are projected into all-day rows: they belong in the band above
 *  the hours, never inside a time slot. */
const isAllDayAppt = (a: Appointment) => a.allDay === true;
const isCourtAppt  = (a: Appointment) => !!a.courtDateId;
/** Mirrored from the lawyer's own Google Calendar: shown here, edited in Google. */
const isExternalAppt = (a: Appointment) => !!a.externalSource;
/** The day a row sits on, as the office calendar reads it. */
const apptDate = (a: Appointment) =>
  (isAllDayAppt(a) ? utcDate(a.startAt) : asFirm(new Date(a.startAt)));

/**
 * "Add to Google Calendar" deep link. Used when the workspace has not connected
 * its account yet (or the lawyer wants the event in a different calendar): the
 * browser opens Google's own event template, pre-filled.
 */
const gDay   = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const gStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

function googleCalendarUrl(appt: Appointment): string {
  const start = new Date(appt.startAt);
  const end   = new Date(appt.endAt);
  const dates = appt.allDay ? `${gDay(start)}/${gDay(end)}` : `${gStamp(start)}/${gStamp(end)}`;
  const details = [
    appt.clientName ? `Client: ${appt.clientName}` : '',
    appt.caseNumber ? `Case #${appt.caseNumber}` : '',
    appt.notes ?? '',
    'Filed with Docketline',
  ].filter(Boolean).join('\n');
  const sp = new URLSearchParams({ action: 'TEMPLATE', text: appt.title, dates });
  if (details) sp.set('details', details);
  if (appt.location) sp.set('location', appt.location);
  return `https://calendar.google.com/calendar/render?${sp.toString()}`;
}

/** Sorting "past" newest-first is what people actually expect to see. */
type RangeFilter = '' | 'upcoming' | 'today' | 'next7' | 'past';

interface RegisterFilters {
  type: string;
  status: string;
  source: '' | 'docketline' | 'google';
  range: RangeFilter;
  sort: 'soonest' | 'latest';
  from: string;
  to: string;
}

const EMPTY_FILTERS: RegisterFilters = { type: '', status: '', source: '', range: '', sort: 'soonest', from: '', to: '' };

// ─── Shared sub-components ────────────────────────────────────────────────────
function Skeleton({ w, h }: { w?: number | string; h?: number }) {
  return <div className="skeleton" style={{ width: w ?? '100%', height: h ?? 12, borderRadius: 4 }} />;
}

function StatusPill({ status }: { status: AppointmentStatus }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.scheduled;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', minHeight: 20, borderRadius: 5,
      padding: '0 7px', fontSize: 10, fontFamily: 'var(--app-font-mono)', fontWeight: 700,
      letterSpacing: '.02em', color: c.color, background: c.bg,
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Google Calendar connection strip ─────────────────────────────────────────
/**
 * The API reports a failed round trip as ?google=error&reason=… — translate the
 * codes so the lawyer reads what to do, not an OAuth constant.
 */
const CONNECT_ERRORS: Record<string, string> = {
  expired: 'That connect link timed out — click Connect again.',
  nocalendar:
    "Google signed you in but did not grant calendar access. Click Connect again and tick the calendar permission on Google's screen.",
  access_denied: 'You declined the Google prompt — nothing was connected.',
};
/**
 * One row that answers the only two questions a lawyer has about the calendar:
 * "is my phone in step?" and "how do I fix it if it isn't?".
 */
function GoogleSyncPanel() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusQ    = useGoogleIntegration();
  const start      = useStartGoogleIntegration();
  const sync       = useSyncGoogleIntegration();
  const disconnect = useDisconnectGoogleIntegration();
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // The OAuth round trip comes back as ?google=connected|error&reason=…
  useEffect(() => {
    const flag = searchParams.get('google');
    if (!flag) return;
    const reason = searchParams.get('reason');
    setNote(flag === 'connected'
      ? { kind: 'ok', text: 'Google Calendar connected — court dates and bookings now sync both ways.' }
      : { kind: 'err', text: CONNECT_ERRORS[reason ?? ''] ?? `Google Calendar could not connect: ${reason ?? 'unknown error'}.` });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('google');
      next.delete('reason');
      return next;
    }, { replace: true });
    qc.invalidateQueries({ queryKey: getGoogleIntegrationQueryKey() });
  }, [searchParams, setSearchParams, qc]);

  const status     = statusQ.data;
  const connected  = status?.connected ?? false;
  const configured = status?.configured ?? false;

  const handleConnect = () => {
    setNote(null);
    start.mutate(undefined, {
      onSuccess: (r) => {
        if (r.url) window.location.assign(r.url);
        else setNote({ kind: 'err', text: r.error ?? 'Google Calendar is not configured on this server.' });
      },
      onError: (e) => setNote({ kind: 'err', text: (e as Error).message }),
    });
  };

  const handleSync = () => {
    setNote(null);
    sync.mutate(undefined, {
      onSuccess: (r) => {
        invalidateAppointments(qc);
        qc.invalidateQueries({ queryKey: getGoogleIntegrationQueryKey() });
        setNote(r.error
          ? { kind: 'err', text: r.error }
          : { kind: 'ok', text: `Synced — ${r.pushed} sent, ${r.updated} updated, ${r.pulled} pulled in, ${r.imported ?? 0} read from your Google Calendar.` });
      },
      onError: (e) => setNote({ kind: 'err', text: (e as Error).message }),
    });
  };

  const handleDisconnect = () => {
    if (!window.confirm('Disconnect Google Calendar? Events already sent stay in Google, but new bookings stop syncing.')) return;
    disconnect.mutate(undefined, {
      onSuccess: () => {
        invalidateAppointments(qc);
        qc.invalidateQueries({ queryKey: getGoogleIntegrationQueryKey() });
        setNote({ kind: 'ok', text: 'Google Calendar disconnected.' });
      },
      onError: (e) => setNote({ kind: 'err', text: (e as Error).message }),
    });
  };

  /** Drop the stored token and run the consent flow again — the only cure when
   *  Google granted the account without calendar rights. */
  const handleReconnect = () => {
    setNote(null);
    disconnect.mutate(undefined, {
      onSuccess: () => {
        start.mutate(undefined, {
          onSuccess: (r) => {
            if (r.url) window.location.assign(r.url);
            else setNote({ kind: 'err', text: r.error ?? 'Google Calendar is not configured on this server.' });
          },
          onError: (e) => setNote({ kind: 'err', text: (e as Error).message }),
        });
      },
      onError: (e) => setNote({ kind: 'err', text: (e as Error).message }),
    });
  };

  return (
    <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'grid', placeItems: 'center',
          background: connected ? '#2e8f7b14' : 'hsl(var(--muted) / .6)',
          color: connected ? '#2e8f7b' : 'hsl(var(--muted-foreground))',
        }}>
          <Link2 size={14} />
        </span>

        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          {statusQ.isLoading ? (
            <Skeleton w={220} h={11} />
          ) : connected ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700 }}>
                Google Calendar · {status?.accountEmail ?? 'connected'}
              </div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
                Two-way sync · {status?.syncedCount ?? 0} event{(status?.syncedCount ?? 0) === 1 ? '' : 's'} on the books
                {status?.lastSyncedAt ? ` · last sync ${new Date(status.lastSyncedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ' · not synced yet'}
              </div>
            </>
          ) : configured ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'hsl(var(--destructive))' }}>
                Google Calendar is not connected — your own meetings are not showing yet
              </div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
                Connect once and leave <strong>both</strong> permission lines ticked on Google&apos;s screen: the Docketline
                calendar (court dates go out) and “See and download any calendar you can access” (your own meetings come in, read-only).
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Google Calendar sync is off</div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
                Set <span className="mono">GOOGLE_CLIENT_ID</span> and <span className="mono">GOOGLE_CLIENT_SECRET</span> on the server to switch on two-way sync.
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {connected ? (
            <>
              <button className="button button-ghost" style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}
                onClick={handleSync} disabled={sync.isPending} title="Pull Google changes and push anything new">
                {sync.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {sync.isPending ? 'Syncing…' : 'Sync now'}
              </button>
              {(status?.lastError || !status?.calendarName) && (
                <button className="button button-accent" style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }}
                  onClick={handleReconnect} disabled={disconnect.isPending || start.isPending}
                  title="Grant calendar access again">
                  <RotateCcw size={12} /> Reconnect
                </button>
              )}
              <button className="button button-ghost" style={{ minHeight: 30, padding: '0 9px', fontSize: 11 }}
                onClick={handleDisconnect} disabled={disconnect.isPending} title="Stop syncing">
                <Unlink size={12} /> Disconnect
              </button>
            </>
          ) : configured ? (
            <button className="button button-accent" style={{ minHeight: 30, padding: '0 12px', fontSize: 11 }}
              onClick={handleConnect} disabled={start.isPending}>
              {start.isPending ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
              {start.isPending ? 'Opening Google…' : 'Connect Google Calendar'}
            </button>
          ) : null}
        </div>
      </div>

      {(note || status?.lastError) && (
        <div style={{
          marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10.5, lineHeight: 1.5,
          color: (note?.kind === 'err' || (!note && status?.lastError)) ? 'hsl(var(--destructive))' : '#2e8f7b',
        }}>
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0, opacity: note?.kind === 'err' ? 1 : 0.5 }} />
          <span>{note?.text ?? `Last sync issue: ${status?.lastError}`}</span>
        </div>
      )}
    </div>
  );
}

// ─── Appointment card (used inside calendar cells) ────────────────────────────
interface ApptCardProps {
  appt: Appointment;
  compact?: boolean;
  onClick: (a: Appointment) => void;
}
function ApptCard({ appt, compact, onClick }: ApptCardProps) {
  const c = typeColor(appt.type);
  const isCancelled = appt.status === 'cancelled' || appt.status === 'no_show';
  return (
    <div
      onClick={() => onClick(appt)}
      title={`${appt.title}\n${appt.allDay ? 'All day' : `${fmtTimeAmPm(new Date(appt.startAt))} – ${fmtTimeAmPm(new Date(appt.endAt))}`}`}
      style={{
        background: c.bg,
        borderLeft: `3px solid ${c.border}`,
        borderRadius: 4,
        padding: compact ? '2px 5px' : '4px 7px',
        cursor: 'pointer',
        opacity: isCancelled ? 0.5 : 1,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <div style={{
        fontSize: compact ? 10 : 11,
        fontWeight: 700,
        color: c.text,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textDecoration: isCancelled ? 'line-through' : 'none',
      }}>
        {appt.title}
      </div>
      {!compact && (
        <div style={{ fontSize: 9, color: c.text, opacity: .75, marginTop: 1 }}>
          {appt.allDay ? 'All day' : fmtTimeAmPm(new Date(appt.startAt))}
          {appt.clientName && ` · ${appt.clientName}`}
        </div>
      )}
    </div>
  );
}

// ─── Add / Edit form ──────────────────────────────────────────────────────────
interface ApptFormProps {
  editing?: Appointment | null;
  defaultDate?: string;   // YYYY-MM-DD
  defaultHour?: number;
  defaultAllDay?: boolean;
  defaultCaseId?: string;
  defaultClientId?: string;
  defaultClientName?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function AppointmentForm({
  editing, defaultDate, defaultHour, defaultAllDay,
  defaultCaseId, defaultClientId, defaultClientName,
  onSuccess, onCancel,
}: ApptFormProps) {
  const qc          = useQueryClient();
  const create      = useCreateAppointment();
  const update      = useUpdateAppointment();

  const clients = useListClients(
    { limit: 200 },
    { query: { queryKey: getListClientsQueryKey({ limit: 200 }), staleTime: 60000 } },
  );
  const [selClient, setSelClient] = useState(editing?.clientId ?? defaultClientId ?? '');

  const cases = useListCases(
    { clientId: selClient || undefined, limit: 100 },
    { query: { queryKey: getListCasesQueryKey({ clientId: selClient || undefined, limit: 100 }), staleTime: 30000, enabled: !!selClient } },
  );

  // Form state
  const defDate  = defaultDate ?? toLocalISODate(asFirm(new Date()));
  const defHour  = defaultHour ?? 9;
  const defStart = `${defDate}T${pad(defHour)}:00`;
  // An 11 pm slot has to end at midnight on the next day — "24:00" is not a real
  // datetime-local value, and the browser would silently blank the field.
  const defEnd   = toLocalISODatetime(new Date(new Date(defStart).getTime() + 3_600_000));

  const [title,    setTitle]    = useState(editing?.title    ?? '');
  const [type,     setType]     = useState(editing?.type     ?? 'Consultation');
  const [caseId,   setCaseId]   = useState(editing?.caseId   ?? defaultCaseId ?? '');
  const [startAt,  setStartAt]  = useState(editing ? toLocalISODatetime(editing.allDay ? utcDate(editing.startAt) : asFirm(new Date(editing.startAt))) : defStart);
  const [endAt,    setEndAt]    = useState(editing ? toLocalISODatetime(editing.allDay ? utcDate(editing.endAt) : asFirm(new Date(editing.endAt))) : defEnd);
  const [location, setLocation] = useState(editing?.location ?? '');
  const [notes,    setNotes]    = useState(editing?.notes    ?? '');
  const [status,   setStatus]   = useState<AppointmentStatus>(editing?.status ?? 'scheduled');
  const [allDay,   setAllDay]   = useState<boolean>(editing?.allDay ?? defaultAllDay ?? false);
  const [serverErr,setServerErr]= useState('');

  /** Toggling all-day swaps the time fields for a single date: the block becomes
   *  [date 00:00, next date 00:00), which is what the API stores. */
  const handleAllDayToggle = (on: boolean) => {
    setAllDay(on);
    const day  = startAt.slice(0, 10) || toLocalISODate(new Date());
    const time = startAt.slice(11, 16);
    const keep = time && time !== '00:00' ? time : `${pad(defHour)}:00`;
    if (on) {
      setStartAt(`${day}T00:00`);
      setEndAt(toLocalISODatetime(addDays(new Date(`${day}T00:00`), 1)));
    } else {
      setStartAt(`${day}T${keep}`);
      setEndAt(toLocalISODatetime(new Date(new Date(`${day}T${keep}`).getTime() + 3_600_000)));
    }
  };

  // Auto-adjust endAt when startAt changes (keep same duration). An all-day row
  // always ends at the next midnight, so the end field can stay hidden.
  const handleStartChange = (val: string) => {
    setStartAt(val);
    if (allDay) {
      if (val) setEndAt(toLocalISODatetime(addDays(new Date(val), 1)));
      return;
    }
    if (val && endAt) {
      const prevDur = new Date(endAt).getTime() - new Date(startAt).getTime();
      const newEnd  = new Date(new Date(val).getTime() + Math.max(prevDur, 30 * 60 * 1000));
      setEndAt(toLocalISODatetime(newEnd));
    }
  };

  // ── Live conflict check ─────────────────────────────────────────────────────
  // Only ran when the slot actually moves: editing the notes of an old double
  // booking should not block the save. The API takes the same view.
  const timeChanged = !editing
    || firmToInstant(startAt).getTime() !== new Date(editing.startAt).getTime()
    || firmToInstant(endAt).getTime()   !== new Date(editing.endAt).getTime();

  const conflictQuery = useCheckConflict(
    timeChanged && !allDay && startAt ? firmToInstant(startAt).toISOString() : '',
    timeChanged && !allDay && endAt   ? firmToInstant(endAt).toISOString()   : '',
    editing?.id,
    { query: { queryKey: ['conflict', allDay ? 'allday' : startAt, endAt, editing?.id], staleTime: 5000 } },
  );
  const conflicts   = allDay ? [] : conflictQuery.data?.conflicts ?? [];
  const hasConflict = !allDay && timeChanged && !!conflictQuery.data?.hasConflict;

  // Validation
  const errors: Record<string, string> = {};
  if (!title.trim())          errors.title   = 'Enter a title';
  if (!startAt)               errors.startAt = allDay ? 'Select a date' : 'Select start time';
  if (!allDay && !endAt)      errors.endAt   = 'Select end time';
  if (!allDay && startAt && endAt && new Date(endAt) <= new Date(startAt))
    errors.endAt = 'End must be after start';
  const durMs = startAt && endAt ? new Date(endAt).getTime() - new Date(startAt).getTime() : 0;
  if (!allDay && durMs > 12 * 3600 * 1000) errors.endAt = 'Max duration is 12 hours';
  // Mirrors the server: attendance is recorded after the fact, never before.
  if ((status === 'completed' || status === 'no_show') && startAt && firmToInstant(startAt) > new Date())
    errors.status = `A future appointment cannot be marked ${status === 'no_show' ? 'no-show' : 'completed'}`;
  if (editing?.status === 'completed' && status !== 'completed')
    errors.status = 'Completed appointments cannot be re-opened';

  const isPast   = !!startAt && firmToInstant(startAt) < new Date();
  const canSubmit = Object.keys(errors).length === 0 && !hasConflict;
  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setServerErr('');

    const dayStart = new Date(`${startAt.slice(0, 10)}T00:00:00.000Z`);
    const payload: AppointmentInput = {
      clientId: selClient || undefined,
      caseId:   caseId    || undefined,
      title:    title.trim(),
      type,
      startAt:  allDay ? dayStart.toISOString() : firmToInstant(startAt).toISOString(),
      endAt:    allDay
        ? new Date(dayStart.getTime() + 86_400_000).toISOString()
        : firmToInstant(endAt).toISOString(),
      allDay,
      location: location.trim() || undefined,
      notes:    notes.trim()    || undefined,
      status,
    };

    const invalidate = () => invalidateAppointments(qc);

    if (editing) {
      const upd: AppointmentUpdate = {
        ...payload,
        clientId: selClient || null,
        caseId:   caseId    || null,
      };
      update.mutate(
        { id: editing.id, data: upd },
        {
          onSuccess: () => { invalidate(); onSuccess(); },
          onError: (e: any) => setServerErr(e?.message ?? 'Update failed'),
        },
      );
    } else {
      create.mutate(
        { data: payload },
        {
          onSuccess: () => { invalidate(); onSuccess(); },
          onError:   (e: any) => {
            const msg = (e as any)?.message ?? '';
            if (msg.includes('conflict') || (e as any)?.status === 409)
              setServerErr('Time slot conflicts with an existing appointment.');
            else setServerErr(msg || 'Create failed');
          },
        },
      );
    }
  };

  return (
    <div
      className="card"
      style={{ padding: '22px 24px', borderColor: 'hsl(var(--accent) / .35)',
        background: 'hsl(var(--accent) / .02)', animation: 'fade-in .2s ease both' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {editing ? 'Edit appointment' : 'New appointment'}
        </div>
        <button className="button button-ghost" style={{ minHeight: 28, padding: '0 9px' }} onClick={onCancel}>
          <X size={14} />
        </button>
      </div>

      <div className="form-grid">
        {/* Title */}
        <div className="form-field full">
          <label className="form-label">Title *</label>
          <input className="field" placeholder="e.g. Initial consultation — John Smith"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          {errors.title && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.title}</span>}
        </div>

        {/* Type */}
        <div className="form-field">
          <label className="form-label">Type *</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Status */}
        <div className="form-field">
          <label className="form-label">Status</label>
          <select className="select" value={status}
            onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
          {errors.status && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.status}</span>}
        </div>

        {/* All-day — court days and trial prep own the whole date, not a slot */}
        <div className="form-field full">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={allDay}
              onChange={(e) => handleAllDayToggle(e.target.checked)} />
            <span>
              All day <span className="muted">— court days and trial prep, no time slot</span>
            </span>
          </label>
        </div>

        {/* Start */}
        <div className="form-field">
          <label className="form-label">{allDay ? 'Date *' : 'Start *'}</label>
          <input className="field" type={allDay ? 'date' : 'datetime-local'}
            value={allDay ? startAt.slice(0, 10) : startAt}
            onChange={(e) => handleStartChange(allDay ? `${e.target.value}T00:00` : e.target.value)} />
          {errors.startAt && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.startAt}</span>}
          {isPast && (
            <span className="muted" style={{ fontSize: 10 }}>
              In the past — you can still log it retroactively.
            </span>
          )}
        </div>

        {/* End — an all-day row ends at the next midnight, so no field is needed */}
        {!allDay && (
          <div className="form-field">
            <label className="form-label">End *</label>
            <input className="field" type="datetime-local"
              value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            {errors.endAt && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.endAt}</span>}
          </div>
        )}

        {/* Client */}
        <div className="form-field">
          <label className="form-label">Client <span className="muted">(optional)</span></label>
          <select className="select" value={selClient}
            onChange={(e) => { setSelClient(e.target.value); setCaseId(''); }}
            disabled={clients.isLoading}>
            <option value="">No client</option>
            {/* A deep-linked client may sit past the first page of the list. */}
            {selClient && !(clients.data?.data ?? []).some((c) => c.id === selClient) && (
              <option value={selClient}>{defaultClientName ?? 'Selected client'}</option>
            )}
            {(clients.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.fullName}</option>
            ))}
          </select>
        </div>

        {/* Case */}
        <div className="form-field">
          <label className="form-label">Case <span className="muted">(optional)</span></label>
          <select className="select" value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            disabled={!selClient || cases.isLoading}>
            <option value="">No case</option>
            {(cases.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                #{c.caseNumber}{c.offenceDescription ? ` — ${c.offenceDescription}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Location */}
        <div className="form-field full">
          <label className="form-label">Location <span className="muted">(optional)</span></label>
          <input className="field" placeholder="e.g. Room 204, 361 University Ave"
            value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        {/* Notes */}
        <div className="form-field full">
          <label className="form-label">Notes <span className="muted">(optional)</span></label>
          <textarea className="textarea" style={{ minHeight: 68 }}
            placeholder="Preparation notes, documents to bring, etc."
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Conflict warning — blocks the save until the slot is free */}
      {hasConflict && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px',
          background: 'hsl(var(--destructive) / .06)', border: '1px solid hsl(var(--destructive) / .3)',
          borderRadius: 7, marginTop: 12, fontSize: 12,
        }}>
          <AlertTriangle size={15} style={{ color: 'hsl(var(--destructive))', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'hsl(var(--destructive))' }}>
              This slot is already booked
            </div>
            <div style={{ color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
              {conflicts.map((c) => (
                <div key={c.id}>
                  · {c.title} ({fmtTimeAmPm(new Date(c.startAt))} – {fmtTimeAmPm(new Date(c.endAt))})
                  {c.clientName ? ` · ${c.clientName}` : ''}
                </div>
              ))}
              <div style={{ marginTop: 4 }}>Pick another time — overlapping bookings are not allowed.</div>
            </div>
          </div>
        </div>
      )}

      {serverErr && (
        <div style={{ color: 'hsl(var(--destructive))', fontSize: 12, marginTop: 10,
          padding: '8px 12px', background: 'hsl(var(--destructive) / .07)', borderRadius: 6 }}>
          {serverErr}
        </div>
      )}

      <div className="form-actions">
        <button className="button button-ghost" onClick={onCancel} disabled={isPending}>Cancel</button>
        <button className="button button-accent" onClick={handleSubmit}
          disabled={isPending || !canSubmit}
          title={hasConflict ? 'Resolve the time conflict first' : undefined}>
          {isPending
            ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
            : <><Check size={13} /> {editing ? 'Save changes' : 'Create appointment'}</>}
        </button>
      </div>
    </div>
  );
}

// ─── Week view ────────────────────────────────────────────────────────────────
interface WeekViewProps {
  weekStart: Date;
  appointments: Appointment[];
  onSlotClick: (date: Date, hour: number) => void;
  onAllDayClick: (date: Date) => void;
  onApptClick: (a: Appointment) => void;
}

interface LaidOutAppt {
  appt: Appointment;
  startMin: number;  // minutes from midnight on the appointment's own day
  endMin: number;
  lane: number;      // column within an overlapping cluster
  lanes: number;     // how many columns that cluster needs
}

/** Overlapping bookings (say a cancelled slot plus a live one) sit side by side
 *  instead of hiding behind each other. Clusters are measured on their own, so
 *  a quiet morning still gets full-width blocks. */
function layoutDay(appts: Appointment[]): LaidOutAppt[] {
  const items = appts
    .map((appt) => {
      const raw   = new Date(appt.startAt);
      const start = asFirm(raw);
      const end   = new Date(appt.endAt);
      const startMin = start.getHours() * 60 + start.getMinutes();
      const duration = Math.max(15, Math.round((end.getTime() - raw.getTime()) / 60000));
      return { appt, startMin, endMin: Math.min(24 * 60, startMin + duration) };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const packed: LaidOutAppt[] = [];
  let cluster: Array<{ appt: Appointment; startMin: number; endMin: number }> = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const placed = cluster.map((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.startMin);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.endMin); }
      else laneEnds[lane] = item.endMin;
      return { ...item, lane, lanes: 1 };
    });
    const lanes = Math.max(1, laneEnds.length);
    placed.forEach((p) => packed.push({ ...p, lanes }));
    cluster = [];
    clusterEnd = -1;
  };

  items.forEach((item) => {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  });
  flush();

  return packed;
}

function WeekView({ weekStart, appointments, onSlotClick, onAllDayClick, onApptClick }: WeekViewProps) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const now  = new Date();

  // The grid always covers every booking of the week: an 11:30 pm court prep
  // stretches the evening downwards instead of being squashed onto the 8 pm line.
  const { gridStartHour, gridEndHour } = useMemo(() => {
    let earliest = DAY_START_HOUR;
    let latest   = DAY_END_HOUR;
    appointments.forEach((a) => {
      // All-day rows have no hour of their own — they must not stretch the grid.
      if (isAllDayAppt(a)) return;
      const raw    = new Date(a.startAt);
      const start  = asFirm(raw);
      const startH = start.getHours() + start.getMinutes() / 60;
      const endH   = startH + Math.max(0, new Date(a.endAt).getTime() - raw.getTime()) / 3_600_000;
      earliest = Math.min(earliest, Math.floor(startH));
      latest   = Math.max(latest, Math.ceil(Math.min(endH, 24)));
    });
    return { gridStartHour: Math.max(0, earliest), gridEndHour: Math.min(24, latest) };
  }, [appointments]);

  const hours = useMemo(
    () => Array.from({ length: gridEndHour - gridStartHour }, (_, i) => gridStartHour + i),
    [gridStartHour, gridEndHour],
  );
  const gridHeight = (gridEndHour - gridStartHour) * SLOT_HEIGHT_PX;
  const columns    = `repeat(7, minmax(${MIN_DAY_WIDTH}px, 1fr))`;

  // Bucket per local day, then lane-pack so overlaps render side by side.
  const apptsByDay = useMemo(() => {
    const grouped = new Map<string, Appointment[]>();
    appointments.forEach((a) => {
      if (isAllDayAppt(a)) return;
      const key  = toLocalISODate(apptDate(a));
      const list = grouped.get(key);
      if (list) list.push(a);
      else grouped.set(key, [a]);
    });
    const map = new Map<string, LaidOutAppt[]>();
    days.forEach((d) => {
      const key = toLocalISODate(d);
      map.set(key, layoutDay(grouped.get(key) ?? []));
    });
    return map;
  }, [appointments, days]);

  // Court dates and other whole-day rows, bucketed per day for the band above
  // the hours.
  const allDayByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    appointments.filter(isAllDayAppt).forEach((a) => {
      const key  = toLocalISODate(apptDate(a));
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    });
    return map;
  }, [appointments]);

  const nowTop = (now.getHours() + now.getMinutes() / 60 - gridStartHour) * SLOT_HEIGHT_PX;

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: GUTTER_WIDTH + MIN_DAY_WIDTH * 7 }}>
      {/* Time gutter — pinned while the week scrolls sideways */}
      <div style={{ width: GUTTER_WIDTH, flexShrink: 0, position: 'sticky', left: 0, zIndex: 6,
        background: 'hsl(var(--card))' }}>
        <div style={{ height: HEADER_HEIGHT, position: 'sticky', top: 0, zIndex: 7,
          background: 'hsl(var(--card))', borderBottom: '1px solid hsl(var(--border))' }} />
        <div style={{ height: ALLDAY_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          paddingRight: 8, background: 'hsl(var(--muted) / .22)', borderBottom: '1px solid hsl(var(--border))' }}>
          <span style={{ fontSize: 8.5, color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)',
            textTransform: 'uppercase', letterSpacing: '.02em', whiteSpace: 'nowrap' }}>all-day</span>
        </div>
        {hours.map((h) => (
          <div key={h} style={{
            height: SLOT_HEIGHT_PX, display: 'flex', alignItems: 'flex-start',
            justifyContent: 'flex-end', paddingRight: 8, paddingTop: 2,
          }}>
            <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))',
              fontFamily: 'var(--app-font-mono)' }}>
              {h % 12 || 12}{h < 12 ? 'am' : 'pm'}
            </span>
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Weekday header — one shared row so it never drifts out of view */}
        <div style={{ display: 'grid', gridTemplateColumns: columns, position: 'sticky', top: 0,
          zIndex: 5, background: 'hsl(var(--card))' }}>
          {days.map((day, di) => {
            const isToday = isSameDay(day, now);
            return (
              <div key={di} style={{
                height: HEADER_HEIGHT, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 1,
                borderRight: '1px solid hsl(var(--border))',
                borderBottom: '1px solid hsl(var(--border))',
                background: isToday ? 'hsl(var(--accent) / .07)' : 'hsl(var(--card))',
              }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', lineHeight: 1,
                  color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase',
                  letterSpacing: '.04em' }}>
                  {DAYS_SHORT[di]}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 700, lineHeight: 1,
                  width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  color: isToday ? 'hsl(var(--accent))' : 'hsl(var(--foreground))',
                  background: isToday ? 'hsl(var(--accent) / .12)' : 'transparent',
                }}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* All-day band — court dates own the whole day, so they get their own row */}
        <div style={{ display: 'grid', gridTemplateColumns: columns,
          background: 'hsl(var(--muted) / .22)', borderBottom: '1px solid hsl(var(--border))' }}>
          {days.map((day, di) => {
            const items = allDayByDay.get(toLocalISODate(day)) ?? [];
            const shown = items.slice(0, 1);
            const extra = items.length - shown.length;
            return (
              <div key={di} style={{
                height: ALLDAY_HEIGHT, borderRight: '1px solid hsl(var(--border))',
                padding: 3, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden',
                // A grid item defaults to min-width:auto, so one long court title
                // would widen its column and push the band out of step with the
                // hour grid. Pin it to the column instead.
                minWidth: 0, cursor: 'pointer',
              }}
              onClick={() => onAllDayClick(day)}
              title={`Add an all-day entry on ${fmtDateShort(day)}`}
            >
                {shown.map((a) => {
                  const c    = typeColor(a.type);
                  const dead = a.status === 'cancelled' || a.status === 'no_show';
                  return (
                    <div
                      key={a.id}
                      onClick={(e) => { e.stopPropagation(); onApptClick(a); }}
                      title={[a.title, a.location,
                        a.status !== 'scheduled' ? a.status.replace('_', ' ') : ''].filter(Boolean).join('\n')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 3, background: c.bg,
                        borderLeft: `2px solid ${c.border}`, borderRadius: 3, padding: '1px 4px',
                        cursor: 'pointer', opacity: dead ? .5 : 1, overflow: 'hidden', minWidth: 0,
                      }}
                    >
                      <Landmark size={9} style={{ color: c.text, flexShrink: 0 }} />
                      <span style={{
                        fontSize: 9.5, fontWeight: 700, color: c.text, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0,
                        textDecoration: dead ? 'line-through' : 'none',
                      }}>
                        {a.title}
                      </span>
                    </div>
                  );
                })}
                {extra > 0 && (
                  <button
                    onClick={() => onApptClick(items[1])}
                    style={{
                      border: 0, background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer',
                      fontSize: 9, color: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)',
                    }}
                  >
                    +{extra} more
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Hour grid */}
        <div style={{ display: 'grid', gridTemplateColumns: columns }}>
          {days.map((day, di) => {
            const isToday    = isSameDay(day, now);
            const isPast     = day < now && !isToday;
            const dayAppts   = apptsByDay.get(toLocalISODate(day)) ?? [];
            return (
              <div key={di} style={{
                borderRight: '1px solid hsl(var(--border))',
                position: 'relative',
                height: gridHeight,
                background: isPast ? 'hsl(var(--muted) / .18)' : undefined,
              }}>
                {/* Hour slots — clickable */}
                {hours.map((h) => (
                  <div
                    key={h}
                    onClick={() => onSlotClick(day, h)}
                    style={{
                      position: 'absolute', top: (h - gridStartHour) * SLOT_HEIGHT_PX,
                      left: 0, right: 0, height: SLOT_HEIGHT_PX,
                      borderBottom: '1px solid hsl(var(--border) / .5)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = 'hsl(var(--accent) / .04)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                    }}
                  />
                ))}

                {/* Current time indicator */}
                {isToday && nowTop >= 0 && nowTop <= gridHeight && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0,
                    top: nowTop, zIndex: 3, pointerEvents: 'none',
                  }}>
                    <div style={{ height: 2, background: 'hsl(var(--accent))', borderRadius: 1 }} />
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: 'hsl(var(--accent))',
                      position: 'absolute', left: -4, top: -3,
                    }} />
                  </div>
                )}

                {/* Appointment blocks */}
                {dayAppts.map(({ appt: a, startMin, endMin, lane, lanes }) => {
                  const top      = (startMin / 60 - gridStartHour) * SLOT_HEIGHT_PX;
                  const height   = Math.max((endMin - startMin) / 60 * SLOT_HEIGHT_PX, 18);
                  const widthPct = 100 / lanes;
                  const c        = typeColor(a.type);
                  const isCancelled = a.status === 'cancelled' || a.status === 'no_show';
                  return (
                    <div
                      key={a.id}
                      title={[a.title, `${fmtTimeAmPm(new Date(a.startAt))} – ${fmtTimeAmPm(new Date(a.endAt))}`,
                        a.clientName, a.location, a.status !== 'scheduled' ? a.status.replace('_', ' ') : '']
                        .filter(Boolean).join('\n')}
                      onClick={(e) => { e.stopPropagation(); onApptClick(a); }}
                      style={{
                        position: 'absolute',
                        top: top + 1,
                        left: `calc(${lane * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        height: Math.max(height - 2, 16),
                        background: c.bg,
                        borderLeft: `3px solid ${c.border}`,
                        borderRadius: 4,
                        padding: '3px 5px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        zIndex: 1,
                        opacity: isCancelled ? 0.45 : 1,
                        transition: 'opacity .15s, box-shadow .15s',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.boxShadow =
                          '0 2px 8px hsl(0 0% 0% / .15)';
                        (e.currentTarget as HTMLDivElement).style.zIndex = '8';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                        (e.currentTarget as HTMLDivElement).style.zIndex = '1';
                      }}
                    >
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: c.text, lineHeight: 1.25,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        textDecoration: isCancelled ? 'line-through' : 'none',
                      }}>
                        {a.title}
                      </div>
                      {height > 30 && (
                        <div style={{ fontSize: 9, color: c.text, opacity: .75,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {fmtTimeAmPm(new Date(a.startAt))}
                        </div>
                      )}
                      {height > 46 && a.clientName && (
                        <div style={{ fontSize: 9, color: c.text, opacity: .6,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {a.clientName}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Month mini-calendar ──────────────────────────────────────────────────────
interface MiniCalProps {
  year: number;
  month: number; // 0-indexed
  selectedDate: Date;
  appointments: Appointment[];
  onDateClick: (d: Date) => void;
  onMonthChange: (year: number, month: number) => void;
}

function MiniCalendar({ year, month, selectedDate, appointments, onDateClick, onMonthChange }: MiniCalProps) {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0
  const totalCells = Math.ceil((startDow + lastDay.getDate()) / 7) * 7;

  // Days with appointments
  const daysWithAppts = useMemo(() => {
    const s = new Set<string>();
    appointments.forEach((a) => s.add(toLocalISODate(apptDate(a))));
    return s;
  }, [appointments]);

  const today = new Date();

  return (
    <div style={{ width: 220 }}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button className="button button-ghost" style={{ minHeight: 28, padding: '0 7px' }}
          onClick={() => { const d = new Date(year, month - 1, 1); onMonthChange(d.getFullYear(), d.getMonth()); }}>
          <ChevronLeft size={14} />
        </button>
        <span style={{ fontSize: 12, fontWeight: 700 }}>
          {MONTHS[month]} {year}
        </span>
        <button className="button button-ghost" style={{ minHeight: 28, padding: '0 7px' }}
          onClick={() => { const d = new Date(year, month + 1, 1); onMonthChange(d.getFullYear(), d.getMonth()); }}>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 3 }}>
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 9,
            fontFamily: 'var(--app-font-mono)', color: 'hsl(var(--muted-foreground))',
            fontWeight: 700, padding: '2px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {Array.from({ length: totalCells }, (_, i) => {
          const dayNum = i - startDow + 1;
          if (dayNum < 1 || dayNum > lastDay.getDate()) {
            return <div key={i} />;
          }
          const cellDate  = new Date(year, month, dayNum);
          const isToday   = isSameDay(cellDate, today);
          const isSel     = isSameDay(cellDate, selectedDate);
          const hasAppts  = daysWithAppts.has(toLocalISODate(cellDate));
          return (
            <div
              key={i}
              onClick={() => onDateClick(cellDate)}
              style={{
                height: 26, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                borderRadius: 4, cursor: 'pointer', fontSize: 11,
                fontWeight: isSel || isToday ? 700 : 400,
                color: isSel
                  ? 'hsl(var(--accent-foreground))'
                  : isToday
                  ? 'hsl(var(--accent))'
                  : 'hsl(var(--foreground))',
                background: isSel
                  ? 'hsl(var(--accent))'
                  : isToday
                  ? 'hsl(var(--accent) / .1)'
                  : 'transparent',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!isSel) (e.currentTarget as HTMLDivElement).style.background = 'hsl(var(--muted))';
              }}
              onMouseLeave={(e) => {
                if (!isSel) (e.currentTarget as HTMLDivElement).style.background =
                  isToday ? 'hsl(var(--accent) / .1)' : 'transparent';
              }}
            >
              {dayNum}
              {hasAppts && (
                <div style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: isSel ? 'hsl(var(--accent-foreground))' : 'hsl(var(--accent))',
                  position: 'absolute', bottom: 3,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Appointment detail popover ───────────────────────────────────────────────
// ─── Per-appointment Google state ─────────────────────────────────────────────
/** One line that tells the lawyer whether this exact booking is on their phone. */
function GoogleEventLine({ appt }: { appt: Appointment }) {
  const statusQ   = useGoogleIntegration();
  const connected = statusQ.data?.connected ?? false;
  const stamp = appt.googleSyncedAt
    ? new Date(appt.googleSyncedAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

  if (connected) {
    if (appt.googleSyncError) {
      return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 10.5, lineHeight: 1.5, color: 'hsl(var(--destructive))' }}>
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Google rejected this event: {appt.googleSyncError}</span>
        </div>
      );
    }
    if (appt.googleEventId) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: '#2e8f7b' }}>
          <Check size={12} />
          <span>Synced to Google Calendar{stamp ? ` · ${stamp}` : ''}</span>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'hsl(var(--muted-foreground))' }}>
        <RefreshCw size={12} /> Waiting for the next Google sync
      </div>
    );
  }

  return (
    <a
      href={googleCalendarUrl(appt)}
      target="_blank" rel="noreferrer"
      className="button button-ghost"
      style={{ minHeight: 30, fontSize: 11, textDecoration: 'none', alignSelf: 'flex-start' }}
    >
      <Calendar size={12} /> Add to Google Calendar
    </a>
  );
}

interface ApptDetailProps {
  appt: Appointment;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onStatusChange: (id: string, status: AppointmentStatus) => void;
  isDeleting: boolean;
}

function AppointmentDetail({ appt, onEdit, onDelete, onClose, onStatusChange, isDeleting }: ApptDetailProps) {
  const c = typeColor(appt.type);
  const allDay   = isAllDayAppt(appt);
  const isCourt  = isCourtAppt(appt);
  const isExternal = isExternalAppt(appt);
  // Both mirror kinds are owned elsewhere: the schedule shows them, it does not
  // edit them.
  const readOnly = isCourt || isExternal;
  const duration = Math.round((new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime()) / 60000);
  const durStr = duration >= 60
    ? `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ''}`
    : `${duration}m`;

  // The server refuses attendance on a meeting that has not started — do not
  // offer the button in the first place.
  const hasStarted = new Date(appt.startAt) <= new Date();
  const isLive     = appt.status === 'scheduled' || appt.status === 'confirmed';
  const isClosed   = appt.status === 'cancelled' || appt.status === 'no_show';

  return (
    <div style={{ padding: '18px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 10, fontFamily: 'var(--app-font-mono)', fontWeight: 700,
            color: c.text, background: c.bg, padding: '2px 8px', borderRadius: 4, marginBottom: 7,
          }}>
            {appt.type}
          </div>
          {isCourt && (
            <div className="muted" style={{ fontSize: 10, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Landmark size={11} /> Mirrored from the case court date
            </div>
          )}
          {isExternal && (
            <div className="muted" style={{ fontSize: 10, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={11} /> From your Google Calendar
            </div>
          )}
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em' }}>{appt.title}</div>
        </div>
        <button className="button button-ghost" style={{ minHeight: 28, padding: '0 8px', flexShrink: 0 }} onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={13} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
          <span>
            {fmtDateLong(apptDate(appt))}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={13} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
          <span>
            {allDay ? (
              <>
                All day
                <span className="muted" style={{ marginLeft: 6 }}>(court calendar)</span>
              </>
            ) : (
              <>
                {fmtTimeAmPm(new Date(appt.startAt))} – {fmtTimeAmPm(new Date(appt.endAt))}
                <span className="muted" style={{ marginLeft: 6 }}>({durStr})</span>
              </>
            )}
          </span>
        </div>
        {appt.clientName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={13} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
            <span>
              {appt.clientName}
              {appt.caseNumber && !appt.caseId && <span className="muted"> · Case #{appt.caseNumber}</span>}
            </span>
          </div>
        )}
        {appt.caseId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Briefcase size={13} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
            <Link href={`/cases/${appt.caseId}`} style={{ color: 'hsl(var(--accent))', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              Case #{appt.caseNumber ?? '—'} <ExternalLink size={10} style={{ display: 'inline' }} />
            </Link>
          </div>
        )}
        {appt.location && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={13} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
            <span>{appt.location}</span>
          </div>
        )}
        {appt.notes && (
          <div style={{
            marginTop: 4, padding: '8px 10px',
            background: 'hsl(var(--muted) / .45)', borderRadius: 6,
            fontSize: 11, lineHeight: 1.55, color: 'hsl(var(--muted-foreground))',
          }}>
            {appt.notes}
          </div>
        )}

        <GoogleEventLine appt={appt} />
      </div>

      {/* Status + actions */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <StatusPill status={appt.status} />
          {!readOnly && appt.status === 'scheduled' && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}
              onClick={() => onStatusChange(appt.id, 'confirmed')}>
              <Check size={11} /> Confirm
            </button>
          )}
          {!readOnly && isLive && hasStarted && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}
              onClick={() => onStatusChange(appt.id, 'completed')}>
              <Check size={11} /> Complete
            </button>
          )}
          {!readOnly && isLive && hasStarted && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}
              title="The client did not turn up"
              onClick={() => onStatusChange(appt.id, 'no_show')}>
              <UserX size={11} /> No-show
            </button>
          )}
          {!readOnly && isLive && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11,
              color: 'hsl(var(--destructive))' }}
              onClick={() => onStatusChange(appt.id, 'cancelled')}>
              <X size={11} /> Cancel
            </button>
          )}
          {!readOnly && isClosed && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}
              title="Put this booking back on the calendar"
              onClick={() => onStatusChange(appt.id, 'scheduled')}>
              <RotateCcw size={11} /> Reopen
            </button>
          )}
        </div>
        {isCourt && (
          <div className="muted" style={{ fontSize: 10 }}>
            Status follows the court date on the case file.
          </div>
        )}
        {isExternal && (
          <div className="muted" style={{ fontSize: 10 }}>
            Live from your Google Calendar — kept in step by every sync.
          </div>
        )}
        {!isCourt && isLive && !hasStarted && (
          <div className="muted" style={{ fontSize: 10 }}>
            Attendance (complete / no-show) can be recorded once the meeting has started.
          </div>
        )}
        {isExternal ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6, borderTop: '1px solid hsl(var(--border))' }}>
            <div className="muted" style={{ fontSize: 10, lineHeight: 1.5 }}>
              This meeting lives in your Google Calendar. Changes made there show up here on the next sync.
            </div>
            <a className="button button-ghost"
              style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}
              href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Open Google Calendar
            </a>
          </div>
        ) : isCourt ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6, borderTop: '1px solid hsl(var(--border))' }}>
            <div className="muted" style={{ fontSize: 10, lineHeight: 1.5 }}>
              Court dates are edited on the case file — the schedule and Google mirror them automatically.
            </div>
            {appt.caseId && (
              <Link href={`/cases/${appt.caseId}`} className="button button-ghost"
                style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}>
                <Briefcase size={13} /> Open case file
              </Link>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 7, paddingTop: 6, borderTop: '1px solid hsl(var(--border))' }}>
            <button className="button button-ghost" style={{ flex: 1 }} onClick={() => onEdit(appt)}>
              <Pencil size={13} /> Edit
            </button>
            <button className="button button-danger" style={{ flex: 1 }}
              disabled={isDeleting}
              onClick={() => {
                if (window.confirm(`Delete "${appt.title}"?`)) onDelete(appt.id);
              }}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── KPI strip ────────────────────────────────────────────────────────────────
type KpiKey = 'today' | 'next7' | 'awaiting' | 'completed';

function AppointmentKpis({ active, onSelect, caseId }: { active: string; onSelect: (key: KpiKey) => void; caseId?: string }) {
  const summaryParams = useMemo(() => ({ caseId }), [caseId]);
  const summary = useGetAppointmentSummary(summaryParams, {
    query: { queryKey: getGetAppointmentSummaryQueryKey(summaryParams), staleTime: 20000 },
  });
  const d = summary.data;

  const cards = [
    { key: 'today'    as const, label: 'Today',                 value: d?.todayCount,     hint: 'on the books today',       color: '#c95743', bg: '#c9574312' },
    { key: 'next7'    as const, label: 'Next 7 days',           value: d?.next7Count,     hint: 'after today',             color: '#4b7bb5', bg: '#4b7bb512' },
    { key: 'awaiting' as const, label: 'Awaiting confirmation', value: d?.awaitingCount,  hint: 'still marked scheduled',   color: '#e8a83e', bg: '#e8a83e12' },
    { key: 'completed'as const, label: 'Completed',             value: d?.completedCount, hint: 'in the last 30 days',      color: '#2e8f7b', bg: '#2e8f7b12' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 20 }}>
      {cards.map((k) => (
        <button
          key={k.key}
          type="button"
          onClick={() => onSelect(k.key)}
          title={active === k.key ? 'Show every appointment' : `Open the register: ${k.label.toLowerCase()}`}
          className="card"
          style={{
            padding: '15px 17px', background: k.bg, textAlign: 'left', cursor: 'pointer',
            borderColor: active === k.key ? `${k.color}80` : `${k.color}28`,
            boxShadow: active === k.key ? `inset 0 0 0 1px ${k.color}66` : 'none',
            transition: 'border-color .15s ease, box-shadow .15s ease',
          }}
        >
          <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', textTransform: 'uppercase',
            letterSpacing: '.06em', color: k.color, fontWeight: 700 }}>
            {k.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 10, letterSpacing: '-.04em',
            fontFamily: 'var(--app-font-mono)', color: k.color }}>
            {summary.isLoading ? <Skeleton w={40} h={20} /> : (k.value ?? 0)}
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>{k.hint}</div>
        </button>
      ))}
    </div>
  );
}

// ─── Main Appointments Page ───────────────────────────────────────────────────
export function AppointmentsPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const PAGE_SIZE = 25;

  // The view, the anchor day, the case scope, the open appointment and the
  // "new" form all live in the URL — case pages and the dashboard can deep-link
  // into an exact appointment, and the Back button does the obvious thing.
  const setParam = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      return next;
    });
  }, [setSearchParams]);

  const viewMode   = searchParams.get('view') === 'list' ? 'list' : 'week';
  const caseFilter = searchParams.get('caseId') ?? '';
  const apptParam  = searchParams.get('appt') ?? '';
  const newParam   = searchParams.get('new') === '1';
  const anchor     = searchParams.get('date') ?? '';

  const currentDate = useMemo(() => {
    if (!anchor) return new Date();
    const d = new Date(`${anchor}T12:00:00`);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [anchor]);

  const [calYear,     setCalYear]     = useState(currentDate.getFullYear());
  const [calMonth,    setCalMonth]    = useState(currentDate.getMonth()); // 0-indexed
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [newApptDate, setNewApptDate] = useState<string | undefined>();
  const [newApptHour, setNewApptHour] = useState<number | undefined>();
  const [newApptAllDay, setNewApptAllDay] = useState(false);

  // Register state (kept local: typing a search should not spam the URL)
  const [filters,         setFilters]         = useState<RegisterFilters>(EMPTY_FILTERS);
  const [searchInput,     setSearchInput]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page,            setPage]            = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const changeFilters = useCallback((patch: Partial<RegisterFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearchInput('');
    setDebouncedSearch('');
    setPage(1);
  }, []);

  const weekStart = useMemo(() => startOfWeek(currentDate), [currentDate]);
  const weekEnd   = useMemo(() => addDays(weekStart, 6),    [weekStart]);

  // Calendar data (month grid — includes the full weeks around the month)
  const calParams = useMemo(() => ({ year: calYear, month: calMonth + 1, caseId: caseFilter || undefined }), [calYear, calMonth, caseFilter]);
  const calQuery  = useCalendarAppointments(calParams, {
    query: { queryKey: getCalendarAppointmentsQueryKey(calParams), staleTime: 20000 },
  });

  const weekAppts = useMemo(() => {
    const all = calQuery.data ?? [];
    return all.filter((a) => {
      const d = new Date(a.startAt);
      return d >= weekStart && d <= addDays(weekEnd, 1);
    });
  }, [calQuery.data, weekStart, weekEnd]);

  // ── Double bookings in the month on screen ────────────────────────────────
  // A conflict is two timed rows sharing a slot. All-day rows are commitments,
  // not slots, so they are left out — the same rule the API applies.
  const monthConflicts = useMemo(() => {
    const rows = (calQuery.data ?? [])
      .filter((a) => !a.allDay && a.status !== 'cancelled')
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    const pairs: Array<{ a: Appointment; b: Appointment }> = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (new Date(rows[j].startAt) >= new Date(rows[i].endAt)) break;
        if (new Date(rows[i].startAt) < new Date(rows[j].endAt)) pairs.push({ a: rows[i], b: rows[j] });
      }
    }
    return pairs;
  }, [calQuery.data]);

  // ── Register window ────────────────────────────────────────────────────────
  const firmNow      = asFirm(new Date());
  const todayStr     = toLocalISODate(firmNow);
  const tomorrowStr  = toLocalISODate(addDays(firmNow, 1));
  const next7Str     = toLocalISODate(addDays(firmNow, 7));
  const yesterdayStr = toLocalISODate(addDays(firmNow, -1));
  const dateRangeInvalid = !!(filters.from && filters.to && filters.to < filters.from);

  const rangeFrom = filters.range === 'today' ? todayStr
    : filters.range === 'next7' ? tomorrowStr
    : (dateRangeInvalid ? undefined : (filters.from || undefined));
  const rangeTo = filters.range === 'today' ? todayStr
    : filters.range === 'next7' ? next7Str
    : filters.range === 'past' ? yesterdayStr
    : (dateRangeInvalid ? undefined : (filters.to || undefined));

  const listParams: ListAppointmentsParams = useMemo(() => ({
    caseId:   caseFilter || undefined,
    search:   debouncedSearch.trim() || undefined,
    type:     filters.type   || undefined,
    status:   filters.status || undefined,
    source:   filters.source || undefined,
    dateFrom: rangeFrom,
    dateTo:   rangeTo,
    upcoming: filters.range === 'upcoming' || filters.range === 'next7' ? true : undefined,
    sort:     filters.sort,
    page,
    limit:    PAGE_SIZE,
  }), [caseFilter, debouncedSearch, filters.type, filters.status, filters.source, filters.sort, filters.range, rangeFrom, rangeTo, page]);

  const register = useListAppointments(listParams, {
    query: {
      queryKey: getListAppointmentsQueryKey(listParams),
      staleTime: 15000,
      // The register is only on screen in list view — no point fetching it twice.
      enabled: viewMode === 'list',
    },
  });

  const scopeCase = useGetCase(caseFilter, {
    query: { queryKey: getGetCaseQueryKey(caseFilter), enabled: !!caseFilter, staleTime: 60000 },
  });

  const updateStatus = useUpdateAppointment();
  const del          = useDeleteAppointment();

  const invalidate = useCallback(() => invalidateAppointments(qc), [qc]);

  const handleStatusChange = (id: string, status: AppointmentStatus) => {
    updateStatus.mutate(
      { id, data: { status } },
      { onSuccess: () => invalidate() },
    );
  };

  const handleDelete = (id: string) => {
    del.mutate({ id }, {
      onSuccess: () => {
        invalidate();
        setParam('appt', null);
      },
    });
  };

  // The detail card resolves from whatever is loaded for the current screen:
  // the week grid or the register. Deep links carry ?date= so the month (and
  // therefore the week) is already hydrated.
  const detailAppt = useMemo(() => {
    if (!apptParam) return null;
    const pool = [...(calQuery.data ?? []), ...(register.data?.data ?? [])];
    return pool.find((a) => a.id === apptParam) ?? null;
  }, [apptParam, calQuery.data, register.data]);

  const openDetail = (a: Appointment) => setParam('appt', a.id);

  const openNew = (date?: Date, hour?: number, allDay = false) => {
    setEditingAppt(null);
    setNewApptDate(date ? toLocalISODate(date) : undefined);
    setNewApptHour(hour);
    setNewApptAllDay(allDay);
    setParam('appt', null);
    setParam('new', '1');
  };

  const handleSlotClick = (date: Date, hour: number) => openNew(date, hour);
  // Clicking the all-day band books a whole-day block (trial prep, a courthouse
  // day) instead of a one-hour slot.
  const handleAllDayClick = (date: Date) => openNew(date, undefined, true);

  const handleEdit = (a: Appointment) => {
    // A court-date mirror is a projection: it is edited on the case file.
    if (isCourtAppt(a)) return;
    setEditingAppt(a);
    setParam('appt', null);
    setParam('new', '1');
  };

  const closeForm = () => {
    setEditingAppt(null);
    setParam('new', null);
  };

  const handleFormSuccess = () => closeForm();

  const showForm = newParam || !!editingAppt;

  // ── KPI → register ─────────────────────────────────────────────────────────
  const activeKpi: string =
    filters.range === 'today' ? 'today'
    : filters.range === 'next7' ? 'next7'
    : filters.status === 'scheduled' && filters.range === 'upcoming' ? 'awaiting'
    : filters.status === 'completed' && filters.range === 'past' ? 'completed'
    : '';

  const applyKpi = (key: KpiKey) => {
    setParam('view', 'list');
    setSearchInput('');
    setDebouncedSearch('');
    setPage(1);
    if (activeKpi === key) { setFilters(EMPTY_FILTERS); return; }
    if (key === 'today')     { setFilters({ ...EMPTY_FILTERS, range: 'today' }); return; }
    if (key === 'next7')     { setFilters({ ...EMPTY_FILTERS, range: 'next7' }); return; }
    if (key === 'awaiting')  { setFilters({ ...EMPTY_FILTERS, status: 'scheduled', range: 'upcoming' }); return; }
    setFilters({ ...EMPTY_FILTERS, status: 'completed', range: 'past', sort: 'latest' });
  };

  const handleExport = () => {
    const sp = new URLSearchParams();
    if (listParams.caseId)   sp.set('caseId',   listParams.caseId);
    if (listParams.search)   sp.set('search',   listParams.search);
    if (listParams.type)     sp.set('type',     listParams.type);
    if (listParams.status)   sp.set('status',   listParams.status);
    if (listParams.dateFrom) sp.set('dateFrom', listParams.dateFrom);
    if (listParams.dateTo)   sp.set('dateTo',   listParams.dateTo);
    if (listParams.upcoming) sp.set('upcoming', 'true');
    if (listParams.sort)     sp.set('sort',     listParams.sort);
    const qs = sp.toString();
    window.open(`/api/appointments/export.csv${qs ? `?${qs}` : ''}`, '_blank');
  };

  const hasFilters =
    !!searchInput || !!filters.type || !!filters.status || !!filters.source || !!filters.range ||
    !!filters.from || !!filters.to || filters.sort !== 'soonest';

  // Sync mini-calendar month when navigating weeks
  useEffect(() => {
    setCalYear(currentDate.getFullYear());
    setCalMonth(currentDate.getMonth());
  }, [currentDate]);

  const goToDate = (d: Date) => setParam('date', toLocalISODate(d));
  const prevWeek = () => goToDate(addDays(currentDate, -7));
  const nextWeek = () => goToDate(addDays(currentDate,  7));
  const goToday  = () => setParam('date', null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div className="eyebrow">Schedule / Calendar</div>
          <h1 className="page-title">Appointments</h1>
          <p className="page-copy">Consultations, court dates and client meetings — with double bookings kept out.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="button button-ghost" onClick={handleExport} title="Export the current filter as CSV">
            <ArrowDownToLine size={14} /> Export CSV
          </button>
          <button
            className={`button ${viewMode === 'week' ? 'button-primary' : 'button-ghost'}`}
            onClick={() => setParam('view', 'week')}>
            <Calendar size={14} /> Week
          </button>
          <button
            className={`button ${viewMode === 'list' ? 'button-primary' : 'button-ghost'}`}
            onClick={() => setParam('view', 'list')}>
            <CalendarClock size={14} /> List
          </button>
          <button className="button button-accent"
            onClick={() => (showForm && !editingAppt ? closeForm() : openNew())}>
            {showForm && !editingAppt ? <X size={14} /> : <Plus size={14} />}
            {showForm && !editingAppt ? 'Cancel' : 'New appointment'}
          </button>
        </div>
      </div>

      {/* ── Case scope banner ────────────────────────────────────────── */}
      {caseFilter && (
        <div
          className="card"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', marginBottom: 16,
            borderColor: 'hsl(var(--chart-4) / .35)', background: 'hsl(var(--chart-4) / .06)',
          }}
        >
          <Briefcase size={16} style={{ color: 'hsl(var(--chart-4))', flexShrink: 0 }} />
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {scopeCase.data
                ? `Case #${scopeCase.data.caseNumber} — ${scopeCase.data.clientName}`
                : scopeCase.isError ? 'Case not found' : 'Scoped to case'}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Only appointments linked to this case are shown — new bookings default to it.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
            <Link href={`/cases/${caseFilter}`} className="button button-ghost" style={{ minHeight: 30, padding: '0 10px' }}>
              Open case <ExternalLink size={12} />
            </Link>
            <button className="button button-ghost" style={{ minHeight: 30, padding: '0 10px' }}
              onClick={() => setParam('caseId', null)}>
              <X size={13} /> Clear scope
            </button>
          </div>
        </div>
      )}

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <AppointmentKpis active={activeKpi} onSelect={applyKpi} caseId={caseFilter || undefined} />

      {/* ── Google Calendar connection ────────────────────────────────── */}
      <GoogleSyncPanel />

      {/* ── Double bookings in the month on screen ────────────────────── */}
      {monthConflicts.length > 0 && (
        <div className="card" style={{
          padding: '11px 14px', marginBottom: 14,
          borderLeft: '3px solid hsl(var(--destructive))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, flexWrap: 'wrap' }}>
            <AlertCircle size={14} style={{ color: 'hsl(var(--destructive))' }} />
            {monthConflicts.length} double booking{monthConflicts.length !== 1 ? 's' : ''} in{' '}
            {new Date(calYear, calMonth, 1).toLocaleDateString('en-CA', { month: 'long' })} {calYear}
            <span className="muted" style={{ fontWeight: 400, fontSize: 10.5 }}>
              — two timed meetings share the same slot
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
            {monthConflicts.slice(0, 4).map(({ a, b }) => (
              <button key={`${a.id}-${b.id}`} className="button button-ghost" onClick={() => openDetail(a)}
                style={{ justifyContent: 'flex-start', minHeight: 26, padding: '0 8px', fontSize: 11, fontWeight: 400, textAlign: 'left', gap: 6 }}>
                <span className="mono" style={{ fontSize: 10, color: 'hsl(var(--destructive))', whiteSpace: 'nowrap' }}>
                  {fmtDateShort(apptDate(a))} · {fmtTimeAmPm(new Date(a.startAt))}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{a.title}</span>
                <span className="muted">×</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{b.title}</span>
              </button>
            ))}
            {monthConflicts.length > 4 && (
              <span className="muted" style={{ fontSize: 10.5, paddingLeft: 8 }}>
                + {monthConflicts.length - 4} more this month
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Add / Edit form ───────────────────────────────────────────── */}
      {showForm && (
        <div style={{ marginBottom: 18 }}>
          <AppointmentForm
            key={`${editingAppt?.id ?? 'new'}-${newApptDate ?? ''}-${newApptHour ?? ''}-${newApptAllDay ? 'allday' : 'timed'}`}
            editing={editingAppt}
            defaultDate={newApptDate ?? toLocalISODate(currentDate)}
            defaultHour={newApptHour}
            defaultAllDay={newApptAllDay}
            defaultCaseId={caseFilter || undefined}
            defaultClientId={scopeCase.data?.clientId}
            defaultClientName={scopeCase.data?.clientName}
            onSuccess={handleFormSuccess}
            onCancel={closeForm}
          />
        </div>
      )}

      {dateRangeInvalid && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', marginBottom: 14,
          borderRadius: 6, fontSize: 12, color: 'hsl(var(--destructive))',
          background: 'hsl(var(--destructive) / .07)', border: '1px solid hsl(var(--destructive) / .25)',
        }}>
          <AlertCircle size={14} />
          “From” is later than “To”, so the date range is ignored. Swap the dates to filter.
        </div>
      )}

      {viewMode === 'week' ? (
        /* ── WEEK VIEW ──────────────────────────────────────────────── */
        <div className="appt-week">
          {/* Sidebar: mini-cal + detail panel */}
          <div className="appt-week-side">
            {/* Mini calendar */}
            <div className="card" style={{ padding: '14px 12px' }}>
              <MiniCalendar
                year={calYear}
                month={calMonth}
                selectedDate={currentDate}
                appointments={calQuery.data ?? []}
                onDateClick={goToDate}
                onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m); }}
              />
            </div>

            {/* Today's appointments count */}
            {calQuery.data && (() => {
              const todayAppts = (calQuery.data ?? []).filter((a) =>
                toLocalISODate(apptDate(a)) === todayStr
                && a.status !== 'cancelled' && a.status !== 'no_show',
              );
              return todayAppts.length > 0 ? (
                <div className="card" style={{ padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', fontWeight: 700,
                    color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                    Today · {todayAppts.length}
                  </div>
                  {todayAppts.slice(0, 5).map((a) => (
                    <div key={a.id} style={{ marginBottom: 6 }}>
                      <ApptCard appt={a} compact onClick={openDetail} />
                    </div>
                  ))}
                </div>
              ) : null;
            })()}

            {/* Appointment detail panel */}
            {detailAppt && (
              <div className="card" style={{ flex: 1 }}>
                <AppointmentDetail
                  appt={detailAppt}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onClose={() => setParam('appt', null)}
                  onStatusChange={handleStatusChange}
                  isDeleting={del.isPending}
                />
              </div>
            )}
          </div>

          {/* Main calendar area */}
          <div className="card appt-week-main">
            {/* Week navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              borderBottom: '1px solid hsl(var(--border))', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button className="button button-ghost" style={{ minHeight: 32, padding: '0 8px' }} onClick={prevWeek}
                  title="Previous week">
                  <ChevronLeft size={15} />
                </button>
                <button className="button button-ghost" style={{ minHeight: 32, padding: '0 8px' }} onClick={nextWeek}
                  title="Next week">
                  <ChevronRight size={15} />
                </button>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.02em', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {fmtDateShort(weekStart)} – {fmtDateShort(weekEnd)}, {weekStart.getFullYear()}
              </div>
              <button className="button button-ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 12, flexShrink: 0 }}
                onClick={goToday}>
                Today
              </button>
              {calQuery.isLoading && (
                <Loader2 size={14} className="animate-spin muted" style={{ marginLeft: 2 }} />
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap', rowGap: 4 }}>
                {APPOINTMENT_TYPES.slice(0, 5).map((t) => {
                  const c = typeColor(t);
                  return (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 9, color: c.text, fontFamily: 'var(--app-font-mono)', fontWeight: 700 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: c.border, flexShrink: 0 }} />
                      {t}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Scrollable week grid */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {calQuery.isError ? (
                <div className="error-panel">
                  <AlertCircle size={16} />
                  Could not load calendar. Check your connection.
                </div>
              ) : (
                <WeekView
                  weekStart={weekStart}
                  appointments={weekAppts}
                  onSlotClick={handleSlotClick}
                  onAllDayClick={handleAllDayClick}
                  onApptClick={openDetail}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── LIST VIEW ──────────────────────────────────────────────── */
        <>
          {detailAppt && (
            <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
              <AppointmentDetail
                appt={detailAppt}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onClose={() => setParam('appt', null)}
                onStatusChange={handleStatusChange}
                isDeleting={del.isPending}
              />
            </div>
          )}
          <AppointmentRegister
            query={register}
            search={searchInput}
            onSearch={setSearchInput}
            filters={filters}
            onChange={changeFilters}
            onReset={resetFilters}
            hasFilters={hasFilters}
            page={page}
            pageSize={PAGE_SIZE}
            onPage={setPage}
            onOpen={openDetail}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onStatusChange={handleStatusChange}
            isDeleting={del.isPending}
            onNew={() => openNew()}
            caseFilter={caseFilter}
          />
        </>
      )}
    </div>
  );
}

// ─── Register (filterable list view) ──────────────────────────────────────────
interface RegisterProps {
  query: ReturnType<typeof useListAppointments<AppointmentList>>;
  search: string;
  onSearch: (v: string) => void;
  filters: RegisterFilters;
  onChange: (patch: Partial<RegisterFilters>) => void;
  onReset: () => void;
  hasFilters: boolean;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onOpen: (a: Appointment) => void;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, s: AppointmentStatus) => void;
  isDeleting: boolean;
  onNew: () => void;
  caseFilter: string;
}

function AppointmentRegister({
  query, search, onSearch, filters, onChange, onReset, hasFilters,
  page, pageSize, onPage, onOpen, onEdit, onDelete, onStatusChange,
  isDeleting, onNew, caseFilter,
}: RegisterProps) {
  const rows  = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last  = Math.min(page * pageSize, total);

  const duration = (a: Appointment) => {
    const mins = Math.round((new Date(a.endAt).getTime() - new Date(a.startAt).getTime()) / 60000);
    return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;
  };

  const rangeLocked = !!filters.range;

  return (
    <section className="card table-card">
      {/* Filters */}
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="input-wrap" style={{ flex: '1 1 220px', minWidth: 180 }}>
          <Search />
          <input
            className="field" placeholder="Search title, client, case #, location…"
            value={search} onChange={(e) => onSearch(e.target.value)}
          />
        </div>

        <select className="select" style={{ width: 150 }} value={filters.type}
          onChange={(e) => onChange({ type: e.target.value })}>
          <option value="">All types</option>
          {APPOINTMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <select className="select" style={{ width: 135 }} value={filters.status}
          onChange={(e) => onChange({ status: e.target.value })}>
          <option value="">Any status</option>
          {APPOINTMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>

        <select className="select" style={{ width: 150 }} value={filters.source}
          title="Who owns the entry"
          onChange={(e) => onChange({ source: e.target.value as RegisterFilters['source'] })}>
          <option value="">All sources</option>
          <option value="docketline">Booked here</option>
          <option value="google">From Google</option>
        </select>

        <select className="select" style={{ width: 135 }} value={filters.range}
          title="Quick date window"
          onChange={(e) => onChange({ range: e.target.value as RangeFilter, from: '', to: '' })}>
          <option value="">All dates</option>
          <option value="upcoming">Upcoming</option>
          <option value="today">Today</option>
          <option value="next7">Next 7 days</option>
          <option value="past">Past</option>
        </select>

        <input
          className="field" type="date" style={{ width: 138, opacity: rangeLocked ? .5 : 1 }}
          title={rangeLocked ? 'Clear the quick window to pick exact dates' : 'From date'}
          value={filters.from} disabled={rangeLocked} max={filters.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })}
        />
        <input
          className="field" type="date" style={{ width: 138, opacity: rangeLocked ? .5 : 1 }}
          title={rangeLocked ? 'Clear the quick window to pick exact dates' : 'To date'}
          value={filters.to} disabled={rangeLocked} min={filters.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })}
        />

        <select className="select" style={{ width: 140 }} value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as 'soonest' | 'latest' })}>
          <option value="soonest">Soonest first</option>
          <option value="latest">Latest first</option>
        </select>

        {hasFilters && (
          <button className="button button-ghost" style={{ minHeight: 34, padding: '0 10px' }} onClick={onReset}>
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* Count bar */}
      {(total > 0 || hasFilters || caseFilter) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 14px', background: 'hsl(var(--muted) / .4)',
          borderBottom: '1px solid hsl(var(--border))', fontSize: 11,
        }}>
          <span className="muted">
            {total} appointment{total !== 1 ? 's' : ''} {hasFilters ? 'matching filters' : 'in total'}
            {caseFilter ? ' · case scoped' : ''}
          </span>
          <span className="muted">Toronto time</span>
        </div>
      )}

      {/* Rows */}
      {query.isLoading ? (
        <div style={{ padding: 16 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid hsl(var(--border))' }}>
              <Skeleton w={90} h={11} />
              <Skeleton w="30%" h={11} />
              <Skeleton w="20%" h={11} />
              <Skeleton w={70} h={11} />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div className="error-panel" style={{ margin: 14 }}>
          <AlertCircle size={16} /> Could not load appointments.
          <button className="button button-ghost" style={{ minHeight: 26, padding: '0 8px', marginLeft: 'auto' }}
            onClick={() => query.refetch()}>
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 20px' }}>
          <div className="empty-icon"><FolderOpen size={20} /></div>
          <h3>{hasFilters || caseFilter ? 'No matching appointments' : 'No appointments yet'}</h3>
          <p>{hasFilters || caseFilter
            ? 'Try a wider date window or clear the filters.'
            : 'Book a consultation or meeting to get started.'}</p>
          {!hasFilters && !caseFilter && (
            <button className="button button-accent" onClick={onNew}>
              <Plus size={13} /> New appointment
            </button>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Appointment</th>
                <th>Client / Case</th>
                <th>Location</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const c = typeColor(a.type);
                const dead = a.status === 'cancelled' || a.status === 'no_show';
                const isLive = a.status === 'scheduled' || a.status === 'confirmed';
                const isClosed = a.status === 'cancelled' || a.status === 'no_show';
                return (
                  <tr
                    key={a.id}
                    onClick={() => onOpen(a)}
                    style={{ cursor: 'pointer', opacity: dead ? .6 : 1 }}
                    title="Open details"
                  >
                    <td className="mono" style={{ whiteSpace: 'nowrap', borderLeft: `3px solid ${c.border}` }}>
                      <div style={{ fontWeight: 700 }}>{fmtDateShort(apptDate(a))}</div>
                      <div className="muted" style={{ fontSize: 10 }}>
                        {a.allDay ? 'All day' : `${fmtTimeAmPm(new Date(a.startAt))} · ${duration(a)}`}
                      </div>
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      <div style={{
                        fontWeight: 700, textDecoration: dead ? 'line-through' : 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {a.title}
                      </div>
                      <div className="muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
                        <span style={{ color: c.text, fontWeight: 700 }}>{a.type}</span>
                        {a.courtDateId ? ' · from case court date' : ''}
                        {a.externalSource ? ' · from your Google Calendar' : ''}
                        {a.notes ? ` · ${a.notes}` : ''}
                      </div>
                    </td>
                    <td style={{ maxWidth: 200 }}>
                      {a.clientName
                        ? <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.clientName}</div>
                        : <span className="muted">—</span>}
                      {a.caseId && (
                        <Link
                          href={`/cases/${a.caseId}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 10, color: 'hsl(var(--accent))', fontWeight: 700 }}
                        >
                          Case #{a.caseNumber ?? '—'}
                        </Link>
                      )}
                    </td>
                    <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                      {a.location ?? '—'}
                    </td>
                    <td><StatusPill status={a.status} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {a.courtDateId ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          {a.caseId && (
                            <Link href={`/cases/${a.caseId}`} className="button button-ghost"
                              style={{ minHeight: 26, padding: '0 8px', fontSize: 10, textDecoration: 'none' }}
                              title="Edit this court date on the case file">
                              <Landmark size={12} /> Case
                            </Link>
                          )}
                        </div>
                      ) : isExternalAppt(a) ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <span className="muted" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title="Managed in your Google Calendar">
                            <Calendar size={11} /> Google
                          </span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                        {a.status === 'scheduled' && (
                          <button className="button button-ghost" style={{ minHeight: 26, padding: '0 7px' }}
                            title="Confirm this appointment" disabled={isDeleting}
                            onClick={() => onStatusChange(a.id, 'confirmed')}>
                            <Check size={12} />
                          </button>
                        )}
                        {isLive && (
                          <button className="button button-ghost" style={{ minHeight: 26, padding: '0 7px' }}
                            title="Cancel this appointment" disabled={isDeleting}
                            onClick={() => onStatusChange(a.id, 'cancelled')}>
                            <X size={12} />
                          </button>
                        )}
                        {isClosed && (
                          <button className="button button-ghost" style={{ minHeight: 26, padding: '0 7px' }}
                            title="Put it back on the calendar" disabled={isDeleting}
                            onClick={() => onStatusChange(a.id, 'scheduled')}>
                            <RotateCcw size={12} />
                          </button>
                        )}
                        <button className="button button-ghost" style={{ minHeight: 26, padding: '0 7px' }}
                          title="Edit" onClick={() => onEdit(a)}>
                          <Pencil size={12} />
                        </button>
                        <button className="button button-danger" style={{ minHeight: 26, padding: '0 7px' }}
                          title="Delete" disabled={isDeleting}
                          onClick={() => { if (window.confirm(`Delete "${a.title}"?`)) onDelete(a.id); }}>
                          <Trash2 size={12} />
                        </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', borderTop: '1px solid hsl(var(--border))', fontSize: 11,
        }}>
          <span className="muted">Showing {first}–{last} of {total}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="button button-ghost" style={{ minHeight: 28, padding: '0 8px' }}
              disabled={page <= 1} onClick={() => onPage(page - 1)}>
              <ChevronLeft size={13} /> Prev
            </button>
            <span className="muted">Page {page} / {pages}</span>
            <button className="button button-ghost" style={{ minHeight: 28, padding: '0 8px' }}
              disabled={page >= pages} onClick={() => onPage(page + 1)}>
              Next <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Case detail panel ────────────────────────────────────────────────────────
interface CasePanelProps {
  caseId: string;
  clientId?: string;
  clientName?: string;
}

/** Compact appointments block for the matter page: next dates at a glance,
 *  plus a shortcut that opens the full schedule already scoped to this case. */
export function CaseAppointmentsPanel({ caseId, clientId, clientName }: CasePanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState('');
  const qc = useQueryClient();
  const update = useUpdateAppointment();

  const params = useMemo(() => ({ caseId, limit: 50 }), [caseId]);
  const query = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params), staleTime: 15000 },
  });

  const rows = query.data?.data ?? [];
  const nowMs = Date.now();

  const upcoming = useMemo(
    () => rows
      .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show' && new Date(a.endAt).getTime() >= nowMs)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [rows, nowMs],
  );

  // Once nothing is booked ahead, the last few entries are the useful context.
  const recent = useMemo(
    () => rows
      .filter((a) => !upcoming.some((u) => u.id === a.id))
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
      .slice(0, 3),
    [rows, upcoming],
  );

  const shown = upcoming.length ? upcoming.slice(0, 4) : recent;
  const next = upcoming[0];

  const bump = () => invalidateAppointments(qc);

  const confirm = (id: string) => {
    setErr('');
    update.mutate(
      { id, data: { status: 'confirmed' } },
      {
        onSuccess: bump,
        onError: (e: any) => setErr(e?.message ?? 'Could not confirm this appointment.'),
      },
    );
  };

  const scheduleHref = (a: Appointment) =>
    `/appointments?caseId=${encodeURIComponent(caseId)}&view=week&date=${toLocalISODate(apptDate(a))}&appt=${a.id}`;

  return (
    <div>
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title">Appointments</div>
          <div className="section-kicker">
            {next
              ? `Next: ${fmtDateShort(new Date(next.startAt))} at ${fmtTimeAmPm(new Date(next.startAt))} · ${next.type}`
              : upcoming.length
                ? `${upcoming.length} upcoming on this file`
                : 'No upcoming appointments on this file.'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Link
            href={`/appointments?caseId=${encodeURIComponent(caseId)}&view=list`}
            className="button button-ghost"
            style={{ minHeight: 28, padding: '0 10px', textDecoration: 'none' }}
          >
            Full schedule <ExternalLink size={12} />
          </Link>
          <button
            className="button button-accent"
            style={{ minHeight: 28, padding: '0 10px' }}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? <X size={13} /> : <Plus size={13} />}
            {showForm ? 'Cancel' : 'Schedule'}
          </button>
        </div>
      </div>

      {showForm && (
        <div style={{ marginBottom: 14 }}>
          <AppointmentForm
            defaultCaseId={caseId}
            defaultClientId={clientId}
            defaultClientName={clientName}
            onSuccess={() => { setShowForm(false); bump(); }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {err && <p style={{ color: 'hsl(var(--destructive))', fontSize: 11, margin: '0 0 8px' }}>{err}</p>}

      {query.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2].map((i) => <Skeleton key={i} h={36} />)}
        </div>
      ) : query.isError ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Appointments could not be loaded.</p>
      ) : shown.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Nothing booked yet — schedule the first meeting or appearance for this matter.
        </p>
      ) : (
        <div>
          {upcoming.length === 0 && recent.length > 0 && (
            <div className="eyebrow" style={{ marginBottom: 4 }}>Most recent</div>
          )}
          {shown.map((a, i) => {
            const c = typeColor(a.type);
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  borderBottom: i < shown.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                }}
              >
                <Link
                  href={scheduleHref(a)}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 0', fontSize: 12, color: 'inherit', textDecoration: 'none',
                  }}
                >
                  <div style={{ width: 4, alignSelf: 'stretch', background: c.border, borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.title}
                    </div>
                    <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                      {fmtDateShort(apptDate(a))} ·{' '}
                      {a.allDay
                        ? 'All day'
                        : `${fmtTimeAmPm(new Date(a.startAt))}–${fmtTimeAmPm(new Date(a.endAt))}`}
                      {` · ${a.type}`}
                      {a.location ? ` · ${a.location}` : ''}
                    </div>
                  </div>
                  <StatusPill status={a.status} />
                </Link>
                {a.status === 'scheduled' && !isCourtAppt(a) && (
                  <button
                    className="button button-ghost"
                    style={{ minHeight: 26, padding: '0 8px', fontSize: 10 }}
                    title="Mark this appointment confirmed"
                    disabled={update.isPending}
                    onClick={() => confirm(a.id)}
                  >
                    <Check size={12} /> Confirm
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Compact upcoming panel (for dashboard) ───────────────────────────────────
export function UpcomingAppointmentsPanel() {
  // Over-fetch then drop cancelled / no-show rows: a dead booking must not eat
  // one of the five slots on the dashboard.
  const params = useMemo(() => ({ upcoming: true, limit: 20, sort: 'soonest' as const }), []);
  const query  = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params), staleTime: 30000 },
  });

  const rows = (query.data?.data ?? [])
    .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
    .slice(0, 5);

  return (
    <div>
      {query.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 40 }} />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>No upcoming appointments.</p>
      ) : (
        <div>
          {rows.map((a, i) => {
            const c = typeColor(a.type);
            const day = toLocalISODate(apptDate(a));
            return (
              <Link
                key={a.id}
                href={`/appointments?view=week&date=${day}&appt=${a.id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0',
                  borderBottom: i < rows.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                  fontSize: 12, color: 'inherit', textDecoration: 'none',
                }}
              >
                <div style={{ width: 4, alignSelf: 'stretch', background: c.border, borderRadius: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                    {fmtDateShort(apptDate(a))} ·{' '}
                    {a.allDay ? 'All day' : fmtTimeAmPm(new Date(a.startAt))}
                    {a.clientName && ` · ${a.clientName}`}
                  </div>
                </div>
                <StatusPill status={a.status} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
