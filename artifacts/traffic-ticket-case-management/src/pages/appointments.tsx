import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, AlertTriangle, CalendarClock, Check, ChevronLeft,
  ChevronRight, Clock, FolderOpen, Loader2, MapPin, Pencil,
  Plus, Trash2, User, X, Calendar,
} from 'lucide-react';
import {
  APPOINTMENT_TYPES,
  APPOINTMENT_STATUSES,
  getCalendarAppointmentsQueryKey,
  getListAppointmentsQueryKey,
  useCalendarAppointments,
  useCheckConflict,
  useCreateAppointment,
  useDeleteAppointment,
  useListAppointments,
  useUpdateAppointment,
  useListClients,
  useListCases,
  getListClientsQueryKey,
  getListCasesQueryKey,
} from '@workspace/api-client-react';
import type {
  Appointment,
  AppointmentInput,
  AppointmentList,
  AppointmentStatus,
  AppointmentUpdate,
} from '@workspace/api-client-react';

// ─── Constants ───────────────────────────────────────────────────────────────
const DAY_START_HOUR = 7;   // 7 AM
const DAY_END_HOUR   = 20;  // 8 PM
const SLOT_HEIGHT_PX = 56;  // pixels per hour
const TOTAL_HOURS    = DAY_END_HOUR - DAY_START_HOUR;

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

const fmtTime = (d: Date) =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const fmtTimeAmPm = (d: Date) => {
  const h = d.getHours();
  const m = d.getMinutes();
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
      title={`${appt.title}\n${fmtTimeAmPm(new Date(appt.startAt))} – ${fmtTimeAmPm(new Date(appt.endAt))}`}
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
          {fmtTimeAmPm(new Date(appt.startAt))}
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
  onSuccess: () => void;
  onCancel: () => void;
}

