import { Router, type IRouter } from "express";
import { ExpenseModel, PaymentModel } from "@workspace/db";
import { CLOSED_STATUSES, getCaseRows } from "../lib/traffic";

// Reporting read-model.
//
// Everything here is derived from rows that already exist — no new collections.
// The one rule that matters: money totals must reconcile with the case pages,
// so receipts are netted exactly the way `toCase` nets them (voided payments are
// ignored, refunds reduce the total) and "outstanding" is taken from
// `balanceOwing`, never recomputed.

const router: IRouter = Router();

const tenantOf = (res: { locals: Record<string, unknown> }): string =>
  String(res.locals.tenantId ?? "");

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type CaseRow = Awaited<ReturnType<typeof getCaseRows>>[number];
type PaymentLite = {
  caseId: string;
  amount?: number | null;
  date?: string | null;
  isVoided?: boolean | null;
  isRefund?: boolean | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round1 = (value: number) => Math.round(value * 10) / 10;
const todayIso = () => new Date().toISOString().slice(0, 10);
const dayOf = (value: string | null | undefined) => (value ?? "").slice(0, 10);
const isClosedStatus = (status: string) =>
  CLOSED_STATUSES.includes(status as (typeof CLOSED_STATUSES)[number]);

// ─── date helpers ────────────────────────────────────────────────────────────

function addMonths(iso: string, delta: number): string {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10);
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function inRange(value: string | null | undefined, from: string, to: string): boolean {
  const day = dayOf(value);
  return Boolean(day) && day >= from && day <= to;
}

type Period = { from: string; to: string };

/**
 * Period selection. Defaults to the trailing 12 months so the page opens on a
 * number that means something; capped at 24 months because every month in the
 * range becomes a column in the revenue chart.
 */
function resolvePeriod(query: Record<string, unknown>): Period | { error: string } {
  const rawFrom = typeof query.from === "string" ? query.from : "";
  const rawTo = typeof query.to === "string" ? query.to : "";
  if (rawFrom && !ISO_DAY.test(rawFrom)) return { error: "from must be YYYY-MM-DD" };
  if (rawTo && !ISO_DAY.test(rawTo)) return { error: "to must be YYYY-MM-DD" };

  const to = rawTo || todayIso();
  const from = rawFrom || addMonths(`${to.slice(0, 7)}-01`, -11);
  if (from > to) return { error: "from must be on or before to" };

  const months =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
    1;
  if (months > 24) return { error: "Ranges are limited to 24 months" };
  return { from, to };
}

// ─── grouping ────────────────────────────────────────────────────────────────

/** Count rows by a free-text field, case-insensitively, keeping the first spelling seen. */
function groupCounts(values: (string | null | undefined)[], limit?: number) {
  const map = new Map<string, { label: string; count: number }>();
  for (const raw of values) {
    const label = (raw ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = map.get(key);
    if (entry) entry.count += 1;
    else map.set(key, { label, count: 1 });
  }
  const rows = Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
  return typeof limit === "number" ? rows.slice(0, limit) : rows;
}

/**
 * Outcome is free text on the case record, so classify by meaning rather than
 * exact spelling: "Not Guilty", "not guilty", "Charge withdrawn" all land in the
 * same bucket. Anything unrecognised is kept as "other" instead of being guessed.
 */
type OutcomeVerdict = "favourable" | "guilty" | "other";

function classifyOutcome(raw: string): OutcomeVerdict {
  if (/withdraw|dismiss|not guilty|acquit|stayed|\bstay\b|divert|crown/i.test(raw)) return "favourable";
  if (/guilty|convict|amended|reduc|plea/i.test(raw)) return "guilty";
  return "other";
}

// ─── read model ──────────────────────────────────────────────────────────────

const AGING_BUCKETS = [
  { label: "0–30 days", min: 0, max: 30 },
  { label: "31–60 days", min: 31, max: 60 },
  { label: "61–90 days", min: 61, max: 90 },
  { label: "90+ days", min: 91, max: Number.POSITIVE_INFINITY },
];

async function buildAnalytics(tenantId: string, from: string, to: string) {
  const [cases, payments] = await Promise.all([
    getCaseRows({ tenantId }),
    PaymentModel.find({ tenantId }).lean(),
  ]);
  // Receipts on soft-deleted files must not reach the money figures. Every other
  // screen hides deleted matters, so counting their payments here would make the
  // period total disagree with the lifetime total — the same book, two answers.
  const liveCaseIds = new Set(cases.map((row) => row.id));
  const receipts = (payments as unknown as PaymentLite[]).filter(
    (p) => !p.isVoided && liveCaseIds.has(p.caseId),
  );
  const receiptValue = (p: PaymentLite) => (p.isRefund ? -Number(p.amount ?? 0) : Number(p.amount ?? 0));

  // ── caseload ───────────────────────────────────────────────────────────────
  const closedCases = cases.filter((c) => isClosedStatus(c.status));
  const openCases = cases.filter((c) => !isClosedStatus(c.status));
  const caseload = {
    total: cases.length,
    open: openCases.length,
    closed: closedCases.length,
    openedInPeriod: cases.filter((c) => inRange(c.intakeDate, from, to)).length,
    closedInPeriod: cases.filter((c) => inRange(c.closedDate, from, to)).length,
  };

  // ── money ──────────────────────────────────────────────────────────────────
  // `written` is fee value on files opened in the period (what the firm booked);
  // `collected` is receipts actually dated in the period. They intentionally use
  // different events — comparing them is the point.
  const writtenOf = (row: CaseRow) => Number(row.totalFee ?? 0) + Number(row.disbursements ?? 0);
  const monthKeys: string[] = [];
  for (let cursor = `${from.slice(0, 7)}-01`; cursor.slice(0, 7) <= to.slice(0, 7); cursor = addMonths(cursor, 1)) {
    monthKeys.push(cursor.slice(0, 7));
    if (monthKeys.length > 24) break;
  }

  const billedAllTime = cases.reduce((sum, row) => sum + writtenOf(row), 0);
  const collectedAllTime = cases.reduce((sum, row) => sum + Number(row.amountReceived ?? 0), 0);
  const owing = cases.filter((row) => Number(row.balanceOwing) > 0);
  const outstanding = owing.reduce((sum, row) => sum + Number(row.balanceOwing), 0);
  const outstandingOnClosed = owing
    .filter((row) => isClosedStatus(row.status))
    .reduce((sum, row) => sum + Number(row.balanceOwing), 0);

  const money = {
    written: round2(cases.filter((c) => inRange(c.intakeDate, from, to)).reduce((sum, c) => sum + writtenOf(c), 0)),
    collected: round2(
      receipts.filter((p) => inRange(dayOf(p.date), from, to)).reduce((sum, p) => sum + receiptValue(p), 0),
    ),
    outstanding: round2(outstanding),
    outstandingOnClosed: round2(outstandingOnClosed),
    billedAllTime: round2(billedAllTime),
    collectedAllTime: round2(collectedAllTime),
    collectionRate: billedAllTime > 0 ? round1((collectedAllTime / billedAllTime) * 100) : 0,
    byMonth: monthKeys.map((key) => ({
      month: key,
      label: monthLabel(key),
      written: round2(cases.filter((c) => dayOf(c.intakeDate).slice(0, 7) === key).reduce((sum, c) => sum + writtenOf(c), 0)),
      collected: round2(
        receipts.filter((p) => dayOf(p.date).slice(0, 7) === key).reduce((sum, p) => sum + receiptValue(p), 0),
      ),
    })),
  };

  // ── aging ──────────────────────────────────────────────────────────────────
  // Age of a balance is measured from the last money that came in on the file,
  // or from intake when nothing has been paid. That is the number a firm acts on
  // ("nobody has paid this since March").
  const lastReceipt = new Map<string, string>();
  for (const p of receipts) {
    if (p.isRefund) continue;
    const day = dayOf(p.date);
    if (!day) continue;
    const seen = lastReceipt.get(p.caseId);
    if (!seen || day > seen) lastReceipt.set(p.caseId, day);
  }
  const today = todayIso();
  const bucketTotals = AGING_BUCKETS.map((bucket) => ({ label: bucket.label, amount: 0, count: 0 }));
  const aged = owing.map((row) => {
    const since = lastReceipt.get(row.id) ?? dayOf(row.intakeDate) ?? today;
    const days = Math.max(0, daysBetween(since || today, today));
    const index = AGING_BUCKETS.findIndex((bucket) => days >= bucket.min && days <= bucket.max);
    const bucket = bucketTotals[index < 0 ? bucketTotals.length - 1 : index];
    bucket.amount = round2(bucket.amount + Number(row.balanceOwing));
    bucket.count += 1;
    return {
      caseId: row.id,
      caseNumber: row.caseNumber,
      clientName: row.clientName,
      status: row.status,
      balanceOwing: round2(Number(row.balanceOwing)),
      days,
      lastReceipt: lastReceipt.get(row.id) ?? null,
      bucket: bucket.label,
    };
  });
  // Sorted once here; the page shows the worst eight, the CSV export takes the lot.
  const agingAll = aged.sort((a, b) => b.days - a.days || b.balanceOwing - a.balanceOwing);
  const aging = {
    total: round2(outstanding),
    count: owing.length,
    buckets: bucketTotals,
    oldest: agingAll.slice(0, 8),
  };

  // ── resolutions ────────────────────────────────────────────────────────────
  const resolved = cases.filter((row) => (row.outcome ?? "").trim().length > 0);
  const verdicts: Record<OutcomeVerdict, number> = { favourable: 0, guilty: 0, other: 0 };
  for (const row of resolved) verdicts[classifyOutcome(row.outcome ?? "")] += 1;
  const withPoints = resolved.filter((row) => row.demeritPoints !== null && row.demeritPoints !== undefined);
  const outcomes = {
    resolved: resolved.length,
    favourable: verdicts.favourable,
    guilty: verdicts.guilty,
    other: verdicts.other,
    favourableRate: resolved.length > 0 ? round1((verdicts.favourable / resolved.length) * 100) : 0,
    // A reduction is a separate win from a withdrawal, and firms quote both.
    reduced: cases.filter((row) => (row.reducedCharge ?? "").trim().length > 0).length,
    pointsRecorded: withPoints.length,
    pointsImposed: withPoints.reduce((sum, row) => sum + Number(row.demeritPoints ?? 0), 0),
    noPoints: withPoints.filter((row) => Number(row.demeritPoints) === 0).length,
    counts: groupCounts(resolved.map((row) => row.outcome)),
  };

  // ── mix ────────────────────────────────────────────────────────────────────
  const staff = new Map<string, { label: string; open: number; closed: number; outstanding: number; collected: number }>();
  for (const row of cases) {
    const label = (row.assignedTo ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = staff.get(key) ?? { label, open: 0, closed: 0, outstanding: 0, collected: 0 };
    if (isClosedStatus(row.status)) entry.closed += 1;
    else entry.open += 1;
    entry.outstanding += Number(row.balanceOwing);
    entry.collected += Number(row.amountReceived);
    staff.set(key, entry);
  }

  return {
    period: { from, to, months: monthKeys.length },
    caseload,
    money,
    aging,
    outcomes,
    // Every aged balance, for the CSV. Stripped from the JSON payload below.
    agingAll,
    topCharges: groupCounts(cases.map((row) => row.statuteCode), 6),
    courts: groupCounts(cases.map((row) => row.courtLocation), 5),
    workload: Array.from(staff.values())
      .map((row) => ({ ...row, outstanding: round2(row.outstanding), collected: round2(row.collected) }))
      .sort((a, b) => b.open - a.open || b.closed - a.closed)
      .slice(0, 8),
  };
}

// ─── collections (day book) & earnings ──────────────────────────────────────
//
// The day book answers "what came in, how did it arrive, and who took it" — the
// question a bank deposit or an audit actually asks. Earnings answers "after
// the money we spent, what is left". Both are cash-basis by design: a fee
// written in March and collected in May is May's money, and saying otherwise
// would make the bank balance disagree with the report.

const METHOD_BUCKETS = ["Cash", "Cheque", "E-transfer", "Card", "Wire", "Money order", "Other"] as const;
type MethodBucket = (typeof METHOD_BUCKETS)[number];

/** Free-text methods collapse into the buckets a bank statement recognises. */
function methodBucket(raw: string | null | undefined): MethodBucket {
  const value = (raw ?? "").toLowerCase();
  if (/cash/.test(value)) return "Cash";
  if (/cheque|check/.test(value)) return "Cheque";
  if (/e-?transfer|interac|e-?mail transfer|\bemt\b/.test(value)) return "E-transfer";
  if (/card|visa|master|amex|debit/.test(value)) return "Card";
  if (/wire|bank/.test(value)) return "Wire";
  if (/money order/.test(value)) return "Money order";
  return "Other";
}

const emptyBuckets = () =>
  Object.fromEntries(METHOD_BUCKETS.map((bucket) => [bucket, 0])) as Record<MethodBucket, number>;

type MoneyRow = PaymentLite & {
  method?: string | null;
  receivedBy?: string | null;
  receiptNumber?: string | null;
};

type DayBook = {
  date: string;
  total: number;
  refunds: number;
  net: number;
  count: number;
  methods: Record<MethodBucket, number>;
};

async function buildCollections(tenantId: string, from: string, to: string) {
  const [cases, payments, expenses] = await Promise.all([
    getCaseRows({ tenantId }),
    PaymentModel.find({ tenantId }).lean(),
    ExpenseModel.find({ tenantId, isDeleted: { $ne: true } }).lean(),
  ]);
  // A receipt on a deleted file is not the firm's money any more; every other
  // screen hides those files, so the day book must too.
  const liveCaseIds = new Set(cases.map((row) => row.id));
  const scoped = (payments as unknown as MoneyRow[]).filter((row) => liveCaseIds.has(row.caseId));
  const live = scoped.filter((row) => !row.isVoided);
  const inPeriod = live.filter((row) => inRange(dayOf(row.date), from, to));
  const receipts = inPeriod.filter((row) => !row.isRefund);
  const refunds = inPeriod.filter((row) => row.isRefund);

  // ── day book ───────────────────────────────────────────────────────────────
  const days = new Map<string, DayBook>();
  const dayOfEntry = (date: string) => {
    const entry = days.get(date) ?? { date, total: 0, refunds: 0, net: 0, count: 0, methods: emptyBuckets() };
    days.set(date, entry);
    return entry;
  };
  for (const row of receipts) {
    const date = dayOf(row.date);
    const entry = dayOfEntry(date);
    const amount = Number(row.amount ?? 0);
    entry.total = round2(entry.total + amount);
    entry.net = round2(entry.net + amount);
    entry.count += 1;
    entry.methods[methodBucket(row.method)] = round2(entry.methods[methodBucket(row.method)] + amount);
  }
  for (const row of refunds) {
    const entry = dayOfEntry(dayOf(row.date));
    const amount = Number(row.amount ?? 0);
    entry.refunds = round2(entry.refunds + amount);
    entry.net = round2(entry.net - amount);
  }
  const byDay = Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date));

  const byMethodMap = new Map<MethodBucket, { amount: number; count: number }>();
  for (const row of receipts) {
    const bucket = methodBucket(row.method);
    const entry = byMethodMap.get(bucket) ?? { amount: 0, count: 0 };
    entry.amount = round2(entry.amount + Number(row.amount ?? 0));
    entry.count += 1;
    byMethodMap.set(bucket, entry);
  }
  const byMethod = METHOD_BUCKETS
    .filter((bucket) => byMethodMap.has(bucket))
    .map((bucket) => ({ method: bucket as string, ...byMethodMap.get(bucket)! }))
    .sort((a, b) => b.amount - a.amount);

  const byStaffMap = new Map<string, { label: string; amount: number; count: number }>();
  for (const row of receipts) {
    const label = (row.receivedBy ?? "").trim() || "Not recorded";
    const key = label.toLowerCase();
    const entry = byStaffMap.get(key) ?? { label, amount: 0, count: 0 };
    entry.amount = round2(entry.amount + Number(row.amount ?? 0));
    entry.count += 1;
    byStaffMap.set(key, entry);
  }
  const byStaff = Array.from(byStaffMap.values()).sort((a, b) => b.amount - a.amount);

  const gross = round2(receipts.reduce((sum, row) => sum + Number(row.amount ?? 0), 0));
  const refundTotal = round2(refunds.reduce((sum, row) => sum + Number(row.amount ?? 0), 0));
  const net = round2(gross - refundTotal);

  // ── earnings (cash basis) ──────────────────────────────────────────────────
  const expenseRows = expenses as unknown as {
    amount?: number | null;
    date?: string | null;
    category?: string | null;
    isBillable?: boolean | null;
    isBilled?: boolean | null;
  }[];
  const expensesInPeriod = expenseRows.filter((row) => inRange(dayOf(row.date), from, to));
  const expenseTotal = round2(expensesInPeriod.reduce((sum, row) => sum + Number(row.amount ?? 0), 0));
  const categoryMap = new Map<string, number>();
  for (const row of expensesInPeriod) {
    const label = (row.category ?? "Other").trim() || "Other";
    categoryMap.set(label, round2((categoryMap.get(label) ?? 0) + Number(row.amount ?? 0)));
  }
  const expenseByCategory = Array.from(categoryMap.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount);
  // Money the firm has already spent for clients that has not reached an invoice.
  const unbilled = round2(
    expenseRows
      .filter((row) => row.isBillable && !row.isBilled)
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
  );

  const monthKeys: string[] = [];
  for (let cursor = `${from.slice(0, 7)}-01`; cursor.slice(0, 7) <= to.slice(0, 7); cursor = addMonths(cursor, 1)) {
    monthKeys.push(cursor.slice(0, 7));
    if (monthKeys.length > 24) break;
  }
  const netByMonth = new Map<string, number>();
  for (const row of receipts) {
    const key = dayOf(row.date).slice(0, 7);
    netByMonth.set(key, round2((netByMonth.get(key) ?? 0) + Number(row.amount ?? 0)));
  }
  for (const row of refunds) {
    const key = dayOf(row.date).slice(0, 7);
    netByMonth.set(key, round2((netByMonth.get(key) ?? 0) - Number(row.amount ?? 0)));
  }
  const spendByMonth = new Map<string, number>();
  for (const row of expensesInPeriod) {
    const key = dayOf(row.date).slice(0, 7);
    spendByMonth.set(key, round2((spendByMonth.get(key) ?? 0) + Number(row.amount ?? 0)));
  }
  const byMonth = monthKeys.map((key) => {
    const cashIn = round2(netByMonth.get(key) ?? 0);
    const spent = round2(spendByMonth.get(key) ?? 0);
    return { month: key, label: monthLabel(key), cashIn, expenses: spent, net: round2(cashIn - spent) };
  });

  return {
    period: { from, to },
    totals: { gross, refunds: refundTotal, net, count: receipts.length, refundCount: refunds.length },
    voidedCount: scoped.filter((row) => row.isVoided && inRange(dayOf(row.date), from, to)).length,
    byDay,
    byMethod,
    byStaff,
    earnings: {
      cashIn: net,
      expenses: expenseTotal,
      netCash: round2(net - expenseTotal),
      // Ontario HST is 13%, and expense entries carry the tax-inclusive amount.
      hstInputCredit: round2((expenseTotal * 13) / 113),
      unbilled,
      byMonth,
      byCategory: expenseByCategory,
    },
  };
}

// ─── routes ──────────────────────────────────────────────────────────────────

router.get("/reports/analytics", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const period = resolvePeriod(req.query as Record<string, unknown>);
  if ("error" in period) {
    res.status(400).json({ error: period.error });
    return;
  }
  const { agingAll: _agingAll, ...payload } = await buildAnalytics(tenantId, period.from, period.to);
  res.json(payload);
});

