import { useState, useMemo, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowDownToLine, BarChart3, Check, ExternalLink,
  FolderOpen, Loader2, Pencil, Plus, RotateCcw, Search, Trash2,
  X, Building2, Briefcase,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  getListExpensesQueryKey,
  getGetExpenseSummaryQueryKey,
  getGetCaseQueryKey,
  getListCasesQueryKey,
  useListExpenses,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useGetExpenseSummary,
  useGetCase,
  useListCases,
} from '@workspace/api-client-react';
import type { Expense, ExpenseInput, ExpenseUpdate, ExpenseSummary } from '@workspace/api-client-react';

// ─── helpers ────────────────────────────────────────────────────────────────
const money = (v = 0) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v);

const fmtDate = (v?: string | null) =>
  v
    ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(v + 'T00:00:00'))
    : '—';

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

// ─── Category colour map ─────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  'Filing Fees':               '#c95743',
  'Court Fees':                '#e8a83e',
  'Travel':                    '#2e8f7b',
  'Parking':                   '#4b7bb5',
  'Postage & Courier':         '#7a5ca0',
  'Printing & Copying':        '#c97043',
  'Phone & Communication':     '#3d8f6b',
  'Office Supplies':           '#5a7ab5',
  'Professional Fees':         '#8f3d5a',
  'Expert Witness':            '#6b8f3d',
  'Process Server':            '#8f6b3d',
  'Transcripts':               '#3d6b8f',
  'Software & Subscriptions':  '#7b3d8f',
  'Marketing':                 '#8f7b3d',
  'Other':                     '#647080',
};

const catColor = (cat: string) => CAT_COLORS[cat] ?? '#647080';

// ─── Shared sub-components ───────────────────────────────────────────────────
function Skeleton({ w, h }: { w?: number | string; h?: number }) {
  return <div className="skeleton" style={{ width: w ?? '100%', height: h ?? 12, borderRadius: 4 }} />;
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><FolderOpen size={20} /></div>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

function ErrBanner({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="error-panel card" style={{ borderColor: 'hsl(var(--destructive) / .25)' }}>
      <AlertCircle size={16} />
      <span>{msg}</span>
      {onRetry && (
        <button className="button button-ghost" style={{ minHeight: 28, padding: '0 10px' }} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// Category badge pill
function CatPill({ cat }: { cat: string }) {
  const c = catColor(cat);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', minHeight: 22, borderRadius: 5,
      padding: '0 8px', fontSize: 10, fontFamily: 'var(--app-font-mono)', fontWeight: 700,
      letterSpacing: '.02em', color: c, background: `${c}18`,
    }}>
      {cat}
    </span>
  );
}

// Scope badge: firm-level vs case-linked
function ScopeBadge({ caseId, caseNumber }: { caseId?: string | null; caseNumber?: number | null }) {
  if (caseId) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 22,
        borderRadius: 5, padding: '0 8px', fontSize: 10,
        fontFamily: 'var(--app-font-mono)', fontWeight: 700,
        color: 'hsl(var(--chart-4))', background: 'hsl(var(--chart-4) / .11)',
      }}>
        <Briefcase size={10} /> Case #{caseNumber ?? '—'}
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 22,
      borderRadius: 5, padding: '0 8px', fontSize: 10,
      fontFamily: 'var(--app-font-mono)', fontWeight: 700,
      color: 'hsl(var(--muted-foreground))', background: 'hsl(var(--muted))',
    }}>
      <Building2 size={10} /> Firm
    </span>
  );
}

// ─── KPI strip ───────────────────────────────────────────────────────────────
interface ExpenseKpiFilters {
  billable: string;   // '', 'true', 'false'
  billed: string;     // '', 'true', 'false'
  firmOnly: boolean;
}