function AppointmentForm({ editing, defaultDate, defaultHour, onSuccess, onCancel }: ApptFormProps) {
  const qc          = useQueryClient();
  const create      = useCreateAppointment();
  const update      = useUpdateAppointment();

  const clients = useListClients(
    { limit: 200 },
    { query: { queryKey: getListClientsQueryKey({ limit: 200 }), staleTime: 60000 } },
  );
  const [selClient, setSelClient] = useState(editing?.clientId ?? '');

  const cases = useListCases(
    { clientId: selClient || undefined, limit: 100 },
    { query: { queryKey: getListCasesQueryKey({ clientId: selClient || undefined, limit: 100 }), staleTime: 30000, enabled: !!selClient } },
  );

  // Form state
  const defDate  = defaultDate ?? toLocalISODate(new Date());
  const defHour  = defaultHour ?? 9;
  const defStart = `${defDate}T${pad(defHour)}:00`;
  const defEnd   = `${defDate}T${pad(defHour + 1)}:00`;

  const [title,    setTitle]    = useState(editing?.title    ?? '');
  const [type,     setType]     = useState(editing?.type     ?? 'Consultation');
  const [caseId,   setCaseId]   = useState(editing?.caseId   ?? '');
  const [startAt,  setStartAt]  = useState(editing ? toLocalISODatetime(new Date(editing.startAt)) : defStart);
  const [endAt,    setEndAt]    = useState(editing ? toLocalISODatetime(new Date(editing.endAt))   : defEnd);
  const [location, setLocation] = useState(editing?.location ?? '');
  const [notes,    setNotes]    = useState(editing?.notes    ?? '');
  const [status,   setStatus]   = useState<AppointmentStatus>(editing?.status ?? 'scheduled');
  const [serverErr,setServerErr]= useState('');

  // Auto-adjust endAt when startAt changes (keep same duration)
  const handleStartChange = (val: string) => {
    setStartAt(val);
    if (val && endAt) {
      const prevDur = new Date(endAt).getTime() - new Date(startAt).getTime();
      const newEnd  = new Date(new Date(val).getTime() + Math.max(prevDur, 30 * 60 * 1000));
      setEndAt(toLocalISODatetime(newEnd));
    }
  };

  // Live conflict check
  const conflictQuery = useCheckConflict(
    startAt ? new Date(startAt).toISOString() : '',
    endAt   ? new Date(endAt).toISOString()   : '',
    editing?.id,
    { query: { queryKey: ['conflict', startAt, endAt, editing?.id], staleTime: 5000 } },
  );
  const hasConflict = !!conflictQuery.data?.hasConflict;

  // Validation
  const errors: Record<string, string> = {};
  if (!title.trim())          errors.title   = 'Enter a title';
  if (!startAt)               errors.startAt = 'Select start time';
  if (!endAt)                 errors.endAt   = 'Select end time';
  if (startAt && endAt && new Date(endAt) <= new Date(startAt))
    errors.endAt = 'End must be after start';
  const durMs = startAt && endAt ? new Date(endAt).getTime() - new Date(startAt).getTime() : 0;
  if (durMs > 12 * 3600 * 1000) errors.endAt = 'Max duration is 12 hours';

  const canSubmit = Object.keys(errors).length === 0;
  const isPending = create.isPending || update.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setServerErr('');

    const payload: AppointmentInput = {
      clientId: selClient || undefined,
      caseId:   caseId    || undefined,
      title:    title.trim(),
      type,
      startAt:  new Date(startAt).toISOString(),
      endAt:    new Date(endAt).toISOString(),
      location: location.trim() || undefined,
      notes:    notes.trim()    || undefined,
      status,
    };

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
      qc.invalidateQueries({ queryKey: ['appointments-calendar'] });
    };

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
        </div>

        {/* Start */}
        <div className="form-field">
          <label className="form-label">Start *</label>
          <input className="field" type="datetime-local"
            value={startAt} onChange={(e) => handleStartChange(e.target.value)} />
          {errors.startAt && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.startAt}</span>}
        </div>

        {/* End */}
        <div className="form-field">
          <label className="form-label">End *</label>
          <input className="field" type="datetime-local"
            value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          {errors.endAt && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.endAt}</span>}
        </div>

        {/* Client */}
        <div className="form-field">
          <label className="form-label">Client <span className="muted">(optional)</span></label>
          <select className="select" value={selClient}
            onChange={(e) => { setSelClient(e.target.value); setCaseId(''); }}
            disabled={clients.isLoading}>
            <option value="">No client</option>
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

      {/* Conflict warning */}
      {hasConflict && canSubmit && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px',
          background: 'hsl(var(--accent) / .08)', border: '1px solid hsl(var(--accent) / .3)',
          borderRadius: 7, marginTop: 12, fontSize: 12,
        }}>
          <AlertTriangle size={15} style={{ color: 'hsl(var(--accent))', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, color: 'hsl(var(--accent))' }}>
              Time conflict detected
            </div>
            <div style={{ color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
              {conflictQuery.data?.conflicts.map((c) => (
                <div key={c.id}>
                  · {c.title} ({fmtTimeAmPm(new Date(c.startAt))} – {fmtTimeAmPm(new Date(c.endAt))})
                </div>
              ))}
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
          disabled={isPending || !canSubmit}>
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
  onApptClick: (a: Appointment) => void;
}

function WeekView({ weekStart, appointments, onSlotClick, onApptClick }: WeekViewProps) {
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => DAY_START_HOUR + i);
  const days  = Array.from({ length: 7 },           (_, i) => addDays(weekStart, i));
  const now   = new Date();

  // Map appointments to day columns
  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    days.forEach((d) => map.set(toLocalISODate(d), []));
    appointments.forEach((a) => {
      const key = toLocalISODate(new Date(a.startAt));
      if (map.has(key)) map.get(key)!.push(a);
    });
    return map;
  }, [appointments, days]);

  // Compute top/height for an appointment block
  const apptStyle = (a: Appointment) => {
    const start  = new Date(a.startAt);
    const end    = new Date(a.endAt);
    const startH = start.getHours() + start.getMinutes() / 60;
    const endH   = end.getHours()   + end.getMinutes()   / 60;
    const clampedStart = Math.max(startH, DAY_START_HOUR);
    const clampedEnd   = Math.min(endH,   DAY_END_HOUR);
    const top    = (clampedStart - DAY_START_HOUR) * SLOT_HEIGHT_PX;
    const height = Math.max((clampedEnd - clampedStart) * SLOT_HEIGHT_PX, 20);
    return { top, height };
  };

  // Current time indicator offset
  const nowOffset =
    isSameDay(now, days[0]) || days.some((d) => isSameDay(d, now))
      ? (now.getHours() + now.getMinutes() / 60 - DAY_START_HOUR) * SLOT_HEIGHT_PX
      : -1;

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}>
      {/* Time gutter */}
      <div style={{ width: 52, flexShrink: 0, paddingTop: 40 }}>
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

      {/* Day columns */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        minWidth: 0, borderLeft: '1px solid hsl(var(--border))' }}>
        {days.map((day, di) => {
          const isToday    = isSameDay(day, now);
          const isPast     = day < now && !isToday;
          const dayAppts   = apptsByDay.get(toLocalISODate(day)) ?? [];
          return (
            <div key={di} style={{
              borderRight: '1px solid hsl(var(--border))',
              position: 'relative',
              background: isPast ? 'hsl(var(--muted) / .18)' : undefined,
            }}>
              {/* Day header */}
              <div style={{
                height: 40, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                borderBottom: '1px solid hsl(var(--border))',
                position: 'sticky', top: 0, zIndex: 2,
                background: isToday ? 'hsl(var(--accent) / .07)' : 'hsl(var(--card))',
              }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)',
                  color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase' }}>
                  {DAYS_SHORT[di]}
                </div>
                <div style={{
                  fontSize: 15, fontWeight: 700, lineHeight: 1,
                  color: isToday ? 'hsl(var(--accent))' : 'hsl(var(--foreground))',
                  width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: isToday ? 'hsl(var(--accent) / .12)' : 'transparent',
                }}>
                  {day.getDate()}
                </div>
              </div>

              {/* Hour slots — clickable */}
              <div style={{ position: 'relative',
                height: TOTAL_HOURS * SLOT_HEIGHT_PX }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    onClick={() => onSlotClick(day, h)}
                    style={{
                      position: 'absolute', top: (h - DAY_START_HOUR) * SLOT_HEIGHT_PX,
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
                {isToday && nowOffset >= 0 && nowOffset <= TOTAL_HOURS * SLOT_HEIGHT_PX && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0,
                    top: nowOffset, zIndex: 3, pointerEvents: 'none',
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
                {dayAppts.map((a) => {
                  const { top, height } = apptStyle(a);
                  const c = typeColor(a.type);
                  const isCancelled = a.status === 'cancelled' || a.status === 'no_show';
                  return (
                    <div
                      key={a.id}
                      onClick={(e) => { e.stopPropagation(); onApptClick(a); }}
                      style={{
                        position: 'absolute',
                        top: top + 1, left: 2, right: 2,
                        height: height - 2,
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
                        (e.currentTarget as HTMLDivElement).style.zIndex = '5';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                        (e.currentTarget as HTMLDivElement).style.zIndex = '1';
                      }}
                    >
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: c.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        textDecoration: isCancelled ? 'line-through' : 'none',
                      }}>
                        {a.title}
                      </div>
                      {height > 32 && (
                        <div style={{ fontSize: 9, color: c.text, opacity: .75 }}>
                          {fmtTimeAmPm(new Date(a.startAt))}
                        </div>
                      )}
                      {height > 48 && a.clientName && (
                        <div style={{ fontSize: 9, color: c.text, opacity: .6 }}>
                          {a.clientName}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
    appointments.forEach((a) => s.add(toLocalISODate(new Date(a.startAt))));
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
  const duration = Math.round((new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime()) / 60000);
  const durStr = duration >= 60
    ? `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ''}`
    : `${duration}m`;

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
            {fmtDateLong(new Date(appt.startAt))}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={13} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
          <span>
            {fmtTimeAmPm(new Date(appt.startAt))} – {fmtTimeAmPm(new Date(appt.endAt))}
            <span className="muted" style={{ marginLeft: 6 }}>({durStr})</span>
          </span>
        </div>
        {appt.clientName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={13} style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0 }} />
            <span>
              {appt.clientName}
              {appt.caseNumber && <span className="muted"> · Case #{appt.caseNumber}</span>}
            </span>
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
      </div>

      {/* Status + actions */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusPill status={appt.status} />
          {appt.status === 'scheduled' && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}
              onClick={() => onStatusChange(appt.id, 'confirmed')}>
              Confirm
            </button>
          )}
          {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}
              onClick={() => onStatusChange(appt.id, 'completed')}>
              Complete
            </button>
          )}
          {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
            <button className="button button-ghost" style={{ minHeight: 26, padding: '0 9px', fontSize: 11,
              color: 'hsl(var(--destructive))' }}
              onClick={() => onStatusChange(appt.id, 'cancelled')}>
              Cancel
            </button>
          )}
        </div>
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
      </div>
    </div>
  );
}

// ─── Main Appointments Page ───────────────────────────────────────────────────
export function AppointmentsPage() {
  const qc  = useQueryClient();
  const now = new Date();

  // Navigation state
  const [viewMode,    setViewMode]    = useState<'week' | 'list'>('week');
  const [currentDate, setCurrentDate] = useState(now);
  const [calYear,     setCalYear]     = useState(now.getFullYear());
  const [calMonth,    setCalMonth]    = useState(now.getMonth()); // 0-indexed

  // UI state
  const [showForm,    setShowForm]    = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [detailAppt,  setDetailAppt]  = useState<Appointment | null>(null);
  const [newApptDate, setNewApptDate] = useState<string | undefined>();
  const [newApptHour, setNewApptHour] = useState<number | undefined>();

  const weekStart = useMemo(() => startOfWeek(currentDate), [currentDate]);
  const weekEnd   = useMemo(() => addDays(weekStart, 6),    [weekStart]);

  // Calendar data (month view — includes full weeks around month)
  const calParams = useMemo(() => ({ year: calYear, month: calMonth + 1 }), [calYear, calMonth]);
  const calQuery  = useCalendarAppointments(calParams, {
    query: { queryKey: [...getCalendarAppointmentsQueryKey(calParams), 'cal'], staleTime: 20000 },
  });

  // Week appointments (filter from calendar data)
  const weekAppts = useMemo(() => {
    const all = calQuery.data ?? [];
    return all.filter((a) => {
      const d = new Date(a.startAt);
      return d >= weekStart && d <= addDays(weekEnd, 1);
    });
  }, [calQuery.data, weekStart, weekEnd]);

  // Upcoming list (next 30 days)
  const upcomingParams = useMemo(() => ({ upcoming: true, limit: 50 }), []);
  const upcomingQuery  = useListAppointments(upcomingParams, {
    query: { queryKey: getListAppointmentsQueryKey(upcomingParams), staleTime: 20000 },
  });

  const updateStatus = useUpdateAppointment();
  const del          = useDeleteAppointment();

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: getCalendarAppointmentsQueryKey(calParams) });
    qc.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
  }, [qc, calParams]);

  const handleStatusChange = (id: string, status: AppointmentStatus) => {
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: (updated) => {
          invalidate();
          setDetailAppt(updated);
        },
      },
    );
  };

  const handleDelete = (id: string) => {
    del.mutate({ id }, {
      onSuccess: () => {
        invalidate();
        setDetailAppt(null);
      },
    });
  };

  const handleSlotClick = (date: Date, hour: number) => {
    setNewApptDate(toLocalISODate(date));
    setNewApptHour(hour);
    setEditingAppt(null);
    setDetailAppt(null);
    setShowForm(true);
  };

  const handleApptClick = (a: Appointment) => {
    setDetailAppt(a);
    setShowForm(false);
  };

  const handleEdit = (a: Appointment) => {
    setEditingAppt(a);
    setDetailAppt(null);
    setShowForm(true);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingAppt(null);
  };

  // Sync mini-calendar month when navigating weeks
  useEffect(() => {
    setCalYear(currentDate.getFullYear());
    setCalMonth(currentDate.getMonth());
  }, [currentDate]);

  const prevWeek = () => setCurrentDate((d) => addDays(d, -7));
  const nextWeek = () => setCurrentDate((d) => addDays(d,  7));
  const goToday  = () => setCurrentDate(new Date());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="eyebrow">Schedule / Calendar</div>
          <h1 className="page-title">Appointments</h1>
          <p className="page-copy">Schedule consultations, court dates, and client meetings.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`button ${viewMode === 'week' ? 'button-primary' : 'button-ghost'}`}
            onClick={() => setViewMode('week')}>
            <Calendar size={14} /> Week
          </button>
          <button
            className={`button ${viewMode === 'list' ? 'button-primary' : 'button-ghost'}`}
            onClick={() => setViewMode('list')}>
            <CalendarClock size={14} /> List
          </button>
          <button className="button button-accent"
            onClick={() => { setEditingAppt(null); setNewApptDate(undefined); setNewApptHour(undefined); setDetailAppt(null); setShowForm((v) => !v); }}>
            {showForm && !editingAppt ? <X size={14} /> : <Plus size={14} />}
            {showForm && !editingAppt ? 'Cancel' : 'New appointment'}
          </button>
        </div>
      </div>

      {/* ── Add / Edit form ───────────────────────────────────────────── */}
      {showForm && (
        <div style={{ marginBottom: 18 }}>
          <AppointmentForm
            editing={editingAppt}
            defaultDate={newApptDate}
            defaultHour={newApptHour}
            onSuccess={handleFormSuccess}
            onCancel={() => { setShowForm(false); setEditingAppt(null); }}
          />
        </div>
      )}

      {viewMode === 'week' ? (
        /* ── WEEK VIEW ──────────────────────────────────────────────── */
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          {/* Sidebar: mini-cal + detail panel */}
          <div style={{ width: 236, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Mini calendar */}
            <div className="card" style={{ padding: '14px 12px' }}>
              <MiniCalendar
                year={calYear}
                month={calMonth}
                selectedDate={currentDate}
                appointments={calQuery.data ?? []}
                onDateClick={(d) => setCurrentDate(d)}
                onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m); }}
              />
            </div>

            {/* Today's appointments count */}
            {calQuery.data && (() => {
              const todayAppts = (calQuery.data ?? []).filter((a) =>
                isSameDay(new Date(a.startAt), now) && a.status !== 'cancelled',
              );
              return todayAppts.length > 0 ? (
                <div className="card" style={{ padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', fontWeight: 700,
                    color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                    Today
                  </div>
                  {todayAppts.slice(0, 5).map((a) => (
                    <div key={a.id} style={{ marginBottom: 6 }}>
                      <ApptCard appt={a} compact onClick={handleApptClick} />
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
                  onClose={() => setDetailAppt(null)}
                  onStatusChange={handleStatusChange}
                  isDeleting={del.isPending}
                />
              </div>
            )}
          </div>

          {/* Main calendar area */}
          <div className="card" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Week navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
              borderBottom: '1px solid hsl(var(--border))' }}>
              <button className="button button-ghost" style={{ minHeight: 32, padding: '0 8px' }} onClick={prevWeek}>
                <ChevronLeft size={15} />
              </button>
              <button className="button button-ghost" style={{ minHeight: 32, padding: '0 8px' }} onClick={nextWeek}>
                <ChevronRight size={15} />
              </button>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.02em' }}>
                {fmtDateShort(weekStart)} – {fmtDateShort(weekEnd)}, {weekStart.getFullYear()}
              </div>
              <button className="button button-ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 12 }}
                onClick={goToday}>
                Today
              </button>
              {calQuery.isLoading && (
                <Loader2 size={14} className="animate-spin muted" style={{ marginLeft: 4 }} />
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                  onApptClick={handleApptClick}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ── LIST VIEW ──────────────────────────────────────────────── */
        <UpcomingList
          query={upcomingQuery}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
          isDeleting={del.isPending}
        />
      )}
    </div>
  );
}

// ─── Upcoming list view ───────────────────────────────────────────────────────
interface UpcomingListProps {
  query: ReturnType<typeof useListAppointments<AppointmentList>>;
  onEdit: (a: Appointment) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, s: AppointmentStatus) => void;
  isDeleting: boolean;
}

function UpcomingList({ query, onEdit, onDelete, onStatusChange, isDeleting }: UpcomingListProps) {
  const rows = query.data?.data ?? [];

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    rows.forEach((a) => {
      const key = toLocalISODate(new Date(a.startAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return Array.from(map.entries()).sort(([a], [b]) => (a as string).localeCompare(b as string));
  }, [rows]);

  if (query.isLoading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 8 }} />)}
    </div>
  );

  if (query.isError) return (
    <div className="card error-panel">
      <AlertCircle size={16} /> Could not load appointments.
    </div>
  );

  if (rows.length === 0) return (
    <div className="card empty-state">
      <div className="empty-icon"><FolderOpen size={20} /></div>
      <h3>No upcoming appointments</h3>
      <p>Schedule a consultation or meeting to get started.</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {grouped.map(([dateKey, appts]) => {
        const d = new Date(dateKey + 'T00:00:00');
        return (
          <div key={dateKey}>
            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--app-font-mono)',
              color: 'hsl(var(--muted-foreground))', textTransform: 'uppercase',
              letterSpacing: '.08em', marginBottom: 8 }}>
              {isSameDay(d, new Date()) ? 'Today' : fmtDateLong(d)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {appts.map((a) => {
                const c = typeColor(a.type);
                const duration = Math.round((new Date(a.endAt).getTime() - new Date(a.startAt).getTime()) / 60000);
                const durStr   = duration >= 60
                  ? `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ''}`
                  : `${duration}m`;
                return (
                  <div key={a.id} className="card" style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                    borderLeft: `3px solid ${c.border}`,
                    opacity: a.status === 'cancelled' || a.status === 'no_show' ? 0.55 : 1,
                  }}>
                    {/* Time */}
                    <div style={{ textAlign: 'center', width: 52, flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--app-font-mono)',
                        color: c.text }}>
                        {fmtTime(new Date(a.startAt))}
                      </div>
                      <div style={{ fontSize: 9, color: 'hsl(var(--muted-foreground))' }}>{durStr}</div>
                    </div>

                    {/* Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textDecoration: a.status === 'cancelled' ? 'line-through' : 'none' }}>
                        {a.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 2,
                        display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ color: c.text, fontWeight: 700 }}>{a.type}</span>
                        {a.clientName && <span>· {a.clientName}</span>}
                        {a.location   && <span>· <MapPin size={10} style={{ display: 'inline', marginRight: 2 }} />{a.location}</span>}
                      </div>
                    </div>

                    {/* Status + actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <StatusPill status={a.status} />
                      <button className="button button-ghost" style={{ minHeight: 28, padding: '0 8px' }}
                        onClick={() => onEdit(a)}>
                        <Pencil size={13} />
                      </button>
                      <button className="button button-danger" style={{ minHeight: 28, padding: '0 8px' }}
                        disabled={isDeleting}
                        onClick={() => { if (window.confirm(`Delete "${a.title}"?`)) onDelete(a.id); }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Compact upcoming panel (for dashboard) ───────────────────────────────────
export function UpcomingAppointmentsPanel() {
  const params = useMemo(() => ({ upcoming: true, limit: 5 }), []);
  const query  = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params), staleTime: 30000 },
  });

  const rows = query.data?.data ?? [];

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
            return (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 0',
                borderBottom: i < rows.length - 1 ? '1px solid hsl(var(--border))' : 'none',
                fontSize: 12,
              }}>
                <div style={{
                  width: 4, alignSelf: 'stretch', background: c.border,
                  borderRadius: 2, flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.title}
                  </div>
                  <div style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', marginTop: 1 }}>
                    {fmtDateShort(new Date(a.startAt))} · {fmtTimeAmPm(new Date(a.startAt))}
                    {a.clientName && ` · ${a.clientName}`}
                  </div>
                </div>
                <StatusPill status={a.status} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
