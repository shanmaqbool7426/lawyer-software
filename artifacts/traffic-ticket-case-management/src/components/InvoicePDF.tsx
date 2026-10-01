import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import type { Invoice, InvoiceItem } from '@workspace/api-client-react';

// ─── Register fonts (built-in Helvetica family — always available) ──────────
// No external font fetch needed; Helvetica is embedded in every PDF renderer.

// ─── Colour tokens (mirror the app palette) ─────────────────────────────────
const C = {
  accent:   '#c95743',
  dark:     '#1c2b3c',
  muted:    '#647080',
  border:   '#dde1e4',
  bg:       '#f9f7f3',
  white:    '#ffffff',
  green:    '#2e8f7b',
  amber:    '#e8a83e',
  red:      '#b8403f',
};

// ─── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: C.dark,
    backgroundColor: C.white,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 52,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
    paddingBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: C.border,
    borderBottomStyle: 'solid',
  },
  brandMark: {
    width: 36,
    height: 36,
    borderWidth: 2,
    borderColor: C.accent,
    borderStyle: 'solid',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  brandMarkText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    color: C.accent,
    letterSpacing: 1,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  brandName: { fontFamily: 'Helvetica-Bold', fontSize: 17, color: C.dark, letterSpacing: -0.4 },
  brandSub: { fontSize: 8, color: C.muted, marginTop: 2, letterSpacing: 1.2, textTransform: 'uppercase' },
  invoiceTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 26,
    color: C.dark,
    letterSpacing: -1,
    textAlign: 'right',
  },
  invoiceNumber: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 13,
    color: C.accent,
    textAlign: 'right',
    marginTop: 3,
    letterSpacing: 0.3,
  },

  // ── Status badge ──
  statusBadge: {
    marginTop: 8,
    alignSelf: 'flex-end',
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Meta row (Bill to / dates) ──
  metaRow: {
    flexDirection: 'row',
    gap: 0,
    marginBottom: 24,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    borderBottomStyle: 'solid',
  },
  metaBlock: { flex: 1 },
  metaLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  metaValue: { fontFamily: 'Helvetica-Bold', fontSize: 12, color: C.dark },
  metaSub: { fontSize: 9, color: C.muted, marginTop: 3 },

  // ── Line items table ──
  table: { marginBottom: 0 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
    borderTopStyle: 'solid',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    borderBottomStyle: 'solid',
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  tableHeaderText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7.5,
    color: C.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    borderBottomStyle: 'solid',
  },
  tableRowAlt: { backgroundColor: '#fafaf8' },
  colDesc:    { flex: 1 },
  colQty:     { width: 44, textAlign: 'right' },
  colPrice:   { width: 76, textAlign: 'right' },
  colAmount:  { width: 80, textAlign: 'right' },
  cellText:   { fontSize: 10, color: C.dark },
  cellMono:   { fontFamily: 'Helvetica', fontSize: 10, color: C.dark },
  cellBold:   { fontFamily: 'Helvetica-Bold', fontSize: 10, color: C.dark },

  // ── Totals ──
  totalsWrapper: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 14,
    marginBottom: 22,
  },
  totalsBlock: { width: 240 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  totalLabel: { fontSize: 10, color: C.muted },
  totalValue: { fontFamily: 'Helvetica', fontSize: 10, color: C.dark },
  totalDivider: {
    borderTopWidth: 2,
    borderTopColor: C.accent,
    borderTopStyle: 'solid',
    marginVertical: 6,
  },
  grandLabel: { fontFamily: 'Helvetica-Bold', fontSize: 13, color: C.dark },
  grandValue: { fontFamily: 'Helvetica-Bold', fontSize: 15, color: C.accent },

  // ── Notes ──
  notesBox: {
    backgroundColor: C.bg,
    borderRadius: 5,
    padding: 14,
    marginBottom: 26,
  },
  notesLabel: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: C.muted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  notesText: { fontSize: 10, color: C.muted, lineHeight: 1.6 },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 52,
    right: 52,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    borderTopStyle: 'solid',
  },
  footerText: { fontSize: 8, color: C.muted },
  footerBold: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: C.muted },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (v = 0) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v);

const fmtDate = (v?: string | null) =>
  v
    ? new Intl.DateTimeFormat('en-CA', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date(v))
    : '—';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft:  { bg: '#f0f0ef', text: C.muted },
  sent:   { bg: '#e8f0f9', text: '#3d5e82' },
  paid:   { bg: '#e4f4ef', text: C.green },
  void:   { bg: '#fbeaea', text: C.red },
};