function ExpenseKpis({ dateFrom, dateTo, caseId, filters, onSelect }: {
  dateFrom?: string;
  dateTo?: string;
  caseId?: string;
  filters: ExpenseKpiFilters;
  onSelect: (next: Partial<ExpenseKpiFilters>) => void;
}) {
  const summaryParams = useMemo(() => ({ dateFrom, dateTo, caseId }), [dateFrom, dateTo, caseId]);
  const summary = useGetExpenseSummary(summaryParams, {
    query: { queryKey: getGetExpenseSummaryQueryKey(summaryParams), staleTime: 20000 },
  });
  const d = summary.data;

  const billableOnly = filters.billable === 'true';
  const clearFilters: Partial<ExpenseKpiFilters> = { billable: '', billed: '', firmOnly: false };

  const cards = [
    {
      key: 'total', label: 'Total expenses',
      value: d ? money(d.totalAmount) : null,
      hint: d ? `${d.count} expense${d.count !== 1 ? 's' : ''}` : '',
      color: '#c95743', bg: '#c9574312',
      active: !billableOnly && !filters.billed && !filters.firmOnly,
      onClick: () => onSelect(clearFilters),
    },
    {
      key: 'billable', label: 'Billable to clients',
      value: d ? money(d.billableAmount) : null,
      hint: 'recoverable from clients',
      color: '#4b7bb5', bg: '#4b7bb512',
      active: billableOnly && !filters.billed,
      onClick: () => onSelect(billableOnly && !filters.billed
        ? clearFilters
        : { billable: 'true', billed: '', firmOnly: false }),
    },
    {
      key: 'unbilled', label: 'Unbilled',
      value: d ? money(d.unbilledAmount) : null,
      hint: 'billable but not invoiced yet',
      color: '#e8a83e', bg: '#e8a83e12',
      active: billableOnly && filters.billed === 'false',
      onClick: () => onSelect(filters.billed === 'false'
        ? clearFilters
        : { billable: 'true', billed: 'false', firmOnly: false }),
    },
    caseId
      ? {
          key: 'billed', label: 'Billed to client',
          value: d ? money(d.billedAmount) : null,
          hint: 'already invoiced on this case',
          color: '#2e8f7b', bg: '#2e8f7b12',
          active: billableOnly && filters.billed === 'true',
          onClick: () => onSelect(filters.billed === 'true'
            ? clearFilters
            : { billable: 'true', billed: 'true', firmOnly: false }),
        }
      : {
          key: 'firm', label: 'Firm-level',
          value: d ? money(d.firmAmount) : null,
          hint: 'not linked to any case',
          color: '#647080', bg: '#64708012',
          active: filters.firmOnly,
          onClick: () => onSelect(filters.firmOnly
            ? clearFilters
            : { billable: '', billed: '', firmOnly: true }),
        },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14, marginBottom: 22 }}>
      {cards.map((k) => (
        <button
          key={k.key}
          type="button"
          onClick={k.onClick}
          title={k.active ? 'Show all expenses' : `Filter: ${k.label}`}
          className="card"
          style={{
            padding: '16px 18px', background: k.bg, textAlign: 'left', cursor: 'pointer',
            borderColor: k.active ? `${k.color}80` : `${k.color}28`,
            boxShadow: k.active ? `inset 0 0 0 1px ${k.color}66` : 'none',
            transition: 'border-color .15s ease, box-shadow .15s ease',
          }}
        >
          <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', color: k.color, fontWeight: 700 }}>
            {k.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 10, letterSpacing: '-.04em', fontFamily: 'var(--app-font-mono)', color: k.color }}>
            {summary.isLoading ? <Skeleton w={80} h={20} /> : k.value}
          </div>
          <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>{k.hint}</div>
        </button>
      ))}
    </div>
  );
}

