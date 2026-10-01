import { useState, useMemo } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Check, Download, FilePlus2, Loader2, Plus,
  Receipt, Search, Trash2, X, Send, FileText,
  AlertCircle, FolderOpen,
} from 'lucide-react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { InvoicePDF } from '@/components/InvoicePDF';
import {
  useListInvoices,
  useGetInvoice,
  useCreateInvoice,
  useUpdateInvoiceStatus,
  useDeleteInvoice,
  useListClients,
  useListCases,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getListClientsQueryKey,
  getListCasesQueryKey,
} from '@workspace/api-client-react';
import type { Invoice, InvoiceItem, InvoiceStatus } from '@workspace/api-client-react';

// ─── helpers ────────────────────────────────────────────────────────────────

const money = (v = 0) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v);

const dateLabel = (v?: string | null) =>
  v
    ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(v))
    : '—';

const today = () => new Date().toISOString().slice(0, 10);
const dueIn30 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const params = useMemo(
    () => ({
      status: statusFilter || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [statusFilter, page],
  );

  const invoices = useListInvoices(params, {
    query: { queryKey: getListInvoicesQueryKey(params), staleTime: 15000 },
  });

  const rows = useMemo(() => {
    const data = invoices.data?.data ?? [];
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(
      (inv) =>
        inv.clientName.toLowerCase().includes(q) ||
        String(inv.invoiceNumber).includes(q),
    );
  }, [invoices.data, search]);

  const queryClient = useQueryClient();
  const del = useDeleteInvoice();
  const handleDelete = (id: string, num: number) => {
    if (!window.confirm(`Delete invoice #${num}? This cannot be undone.`)) return;
    del.mutate(
      { id },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() }),
      },
    );
  };

  const total = invoices.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
      <InvoiceKpis />

      {/* Table card */}
      <section className="card table-card" style={{ marginTop: 22 }}>
        <div className="toolbar">
          <div className="input-wrap" style={{ flex: 1 }}>
            <Search />
            <input
              className="field"
              placeholder="Search by client or invoice #"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="select"
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as InvoiceStatus | ''); setPage(1); }}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
        </div>

        {invoices.isLoading ? (
          <LoadingState rows={7} />
        ) : invoices.isError ? (
          <ErrorState onRetry={() => invoices.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No invoices found"
            copy="Create your first invoice to get started."
            action={
              <button
                className="button button-accent"
                onClick={() => setLocation('/invoices/new')}
              >
                <Plus size={14} /> New invoice
              </button>
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
                      <InvoicePill status={inv.status as InvoiceStatus} />
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
                        <button
                          className="button button-danger"
                          style={{ minHeight: 28, padding: '0 8px' }}
                          onClick={() => handleDelete(inv.id, inv.invoiceNumber)}
                          disabled={del.isPending}
                        >
                          <Trash2 size={13} />
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
              Page {page} of {totalPages} · {total} invoices
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

function InvoiceKpis() {
  const all = useListInvoices(
    { limit: 200 },
    { query: { queryKey: getListInvoicesQueryKey({ limit: 200 }), staleTime: 30000 } },
  );
  const data = all.data?.data ?? [];
  const totalBilled   = data.reduce((s, i) => s + i.total, 0);
  const totalPaid     = data.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const totalOutstand = data.filter((i) => i.status === 'sent').reduce((s, i) => s + i.total, 0);
  const overdue       = data.filter((i) => i.status === 'sent' && i.dueDate < today()).length;

  const kpis = [
    { label: 'Total Billed',    value: money(totalBilled),   color: 'hsl(var(--chart-4))',    bg: 'hsl(var(--chart-4) / .08)' },
    { label: 'Collected',       value: money(totalPaid),     color: 'hsl(var(--chart-2))',    bg: 'hsl(var(--chart-2) / .08)' },
    { label: 'Outstanding',     value: money(totalOutstand), color: 'hsl(var(--accent))',     bg: 'hsl(var(--accent) / .08)'  },
    { label: 'Overdue invoices',value: String(overdue),      color: overdue > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--chart-2))', bg: overdue > 0 ? 'hsl(var(--destructive) / .07)' : 'hsl(var(--chart-2) / .07)' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="card"
          style={{ padding: '16px 18px', background: kpi.bg, borderColor: `${kpi.color}28` }}
        >
          <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', color: kpi.color, fontWeight: 700 }}>
            {kpi.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10, letterSpacing: '-.04em', fontFamily: 'var(--app-font-mono)', color: kpi.color }}>
            {all.isLoading ? '…' : kpi.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 2. New invoice form ──────────────────────────────────────────────────────

interface LineItem {
  _key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function newLine(): LineItem {
  return { _key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '' };
}

export function NewInvoicePage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const create = useCreateInvoice();

  const clients = useListClients(
    { limit: 100 },
    { query: { queryKey: getListClientsQueryKey({ limit: 100 }), staleTime: 60000 } },
  );
  const [selectedClient, setSelectedClient] = useState('');

  const cases = useListCases(
    { clientId: selectedClient || undefined, limit: 100 },
    {
      query: {
        queryKey: getListCasesQueryKey({ clientId: selectedClient || undefined, limit: 100 }),
        staleTime: 30000,
        enabled: !!selectedClient,
      },
    },
  );

  const [selectedCase, setSelectedCase] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(dueIn30());
  const [taxRate, setTaxRate] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([newLine()]);

  const updateLine = (key: string, field: keyof Omit<LineItem, '_key'>, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l._key === key ? { ...l, [field]: value } : l)),
    );
  };
  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l._key !== key));
  };

  // live totals
  const computedItems = lines.map((l) => {
    const qty = parseFloat(l.quantity) || 0;
    const up  = parseFloat(l.unitPrice) || 0;
    return { qty, up, amount: Math.round(qty * up * 100) / 100 };
  });
  const subtotal  = computedItems.reduce((s, i) => s + i.amount, 0);
  const taxAmt    = Math.round(subtotal * ((parseFloat(taxRate) || 0) / 100) * 100) / 100;
  const total     = subtotal + taxAmt;

  const canSubmit =
    !!selectedClient &&
    !!issueDate &&
    !!dueDate &&
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && parseFloat(l.unitPrice) > 0);

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        data: {
          clientId: selectedClient,
          caseId: selectedCase || undefined,
          issueDate,
          dueDate,
          taxRate: parseFloat(taxRate) || 0,
          notes: notes.trim() || undefined,
          items: lines.map((l) => ({
            description: l.description.trim(),
            quantity: parseFloat(l.quantity) || 1,
            unitPrice: parseFloat(l.unitPrice) || 0,
          })),
        },
      },
      {
        onSuccess: (inv) => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
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
          <p className="page-copy">Fill in the client, line items, and dates — totals calculate automatically.</p>
        </div>
        <Link href="/invoices" className="button button-ghost">
          <ArrowLeft size={14} /> Cancel
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(280px,.6fr)', gap: 18 }}>
        {/* Left — main form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Client + case */}
          <section className="card detail-card">
            <div className="section-title" style={{ marginBottom: 16 }}>Bill to</div>
            <div className="form-grid">
              <div className="form-field">
                <label className="form-label">Client *</label>
                <select
                  className="select"
                  value={selectedClient}
                  onChange={(e) => { setSelectedClient(e.target.value); setSelectedCase(''); }}
                  disabled={clients.isLoading}
                >
                  <option value="">Select a client</option>
                  {(clients.data?.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.fullName}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Link to case <span className="muted">(optional)</span></label>
                <select
                  className="select"
                  value={selectedCase}
                  onChange={(e) => setSelectedCase(e.target.value)}
                  disabled={!selectedClient || cases.isLoading}
                >
                  <option value="">No case</option>
                  {(cases.data?.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.caseNumber} — {c.offenceDescription || c.statuteCode || 'Traffic matter'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Line items */}
          <section className="card detail-card">
            <div className="section-head" style={{ marginBottom: 14 }}>
              <div className="section-title">Line items</div>
              <button
                className="button button-ghost"
                style={{ minHeight: 30, padding: '0 10px' }}
                onClick={() => setLines((prev) => [...prev, newLine()])}
              >
                <Plus size={13} /> Add line
              </button>
            </div>

            {/* Header row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 80px 100px 80px 28px',
                gap: 8,
                padding: '0 0 8px',
                borderBottom: '1px solid hsl(var(--border))',
                marginBottom: 10,
              }}
            >
              {['Description', 'Qty', 'Unit price', 'Amount', ''].map((h) => (
                <div key={h} className="form-label" style={{ padding: 0 }}>{h}</div>
              ))}
            </div>

            {lines.map((line, idx) => (
              <div
                key={line._key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 100px 80px 28px',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <input
                  className="field"
                  style={{ minHeight: 34 }}
                  placeholder={`e.g. Legal representation — matter ${idx + 1}`}
                  value={line.description}
                  onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                />
                <input
                  className="field"
                  style={{ minHeight: 34 }}
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="1"
                  value={line.quantity}
                  onChange={(e) => updateLine(line._key, 'quantity', e.target.value)}
                />
                <input
                  className="field"
                  style={{ minHeight: 34 }}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line._key, 'unitPrice', e.target.value)}
                />
                <div
                  style={{
                    fontFamily: 'var(--app-font-mono)',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'right',
                    paddingRight: 4,
                  }}
                >
                  {money(computedItems[idx]?.amount ?? 0)}
                </div>
                <button
                  className="button button-danger"
                  style={{ minHeight: 28, padding: '0 6px', opacity: lines.length === 1 ? 0.3 : 1 }}
                  disabled={lines.length === 1}
                  onClick={() => removeLine(line._key)}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </section>

          {/* Notes */}
          <section className="card detail-card">
            <div className="section-title" style={{ marginBottom: 12 }}>Notes</div>
            <textarea
              className="textarea"
              style={{ minHeight: 80 }}
              placeholder="Payment terms, bank details, thank-you note, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </section>
        </div>

        {/* Right — dates + totals + submit */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <section className="card detail-card">
            <div className="section-title" style={{ marginBottom: 14 }}>Dates</div>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label className="form-label">Issue date *</label>
              <input
                className="field"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Due date *</label>
              <input
                className="field"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </section>

          {/* Totals card */}
          <section className="card detail-card">
            <div className="section-title" style={{ marginBottom: 14 }}>Summary</div>
            <div className="form-field" style={{ marginBottom: 14 }}>
              <label className="form-label">Tax / HST rate (%)</label>
              <input
                className="field"
                type="number"
                min="0"
                max="100"
                step="0.1"
                placeholder="0"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0', borderTop: '1px solid hsl(var(--border))' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span className="muted">Subtotal</span>
                <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 600 }}>{money(subtotal)}</span>
              </div>
              {taxAmt > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span className="muted">Tax ({parseFloat(taxRate) || 0}%)</span>
                  <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 600 }}>{money(taxAmt)}</span>
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  paddingTop: 10,
                  borderTop: '1px solid hsl(var(--border))',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 14 }}>Total</span>
                <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 700, fontSize: 18, color: 'hsl(var(--accent))' }}>
                  {money(total)}
                </span>
              </div>
            </div>

            {create.isError && (
              <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginBottom: 10 }}>
                Invoice could not be created. Check the fields and try again.
              </div>
            )}

            <button
              className="button button-accent"
              style={{ width: '100%', marginTop: 6 }}
              disabled={create.isPending || !canSubmit}
              onClick={submit}
            >
              {create.isPending ? <Loader2 className="animate-spin" size={15} /> : <FilePlus2 size={15} />}
              Create invoice
            </button>
          </section>
        </div>
      </div>
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

  const setStatus = (status: InvoiceStatus) => {
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        },
      },
    );
  };

  const handleDelete = () => {
    if (!window.confirm('Delete this invoice?')) return;
    del.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          setLocation('/invoices');
        },
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
          <InvoicePill status={invoice.status as InvoiceStatus} />

          {invoice.status === 'draft' && (
            <button
              className="button button-primary"
              disabled={updateStatus.isPending}
              onClick={() => setStatus('sent')}
            >
              {updateStatus.isPending ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
              Mark as sent
            </button>
          )}
          {invoice.status === 'sent' && (
            <button
              className="button button-accent"
              disabled={updateStatus.isPending}
              onClick={() => setStatus('paid')}
            >
              {updateStatus.isPending ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
              Mark as paid
            </button>
          )}
          {(invoice.status === 'draft' || invoice.status === 'sent') && (
            <button
              className="button button-ghost"
              disabled={updateStatus.isPending}
              onClick={() => setStatus('void')}
            >
              <X size={14} /> Void
            </button>
          )}
          <PDFDownloadLink
            document={<InvoicePDF invoice={invoice} />}
            fileName={`INV-${String(invoice.invoiceNumber).padStart(4, '0')}-${invoice.clientName.replace(/\s+/g, '-')}.pdf`}
            style={{ textDecoration: 'none' }}
          >
            {({ loading }) => (
              <button className="button button-primary" disabled={loading}>
                {loading
                  ? <><Loader2 size={14} className="animate-spin" /> Preparing PDF&hellip;</>
                  : <><Download size={14} /> Download PDF</>}
              </button>
            )}
          </PDFDownloadLink>
          <button
            className="button button-danger"
            onClick={handleDelete}
            disabled={del.isPending}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

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
