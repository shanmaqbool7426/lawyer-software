import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  CaseModel,
  ClientModel,
  ExpenseModel,
  EXPENSE_CATEGORIES,
} from "@workspace/db";
import {
  CreateExpenseBody,
  CreateExpenseResponse,
  DeleteExpenseParams,
  GetExpenseParams,
  GetExpenseResponse,
  GetExpenseSummaryQueryParams,
  GetExpenseSummaryResponse,
  ListExpensesQueryParams,
  ListExpensesResponse,
  UpdateExpenseBody,
  UpdateExpenseParams,
  UpdateExpenseResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const tenantOf = (res: { locals: Record<string, unknown> }): string =>
  String(res.locals.tenantId ?? "");

function escapeRegExp(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Enrich a raw expense doc with clientName + caseNumber by pre-loaded maps */
function plainExpense(
  exp: {
    id: string; tenantId: string; caseId?: string | null;
    clientId?: string | null; category: string; amount: number;
    date: string; description: string; vendor?: string | null;
    receiptUrl?: string | null; isBillable: boolean; isBilled: boolean;
    createdAt: Date; updatedAt: Date;
  },
  caseNumberById: Map<string, number>,
  clientNameById: Map<string, string>,
) {
  return {
    id:          exp.id,
    tenantId:    exp.tenantId,
    caseId:      exp.caseId ?? null,
    caseNumber:  exp.caseId ? (caseNumberById.get(exp.caseId) ?? null) : null,
    clientId:    exp.clientId ?? null,
    clientName:  exp.clientId ? (clientNameById.get(exp.clientId) ?? null) : null,
    category:    exp.category,
    amount:      Number(exp.amount),
    date:        exp.date,
    description: exp.description,
    vendor:      exp.vendor ?? null,
    receiptUrl:  exp.receiptUrl ?? null,
    isBillable:  Boolean(exp.isBillable),
    isBilled:    Boolean(exp.isBilled),
    createdAt:   exp.createdAt,
    updatedAt:   exp.updatedAt,
  };
}

async function enrichExpenses(
  tenantId: string,
  expenses: Array<{
    id: string; tenantId: string; caseId?: string | null;
    clientId?: string | null; category: string; amount: number;
    date: string; description: string; vendor?: string | null;
    receiptUrl?: string | null; isBillable: boolean; isBilled: boolean;
    createdAt: Date; updatedAt: Date;
  }>,
) {
  const caseIds   = Array.from(new Set(expenses.map((e) => e.caseId).filter((x): x is string => !!x)));
  const clientIds = Array.from(new Set(expenses.map((e) => e.clientId).filter((x): x is string => !!x)));

  const [cases, clients] = await Promise.all([
    caseIds.length
      ? CaseModel.find({ tenantId, id: { $in: caseIds } }).select("id caseNumber clientId").lean()
      : [],
    clientIds.length
      ? ClientModel.find({ tenantId, id: { $in: clientIds } }).select("id fullName").lean()
      : [],
  ]);

  // Also grab clients from cases (in case clientId wasn't stored on expense)
  const extraClientIds = Array.from(new Set(cases.map((c) => c.clientId).filter((x): x is string => !!x && !clientIds.includes(x))));
  const extraClients   = extraClientIds.length
    ? await ClientModel.find({ tenantId, id: { $in: extraClientIds } }).select("id fullName").lean()
    : [];

  const caseNumberById  = new Map(cases.map((c) => [c.id, c.caseNumber]));
  const clientNameById  = new Map([...clients, ...extraClients].map((c) => [c.id, c.fullName]));

  // Fill in clientId from case when missing on expense
  const enriched = expenses.map((e) => {
    const effectiveClientId = e.clientId ?? (e.caseId ? (cases.find((c) => c.id === e.caseId)?.clientId ?? null) : null);
    return plainExpense({ ...e, clientId: effectiveClientId }, caseNumberById, clientNameById);
  });

  return { enriched, caseNumberById, clientNameById };
}

// ── GET /expenses ────────────────────────────────────────────────────────────
router.get("/expenses", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListExpensesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { caseId, clientId, category, firmOnly, billable, billed, dateFrom, dateTo, search, page: rawPage, limit: rawLimit } = parsed.data;
  const page  = Math.max(1, Math.floor(rawPage  ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(rawLimit ?? 20)));

  const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };

  if (caseId)    query.caseId = caseId;
  if (clientId)  query.clientId = clientId;
  if (category)  query.category = category;
  // firmOnly: only expenses with NO case attached
  if (firmOnly === true)  query.caseId = null;
  // If both caseId and firmOnly supplied, caseId wins (edge case guard)
  if (billable !== undefined) query.isBillable = billable;
  if (billed   !== undefined) query.isBilled   = billed;
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, string> = {};
    if (dateFrom) dateFilter.$gte = dateFrom;
    if (dateTo)   dateFilter.$lte = dateTo;
    query.date = dateFilter;
  }
  if (search) {
    const re = { $regex: escapeRegExp(search), $options: "i" };
    (query as any).$or = [{ description: re }, { vendor: re }];
  }

  const [total, expenses, aggregateResult] = await Promise.all([
    ExpenseModel.countDocuments(query),
    ExpenseModel.find(query)
      .sort({ date: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    // total amount across ALL matching rows (not just page)
    ExpenseModel.aggregate([
      { $match: { ...query } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  const totalAmount = Number(aggregateResult[0]?.total ?? 0);
  const { enriched } = await enrichExpenses(tenantId, expenses as any);

  res.json(
    ListExpensesResponse.parse({
      data: enriched,
      total,
      totalAmount,
      page,
      pageSize: limit,
    }),
  );
});

// ── POST /expenses ───────────────────────────────────────────────────────────
router.post("/expenses", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data = parsed.data;
  let clientId: string | null = null;

  // Validate caseId and resolve clientId from case
  if (data.caseId) {
    const caseItem = await CaseModel.findOne({ id: data.caseId, tenantId, isDeleted: false }).lean();
    if (!caseItem) { res.status(404).json({ error: "Case not found" }); return; }
    clientId = caseItem.clientId;
  }

  // Validate category
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(data.category)) {
    res.status(400).json({ error: `Invalid category. Valid: ${EXPENSE_CATEGORIES.join(", ")}` });
    return;
  }

  // Amount must be positive — already validated by zod but double-check
  if (data.amount <= 0) { res.status(400).json({ error: "Amount must be positive" }); return; }

  const expense = await ExpenseModel.create({
    id:          randomUUID(),
    tenantId,
    caseId:      data.caseId   || null,
    clientId,
    category:    data.category,
    amount:      data.amount,
    date:        data.date,
    description: data.description.trim(),
    vendor:      data.vendor?.trim()     || null,
    receiptUrl:  data.receiptUrl?.trim() || null,
    isBillable:  data.isBillable ?? false,
    isBilled:    false,
  });

  const { enriched } = await enrichExpenses(tenantId, [expense.toObject() as any]);
  res.status(201).json(CreateExpenseResponse.parse(enriched[0]));
});

// ── GET /expenses/summary ────────────────────────────────────────────────────
// IMPORTANT: must be before /:id to avoid route conflict
router.get("/expenses/summary", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetExpenseSummaryQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { dateFrom, dateTo, caseId } = parsed.data;
  const baseMatch: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (caseId)   baseMatch.caseId = caseId;
  if (dateFrom || dateTo) {
    const df: Record<string, string> = {};
    if (dateFrom) df.$gte = dateFrom;
    if (dateTo)   df.$lte = dateTo;
    baseMatch.date = df;
  }

  const [agg, byCatAgg, byMonthAgg, byVendorAgg] = await Promise.all([
    // Overall totals
    ExpenseModel.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalAmount:    { $sum: "$amount" },
          billableAmount: { $sum: { $cond: ["$isBillable", "$amount", 0] } },
          billedAmount:   { $sum: { $cond: [{ $and: ["$isBillable", "$isBilled"] }, "$amount", 0] } },
          firmAmount:     { $sum: { $cond: [{ $eq: ["$caseId", null] }, "$amount", 0] } },
          caseAmount:     { $sum: { $cond: [{ $ne: ["$caseId", null] }, "$amount", 0] } },
          count:          { $sum: 1 },
        },
      },
    ]),
    // By category
    ExpenseModel.aggregate([
      { $match: baseMatch },
      { $group: { _id: "$category", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    // By month (last 12)
    ExpenseModel.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id:    { $substr: ["$date", 0, 7] }, // "YYYY-MM"
          amount: { $sum: "$amount" },
          count:  { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 12 },
    ]),
    // Top vendors (non-null)
    ExpenseModel.aggregate([
      { $match: { ...baseMatch, vendor: { $ne: null } } },
      { $group: { _id: "$vendor", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
      { $limit: 10 },
    ]),
  ]);

  const totals        = agg[0] ?? { totalAmount: 0, billableAmount: 0, billedAmount: 0, firmAmount: 0, caseAmount: 0, count: 0 };
  const billableAmt   = Number(totals.billableAmount ?? 0);
  const billedAmt     = Number(totals.billedAmount   ?? 0);

  res.json(
    GetExpenseSummaryResponse.parse({
      totalAmount:    Number(totals.totalAmount   ?? 0),
      billableAmount: billableAmt,
      billedAmount:   billedAmt,
      unbilledAmount: billableAmt - billedAmt,
      firmAmount:     Number(totals.firmAmount    ?? 0),
      caseAmount:     Number(totals.caseAmount    ?? 0),
      count:          Number(totals.count         ?? 0),
      byCategory: byCatAgg.map((r: any) => ({
        category: r._id,
        amount:   Number(r.amount),
        count:    Number(r.count),
      })),
      byMonth: byMonthAgg.map((r: any) => ({
        month:  r._id,
        amount: Number(r.amount),
        count:  Number(r.count),
      })),
      topVendors: byVendorAgg.map((r: any) => ({
        vendor: r._id,
        amount: Number(r.amount),
        count:  Number(r.count),
      })),
    }),
  );
});

// ── GET /expenses/export.csv ─────────────────────────────────────────────────
router.get("/expenses/export.csv", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListExpensesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { caseId, clientId, category, firmOnly, billable, billed, dateFrom, dateTo, search } = parsed.data;
  const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (caseId)    query.caseId   = caseId;
  if (clientId)  query.clientId = clientId;
  if (category)  query.category = category;
  if (firmOnly === true) query.caseId = null;
  if (billable !== undefined) query.isBillable = billable;
  if (billed   !== undefined) query.isBilled   = billed;
  if (dateFrom || dateTo) {
    const df: Record<string, string> = {};
    if (dateFrom) df.$gte = dateFrom;
    if (dateTo)   df.$lte = dateTo;
    query.date = df;
  }
  if (search) {
    const re = { $regex: escapeRegExp(search), $options: "i" };
    (query as any).$or = [{ description: re }, { vendor: re }];
  }

  const expenses = await ExpenseModel.find(query).sort({ date: -1 }).lean();
  const { enriched } = await enrichExpenses(tenantId, expenses as any);

  const q = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [
    ["Date", "Category", "Description", "Vendor", "Amount (CAD)", "Billable", "Billed", "Case #", "Client", "Receipt URL"].map(q).join(","),
    ...enriched.map((e) =>
      [
        e.date,
        e.category,
        e.description,
        e.vendor ?? "",
        e.amount.toFixed(2),
        e.isBillable ? "Yes" : "No",
        e.isBilled   ? "Yes" : "No",
        e.caseNumber ? `#${e.caseNumber}` : "",
        e.clientName ?? "",
        e.receiptUrl ?? "",
      ].map(q).join(","),
    ),
  ];

  res
    .type("text/csv")
    .set("Content-Disposition", 'attachment; filename="expenses.csv"')
    .send(lines.join("\n"));
});

// ── GET /expenses/:id ────────────────────────────────────────────────────────
router.get("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetExpenseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const expense = await ExpenseModel.findOne({ id: parsed.data.id, tenantId, isDeleted: { $ne: true } }).lean();
  if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }

  const { enriched } = await enrichExpenses(tenantId, [expense as any]);
  res.json(GetExpenseResponse.parse(enriched[0]));
});

