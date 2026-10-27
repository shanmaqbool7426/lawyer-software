import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  CaseModel,
  ClientModel,
  CounterModel,
  InvoiceModel,
  PaymentModel,
} from "@workspace/db";
import {
  CreateInvoiceBody,
  CreateInvoiceResponse,
  DeleteInvoiceParams,
  GetInvoiceParams,
  GetInvoiceResponse,
  GetInvoiceSummaryResponse,
  ListInvoicesQueryParams,
  ListInvoicesResponse,
  SendInvoiceEmailBody,
  SendInvoiceEmailParams,
  SendInvoiceEmailResponse,
  UpdateInvoiceBody,
  UpdateInvoiceParams,
  UpdateInvoiceResponse,
  UpdateInvoiceStatusBody,
  UpdateInvoiceStatusParams,
  UpdateInvoiceStatusResponse,
} from "@workspace/api-zod";
import { isEmailConfigured, invoiceEmailHtml, sendEmail } from "../lib/email";
import { getNextReceiptNumber, caseTotals } from "../lib/traffic";

const router: IRouter = Router();

const tenantOf = (res: { locals: Record<string, unknown> }): string =>
  String(res.locals.tenantId ?? "");

/** Date-only string (YYYY-MM-DD) in local time — invoice dates are calendar days. */
function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function randomToken(): string {
  return randomUUID().replace(/-/g, "");
}

