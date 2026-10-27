import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, Clock, Copy, Download,
  FilePlus2, FileText, FolderOpen, Loader2, Mail, Pencil, Plus,
  Receipt, Search, Send, Trash2, Undo2, X,
} from 'lucide-react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { InvoicePDF } from '@/components/InvoicePDF';
import { InvoiceForm, type InvoiceFormPayload } from '@/components/InvoiceForm';
import {
  getGetCaseQueryKey,
  getGetInvoiceQueryKey,
  getGetInvoiceSummaryQueryKey,
  getGetReportCollectionsQueryKey,
  getListCasesQueryKey,
  getListInvoicesQueryKey,
  useCreateInvoice,
  useDeleteInvoice,
  useGetInvoice,
  useGetInvoiceSummary,
  useListInvoices,
  useSendInvoiceEmail,
  useUpdateInvoice,
  useUpdateInvoiceStatus,
} from '@workspace/api-client-react';
import type {
  Invoice,
  InvoiceItem,
  InvoiceSort,
  InvoiceStatus,
} from '@workspace/api-client-react';

// ─── helpers ────────────────────────────────────────────────────────────────

const money = (v = 0) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v);

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Date-only values arrive as UTC-midnight ISO strings; format them on their own
// calendar day so they do not shift a day in timezones west of UTC.
const dateLabel = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', ...(utcMidnight ? { timeZone: 'UTC' } : {}) }).format(d);
};

const today = () => localDay(new Date());
const dueIn30 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return localDay(d);
};

// Debounce keystrokes so the register queries the API once per pause instead of
// once per character.
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ApiError messages look like "HTTP 409 Conflict: <reason>" — surface only the reason.
function apiMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : '';
  const idx = raw.indexOf(': ');
  const text = (idx >= 0 ? raw.slice(idx + 2) : raw).trim();
  return text || fallback;
}

// ─── shared sub-components ──────────────────────────────────────────────────

function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 54,
            margin: '0 16px',
            borderBottom: '1px solid hsl(var(--border))',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div className="skeleton" style={{ width: 34, height: 24 }} />
          <div className="skeleton" style={{ width: `${42 + (i * 11) % 32}%`, height: 11 }} />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="card error-panel">
      <AlertCircle size={18} />
      <span>We couldn't load this view.</span>
      <button className="button button-ghost" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FolderOpen size={20} />
      </div>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

// ─── Invoice status pill ─────────────────────────────────────────────────────

const STATUS_META: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft:  { label: 'Draft',  color: 'hsl(var(--muted-foreground))', bg: 'hsl(var(--muted))' },
  sent:   { label: 'Sent',   color: 'hsl(var(--chart-4))',          bg: 'hsl(var(--chart-4) / .12)' },
  paid:   { label: 'Paid',   color: 'hsl(var(--chart-2))',          bg: 'hsl(var(--chart-2) / .12)' },
  void:   { label: 'Void',   color: 'hsl(var(--destructive))',      bg: 'hsl(var(--destructive) / .09)' },
};

function InvoicePill({ status }: { status: InvoiceStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 24,
        borderRadius: 6,
        padding: '0 9px',
        font: `700 10px var(--app-font-mono)`,
        letterSpacing: '.02em',
        color: meta.color,
        background: meta.bg,
      }}
    >
      {meta.label}
    </span>
  );
}

// ─── 1. Invoices list page ────────────────────────────────────────────────────

