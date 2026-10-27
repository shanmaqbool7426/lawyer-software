import { useState } from 'react';
import { AlertCircle, FilePlus2, Loader2, Plus, Save, X } from 'lucide-react';
import {
  getListCasesQueryKey,
  getListClientsQueryKey,
  useListCases,
  useListClients,
} from '@workspace/api-client-react';

// ─── helpers ────────────────────────────────────────────────────────────────

const money = (v = 0) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v);

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => localDay(new Date());
const dueIn30 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return localDay(d);
};

// ─── types ──────────────────────────────────────────────────────────────────

export interface InvoiceFormPayload {
  clientId: string;
  caseId: string | null;
  issueDate: string;
  dueDate: string;
  taxRate: number;
  notes: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
}

export interface InvoiceFormInitial {
  clientId?: string;
  caseId?: string | null;
  issueDate?: string;
  dueDate?: string;
  taxRate?: number;
  notes?: string | null;
  items?: Array<{ description: string; quantity: number; unitPrice: number }>;
}

interface LineItem {
  _key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function newLine(seed?: { description: string; quantity: number; unitPrice: number }): LineItem {
  return {
    _key: crypto.randomUUID(),
    description: seed?.description ?? '',
    quantity: String(seed?.quantity ?? 1),
    unitPrice: seed ? String(seed.unitPrice) : '',
  };
}

const errorText = { color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 5 } as const;

// ─── form ───────────────────────────────────────────────────────────────────

export function InvoiceForm({
  mode,
  initial,
  saving,
  error,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial?: InvoiceFormInitial;
  saving: boolean;
  error?: string | null;
  onSubmit: (payload: InvoiceFormPayload) => void;
}) {
  const [selectedClient, setSelectedClient] = useState(initial?.clientId ?? '');
  const [selectedCase, setSelectedCase] = useState(initial?.caseId ?? '');
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? today());
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? dueIn30());
  const [taxRate, setTaxRate] = useState(String(initial?.taxRate ?? 0));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [lines, setLines] = useState<LineItem[]>(
    initial?.items?.length ? initial.items.map((item) => newLine(item)) : [newLine()],
  );
  const [touched, setTouched] = useState(false);

  const clients = useListClients(
    { limit: 100 },
    { query: { queryKey: getListClientsQueryKey({ limit: 100 }), staleTime: 60000 } },
  );

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

  const updateLine = (key: string, field: keyof Omit<LineItem, '_key'>, value: string) => {
    setLines((prev) => prev.map((l) => (l._key === key ? { ...l, [field]: value } : l)));
  };
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l._key !== key));

  // Live totals — the server recomputes and stores the same numbers on save.
  const computedItems = lines.map((l) => {
    const qty = parseFloat(l.quantity) || 0;
    const up = parseFloat(l.unitPrice) || 0;
    return { qty, up, amount: Math.round(qty * up * 100) / 100 };
  });
  const subtotal = Math.round(computedItems.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const taxNum = parseFloat(taxRate);
  const safeTax = Number.isFinite(taxNum) ? taxNum : 0;
  const taxAmt = Math.round(subtotal * (safeTax / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmt) * 100) / 100;

  // ─── validation ───────────────────────────────────────────────────────────
  const dateError =
    issueDate && dueDate && dueDate < issueDate ? 'Due date cannot be before the issue date.' : '';
  const taxError =
    taxRate.trim() === '' || !Number.isFinite(taxNum) || taxNum < 0 || taxNum > 100
      ? 'Enter a tax rate between 0 and 100.'
      : '';
  const lineErrors = lines.map((l) => {
    if (!l.description.trim()) return 'Description is required.';
    if (!(parseFloat(l.unitPrice) > 0)) return 'Unit price must be greater than zero.';
    if (!(parseFloat(l.quantity) > 0)) return 'Quantity must be greater than zero.';
    return '';
  });
  const clientError = selectedClient ? '' : 'Choose the client this invoice is for.';

  const canSubmit =
    !clientError &&
    !!issueDate &&
    !!dueDate &&
    !dateError &&
    !taxError &&
    lines.length > 0 &&
    lineErrors.every((e) => !e);

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    onSubmit({
      clientId: selectedClient,
      caseId: selectedCase || null,
      issueDate,
      dueDate,
      taxRate: safeTax,
      notes: notes.trim() || null,
      items: lines.map((l) => ({
        description: l.description.trim(),
        quantity: parseFloat(l.quantity),
        unitPrice: parseFloat(l.unitPrice),
      })),
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(280px,.6fr)', gap: 18 }}>
      {/* Left — main form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <section className="card detail-card">
          <div className="section-title" style={{ marginBottom: 16 }}>Bill to</div>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Client *</label>
              <select
                className="select"
                value={selectedClient}
                onChange={(e) => {
                  setSelectedClient(e.target.value);
                  setSelectedCase('');
                }}
                disabled={clients.isLoading}
              >
                <option value="">{clients.isLoading ? 'Loading clients…' : 'Select a client'}</option>
                {(clients.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
              {touched && clientError && <div style={errorText}>{clientError}</div>}
            </div>
            <div className="form-field">
              <label className="form-label">
                Link to case <span className="muted">(optional)</span>
              </label>
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

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 100px 90px 28px',
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
            <div key={line._key} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 80px 100px 90px 28px',
                  gap: 8,
                  alignItems: 'center',
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
                  title="Remove line"
                >
                  <X size={13} />
                </button>
              </div>
              {touched && lineErrors[idx] && <div style={errorText}>{lineErrors[idx]}</div>}
            </div>
          ))}
        </section>

        <section className="card detail-card">
          <div className="section-title" style={{ marginBottom: 12 }}>Notes</div>
          <textarea
            className="textarea"
            style={{ minHeight: 80 }}
            placeholder="Payment terms, bank details, thank-you note, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Notes print on the invoice and appear in the PDF.
          </div>
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
              onChange={(e) => {
                setIssueDate(e.target.value);
                // Keep the pair sane instead of failing validation on save.
                if (dueDate && e.target.value && dueDate < e.target.value) {
                  const next = new Date(`${e.target.value}T00:00:00`);
                  if (!Number.isNaN(next.getTime())) {
                    next.setDate(next.getDate() + 30);
                    setDueDate(localDay(next));
                  }
                }
              }}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Due date *</label>
            <input
              className="field"
              type="date"
              min={issueDate || undefined}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {dateError && <div style={errorText}>{dateError}</div>}
          </div>
        </section>

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
            {taxError && <div style={errorText}>{taxError}</div>}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '14px 0',
              borderTop: '1px solid hsl(var(--border))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">Subtotal</span>
              <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 600 }}>{money(subtotal)}</span>
            </div>
            {taxAmt > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span className="muted">Tax ({safeTax}%)</span>
                <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 600 }}>{money(taxAmt)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid hsl(var(--border))' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Total</span>
              <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 700, fontSize: 18, color: 'hsl(var(--accent))' }}>
                {money(total)}
              </span>
            </div>
          </div>

          {error && (
            <div
              style={{
                display: 'flex',
                gap: 7,
                alignItems: 'flex-start',
                color: 'hsl(var(--destructive))',
                fontSize: 11,
                marginBottom: 10,
                lineHeight: 1.5,
              }}
            >
              <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            className="button button-accent"
            style={{ width: '100%', marginTop: 6 }}
            disabled={saving || !canSubmit}
            onClick={submit}
          >
            {saving ? (
              <Loader2 className="animate-spin" size={15} />
            ) : mode === 'edit' ? (
              <Save size={15} />
            ) : (
              <FilePlus2 size={15} />
            )}
            {mode === 'edit' ? 'Save changes' : 'Create invoice'}
          </button>
          {!canSubmit && touched && (
            <div className="muted" style={{ fontSize: 10.5, marginTop: 8, textAlign: 'center' }}>
              Fix the highlighted fields to continue.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
