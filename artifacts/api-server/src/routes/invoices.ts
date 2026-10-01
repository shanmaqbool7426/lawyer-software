import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  CaseModel,
  ClientModel,
  CounterModel,
  InvoiceModel,
} from "@workspace/db";
import {
  CreateInvoiceBody,
  CreateInvoiceResponse,
  DeleteInvoiceParams,
  GetInvoiceParams,
  GetInvoiceResponse,
  ListInvoicesQueryParams,
  ListInvoicesResponse,
  UpdateInvoiceStatusBody,
  UpdateInvoiceStatusParams,
  UpdateInvoiceStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const tenantOf = (res: { locals: Record<string, unknown> }): string =>
  String(res.locals.tenantId ?? "");

async function getNextInvoiceNumber(tenantId: string): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate(
    { key: `invoiceNumber:${tenantId}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true },
  ).lean();
  return counter!.value;
}

function plainInvoice(inv: {
  id: string;
  invoiceNumber: number;
  clientId: string;
  caseId?: string | null;
  status: string;
  issueDate: string;
  dueDate: string;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  clientName: string;
  caseNumber?: number | null;
}) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    clientId: inv.clientId,
    clientName: inv.clientName,
    caseId: inv.caseId ?? null,
    caseNumber: inv.caseNumber ?? null,
    status: inv.status,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    items: inv.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      amount: Number(item.amount),
    })),
    subtotal: Number(inv.subtotal),
    taxRate: Number(inv.taxRate),
    taxAmount: Number(inv.taxAmount),
    total: Number(inv.total),
    notes: inv.notes ?? null,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
  };
}

// ── GET /invoices ────────────────────────────────────────────────────────────
router.get("/invoices", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListInvoicesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { clientId, caseId, status, page: rawPage, limit: rawLimit } = parsed.data;
  const page = Math.max(1, Math.floor(rawPage ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(rawLimit ?? 20)));

  const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (clientId) query.clientId = clientId;
  if (caseId) query.caseId = caseId;
  if (status) query.status = status;

  const total = await InvoiceModel.countDocuments(query);
  const invoices = await InvoiceModel.find(query)
    .sort({ invoiceNumber: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  // Batch-load client names
  const clientIds = Array.from(new Set(invoices.map((inv) => inv.clientId)));
  const clients = clientIds.length
    ? await ClientModel.find({ tenantId, id: { $in: clientIds } })
        .select("id fullName")
        .lean()
    : [];
  const clientNameById = new Map(clients.map((c) => [c.id, c.fullName]));

  // Batch-load case numbers
  const caseIds = Array.from(new Set(invoices.map((inv) => inv.caseId).filter(Boolean) as string[]));
  const cases = caseIds.length
    ? await CaseModel.find({ tenantId, id: { $in: caseIds } })
        .select("id caseNumber")
        .lean()
    : [];
  const caseNumberById = new Map(cases.map((c) => [c.id, c.caseNumber]));

  res.json(
    ListInvoicesResponse.parse({
      data: invoices.map((inv) =>
        plainInvoice({
          ...inv,
          clientName: clientNameById.get(inv.clientId) ?? "Unknown",
          caseNumber: inv.caseId ? (caseNumberById.get(inv.caseId) ?? null) : null,
        } as any),
      ),
      total,
      page,
      pageSize: limit,
    }),
  );
});

// ── POST /invoices ───────────────────────────────────────────────────────────
router.post("/invoices", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;

  const client = await ClientModel.findOne({
    id: data.clientId,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  let caseNumber: number | null = null;
  if (data.caseId) {
    const caseItem = await CaseModel.findOne({ id: data.caseId, tenantId }).lean();
    if (!caseItem) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    caseNumber = caseItem.caseNumber;
  }

  const taxRate = data.taxRate ?? 0;
  const items = data.items.map((item) => ({
    id: randomUUID(),
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
  }));
  const subtotal = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const invoiceNumber = await getNextInvoiceNumber(tenantId);

  const invoice = await InvoiceModel.create({
    id: randomUUID(),
    tenantId,
    invoiceNumber,
    clientId: data.clientId,
    caseId: data.caseId || null,
    status: "draft",
    issueDate: data.issueDate,
    dueDate: data.dueDate,
    items,
    subtotal,
    taxRate,
    taxAmount,
    total,
    notes: data.notes || null,
  });

  res.status(201).json(
    CreateInvoiceResponse.parse(
      plainInvoice({
        ...invoice.toObject(),
        clientName: client.fullName,
        caseNumber,
      } as any),
    ),
  );
});

// ── GET /invoices/:id ────────────────────────────────────────────────────────
router.get("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetInvoiceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const invoice = await InvoiceModel.findOne({
    id: parsed.data.id,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const client = await ClientModel.findOne({ id: invoice.clientId, tenantId })
    .select("fullName")
    .lean();
  let caseNumber: number | null = null;
  if (invoice.caseId) {
    const caseItem = await CaseModel.findOne({ id: invoice.caseId, tenantId })
      .select("caseNumber")
      .lean();
    caseNumber = caseItem?.caseNumber ?? null;
  }
  res.json(
    GetInvoiceResponse.parse(
      plainInvoice({
        ...invoice,
        clientName: client?.fullName ?? "Unknown",
        caseNumber,
      } as any),
    ),
  );
});

// ── PATCH /invoices/:id/status ───────────────────────────────────────────────
router.patch("/invoices/:id/status", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = UpdateInvoiceStatusParams.safeParse(req.params);
  const body = UpdateInvoiceStatusBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const invoice = await InvoiceModel.findOneAndUpdate(
    { id: params.data.id, tenantId, isDeleted: { $ne: true } },
    { $set: { status: body.data.status, updatedAt: new Date() } },
    { new: true },
  ).lean();
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const client = await ClientModel.findOne({ id: invoice.clientId, tenantId })
    .select("fullName")
    .lean();
  let caseNumber: number | null = null;
  if (invoice.caseId) {
    const caseItem = await CaseModel.findOne({ id: invoice.caseId, tenantId })
      .select("caseNumber")
      .lean();
    caseNumber = caseItem?.caseNumber ?? null;
  }
  res.json(
    UpdateInvoiceStatusResponse.parse(
      plainInvoice({
        ...invoice,
        clientName: client?.fullName ?? "Unknown",
        caseNumber,
      } as any),
    ),
  );
});

// ── DELETE /invoices/:id ─────────────────────────────────────────────────────
router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteInvoiceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await InvoiceModel.findOneAndUpdate(
    { id: parsed.data.id, tenantId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, updatedAt: new Date() } },
  ).lean();
  if (!updated) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