// ─── Add / Edit Expense Form (inline slide-down panel) ───────────────────────
interface ExpenseFormProps {
  editing?: Expense | null;
  defaultCaseId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function ExpenseForm({ editing, defaultCaseId, onSuccess, onCancel }: ExpenseFormProps) {
  const qc = useQueryClient();
  const create = useCreateExpense();
  const update = useUpdateExpense();

  const cases = useListCases(
    { limit: 200 },
    { query: { queryKey: getListCasesQueryKey({ limit: 200 }), staleTime: 60000 } },
  );

  // Form state — pre-fill if editing
  const [caseId,       setCaseId]       = useState(editing?.caseId       ?? defaultCaseId ?? '');
  const [category,     setCategory]     = useState(editing?.category     ?? '');
  const [amount,       setAmount]       = useState(editing ? String(editing.amount) : '');
  const [date,         setDate]         = useState(editing?.date         ?? todayStr());
  const [description,  setDescription]  = useState(editing?.description  ?? '');
  const [vendor,       setVendor]       = useState(editing?.vendor       ?? '');
  const [receiptUrl,   setReceiptUrl]   = useState(editing?.receiptUrl   ?? '');
  const [isBillable,   setIsBillable]   = useState(editing?.isBillable   ?? false);
  const [isBilled,     setIsBilled]     = useState(editing?.isBilled     ?? false);
  const [serverError,  setServerError]  = useState('');

  // A case reached through a deep link may not be in the first page of the case
  // list — look it up so the select shows its number instead of a blank option.
  const caseInList = (cases.data?.data ?? []).some((c) => c.id === caseId);
  const selectedCase = useGetCase(caseId, {
    query: {
      queryKey: getGetCaseQueryKey(caseId),
      enabled: !!caseId && !caseInList,
      staleTime: 60000,
    },
  });

  const isPending = create.isPending || update.isPending;

  // Validation
  const amountNum = parseFloat(amount);
  const errors: Record<string, string> = {};
  if (!category)              errors.category    = 'Select a category';
  if (!amount || isNaN(amountNum) || amountNum <= 0) errors.amount = 'Enter a positive amount';
  if (!date)                  errors.date        = 'Select a date';
  if (!description.trim())    errors.description = 'Enter a description';
  if (receiptUrl && !/^https?:\/\/.+/.test(receiptUrl)) errors.receiptUrl = 'Enter a valid URL (https://…)';
  // Edge: cannot mark billed if not billable
  if (isBilled && !isBillable) errors.isBilled = 'Mark as billable first';
  const canSubmit = Object.keys(errors).length === 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setServerError('');

    const payload: ExpenseInput = {
      caseId:      caseId || undefined,
      category,
      amount:      amountNum,
      date,
      description: description.trim(),
      vendor:      vendor.trim()     || undefined,
      receiptUrl:  receiptUrl.trim() || undefined,
      isBillable,
      // Back-filling already-invoiced costs should not leave them "unbilled" forever.
      isBilled: isBillable ? isBilled : false,
    };

    if (editing) {
      const updatePayload: ExpenseUpdate = {
        ...payload,
        caseId: caseId || null,
        isBilled,
      };
      update.mutate(
        { id: editing.id, data: updatePayload },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
            qc.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
            onSuccess();
          },
          onError: (e: any) => setServerError(e?.message ?? 'Update failed'),
        },
      );
    } else {
      create.mutate(
        { data: payload },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
            qc.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
            onSuccess();
          },
          onError: (e: any) => setServerError(e?.message ?? 'Create failed'),
        },
      );
    }
  };

  return (
    <div
      className="card"
      style={{ padding: '22px 24px', marginBottom: 16, borderColor: 'hsl(var(--accent) / .35)',
        background: 'hsl(var(--accent) / .03)', animation: 'fade-in .25s ease both' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {editing ? 'Edit expense' : 'Add expense'}
        </div>
        <button className="button button-ghost" style={{ minHeight: 28, padding: '0 9px' }} onClick={onCancel}>
          <X size={14} />
        </button>
      </div>

      <div className="form-grid">
        {/* Category */}
        <div className="form-field">
          <label className="form-label">Category *</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Select category…</option>
            {EXPENSE_CATEGORIES.map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>
          {errors.category && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.category}</span>}
        </div>

        {/* Amount */}
        <div className="form-field">
          <label className="form-label">Amount (CAD) *</label>
          <input
            className="field" type="number" min="0.01" step="0.01" placeholder="0.00"
            value={amount} onChange={(e) => setAmount(e.target.value)}
          />
          {errors.amount && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.amount}</span>}
        </div>

        {/* Date */}
        <div className="form-field">
          <label className="form-label">Date *</label>
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {errors.date && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.date}</span>}
        </div>

        {/* Link to case (optional) */}
        <div className="form-field">
          <label className="form-label">
            Link to case &nbsp;<span className="muted">(optional — leave blank for firm-level)</span>
          </label>
          <select
            className="select" value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            disabled={cases.isLoading}
          >
            <option value="">Firm-level (no case)</option>
            {caseId && !caseInList && (
              <option value={caseId}>
                {selectedCase.data
                  ? `#${selectedCase.data.caseNumber} — ${selectedCase.data.clientName}`
                  : 'Selected case'}
              </option>
            )}
            {(cases.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                #{c.caseNumber} — {c.clientName}{c.offenceDescription ? ` · ${c.offenceDescription}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="form-field full">
          <label className="form-label">Description *</label>
          <input
            className="field" placeholder="e.g. Ontario court filing fee for Case #42"
            value={description} onChange={(e) => setDescription(e.target.value)}
          />
          {errors.description && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.description}</span>}
        </div>

        {/* Vendor */}
        <div className="form-field">
          <label className="form-label">Vendor / Payee <span className="muted">(optional)</span></label>
          <input className="field" placeholder="e.g. Canada Post, City Parking" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </div>

        {/* Receipt URL */}
        <div className="form-field">
          <label className="form-label">Receipt URL <span className="muted">(optional)</span></label>
          <input
            className="field" type="url" placeholder="https://drive.google.com/…"
            value={receiptUrl} onChange={(e) => setReceiptUrl(e.target.value)}
          />
          {errors.receiptUrl && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.receiptUrl}</span>}
        </div>

        {/* Billable + Billed checkboxes */}
        <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 20, paddingTop: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={isBillable} onChange={(e) => {
              setIsBillable(e.target.checked);
              if (!e.target.checked) setIsBilled(false); // auto-uncheck billed if billable removed
            }} />
            Billable to client
          </label>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 7, cursor: isBillable ? 'pointer' : 'not-allowed',
              fontSize: 13, opacity: isBillable ? 1 : 0.4,
            }}
          >
            <input
              type="checkbox" checked={isBilled} disabled={!isBillable}
              onChange={(e) => setIsBilled(e.target.checked)}
            />
            Already billed
          </label>
          {errors.isBilled && <span style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>{errors.isBilled}</span>}
        </div>
      </div>

      {serverError && (
        <div style={{ color: 'hsl(var(--destructive))', fontSize: 12, marginTop: 10, padding: '8px 12px', background: 'hsl(var(--destructive) / .07)', borderRadius: 6 }}>
          {serverError}
        </div>
      )}

      <div className="form-actions">
        <button className="button button-ghost" onClick={onCancel} disabled={isPending}>Cancel</button>
        <button
          className="button button-accent"
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
        >
          {isPending
            ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
            : <><Check size={13} /> {editing ? 'Save changes' : 'Add expense'}</>
          }
        </button>
      </div>
    </div>
  );
}