router.get("/reports/collections", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const period = resolvePeriod(req.query as Record<string, unknown>);
  if ("error" in period) {
    res.status(400).json({ error: period.error });
    return;
  }
  res.json(await buildCollections(tenantId, period.from, period.to));
});

router.get("/reports/export.csv", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const report = String(req.query.report ?? "");
  if (report !== "aging" && report !== "revenue" && report !== "collections" && report !== "earnings") {
    res.status(400).json({ error: "report must be aging, revenue, collections or earnings" });
    return;
  }
  const period = resolvePeriod(req.query as Record<string, unknown>);
  if ("error" in period) {
    res.status(400).json({ error: period.error });
    return;
  }

  const data = await buildAnalytics(tenantId, period.from, period.to);
  const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const collections = report === "collections" || report === "earnings"
    ? await buildCollections(tenantId, period.from, period.to)
    : null;
  const lines =
    report === "aging"
      ? [
          "Case Number,Client,Status,Balance Owing,Last Receipt,Age (days),Bucket",
          ...data.agingAll.map((row) =>
            [row.caseNumber, row.clientName, row.status, row.balanceOwing.toFixed(2), row.lastReceipt ?? "", row.days, row.bucket]
              .map(cell)
              .join(","),
          ),
        ]
      : report === "revenue"
      ? [
          "Month,Collected,Written",
          ...data.money.byMonth.map((row) => [row.label, row.collected.toFixed(2), row.written.toFixed(2)].map(cell).join(",")),
        ]
      : report === "collections"
      ? [
          `"Day book",${cell(period.from)},${cell(period.to)}`,
          "",
          ["Date", "Receipts", "Receipt count", "Refunds", "Net", ...METHOD_BUCKETS].map(cell).join(","),
          ...(collections?.byDay ?? []).map((row) =>
            [
              row.date,
              row.total.toFixed(2),
              row.count,
              row.refunds.toFixed(2),
              row.net.toFixed(2),
              ...METHOD_BUCKETS.map((bucket) => row.methods[bucket].toFixed(2)),
            ]
              .map(cell)
              .join(","),
          ),
          "",
          ["Staff", "Received", "Receipt count"].map(cell).join(","),
          ...(collections?.byStaff ?? []).map((row) => [row.label, row.amount.toFixed(2), row.count].map(cell).join(",")),
        ]
      : [
          `"Earnings (cash basis)",${cell(period.from)},${cell(period.to)}`,
          "",
          "Line,Amount",
          ["Collected (net of refunds)", (collections?.earnings.cashIn ?? 0).toFixed(2)].map(cell).join(","),
          ["Expenses", (collections?.earnings.expenses ?? 0).toFixed(2)].map(cell).join(","),
          ["Net cash", (collections?.earnings.netCash ?? 0).toFixed(2)].map(cell).join(","),
          ["HST input credit (13% included)", (collections?.earnings.hstInputCredit ?? 0).toFixed(2)].map(cell).join(","),
          ["Unbilled client disbursements", (collections?.earnings.unbilled ?? 0).toFixed(2)].map(cell).join(","),
          "",
          ["Month", "Collected", "Expenses", "Net"].map(cell).join(","),
          ...(collections?.earnings.byMonth ?? []).map((row) =>
            [row.label, row.cashIn.toFixed(2), row.expenses.toFixed(2), row.net.toFixed(2)].map(cell).join(","),
          ),
          "",
          ["Expense category", "Amount"].map(cell).join(","),
          ...(collections?.earnings.byCategory ?? []).map((row) => [row.label, row.amount.toFixed(2)].map(cell).join(",")),
        ];

  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader(
    "content-disposition",
    `attachment; filename="docketline-${report}-${period.from}-to-${period.to}.csv"`,
  );
  res.send(lines.join("\n"));
});

export default router;