async function getNextInvoiceNumber(tenantId: string): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate(
    { key: `invoiceNumber:${tenantId}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true },
  ).lean();
  return counter!.value;
}

function escapeRegExp(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Line items + tax -> stored money fields. Always round at the cent. */
function recalc<T extends { quantity: number; unitPrice: number }>(items: T[], taxRate: number) {
  const priced = items.map((item) => ({
    ...item,
    amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
  }));
  const subtotal = Math.round(priced.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  return { priced, subtotal, taxAmount, total };
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
  sentAt?: string | null;
  paidAt?: string | null;
  createdAt: Date;
  updatedAt: Date;
  clientName: string;
  caseNumber?: number | null;
  settledReceipt?: string | null;
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
    sentAt: inv.sentAt ?? null,
    paidAt: inv.paidAt ?? null,
    // The receipt that settled this invoice, so the register can be traced
    // straight to the case ledger and the day book.
    settledReceipt: inv.settledReceipt ?? null,
    createdAt: inv.createdAt,
    updatedAt: inv.updatedAt,
  };
}

/** Enrich a single invoice document with the client name and case number. */
async function withRelations(
  tenantId: string,
  invoice: any,
  clientNameHint?: string,
): Promise<Record<string, unknown>> {
  const client = clientNameHint
    ? null
    : await ClientModel.findOne({ id: invoice.clientId, tenantId })
        .select("fullName")
        .lean();
  let caseNumber: number | null = null;
  if (invoice.caseId) {
    const caseItem = await CaseModel.findOne({ id: invoice.caseId, tenantId })
      .select("caseNumber")
      .lean();
    caseNumber = caseItem?.caseNumber ?? null;
  }
  let settledReceipt: string | null = null;
  if (invoice.paymentId) {
    const settled = await PaymentModel.findOne({ id: invoice.paymentId, tenantId })
      .select("receiptNumber isVoided")
      .lean();
    settledReceipt = settled && !settled.isVoided ? (settled.receiptNumber ?? null) : null;
  }
  return plainInvoice({
    ...invoice,
    clientName: clientNameHint ?? client?.fullName ?? "Unknown",
    caseNumber,
    settledReceipt,
  } as any);
}

// ── GET /invoices/summary ────────────────────────────────────────────────────
// MUST be registered before /invoices/:id or "summary" is read as an id.
router.get("/invoices/summary", async (_req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const match = { tenantId, isDeleted: { $ne: true } };
  const today = todayStr();

  const [byStatus, overdue] = await Promise.all([
    InvoiceModel.aggregate([
      { $match: match },
      { $group: { _id: "$status", amount: { $sum: "$total" }, count: { $sum: 1 } } },
    ]),
    InvoiceModel.aggregate([
      { $match: { ...match, status: "sent", dueDate: { $lt: today } } },
      { $group: { _id: null, amount: { $sum: "$total" }, count: { $sum: 1 } } },
    ]),
  ]);

  const pick = (status: string) => {
    const row = byStatus.find((r: any) => r._id === status) as any;
    return { amount: Number(row?.amount ?? 0), count: Number(row?.count ?? 0) };
  };

  const draft = pick("draft");
  const sent = pick("sent");
  const paid = pick("paid");
  const voided = pick("void");

  res.json(
    GetInvoiceSummaryResponse.parse({
      draftAmount: draft.amount,
      draftCount: draft.count,
      // "Billed" means money we have actually asked the client for — drafts and
      // voided invoices never count, otherwise the register overstates revenue.
      billedAmount: Math.round((sent.amount + paid.amount) * 100) / 100,
      billedCount: sent.count + paid.count,
      collectedAmount: paid.amount,
      collectedCount: paid.count,
      outstandingAmount: sent.amount,
      outstandingCount: sent.count,
      overdueAmount: Number(overdue[0]?.amount ?? 0),
      overdueCount: Number(overdue[0]?.count ?? 0),
      voidCount: voided.count,
      totalCount: draft.count + sent.count + paid.count + voided.count,
    }),
  );
});

// ── GET /invoices ────────────────────────────────────────────────────────────
router.get("/invoices", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListInvoicesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { clientId, caseId, status, search, overdue, sort, page: rawPage, limit: rawLimit } = parsed.data;
  const page = Math.max(1, Math.floor(rawPage ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(rawLimit ?? 20)));

  const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (clientId) query.clientId = clientId;
  if (caseId) query.caseId = caseId;
  if (status) query.status = status;
  if (overdue) {
    // Overdue is a view, not a stored status: a sent invoice past its due date.
    query.status = "sent";
    query.dueDate = { $lt: todayStr() };
  }

  if (search?.trim()) {
    const re = { $regex: escapeRegExp(search.trim()), $options: "i" };
    const matchingClients = await ClientModel.find({ tenantId, fullName: re, isDeleted: { $ne: true } })
      .select("id")
      .lean();
    const or: Array<Record<string, unknown>> = [
      { clientId: { $in: matchingClients.map((c) => c.id) } },
      { "items.description": re },
    ];
    const numeric = Number(search.replace(/[^0-9]/g, ""));
    if (search.replace(/[^0-9]/g, "").length > 0 && Number.isFinite(numeric)) {
      or.push({ invoiceNumber: numeric });
    }
    (query as any).$or = or;
  }

  const sortSpec: Record<string, 1 | -1> =
    sort === "oldest" ? { invoiceNumber: 1 }
    : sort === "amount_desc" ? { total: -1 }
    : sort === "amount_asc" ? { total: 1 }
    : sort === "due_asc" ? { dueDate: 1 }
    : { invoiceNumber: -1 };

  const total = await InvoiceModel.countDocuments(query);
  const invoices = await InvoiceModel.find(query)
    .sort(sortSpec)
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

  // Batch-load the receipts that settled the paid invoices.
  const paymentIds = Array.from(
    new Set(invoices.map((inv) => (inv as { paymentId?: string | null }).paymentId).filter(Boolean) as string[]),
  );
  const settlements = paymentIds.length
    ? await PaymentModel.find({ tenantId, id: { $in: paymentIds }, isVoided: false })
        .select("id receiptNumber")
        .lean()
    : [];
  const receiptByPaymentId = new Map(settlements.map((p) => [p.id, p.receiptNumber ?? null]));

  res.json(
    ListInvoicesResponse.parse({
      data: invoices.map((inv) =>
        plainInvoice({
          ...inv,
          clientName: clientNameById.get(inv.clientId) ?? "Unknown",
          caseNumber: inv.caseId ? (caseNumberById.get(inv.caseId) ?? null) : null,
          settledReceipt: inv.paymentId ? (receiptByPaymentId.get(inv.paymentId) ?? null) : null,
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

  if (data.dueDate < data.issueDate) {
    res.status(422).json({ error: "Due date cannot be before the issue date" });
    return;
  }

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
  const { priced, subtotal, taxAmount, total } = recalc(data.items, taxRate);
  const items = priced.map((item) => ({
    id: randomUUID(),
    description: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.amount,
  }));

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
    sentAt: null,
    paidAt: null,
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

// ── PATCH /invoices/:id ──────────────────────────────────────────────────────
router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = UpdateInvoiceParams.safeParse(req.params);
  const body = UpdateInvoiceBody.safeParse(req.body ?? {});
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const existing = await InvoiceModel.findOne({
    id: params.data.id,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  // A settled or voided invoice is a financial record — corrections belong in a
  // credit note, not a silent rewrite of the total.
  if (existing.status === "paid" || existing.status === "void") {
    res.status(409).json({
      error: `This invoice is ${existing.status} and can no longer be edited. Create a new invoice instead.`,
    });
    return;
  }

  const data = body.data;
  const $set: Record<string, unknown> = { updatedAt: new Date() };

  if (data.clientId !== undefined) {
    const client = await ClientModel.findOne({
      id: data.clientId,
      tenantId,
      isDeleted: { $ne: true },
    }).lean();
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    $set.clientId = data.clientId;
  }

  let caseNumber: number | null = null;
  if (data.caseId !== undefined) {
    if (data.caseId) {
      const caseItem = await CaseModel.findOne({ id: data.caseId, tenantId }).lean();
      if (!caseItem) {
        res.status(404).json({ error: "Case not found" });
        return;
      }
      caseNumber = caseItem.caseNumber;
    }
    $set.caseId = data.caseId || null;
  } else if (existing.caseId) {
    const caseItem = await CaseModel.findOne({ id: existing.caseId, tenantId })
      .select("caseNumber")
      .lean();
    caseNumber = caseItem?.caseNumber ?? null;
  }

  const issueDate = data.issueDate ?? existing.issueDate;
  const dueDate = data.dueDate ?? existing.dueDate;
  if (dueDate < issueDate) {
    res.status(422).json({ error: "Due date cannot be before the issue date" });
    return;
  }
  if (data.issueDate !== undefined) $set.issueDate = data.issueDate;
  if (data.dueDate !== undefined) $set.dueDate = data.dueDate;

  const taxRate = data.taxRate ?? Number(existing.taxRate);
  if (data.taxRate !== undefined) $set.taxRate = data.taxRate;

  if (data.items !== undefined) {
    const { priced, subtotal, taxAmount, total } = recalc(data.items, taxRate);
    $set.items = priced.map((item) => ({
      id: randomUUID(),
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
    }));
    $set.subtotal = subtotal;
    $set.taxAmount = taxAmount;
    $set.total = total;
  } else if (data.taxRate !== undefined) {
    // Tax changed but the lines did not — re-derive tax and total from the
    // stored line amounts so the invoice can never carry a stale total.
    const items = (existing.items ?? []).map((item: any) => ({
      description: String(item.description ?? ""),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    }));
    const { subtotal, taxAmount, total } = recalc(items, taxRate);
    $set.subtotal = subtotal;
    $set.taxAmount = taxAmount;
    $set.total = total;
  }

  if (data.notes !== undefined) $set.notes = data.notes?.trim() || null;

  const updated = await InvoiceModel.findOneAndUpdate(
    { id: params.data.id, tenantId },
    { $set },
    { new: true },
  ).lean();
  if (!updated) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(
    UpdateInvoiceResponse.parse(
      await withRelations(tenantId, updated, undefined),
    ),
  );
});

// ── POST /invoices/:id/send ──────────────────────────────────────────────────
router.post("/invoices/:id/send", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = SendInvoiceEmailParams.safeParse(req.params);
  const body = SendInvoiceEmailBody.safeParse(req.body ?? {});
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const invoice = await InvoiceModel.findOne({
    id: params.data.id,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (invoice.status === "void") {
    res.status(409).json({ error: "Voided invoices cannot be sent" });
    return;
  }
  if (invoice.status === "paid") {
    res.status(409).json({ error: "This invoice is already paid — nothing to send" });
    return;
  }

  const client = await ClientModel.findOne({
    id: invoice.clientId,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  // Reuse the client's existing portal link; only mint one when they have none,
  // so emailing an invoice never invalidates a link they already saved.
  let token = client.portalToken ?? null;
  if (!token) {
    token = randomToken();
    await ClientModel.updateOne({ id: client.id, tenantId }, { $set: { portalToken: token } });
  }
  const host = req.get("host") ?? "localhost";
  const proto = (req.get("x-forwarded-proto") ?? req.protocol ?? "http").split(",")[0].trim();
  const portalUrl = `${proto}://${host}/portal/${token}`;

  const to = body.data.email?.trim() || client.email || null;
  let emailed = false;
  let reason: string | null = null;

  if (!to) {
    reason = "no_client_email";
  } else if (!isEmailConfigured()) {
    reason = "not_configured";
  } else {
    const number = `INV-${String(invoice.invoiceNumber).padStart(4, "0")}`;
    const result = await sendEmail({
      to,
      subject: `${number} from Docketline — ${invoice.total.toFixed(2)} CAD due ${invoice.dueDate}`,
      text: `Hello ${client.fullName},\n\nInvoice ${number} for $${invoice.total.toFixed(2)} CAD is ready. Due date: ${invoice.dueDate}.\n\nView your file and documents here:\n${portalUrl}\n\nThis link is personal to you — please don't forward it.`,
      html: invoiceEmailHtml({
        clientName: client.fullName,
        invoiceNumber: number,
        total: invoice.total,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        items: invoice.items.map((item) => ({
          description: item.description,
          quantity: Number(item.quantity),
          amount: Number(item.amount),
        })),
        portalUrl,
      }),
    });
    emailed = result.ok;
    if (!result.ok) reason = result.reason;
  }

  // Sending flips a draft out of draft; it never rewinds a paid invoice.
  if (emailed && invoice.status === "draft") {
    await InvoiceModel.updateOne(
      { id: invoice.id, tenantId },
      { $set: { status: "sent", sentAt: todayStr(), updatedAt: new Date() } },
    );
  }

  res.json(
    SendInvoiceEmailResponse.parse({
      emailed,
      to,
      reason,
      portalUrl,
    }),
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
  res.json(GetInvoiceResponse.parse(await withRelations(tenantId, invoice)));
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

  const existing = await InvoiceModel.findOne({
    id: params.data.id,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const next = body.data.status;
  if (next === existing.status) {
    res.json(UpdateInvoiceStatusResponse.parse(await withRelations(tenantId, existing)));
    return;
  }
  // Void is terminal: a voided invoice cannot be quietly resurrected.
  if (existing.status === "void") {
    res.status(409).json({ error: "A voided invoice cannot change status" });
    return;
  }
  // Un-paying is legitimate (cheque bounced), but voiding a paid invoice is not:
  // the money was received, so it must be un-paid first.
  if (existing.status === "paid" && next === "void") {
    res.status(409).json({ error: "Un-mark this invoice as paid before voiding it" });
    return;
  }

  const $set: Record<string, unknown> = { status: next, updatedAt: new Date() };
  if (next === "paid") {
    // Settling an invoice is a cash event. When the invoice belongs to a case the
    // money has to reach that case ledger with a numbered receipt, otherwise the
    // invoice register and the day book tell two different stories.
    const label = `INV-${String(existing.invoiceNumber).padStart(4, "0")}`;
    let paymentId: string | null = (existing as { paymentId?: string | null }).paymentId ?? null;
    if (existing.caseId) {
      const alreadyRecorded = await PaymentModel.findOne({
        tenantId,
        caseId: existing.caseId,
        reference: label,
        isVoided: false,
        isRefund: false,
      }).lean();
      if (alreadyRecorded) {
        // The office booked the money on the case by hand first — link, don't double count.
        paymentId = alreadyRecorded.id;
      } else {
        // A receipt against a deleted matter would be invisible in the day book,
        // so it must never be raised.
        const caseDoc = await CaseModel.findOne({ id: existing.caseId, tenantId })
          .select("totalFee disbursements caseNumber isDeleted")
          .lean();
        if (!caseDoc || caseDoc.isDeleted) {
          res.status(409).json({
            error:
              "This invoice belongs to a matter that has been deleted, so the receipt would not appear in the books. " +
              "Re-attach the invoice to an active matter first.",
          });
          return;
        }
        const method = String(body.data.method ?? "").trim();
        const receivedBy = String(body.data.receivedBy ?? "").trim();
        if (!method) {
          res.status(422).json({ error: "Record how the money arrived — cash, cheque, e-transfer, card." });
          return;
        }
        if (!receivedBy) {
          res.status(422).json({ error: "Record who received the money." });
          return;
        }
        // If the case already holds more money than it owes, this cash is on the
        // books already — adding the invoice total would count it twice.
        const livePayments = await PaymentModel.find({ tenantId, caseId: existing.caseId, isVoided: false })
          .select("amount isVoided isRefund")
          .lean();
        const alreadyIn = caseTotals(caseDoc, livePayments);
        if (alreadyIn.creditBalance > 0.005) {
          res.status(409).json({
            error:
              `Case #${caseDoc.caseNumber ?? ""} already holds more money than it owes ` +
              `(${alreadyIn.creditBalance.toFixed(2)} in credit), so this invoice looks like it is on the books already. ` +
              `Put reference ${label} on the payment that paid it, or clear the credit before settling.`,
          });
          return;
        }
        const paidOn = (body.data.date ?? todayStr()).slice(0, 10);
        const receipt = await PaymentModel.create({
          id: randomUUID(),
          tenantId,
          caseId: existing.caseId,
          amount: Number(existing.total),
          date: paidOn,
          receiptNumber: await getNextReceiptNumber(tenantId, paidOn),
          method,
          reference: label,
          allocationType: "Final Payment",
          receivedBy,
          note: `Invoice ${label} settled`,
          isVoided: false,
          isRefund: false,
        });
        paymentId = receipt.id;
      }
    }
    $set.paidAt = body.data.date ? body.data.date.slice(0, 10) : todayStr();
    $set.paymentId = paymentId;
    if (!existing.sentAt) $set.sentAt = todayStr();
  } else {
    $set.paidAt = null;
    // Un-marking a paid invoice means the receipt must come out of the ledger too
    // — voided, never deleted, so the receipt number stays accounted for.
    const linked = (existing as { paymentId?: string | null }).paymentId;
    if (linked) {
      await PaymentModel.updateOne(
        { id: linked, tenantId, isVoided: false },
        {
          $set: {
            isVoided: true,
            voidedAt: new Date(),
            voidReason: "Invoice unmarked as paid",
            updatedAt: new Date(),
          },
        },
      );
      $set.paymentId = null;
    }
  }
  if (next === "sent" && !existing.sentAt) $set.sentAt = todayStr();

  const invoice = await InvoiceModel.findOneAndUpdate(
    { id: params.data.id, tenantId, isDeleted: { $ne: true } },
    { $set },
    { new: true },
  ).lean();
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(UpdateInvoiceStatusResponse.parse(await withRelations(tenantId, invoice)));
});

// ── DELETE /invoices/:id ─────────────────────────────────────────────────────
router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteInvoiceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await InvoiceModel.findOne({
    id: parsed.data.id,
    tenantId,
    isDeleted: { $ne: true },
  }).lean();
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  // Paid invoices are accounting records. Void first, then delete the mistake.
  if (existing.status === "paid") {
    res.status(409).json({ error: "Paid invoices cannot be deleted. Void the invoice first." });
    return;
  }
  await InvoiceModel.updateOne(
    { id: parsed.data.id, tenantId },
    { $set: { isDeleted: true, updatedAt: new Date() } },
  );
  res.sendStatus(204);
});

export default router;