// ─── By-category breakdown bars ──────────────────────────────────────────────
function CategoryBreakdown({ dateFrom, dateTo, caseId }: { dateFrom?: string; dateTo?: string; caseId?: string }) {
  const summaryParams = useMemo(() => ({ dateFrom, dateTo, caseId }), [dateFrom, dateTo, caseId]);
  const summary = useGetExpenseSummary(summaryParams, {
    query: { queryKey: getGetExpenseSummaryQueryKey(summaryParams), staleTime: 20000 },
  });

  const cats = (summary.data?.byCategory ?? []) as { category: string; amount: number; count: number }[];
  const maxAmt = cats.length ? cats[0].amount : 1;

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div className="section-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="section-title">By category</div>
          <div className="section-kicker">Spending breakdown across all expense types</div>
        </div>
      </div>

      {summary.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[70, 55, 40, 30].map((w, i) => <Skeleton key={i} w={`${w}%`} h={28} />)}
        </div>
      ) : cats.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>No expenses yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cats.map((row) => (
            <div key={row.category}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: catColor(row.category), flexShrink: 0, display: 'inline-block' }} />
                  {row.category}
                  <span className="muted" style={{ fontSize: 10, marginLeft: 2 }}>({row.count})</span>
                </span>
                <span style={{ fontFamily: 'var(--app-font-mono)', fontSize: 12, fontWeight: 700 }}>{money(row.amount)}</span>
              </div>
              <div style={{ height: 6, background: 'hsl(var(--muted))', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4,
                  width: `${Math.round((row.amount / maxAmt) * 100)}%`,
                  background: catColor(row.category),
                  transition: 'width .6s cubic-bezier(.4,0,.2,1)',
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Monthly trend ────────────────────────────────────────────────────────────
function MonthlyTrend({ dateFrom, dateTo, caseId }: { dateFrom?: string; dateTo?: string; caseId?: string }) {
  const summaryParams = useMemo(() => ({ dateFrom, dateTo, caseId }), [dateFrom, dateTo, caseId]);
  const summary = useGetExpenseSummary(summaryParams, {
    query: { queryKey: getGetExpenseSummaryQueryKey(summaryParams), staleTime: 20000 },
  });

  const months = (summary.data?.byMonth ?? []) as { month: string; amount: number; count: number }[];
  const maxAmt = months.length ? Math.max(...months.map((m) => m.amount)) : 1;
  // Show the year as soon as the window crosses a calendar-year boundary.
  const crossYear =
    months.length > 0 && months[0].month.slice(0, 4) !== months[months.length - 1].month.slice(0, 4);

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div className="section-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="section-title">Monthly trend</div>
          <div className="section-kicker">Expenses per month</div>
        </div>
      </div>

      {summary.isLoading ? (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
          {[60, 80, 45, 95, 70, 55].map((h, i) => (
            <div key={i} className="skeleton" style={{ flex: 1, height: h }} />
          ))}
        </div>
      ) : months.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>No data yet.</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
          {months.map((m) => {
            const pct = Math.round((m.amount / maxAmt) * 100);
            return (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div
                  title={`${m.month}: ${money(m.amount)} (${m.count} items)`}
                  style={{
                    width: '100%', background: 'hsl(var(--accent))', borderRadius: '3px 3px 0 0',
                    height: `${pct}%`, minHeight: 4,
                    transition: 'height .5s cubic-bezier(.4,0,.2,1)',
                    cursor: 'default',
                  }}
                />
                <span style={{ fontSize: 9, fontFamily: 'var(--app-font-mono)', color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>
                  {crossYear ? `${m.month.slice(5)}/${m.month.slice(2, 4)}` : m.month.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Top vendors ─────────────────────────────────────────────────────────────
function TopVendors({ dateFrom, dateTo, caseId }: { dateFrom?: string; dateTo?: string; caseId?: string }) {
  const summaryParams = useMemo(() => ({ dateFrom, dateTo, caseId }), [dateFrom, dateTo, caseId]);
  const summary = useGetExpenseSummary(summaryParams, {
    query: { queryKey: getGetExpenseSummaryQueryKey(summaryParams), staleTime: 20000 },
  });

  const vendors = (summary.data?.topVendors ?? []) as { vendor: string; amount: number; count: number }[];

  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div className="section-title" style={{ marginBottom: 14 }}>Top vendors</div>
      {summary.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => <Skeleton key={i} h={18} />)}
        </div>
      ) : vendors.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>No vendor data yet.</p>
      ) : (
        <div>
          {vendors.map((v, i) => (
            <div key={v.vendor} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 0', borderBottom: i < vendors.length - 1 ? '1px solid hsl(var(--border))' : 'none',
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: 'hsl(var(--muted))', display: 'grid', placeItems: 'center',
                fontSize: 10, fontFamily: 'var(--app-font-mono)', fontWeight: 700,
                color: 'hsl(var(--muted-foreground))',
              }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{v.vendor}</span>
              <span className="muted" style={{ fontSize: 10 }}>{v.count}×</span>
              <span style={{ fontFamily: 'var(--app-font-mono)', fontSize: 12, fontWeight: 700 }}>{money(v.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Expenses Page ───────────────────────────────────────────────────────
export function ExpensesPage() {
  // The case scope lives in the URL (/expenses?caseId=…) so a case page can
  // deep-link straight into its own costs and the Back button undoes the scope.
  const [searchParams, setSearchParams] = useSearchParams();
  const caseFilter = searchParams.get('caseId') ?? '';
  const [showForm,      setShowForm]      = useState(false);
  const [editingExp,    setEditingExp]    = useState<Expense | null>(null);
  const [search,        setSearch]        = useState('');
  const [catFilter,     setCatFilter]     = useState('');
  const [firmOnly,      setFirmOnly]      = useState(false);
  const [billableFilter,setBillableFilter]= useState('');   // '', 'true', 'false'
  const [billedFilter,  setBilledFilter]  = useState('');
  const [dateFrom,      setDateFrom]      = useState('');
  const [dateTo,        setDateTo]        = useState('');
  const [page,          setPage]          = useState(1);
  const [showSummary,   setShowSummary]   = useState(true);
  const [actionError,   setActionError]   = useState('');
  const PAGE_SIZE = 25;

  const qc = useQueryClient();
  const del = useDeleteExpense();
  const update = useUpdateExpense();

  const scopeCase = useGetCase(caseFilter, {
    query: { queryKey: getGetCaseQueryKey(caseFilter), enabled: !!caseFilter, staleTime: 60000 },
  });

  const setCaseScope = useCallback((id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('caseId', id);
      else next.delete('caseId');
      return next;
    });
    // firmOnly and a case scope are mutually exclusive, so drop it on the way in.
    setFirmOnly(false);
    setPage(1);
  }, [setSearchParams]);

  // A different case is a different result set — start from the first page.
  useEffect(() => { setPage(1); }, [caseFilter]);

  // A backwards range would silently return nothing — surface it and skip the
  // date filter instead of pretending the user has no expenses.
  const dateRangeInvalid = !!(dateFrom && dateTo && dateTo < dateFrom);
  const filterFrom = dateRangeInvalid ? undefined : (dateFrom || undefined);
  const filterTo   = dateRangeInvalid ? undefined : (dateTo   || undefined);

  // Build query params — memoised so hooks don't thrash
  const listParams = useMemo(() => ({
    caseId:   caseFilter || undefined,
    search:   search.trim() || undefined,
    category: catFilter     || undefined,
    // The API rejects firmOnly + caseId together: they describe opposite scopes.
    firmOnly: caseFilter ? undefined : (firmOnly || undefined),
    billable: billableFilter === 'true' ? true : billableFilter === 'false' ? false : undefined,
    billed:   billedFilter   === 'true' ? true : billedFilter   === 'false' ? false : undefined,
    dateFrom: filterFrom,
    dateTo:   filterTo,
    page,
    limit: PAGE_SIZE,
  }), [caseFilter, search, catFilter, firmOnly, billableFilter, billedFilter, dateFrom, dateTo, dateRangeInvalid, page]);

  const expenses = useListExpenses(listParams, {
    query: { queryKey: getListExpensesQueryKey(listParams), staleTime: 15000 },
  });

  const rows      = expenses.data?.data      ?? [];
  const total     = expenses.data?.total     ?? 0;
  const totalAmt  = expenses.data?.totalAmount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetFilters = useCallback(() => {
    setSearch(''); setCatFilter(''); setFirmOnly(false);
    setBillableFilter(''); setBilledFilter('');
    setDateFrom(''); setDateTo(''); setPage(1);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('caseId');
      return next;
    });
  }, [setSearchParams]);

  // KPI cards act as one-click filters (same behaviour as the invoice register).
  const applyKpiFilter = (next: Partial<ExpenseKpiFilters>) => {
    if (next.billable !== undefined) setBillableFilter(next.billable);
    if (next.billed   !== undefined) setBilledFilter(next.billed);
    if (next.firmOnly !== undefined) setFirmOnly(next.firmOnly);
    setPage(1);
  };

  const hasFilters = !!(caseFilter || search || catFilter || firmOnly || billableFilter || billedFilter || dateFrom || dateTo);

  const handleDelete = (exp: Expense) => {
    if (!window.confirm(`Delete "${exp.description}" (${money(exp.amount)})?`)) return;
    setActionError('');
    del.mutate(
      { id: exp.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
        },
        onError: (e: any) => setActionError(e?.message ?? 'The expense could not be deleted.'),
      },
    );
  };

  // One-click billed/unbilled toggle — unbilling matters when an invoice is voided.
  const toggleBilled = (exp: Expense) => {
    setActionError('');
    update.mutate(
      { id: exp.id, data: { isBilled: !exp.isBilled } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
        },
        onError: (e: any) => setActionError(e?.message ?? 'The expense could not be updated.'),
      },
    );
  };

  const handleEdit = (exp: Expense) => {
    setEditingExp(exp);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingExp(null);
  };

  // CSV export — direct browser download
  const handleExport = () => {
    const sp = new URLSearchParams();
    if (listParams.caseId)   sp.set('caseId',   listParams.caseId);
    if (listParams.search)   sp.set('search',   listParams.search);
    if (listParams.category) sp.set('category', listParams.category);
    if (listParams.firmOnly) sp.set('firmOnly', 'true');
    if (listParams.billable !== undefined) sp.set('billable', String(listParams.billable));
    if (listParams.billed   !== undefined) sp.set('billed',   String(listParams.billed));
    if (listParams.dateFrom) sp.set('dateFrom', listParams.dateFrom);
    if (listParams.dateTo)   sp.set('dateTo',   listParams.dateTo);
    const qs = sp.toString();
    window.open(`/api/expenses/export.csv${qs ? `?${qs}` : ''}`, '_blank');
  };

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <div className="eyebrow">Finance / Costs</div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-copy">Track filing fees, travel, and all practice costs — per-case or firm-wide.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="button button-ghost" onClick={handleExport} title="Export filtered results as CSV">
            <ArrowDownToLine size={14} /> Export CSV
          </button>
          <button
            className="button button-ghost"
            onClick={() => setShowSummary((v) => !v)}
          >
            <BarChart3 size={14} /> {showSummary ? 'Hide' : 'Show'} summary
          </button>
          <button
            className="button button-accent"
            onClick={() => { setEditingExp(null); setShowForm((v) => !v); }}
          >
            {showForm && !editingExp ? <X size={14} /> : <Plus size={14} />}
            {showForm && !editingExp ? 'Cancel' : 'Add expense'}
          </button>
        </div>
      </div>

      {/* ── Case scope banner ────────────────────────────────────────── */}
      {caseFilter && (
        <div
          className="card"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', marginBottom: 16,
            borderColor: 'hsl(var(--chart-4) / .35)', background: 'hsl(var(--chart-4) / .06)',
          }}
        >
          <Briefcase size={16} style={{ color: 'hsl(var(--chart-4))', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {scopeCase.data
                ? `Case #${scopeCase.data.caseNumber} — ${scopeCase.data.clientName}`
                : scopeCase.isError ? 'Case not found' : 'Scoped to case'}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Only costs linked to this case are shown — firm-level expenses are excluded.
            </div>
          </div>
          <Link href={`/cases/${caseFilter}`} className="button button-ghost" style={{ minHeight: 30, padding: '0 10px' }}>
            Open case <ExternalLink size={12} />
          </Link>
          <button className="button button-ghost" style={{ minHeight: 30, padding: '0 10px' }} onClick={() => setCaseScope('')}>
            <X size={13} /> Clear scope
          </button>
        </div>
      )}

      {/* ── KPI strip ────────────────────────────────────────────────── */}
      <ExpenseKpis
        dateFrom={filterFrom}
        dateTo={filterTo}
        caseId={caseFilter || undefined}
        filters={{ billable: billableFilter, billed: billedFilter, firmOnly }}
        onSelect={applyKpiFilter}
      />

      {/* ── Add/Edit form ─────────────────────────────────────────────── */}
      {showForm && (
        <ExpenseForm
          editing={editingExp}
          defaultCaseId={caseFilter || undefined}
          onSuccess={handleFormSuccess}
          onCancel={() => { setShowForm(false); setEditingExp(null); }}
        />
      )}

      {/* ── Summary charts ────────────────────────────────────────────── */}
      {showSummary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,.8fr) minmax(0,.8fr)', gap: 14, marginBottom: 22 }}>
          <CategoryBreakdown dateFrom={filterFrom} dateTo={filterTo} caseId={caseFilter || undefined} />
          <MonthlyTrend      dateFrom={filterFrom} dateTo={filterTo} caseId={caseFilter || undefined} />
          <TopVendors        dateFrom={filterFrom} dateTo={filterTo} caseId={caseFilter || undefined} />
        </div>
      )}

      {/* ── Guards that would otherwise fail silently ─────────────────── */}
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
      {actionError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', marginBottom: 14,
          borderRadius: 6, fontSize: 12, color: 'hsl(var(--destructive))',
          background: 'hsl(var(--destructive) / .07)', border: '1px solid hsl(var(--destructive) / .25)',
        }}>
          <AlertCircle size={14} />
          <span style={{ flex: 1 }}>{actionError}</span>
          <button
            className="button button-ghost"
            style={{ minHeight: 24, padding: '0 6px', color: 'inherit' }}
            onClick={() => setActionError('')}
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Filters + table ───────────────────────────────────────────── */}
      <section className="card table-card">
        {/* Toolbar */}
        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
          {/* Search */}
          <div className="input-wrap" style={{ flex: '1 1 200px', minWidth: 180 }}>
            <Search />
            <input
              className="field" placeholder="Search description or vendor…"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          {/* Category filter */}
          <select
            className="select" style={{ width: 160 }}
            value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }}
          >
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Billable */}
          <select
            className="select" style={{ width: 130 }}
            value={billableFilter} onChange={(e) => { setBillableFilter(e.target.value); setPage(1); }}
          >
            <option value="">Billable: all</option>
            <option value="true">Billable only</option>
            <option value="false">Non-billable</option>
          </select>

          {/* Billed */}
          <select
            className="select" style={{ width: 120 }}
            value={billedFilter} onChange={(e) => { setBilledFilter(e.target.value); setPage(1); }}
          >
            <option value="">Billed: all</option>
            <option value="true">Billed</option>
            <option value="false">Unbilled</option>
          </select>

          {/* Firm-only toggle — cannot combine with a case scope */}
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, whiteSpace: 'nowrap',
              cursor: caseFilter ? 'not-allowed' : 'pointer', opacity: caseFilter ? .45 : 1,
            }}
            title={caseFilter ? 'Clear the case scope to see firm-level costs' : 'Show only costs that are not linked to a case'}
          >
            <input
              type="checkbox" checked={firmOnly} disabled={!!caseFilter}
              onChange={(e) => { setFirmOnly(e.target.checked); setPage(1); }}
            />
            Firm-level only
          </label>

          {/* Date range */}
          <input
            className="field" type="date" style={{ width: 138 }}
            title="From date" value={dateFrom} max={dateTo || undefined}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          />
          <input
            className="field" type="date" style={{ width: 138 }}
            title="To date" value={dateTo} min={dateFrom || undefined}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />

          {/* Clear filters */}
          {hasFilters && (
            <button className="button button-ghost" style={{ minHeight: 34, padding: '0 10px' }} onClick={resetFilters}>
              <X size={13} /> Clear
            </button>
          )}
        </div>

        {/* Filtered total bar */}
        {(total > 0 || hasFilters) && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 14px', background: 'hsl(var(--muted) / .4)',
            borderBottom: '1px solid hsl(var(--border))', fontSize: 11,
          }}>
            <span className="muted">
              {total} expense{total !== 1 ? 's' : ''} {hasFilters ? 'matching filters' : 'in total'}
            </span>
            <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 700, fontSize: 12 }}>
              Total: {money(totalAmt)}
            </span>
          </div>
        )}

        {/* Table */}
        {expenses.isLoading ? (
          <div style={{ padding: 16 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid hsl(var(--border))' }}>
                <Skeleton w={80} h={11} />
                <Skeleton w="30%" h={11} />
                <Skeleton w="20%" h={11} />
                <Skeleton w={60} h={11} />
              </div>
            ))}
          </div>
        ) : expenses.isError ? (
          <ErrBanner msg="Could not load expenses." onRetry={() => expenses.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No matching expenses' : 'No expenses yet'}
            copy={hasFilters ? 'Try adjusting your filters.' : 'Add your first expense to get started.'}
            action={!hasFilters && (
              <button className="button button-accent" onClick={() => setShowForm(true)}>
                <Plus size={13} /> Add expense
              </button>
            )}
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Scope</th>
                  <th>Vendor</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Billable</th>
                  <th>Receipt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((exp) => (
                  <tr key={exp.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(exp.date)}</td>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {exp.description}
                    </td>
                    <td><CatPill cat={exp.category} /></td>
                    <td><ScopeBadge caseId={exp.caseId} caseNumber={exp.caseNumber} /></td>
                    <td className="muted" style={{ fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {exp.vendor ?? '—'}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {money(exp.amount)}
                    </td>
                    <td>
                      {exp.isBillable ? (
                        <button
                          type="button"
                          onClick={() => toggleBilled(exp)}
                          disabled={update.isPending}
                          title={exp.isBilled
                            ? 'Billed to the client — click to undo (e.g. after voiding the invoice)'
                            : 'Mark this cost as billed to the client'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            minHeight: 24, padding: '0 8px', borderRadius: 5, fontSize: 10,
                            fontFamily: 'var(--app-font-mono)', fontWeight: 700, letterSpacing: '.02em',
                            cursor: update.isPending ? 'wait' : 'pointer',
                            border: `1px solid ${exp.isBilled ? 'hsl(var(--chart-2) / .45)' : 'hsl(var(--accent) / .45)'}`,
                            background: exp.isBilled ? 'hsl(var(--chart-2) / .1)' : 'transparent',
                            color: exp.isBilled ? 'hsl(var(--chart-2))' : 'hsl(var(--accent))',
                          }}
                        >
                          {exp.isBilled ? <RotateCcw size={11} /> : <Check size={11} />}
                          {exp.isBilled ? 'Billed' : 'Mark billed'}
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td>
                      {exp.receiptUrl ? (
                        <a href={exp.receiptUrl} target="_blank" rel="noreferrer" className="button button-ghost" style={{ minHeight: 26, padding: '0 8px', fontSize: 11 }}>
                          <ExternalLink size={12} /> View
                        </a>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button
                          className="button button-ghost"
                          style={{ minHeight: 26, padding: '0 7px' }}
                          title="Edit"
                          onClick={() => handleEdit(exp)}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="button button-danger"
                          style={{ minHeight: 26, padding: '0 7px' }}
                          title="Delete"
                          onClick={() => handleDelete(exp)}
                          disabled={del.isPending}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderTop: '1px solid hsl(var(--border))',
          }}>
            <span className="muted" style={{ fontSize: 11 }}>
              Page {page} of {totalPages} · {total} results
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="button button-ghost" style={{ minHeight: 28, padding: '0 10px' }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button className="button button-ghost" style={{ minHeight: 28, padding: '0 10px' }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

// ─── Compact expense list for case detail pages ───────────────────────────────
export function CaseExpensesPanel({ caseId }: { caseId: string }) {
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState('');
  const qc = useQueryClient();
  const del = useDeleteExpense();
  const update = useUpdateExpense();

  const params = useMemo(() => ({ caseId, limit: 50 }), [caseId]);
  const expenses = useListExpenses(params, {
    query: { queryKey: getListExpensesQueryKey(params), staleTime: 15000 },
  });

  const rows     = expenses.data?.data      ?? [];
  const totalAmt = expenses.data?.totalAmount ?? 0;

  // Case totals feed both this panel and the register / KPI strip.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
  };

  const toggleBilled = (exp: Expense) => {
    setErr('');
    update.mutate(
      { id: exp.id, data: { isBilled: !exp.isBilled } },
      {
        onSuccess: refresh,
        onError: (e: any) => setErr(e?.message ?? 'Could not update this expense.'),
      },
    );
  };

  return (
    <div>
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <div className="section-title">Expenses</div>
          {rows.length > 0 && (
            <div className="section-kicker">{rows.length} item{rows.length !== 1 ? 's' : ''} · {money(totalAmt)} total</div>
          )}
        </div>
        <button
          className="button button-ghost"
          style={{ minHeight: 28, padding: '0 10px' }}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? <X size={13} /> : <Plus size={13} />}
          {showForm ? 'Cancel' : 'Add'}
        </button>
      </div>

      {showForm && (
        <ExpenseForm
          defaultCaseId={caseId}
          onSuccess={() => {
            setShowForm(false);
            refresh();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {err && (
        <p style={{ color: 'hsl(var(--destructive))', fontSize: 11, margin: '0 0 8px' }}>{err}</p>
      )}

      {expenses.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2].map((i) => <Skeleton key={i} h={36} />)}
        </div>
      ) : rows.length === 0 && !showForm ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>No expenses logged for this case.</p>
      ) : (
        <div>
          {rows.map((exp) => (
            <div
              key={exp.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '1px solid hsl(var(--border))',
                fontSize: 12,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: catColor(exp.category), flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exp.description}</span>
              <CatPill cat={exp.category} />
              {exp.isBillable && (
                <button
                  type="button"
                  disabled={update.isPending}
                  onClick={() => toggleBilled(exp)}
                  title={exp.isBilled
                    ? 'Billed to the client — click to undo (e.g. after voiding the invoice)'
                    : 'Mark this cost as billed to the client'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    border: `1px solid ${exp.isBilled ? 'hsl(var(--chart-2) / .45)' : 'hsl(var(--accent) / .45)'}`,
                    background: 'transparent', borderRadius: 4, padding: '1px 6px',
                    cursor: 'pointer', fontSize: 10, fontFamily: 'var(--app-font-mono)', fontWeight: 700,
                    color: exp.isBilled ? 'hsl(var(--chart-2))' : 'hsl(var(--accent))',
                  }}
                >
                  {exp.isBilled ? '✓ Billed' : 'Unbilled'}
                </button>
              )}
              <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 700, whiteSpace: 'nowrap' }}>{money(exp.amount)}</span>
              <button
                className="button button-danger"
                style={{ minHeight: 24, padding: '0 6px' }}
                onClick={() => {
                  if (!window.confirm(`Delete "${exp.description}"?`)) return;
                  setErr('');
                  del.mutate({ id: exp.id }, {
                    onSuccess: refresh,
                    onError: (e: any) => setErr(e?.message ?? 'Could not delete this expense.'),
                  });
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {rows.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, fontSize: 12 }}>
              <Link href={`/expenses?caseId=${caseId}`} style={{ color: 'hsl(var(--accent))', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                View all in Expenses <ExternalLink size={11} />
              </Link>
              <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 700 }}>{money(totalAmt)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