export function InvoicesPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const PAGE_SIZE = 20;

  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sort, setSort] = useState<InvoiceSort>('newest');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState('');

  // Clearing the box applies instantly instead of waiting out the debounce.
  const debouncedSearch = useDebounced(searchInput.trim(), 300);
  const search = searchInput.trim() === '' ? '' : debouncedSearch;

  // Every filter change starts a fresh page list.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, overdueOnly, sort]);

  const params = useMemo(
    () => ({
      status: statusFilter || undefined,
      search: search || undefined,
      overdue: overdueOnly || undefined,
      sort,
      page,
      limit: PAGE_SIZE,
    }),
    [statusFilter, search, overdueOnly, sort, page],
  );

  const invoices = useListInvoices(params, {
    query: { queryKey: getListInvoicesQueryKey(params), staleTime: 15000 },
  });

  const rows = invoices.data?.data ?? [];

  const del = useDeleteInvoice();
  const handleDelete = (inv: Invoice) => {
    if (!window.confirm(`Delete invoice #${inv.invoiceNumber} for ${inv.clientName}? This cannot be undone.`)) return;
    setActionError('');
    del.mutate(
      { id: inv.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceSummaryQueryKey() });
        },
        onError: (err) => setActionError(apiMessage(err, 'The invoice could not be deleted.')),
      },
    );
  };

  const clearFilters = () => {
    setSearchInput('');
    setStatusFilter('');
    setOverdueOnly(false);
  };

  const total = invoices.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!search || !!statusFilter || overdueOnly;

  return (
    <>
      {/* Page header */}
      <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 25 }}>
        <div>
          <div className="eyebrow">Billing / Register</div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-copy">
            Create, send, and track invoices across all your clients and cases.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="button button-accent"
            onClick={() => setLocation('/invoices/new')}
          >
            <FilePlus2 size={15} /> New invoice
          </button>
        </div>
      </div>

      {/* Summary KPI strip */}
      <InvoiceKpis
        activeStatus={statusFilter}
        activeOverdue={overdueOnly}
        onSelect={(next) => {
          setStatusFilter(next.status);
          setOverdueOnly(next.overdue);
        }}
      />

      {/* Table card */}
      <section className="card table-card" style={{ marginTop: 22 }}>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <div className="input-wrap" style={{ flex: 1, minWidth: 220 }}>
            <Search />
            <input
              className="field"
              placeholder="Search client, invoice #, or line item…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <button
            className={`button ${overdueOnly ? 'button-danger' : 'button-ghost'}`}
            style={{ minHeight: 34 }}
            onClick={() => {
              setOverdueOnly((v) => !v);
              setStatusFilter('');
            }}
            title="Only sent invoices past their due date"
          >
            <AlertCircle size={13} /> Overdue
          </button>
          <select
            className="select"
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as InvoiceStatus | '');
              setOverdueOnly(false);
            }}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
          <select
            className="select"
            style={{ width: 150 }}
            value={sort}
            onChange={(e) => setSort(e.target.value as InvoiceSort)}
            title="Sort order"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount_desc">Highest amount</option>
            <option value="amount_asc">Lowest amount</option>
            <option value="due_asc">Due date</option>
          </select>
        </div>

        {actionError && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '0 16px 12px',
              padding: '10px 12px',
              borderRadius: 8,
              background: 'hsl(var(--destructive) / .08)',
              border: '1px solid hsl(var(--destructive) / .25)',
              color: 'hsl(var(--destructive))',
              fontSize: 12,
            }}
          >
            <AlertCircle size={14} />
            <span style={{ flex: 1 }}>{actionError}</span>
            <button className="button button-ghost" style={{ minHeight: 24, padding: '0 8px' }} onClick={() => setActionError('')}>
              <X size={12} />
            </button>
          </div>
        )}

        {invoices.isLoading ? (
          <LoadingState rows={7} />
        ) : invoices.isError ? (
          <ErrorState onRetry={() => invoices.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No invoices match these filters' : 'No invoices yet'}
            copy={
              hasFilters
                ? 'Try a different search term or status, or clear the filters.'
                : 'Create your first invoice to start tracking what you are owed.'
            }
            action={
              hasFilters ? (
                <button className="button button-ghost" onClick={clearFilters}>
                  <X size={14} /> Clear filters
                </button>
              ) : (
                <button className="button button-accent" onClick={() => setLocation('/invoices/new')}>
                  <Plus size={14} /> New invoice
                </button>
              )
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Client</th>
                  <th>Case</th>
                  <th>Issue date</th>
                  <th>Due date</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`/invoices/${inv.id}`} className="data-link mono">
                        INV-{String(inv.invoiceNumber).padStart(4, '0')}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/invoices/${inv.id}`} className="data-link">
                        {inv.clientName}
                      </Link>
                    </td>
                    <td className="muted mono">
                      {inv.caseNumber ? `#${inv.caseNumber}` : '—'}
                    </td>
                    <td className="mono">{dateLabel(inv.issueDate)}</td>
                    <td
                      className="mono"
                      style={{
                        color:
                          inv.status !== 'paid' && inv.dueDate < today()
                            ? 'hsl(var(--destructive))'
                            : undefined,
                      }}
                    >
                      {dateLabel(inv.dueDate)}
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {money(inv.total)}
                    </td>
                    <td>
                      <InvoicePill status={inv.status} />
                      {(inv.paidAt || inv.sentAt) && (
                        <div
                          className="muted"
                          style={{ fontSize: 9.5, marginTop: 4, fontFamily: 'var(--app-font-mono)' }}
                        >
                          {inv.paidAt
                            ? `Paid ${dateLabel(inv.paidAt)}`
                            : `Sent ${dateLabel(inv.sentAt)}`}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="button button-ghost"
                          style={{ minHeight: 28, padding: '0 10px' }}
                        >
                          Open
                        </Link>
                        {(inv.status === 'draft' || inv.status === 'sent') && (
                          <Link
                            href={`/invoices/${inv.id}/edit`}
                            className="button button-ghost"
                            style={{ minHeight: 28, padding: '0 8px' }}
                            title="Edit invoice"
                          >
                            <Pencil size={13} />
                          </Link>
                        )}
                        {inv.status !== 'paid' && (
                          <button
                            className="button button-danger"
                            style={{ minHeight: 28, padding: '0 8px' }}
                            onClick={() => handleDelete(inv)}
                            disabled={del.isPending}
                            title="Delete invoice"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              borderTop: '1px solid hsl(var(--border))',
            }}
          >
            <span className="muted" style={{ fontSize: 11 }}>
              Page {page} of {totalPages} · {total} {hasFilters ? 'matching' : 'total'} invoices
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="button button-ghost"
                style={{ minHeight: 28, padding: '0 10px' }}
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                className="button button-ghost"
                style={{ minHeight: 28, padding: '0 10px' }}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

// ─── KPI strip ───────────────────────────────────────────────────────────────

function InvoiceKpis({
  activeStatus,
  activeOverdue,
  onSelect,
}: {
  activeStatus: InvoiceStatus | '';
  activeOverdue: boolean;
  onSelect: (next: { status: InvoiceStatus | ''; overdue: boolean }) => void;
}) {
  // Server-side aggregates — never truncated by pagination, drafts and voids are
  // reported separately instead of being counted as revenue.
  const summary = useGetInvoiceSummary({
    query: { queryKey: getGetInvoiceSummaryQueryKey(), staleTime: 30000 },
  });
  const s = summary.data;

  const cards = [
    {
      key: 'billed',
      label: 'Billed',
      value: money(s?.billedAmount ?? 0),
      hint: `${s?.billedCount ?? 0} sent or paid`,
      color: 'hsl(var(--chart-4))',
      bg: 'hsl(var(--chart-4) / .08)',
      active: !activeOverdue && activeStatus === '',
      onClick: () => onSelect({ status: '', overdue: false }),
      title: 'Show every invoice',
    },
    {
      key: 'collected',
      label: 'Collected',
      value: money(s?.collectedAmount ?? 0),
      hint: `${s?.collectedCount ?? 0} paid`,
      color: 'hsl(var(--chart-2))',
      bg: 'hsl(var(--chart-2) / .08)',
      active: activeStatus === 'paid' && !activeOverdue,
      onClick: () => onSelect({ status: 'paid', overdue: false }),
      title: 'Show paid invoices',
    },
    {
      key: 'outstanding',
      label: 'Outstanding',
      value: money(s?.outstandingAmount ?? 0),
      hint: `${s?.outstandingCount ?? 0} awaiting payment`,
      color: 'hsl(var(--accent))',
      bg: 'hsl(var(--accent) / .08)',
      active: activeStatus === 'sent' && !activeOverdue,
      onClick: () => onSelect({ status: 'sent', overdue: false }),
      title: 'Show sent invoices',
    },
    {
      key: 'overdue',
      label: 'Overdue',
      value: money(s?.overdueAmount ?? 0),
      hint: `${s?.overdueCount ?? 0} past due`,
      color: (s?.overdueCount ?? 0) > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--chart-2))',
      bg: (s?.overdueCount ?? 0) > 0 ? 'hsl(var(--destructive) / .07)' : 'hsl(var(--chart-2) / .07)',
      active: activeOverdue,
      onClick: () => onSelect({ status: '', overdue: true }),
      title: 'Show overdue invoices',
    },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
        {cards.map((kpi) => (
          <button
            key={kpi.key}
            type="button"
            className="card"
            onClick={kpi.onClick}
            title={kpi.title}
            style={{
              padding: '16px 18px',
              textAlign: 'left',
              cursor: 'pointer',
              background: kpi.bg,
              borderColor: kpi.active ? kpi.color : `${kpi.color}28`,
              boxShadow: kpi.active ? `inset 0 0 0 1px ${kpi.color}` : undefined,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: 'var(--app-font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '.06em',
                color: kpi.color,
                fontWeight: 700,
              }}
            >
              {kpi.label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                marginTop: 10,
                letterSpacing: '-.04em',
                fontFamily: 'var(--app-font-mono)',
                color: kpi.color,
              }}
            >
              {summary.isLoading ? '…' : kpi.value}
            </div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
              {summary.isLoading ? 'Loading' : kpi.hint}
            </div>
          </button>
        ))}
      </div>

      {s && s.totalCount > 0 && (
        <div
          className="muted"
          style={{ fontSize: 11, marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
        >
          {s.draftCount > 0 ? (
            <button
              type="button"
              onClick={() => onSelect({ status: 'draft', overdue: false })}
              title="Show drafts only"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'inherit',
                cursor: 'pointer',
                textDecoration: 'underline dotted',
                textUnderlineOffset: 2,
              }}
            >
              <strong style={{ color: 'hsl(var(--foreground))' }}>{s.draftCount}</strong> draft
              {s.draftCount === 1 ? '' : 's'} worth {money(s.draftAmount)} not yet billed
            </button>
          ) : (
            <span>Nothing left in draft</span>
          )}
          {s.voidCount > 0 && <span>· {s.voidCount} voided</span>}
          <span>· {s.totalCount} invoice{s.totalCount === 1 ? '' : 's'} in total</span>
        </div>
      )}
    </div>
  );
}

// ─── 2. Invoice create / edit pages ──────────────────────────────────────────

export function NewInvoicePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const create = useCreateInvoice();

  const submit = (payload: InvoiceFormPayload) => {
    create.mutate(
      {
        data: {
          clientId: payload.clientId,
          caseId: payload.caseId ?? undefined,
          issueDate: payload.issueDate,
          dueDate: payload.dueDate,
          taxRate: payload.taxRate,
          notes: payload.notes ?? undefined,
          items: payload.items,
        },
      },
      {
        onSuccess: (inv) => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceSummaryQueryKey() });
          setLocation(`/invoices/${inv.id}`);
        },
      },
    );
  };

  return (
    <>
      <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 25 }}>
        <div>
          <div className="eyebrow">Billing / New</div>
          <h1 className="page-title">New invoice</h1>
          <p className="page-copy">
            Pick the client, add line items, and set the dates — totals calculate automatically.
          </p>
        </div>
        <Link href="/invoices" className="button button-ghost">
          <ArrowLeft size={14} /> Cancel
        </Link>
      </div>

      <InvoiceForm
        mode="create"
        saving={create.isPending}
        error={
          create.isError
            ? apiMessage(create.error, 'Invoice could not be created. Check the fields and try again.')
            : null
        }
        onSubmit={submit}
      />
    </>
  );
}