// ─── PDF Document ─────────────────────────────────────────────────────────────
export function InvoicePDF({ invoice }: { invoice: Invoice }) {
  const statusMeta = STATUS_COLORS[invoice.status] ?? STATUS_COLORS.draft;
  const invoiceCode = `INV-${String(invoice.invoiceNumber).padStart(4, '0')}`;
  const isOverdue =
    invoice.status === 'sent' &&
    invoice.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <Document
      title={`${invoiceCode} — ${invoice.clientName}`}
      author="Docketline"
      subject="Invoice"
      creator="Docketline · Ontario Traffic Law"
    >
      <Page size="A4" style={s.page}>

        {/* ── HEADER ──────────────────────────────────────────────────── */}
        <View style={s.header}>
          {/* Left: branding */}
          <View>
            <View style={s.brandRow}>
              <View style={s.brandMark}>
                <Text style={s.brandMarkText}>TT</Text>
              </View>
              <View>
                <Text style={s.brandName}>Docketline</Text>
                <Text style={s.brandSub}>Ontario Traffic Law</Text>
              </View>
            </View>
          </View>

          {/* Right: INVOICE title + number + status */}
          <View>
            <Text style={s.invoiceTitle}>INVOICE</Text>
            <Text style={s.invoiceNumber}>{invoiceCode}</Text>
            <View
              style={[
                s.statusBadge,
                { backgroundColor: statusMeta.bg },
              ]}
            >
              <Text style={[s.statusText, { color: statusMeta.text }]}>
                {invoice.status.toUpperCase()}
                {isOverdue ? '  ·  OVERDUE' : ''}
              </Text>
            </View>
          </View>
        </View>

        {/* ── META ROW ────────────────────────────────────────────────── */}
        <View style={s.metaRow}>
          {/* Bill to */}
          <View style={s.metaBlock}>
            <Text style={s.metaLabel}>Bill to</Text>
            <Text style={s.metaValue}>{invoice.clientName}</Text>
            {invoice.caseNumber ? (
              <Text style={s.metaSub}>Case #{invoice.caseNumber}</Text>
            ) : null}
          </View>

          {/* Issue date */}
          <View style={s.metaBlock}>
            <Text style={s.metaLabel}>Issue date</Text>
            <Text style={s.metaValue}>{fmtDate(invoice.issueDate)}</Text>
          </View>

          {/* Due date */}
          <View style={s.metaBlock}>
            <Text style={s.metaLabel}>Due date</Text>
            <Text
              style={[
                s.metaValue,
                isOverdue ? { color: C.red } : {},
              ]}
            >
              {fmtDate(invoice.dueDate)}
            </Text>
            {isOverdue ? (
              <Text style={[s.metaSub, { color: C.red }]}>Overdue</Text>
            ) : null}
          </View>

          {/* Invoice ref */}
          <View style={s.metaBlock}>
            <Text style={s.metaLabel}>Reference</Text>
            <Text style={s.metaValue}>{invoiceCode}</Text>
            <Text style={s.metaSub}>
              Issued {fmtDate(invoice.issueDate)}
            </Text>
          </View>
        </View>

        {/* ── LINE ITEMS TABLE ─────────────────────────────────────────── */}
        <View style={s.table}>
          {/* Table header */}
          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderText, s.colDesc]}>Description</Text>
            <Text style={[s.tableHeaderText, s.colQty]}>Qty</Text>
            <Text style={[s.tableHeaderText, s.colPrice]}>Unit price</Text>
            <Text style={[s.tableHeaderText, s.colAmount]}>Amount</Text>
          </View>

          {/* Table rows */}
          {invoice.items.map((item: InvoiceItem, idx: number) => (
            <View
              key={item.id}
              style={[s.tableRow, idx % 2 === 1 ? s.tableRowAlt : {}]}
            >
              <Text style={[s.cellText, s.colDesc]}>{item.description}</Text>
              <Text style={[s.cellMono, s.colQty]}>{item.quantity}</Text>
              <Text style={[s.cellMono, s.colPrice]}>{fmt(item.unitPrice)}</Text>
              <Text style={[s.cellBold, s.colAmount]}>{fmt(item.amount)}</Text>
            </View>
          ))}
        </View>

        {/* ── TOTALS ───────────────────────────────────────────────────── */}
        <View style={s.totalsWrapper}>
          <View style={s.totalsBlock}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Subtotal</Text>
              <Text style={s.totalValue}>{fmt(invoice.subtotal)}</Text>
            </View>

            {invoice.taxRate > 0 && (
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>
                  HST / Tax ({invoice.taxRate}%)
                </Text>
                <Text style={s.totalValue}>{fmt(invoice.taxAmount)}</Text>
              </View>
            )}

            <View style={s.totalDivider} />

            <View style={s.totalRow}>
              <Text style={s.grandLabel}>Total due</Text>
              <Text style={s.grandValue}>{fmt(invoice.total)}</Text>
            </View>
          </View>
        </View>

        {/* ── NOTES ────────────────────────────────────────────────────── */}
        {invoice.notes ? (
          <View style={s.notesBox}>
            <Text style={s.notesLabel}>Notes</Text>
            <Text style={s.notesText}>{invoice.notes}</Text>
          </View>
        ) : null}

        {/* ── FOOTER ───────────────────────────────────────────────────── */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            <Text style={s.footerBold}>Docketline</Text>
            {'  ·  Ontario Traffic Law  ·  '}
            {invoiceCode}
          </Text>
          <Text style={s.footerText}>
            Total:{' '}
            <Text style={s.footerBold}>{fmt(invoice.total)}</Text>
          </Text>
        </View>

      </Page>
    </Document>
  );
}