// ── PATCH /expenses/:id ──────────────────────────────────────────────────────
router.patch("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = UpdateExpenseParams.safeParse(req.params);
  const body   = UpdateExpenseBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success)   { res.status(400).json({ error: body.error.message });   return; }

  const existing = await ExpenseModel.findOne({ id: params.data.id, tenantId, isDeleted: { $ne: true } }).lean();
  if (!existing) { res.status(404).json({ error: "Expense not found" }); return; }

  const data = body.data;

  // Validate new caseId if provided
  let clientId = existing.clientId;
  if (data.caseId !== undefined) {
    if (data.caseId) {
      const caseItem = await CaseModel.findOne({ id: data.caseId, tenantId, isDeleted: false }).lean();
      if (!caseItem) { res.status(404).json({ error: "Case not found" }); return; }
      clientId = caseItem.clientId;
    } else {
      clientId = null; // moved to firm-level
    }
  }

  // Validate category if changing
  if (data.category && !(EXPENSE_CATEGORIES as readonly string[]).includes(data.category)) {
    res.status(400).json({ error: `Invalid category. Valid: ${EXPENSE_CATEGORIES.join(", ")}` });
    return;
  }

  // Guard: cannot mark as billed if not billable
  if (data.isBilled === true) {
    const effectiveBillable = data.isBillable ?? existing.isBillable;
    if (!effectiveBillable) {
      res.status(422).json({ error: "Cannot mark as billed — expense is not billable" });
      return;
    }
  }

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.caseId       !== undefined) { $set.caseId      = data.caseId ?? null; $set.clientId = clientId; }
  if (data.category     !== undefined) $set.category     = data.category;
  if (data.amount       !== undefined) $set.amount       = data.amount;
  if (data.date         !== undefined) $set.date         = data.date;
  if (data.description  !== undefined) $set.description  = data.description.trim();
  if (data.vendor       !== undefined) $set.vendor       = data.vendor?.trim() || null;
  if (data.receiptUrl   !== undefined) $set.receiptUrl   = data.receiptUrl?.trim() || null;
  if (data.isBillable   !== undefined) $set.isBillable   = data.isBillable;
  if (data.isBilled     !== undefined) $set.isBilled     = data.isBilled;

  const updated = await ExpenseModel.findOneAndUpdate(
    { id: params.data.id, tenantId },
    { $set },
    { new: true },
  ).lean();

  if (!updated) { res.status(404).json({ error: "Expense not found" }); return; }

  const { enriched } = await enrichExpenses(tenantId, [updated as any]);
  res.json(UpdateExpenseResponse.parse(enriched[0]));
});

// ── DELETE /expenses/:id ─────────────────────────────────────────────────────
router.delete("/expenses/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteExpenseParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updated = await ExpenseModel.findOneAndUpdate(
    { id: parsed.data.id, tenantId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, updatedAt: new Date() } },
  ).lean();

  if (!updated) { res.status(404).json({ error: "Expense not found" }); return; }
  res.sendStatus(204);
});

export default router;