export function EditInvoicePage() {
  const { id = '' } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const inv = useGetInvoice(id, {
    query: { queryKey: getGetInvoiceQueryKey(id), staleTime: 10000 },
  });
  const update = useUpdateInvoice();

  if (inv.isLoading) {
    return (
      <>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Edit invoice</div>
        <LoadingState rows={6} />
      </>
    );
  }
  if (inv.isError || !inv.data) {
    return (
      <>
        <div className="eyebrow" style={{ marginBottom: 16 }}>Edit invoice</div>
        <ErrorState onRetry={() => inv.refetch()} />
      </>
    );
  }

  const invoice = inv.data;
  const locked = invoice.status === 'paid' || invoice.status === 'void';
  const number = `INV-${String(invoice.invoiceNumber).padStart(4, '0')}`;

  const submit = (payload: InvoiceFormPayload) => {
    update.mutate(
      {
        id,
        data: {
          clientId: payload.clientId,
          caseId: payload.caseId,
          issueDate: payload.issueDate,
          dueDate: payload.dueDate,
          taxRate: payload.taxRate,
          notes: payload.notes,
          items: payload.items,
        },
      },
      {
        onSuccess: (next) => {
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(next.id) });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceSummaryQueryKey() });
          setLocation(`/invoices/${next.id}`);
        },
      },
    );
  };

  return (
    <>
      <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 25 }}>
        <div>
          <div className="eyebrow">Billing / Edit</div>
          <h1 className="page-title">Edit {number}</h1>
          <p className="page-copy">
            {invoice.clientName} · totals are recalculated server-side when you save.
          </p>
        </div>
        <Link href={`/invoices/${id}`} className="button button-ghost">
          <ArrowLeft size={14} /> Back to invoice
        </Link>
      </div>

      {locked ? (
        <div className="card" style={{ padding: 22, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertCircle size={18} style={{ color: 'hsl(var(--destructive))', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              This invoice is {invoice.status === 'paid' ? 'paid' : 'voided'} and can no longer be edited.
            </div>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
              Settled invoices are immutable accounting records.{' '}
              {invoice.status === 'paid'
                ? 'Mark it as unpaid first if you really need to correct something.'
                : 'Create a fresh invoice instead.'}
            </p>
            <Link href={`/invoices/${id}`} className="button button-ghost" style={{ marginTop: 14 }}>
              Back to invoice
            </Link>
          </div>
        </div>
      ) : (
        <InvoiceForm
          key={invoice.id}
          mode="edit"
          initial={{
            clientId: invoice.clientId,
            caseId: invoice.caseId ?? null,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            taxRate: invoice.taxRate,
            notes: invoice.notes ?? '',
            items: invoice.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          }}
          saving={update.isPending}
          error={update.isError ? apiMessage(update.error, 'Changes could not be saved.') : null}
          onSubmit={submit}
        />
      )}
    </>
  );
}

// ─── 3. Invoice detail / print view ─────────────────────────────────────────

export function InvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const inv = useGetInvoice(id, {
    query: { queryKey: getGetInvoiceQueryKey(id), staleTime: 10000 },
  });
  const updateStatus = useUpdateInvoiceStatus();
  const del = useDeleteInvoice();
  const send = useSendInvoiceEmail();

  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string; url?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Settling a case-linked invoice raises a receipt, so the money details are
  // captured right here instead of being typed into the ledger separately.
  const [settling, setSettling] = useState(false);
  const [settleForm, setSettleForm] = useState({ date: localDay(new Date()), method: 'E-transfer', receivedBy: '' });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceSummaryQueryKey() });
  };

  // Settling or un-settling an invoice moves money on the case ledger, so the
  // case page, the register and the day book all have to refetch.
  const refreshLedger = () => {
    const caseId = inv.data?.caseId;
    if (caseId) queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetReportCollectionsQueryKey() });
  };

  const setStatus = (status: InvoiceStatus) => {
    setNotice(null);
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          refresh();
          refreshLedger();
        },
        onError: (err) =>
          setNotice({ kind: 'error', text: apiMessage(err, 'The status could not be changed.') }),
      },
    );
  };

  // Mark paid with the money details the ledger needs to raise a receipt.
  const settleInvoice = () => {
    if (!settleForm.receivedBy.trim()) return;
    setNotice(null);
    updateStatus.mutate(
      {
        id,
        data: {
          status: 'paid',
          date: settleForm.date,
          method: settleForm.method,
          receivedBy: settleForm.receivedBy.trim(),
        },
      },
      {
        onSuccess: () => {
          setSettling(false);
          refresh();
          refreshLedger();
          setNotice({ kind: 'ok', text: 'Invoice marked paid and a receipt was recorded on the case ledger.' });
        },
        onError: (err) =>
          setNotice({ kind: 'error', text: apiMessage(err, 'The invoice could not be settled.') }),
      },
    );
  };

  const handleSend = () => {
    setNotice(null);
    setCopied(false);
    send.mutate(
      { id },
      {
        onSuccess: (result) => {
          refresh();
          if (result.emailed) {
            setNotice({ kind: 'ok', text: `Invoice emailed to ${result.to}.` });
            return;
          }
          const why =
            result.reason === 'no_client_email'
              ? 'This client has no email address on file.'
              : result.reason === 'not_configured'
                ? 'Email is not configured on this server.'
                : 'The email provider rejected the message.';
          setNotice({
            kind: 'warn',
            text: `${why} Copy the portal link below and send it yourself.`,
            url: result.portalUrl ?? undefined,
          });
        },
        onError: (err) =>
          setNotice({ kind: 'error', text: apiMessage(err, 'The invoice could not be sent.') }),
      },
    );
  };

  const copyPortal = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice({ kind: 'warn', text: 'Could not copy automatically — select the link and copy it manually.', url });
    }
  };

  const handleDelete = () => {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return;
    del.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceSummaryQueryKey() });
          setLocation('/invoices');
        },
        onError: (err) =>
          setNotice({ kind: 'error', text: apiMessage(err, 'The invoice could not be deleted.') }),
      },
    );
  };

  if (inv.isLoading) return <><div className="eyebrow" style={{ marginBottom: 16 }}>Invoice</div><LoadingState rows={6} /></>;
  if (inv.isError || !inv.data) return (
    <>
      <div className="eyebrow" style={{ marginBottom: 16 }}>Invoice</div>
      <ErrorState onRetry={() => inv.refetch()} />
    </>
  );

  const invoice = inv.data;
  const isOverdue = invoice.status === 'sent' && invoice.dueDate < today();

  return (
    <>
      {/* Actions header — hidden on print */}
      <div className="detail-hero no-print">
        <div>
          <Link
            href="/invoices"
            className="muted"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', fontSize: 11 }}
          >
            <ArrowLeft size={13} /> Invoice register
          </Link>
          <div className="eyebrow" style={{ marginTop: 20 }}>Invoice</div>
          <h1 className="page-title">
            INV-{String(invoice.invoiceNumber).padStart(4, '0')}
          </h1>
          <div className="detail-id">{invoice.clientName}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <InvoicePill status={invoice.status} />

          {(invoice.status === 'draft' || invoice.status === 'sent') && (
            <button
              className="button button-primary"
              disabled={send.isPending}
              onClick={handleSend}
            >
              {send.isPending ? <Loader2 className="animate-spin" size={14} /> : <Mail size={14} />}
              {invoice.sentAt ? 'Resend to client' : 'Send to client'}
            </button>
          )}
          {invoice.status === 'draft' && (
            <button
              className="button button-ghost"
              disabled={updateStatus.isPending}
              onClick={() => setStatus('sent')}
              title="Mark as sent without emailing it"
            >
              <Send size={14} /> Mark sent
            </button>
          )}
          {invoice.status === 'sent' && (
            <button
              className="button button-accent"
              disabled={updateStatus.isPending}
              onClick={() => (invoice.caseId ? setSettling((open) => !open) : setStatus('paid'))}
              title={invoice.caseId ? 'Record the receipt and mark this invoice paid' : 'Mark this invoice paid'}
            >
              {updateStatus.isPending ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
              Mark as paid
            </button>
          )}
          {invoice.status === 'paid' && (
            <button
              className="button button-ghost"
              disabled={updateStatus.isPending}
              onClick={() => setStatus('sent')}
              title="Use this when a payment bounces — the paid date is cleared"
            >
              <Undo2 size={14} /> Mark as unpaid
            </button>
          )}
          {(invoice.status === 'draft' || invoice.status === 'sent') && (
            <>
              <Link href={`/invoices/${invoice.id}/edit`} className="button button-ghost">
                <Pencil size={14} /> Edit
              </Link>
              <button
                className="button button-ghost"
                disabled={updateStatus.isPending}
                onClick={() => setStatus('void')}
                title="Voiding is permanent — the invoice stays on record but can't be edited or paid"
              >
                <X size={14} /> Void
              </button>
            </>
          )}
          <PDFDownloadLink
            document={<InvoicePDF invoice={invoice} />}
            fileName={`INV-${String(invoice.invoiceNumber).padStart(4, '0')}-${invoice.clientName.replace(/\s+/g, '-')}.pdf`}
            style={{ textDecoration: 'none' }}
          >
            {({ loading }) => (
              <button className="button button-ghost" disabled={loading}>
                {loading
                  ? <><Loader2 size={14} className="animate-spin" /> Preparing PDF&hellip;</>
                  : <><Download size={14} /> Download PDF</>}
              </button>
            )}
          </PDFDownloadLink>
          {invoice.status !== 'paid' && (
            <button
              className="button button-danger"
              onClick={handleDelete}
              disabled={del.isPending}
              title="Delete invoice"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {settling && invoice.status === 'sent' && invoice.caseId && (
        <section
          className="card no-print"
          data-testid="panel-settle-invoice"
          style={{ padding: 18, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="section-title" style={{ fontSize: 14 }}>Record the receipt</div>
            <div className="section-kicker" style={{ marginTop: 4 }}>
              Settling adds {money(invoice.total)} to case #{invoice.caseNumber ?? ''} with a numbered receipt, and it shows in the day book the same day.
            </div>
          </div>
          <div className="form-field" style={{ width: 145 }}>
            <label className="form-label">Date</label>
            <input className="field" type="date" data-testid="input-settle-date" value={settleForm.date} onChange={(e) => setSettleForm({ ...settleForm, date: e.target.value })} />
          </div>
          <div className="form-field" style={{ width: 150 }}>
            <label className="form-label">Method</label>
            <select className="select" data-testid="select-settle-method" value={settleForm.method} onChange={(e) => setSettleForm({ ...settleForm, method: e.target.value })}>
              <option>E-transfer</option><option>Cash</option><option>Card</option><option>Cheque</option><option>Money order</option><option>Wire</option><option>Other</option>
            </select>
          </div>
          <div className="form-field" style={{ width: 195 }}>
            <label className="form-label">Received by <span className="muted">(required)</span></label>
            <input className="field" data-testid="input-settle-received-by" autoFocus value={settleForm.receivedBy} onChange={(e) => setSettleForm({ ...settleForm, receivedBy: e.target.value })} placeholder="Who handled the money?" />
          </div>
          <button className="button button-accent" data-testid="button-confirm-settle" disabled={updateStatus.isPending || !settleForm.receivedBy.trim()} onClick={settleInvoice}>
            {updateStatus.isPending ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Record receipt &amp; mark paid
          </button>
          <button className="button button-ghost" onClick={() => setSettling(false)}>Cancel</button>
        </section>
      )}

      {notice && (
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            marginBottom: 16,
            borderRadius: 8,
            fontSize: 12.5,
            lineHeight: 1.55,
            background:
              notice.kind === 'ok'
                ? 'hsl(var(--chart-2) / .08)'
                : notice.kind === 'warn'
                  ? 'hsl(var(--chart-4) / .10)'
                  : 'hsl(var(--destructive) / .08)',
            border: `1px solid ${
              notice.kind === 'ok'
                ? 'hsl(var(--chart-2) / .3)'
                : notice.kind === 'warn'
                  ? 'hsl(var(--chart-4) / .35)'
                  : 'hsl(var(--destructive) / .25)'
            }`,
            color:
              notice.kind === 'ok'
                ? 'hsl(var(--chart-2))'
                : notice.kind === 'warn'
                  ? 'hsl(var(--chart-4))'
                  : 'hsl(var(--destructive))',
          }}
        >
          {notice.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{notice.text}</div>
            {notice.url && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <code style={{ fontFamily: 'var(--app-font-mono)', fontSize: 11, wordBreak: 'break-all' }}>
                  {notice.url}
                </code>
                <button
                  className="button button-ghost"
                  style={{ minHeight: 26, padding: '0 8px' }}
                  onClick={() => notice.url && copyPortal(notice.url)}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            )}
          </div>
          <button
            className="button button-ghost"
            style={{ minHeight: 24, padding: '0 6px' }}
            onClick={() => setNotice(null)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Overdue banner */}
      {isOverdue && (
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            marginBottom: 20,
            borderRadius: 8,
            background: 'hsl(var(--destructive) / .08)',
            border: '1px solid hsl(var(--destructive) / .25)',
            color: 'hsl(var(--destructive))',
            fontSize: 13,
          }}
        >
          <AlertCircle size={16} />
          <strong>Overdue</strong> — this invoice was due on {dateLabel(invoice.dueDate)}
        </div>
      )}

      {/* ── PRINTABLE INVOICE DOCUMENT ─────────────────────────────────── */}
      <div className="invoice-doc card">
        {/* Letterhead */}
        <div className="inv-header">
          <div>
            <div className="inv-brand">
              <div className="brand-mark" style={{ transform: 'none' }}>TT</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-.04em' }}>Docketline</div>
                <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>Ontario traffic law</div>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.05em', fontFamily: 'var(--app-font-mono)' }}>
              INVOICE
            </div>
            <div style={{ fontFamily: 'var(--app-font-mono)', fontSize: 14, marginTop: 4, color: 'hsl(var(--accent))' }}>
              INV-{String(invoice.invoiceNumber).padStart(4, '0')}
            </div>
            <div style={{ marginTop: 8 }}>
              <InvoicePill status={invoice.status as InvoiceStatus} />
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div className="inv-meta">
          <div className="inv-meta-block">
            <div className="inv-meta-label">Bill to</div>
            <div className="inv-meta-value">{invoice.clientName}</div>
            {invoice.caseNumber && (
              <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                Case #{invoice.caseNumber}
              </div>
            )}
          </div>
          <div className="inv-meta-block">
            <div className="inv-meta-label">Issue date</div>
            <div className="inv-meta-value">{dateLabel(invoice.issueDate)}</div>
          </div>
          <div className="inv-meta-block">
            <div className="inv-meta-label">Due date</div>
            <div
              className="inv-meta-value"
              style={{ color: isOverdue ? 'hsl(var(--destructive))' : undefined }}
            >
              {dateLabel(invoice.dueDate)}
            </div>
          </div>
        </div>

        {(invoice.sentAt || invoice.paidAt) && (
          <div
            style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              marginTop: 16,
              fontSize: 11,
              color: 'hsl(var(--muted-foreground))',
            }}
          >
            {invoice.sentAt && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Clock size={12} /> Issued to client {dateLabel(invoice.sentAt)}
              </span>
            )}
            {invoice.paidAt && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  color: 'hsl(var(--chart-2))',
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={12} /> Paid in full {dateLabel(invoice.paidAt)}
              </span>
            )}
            {invoice.paidAt && invoice.settledReceipt && (
              <span
                data-testid="text-settled-receipt"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--app-font-mono)' }}
              >
                <Receipt size={12} /> {invoice.settledReceipt}
              </span>
            )}
            {invoice.paidAt && !invoice.settledReceipt && (
              <span>
                No case receipt — this invoice is not linked to a case ledger
              </span>
            )}
          </div>
        )}

        {/* Line items table */}
        <div className="table-scroll" style={{ marginTop: 24 }}>
          <table className="data-table inv-table">
            <thead>
              <tr>
                <th style={{ width: '50%' }}>Description</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Unit price</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item: InvoiceItem) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 500 }}>{item.description}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--app-font-mono)' }}>{item.quantity}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--app-font-mono)' }}>{money(item.unitPrice)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--app-font-mono)', fontWeight: 700 }}>{money(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="inv-totals">
          <div className="inv-totals-block">
            <div className="inv-total-row">
              <span>Subtotal</span>
              <span>{money(invoice.subtotal)}</span>
            </div>
            {invoice.taxRate > 0 && (
              <div className="inv-total-row">
                <span>HST / Tax ({invoice.taxRate}%)</span>
                <span>{money(invoice.taxAmount)}</span>
              </div>
            )}
            <div className="inv-total-row inv-total-grand">
              <span>Total due</span>
              <span>{money(invoice.total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div className="inv-notes">
            <div className="inv-meta-label" style={{ marginBottom: 7 }}>Notes</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'hsl(var(--muted-foreground))' }}>
              {invoice.notes}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="inv-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={13} style={{ opacity: 0.5 }} />
            <span>INV-{String(invoice.invoiceNumber).padStart(4, '0')}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>Generated by Docketline</span>
          </div>
          <span style={{ fontFamily: 'var(--app-font-mono)' }}>{money(invoice.total)}</span>
        </div>
      </div>
    </>
  );
}
