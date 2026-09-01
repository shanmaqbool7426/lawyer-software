import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  CreateCaseBody,
  CreateClientBody,
  CreateNoteBody,
  CreatePaymentBody,
  CreatePaymentParams,
  CreateNoteParams,
  DeleteCaseParams,
  GetCaseParams,
  GetDashboardResponse,
  GetReportsSummaryResponse,
  ListCasesQueryParams,
  ListCasesResponse,
  ListClientsQueryParams,
  ListClientsResponse,
  UpdateCaseBody,
  UpdateCaseParams,
  UpdateCaseResponse,
  CreateCaseResponse,
  CreateClientResponse,
  CreateNoteResponse,
  CreatePaymentResponse,
  GetCaseResponse,
  PreviewImportResponse,
  CommitImportResponse,
  PreviewImportBody,
  CommitImportBody,
} from "@workspace/api-zod";
import {
  casesTable,
  clientsTable,
  db,
  paymentsTable,
} from "@workspace/db";
import {
  addNote,
  CASE_STATUSES,
  CLOSED_STATUSES,
  createAuditNote,
  getCaseDetail,
  getCaseRows,
  getNextCaseNumber,
  seedTrafficData,
  toCase,
} from "../lib/traffic";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);

router.get("/dashboard", async (req, res): Promise<void> => {
  await seedTrafficData();
  const allCases = await getCaseRows();
  const active = allCases.filter((item) => !CLOSED_STATUSES.includes(item.status as (typeof CLOSED_STATUSES)[number]));
  const due = active.filter((item) => item.nextFollowUpDate && item.nextFollowUpDate <= today());
  const statusCounts = Object.fromEntries(
    CASE_STATUSES.map((status) => [status, allCases.filter((item) => item.status === status).length]),
  );
  const response = {
    activeCases: active.length,
    outstandingBalance: active.reduce((sum, item) => sum + item.balanceOwing, 0),
    dueFollowUps: due.length,
    attentionCases: due.sort((a, b) => (a.nextFollowUpDate ?? "").localeCompare(b.nextFollowUpDate ?? "")),
    statusCounts,
  };
  res.json(GetDashboardResponse.parse(response));
});

router.get("/clients", async (req, res): Promise<void> => {
  const parsed = ListClientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search;
  const clients = await db
    .select()
    .from(clientsTable)
    .where(search ? sql`${clientsTable.fullName} ILIKE ${`%${search}%`}` : undefined)
    .orderBy(clientsTable.fullName);
  res.json(ListClientsResponse.parse(clients.map((client) => ({
    id: client.id,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
    leadSourceChannel: client.leadSourceChannel,
    leadSourceDetail: client.leadSourceDetail,
    createdAt: client.createdAt,
  }))));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const [client] = await db.insert(clientsTable).values({
    id: randomUUID(),
    fullName: data.fullName,
    phone: data.phone || null,
    email: data.email || null,
    leadSourceChannel: data.leadSourceChannel,
    leadSourceDetail: data.leadSourceDetail || null,
  }).returning();
  res.status(201).json(CreateClientResponse.parse(client));
});

router.get("/cases", async (req, res): Promise<void> => {
  await seedTrafficData();
  const parsed = ListCasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const cases = await getCaseRows({
    ...parsed.data,
    dateFrom: parsed.data.dateFrom?.toISOString().slice(0, 10),
    dateTo: parsed.data.dateTo?.toISOString().slice(0, 10),
  });
  res.json(ListCasesResponse.parse(cases));
});

router.post("/cases", async (req, res): Promise<void> => {
  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const caseNumber = await getNextCaseNumber();
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, data.clientId));
  if (!client) {
    res.status(400).json({ error: "Client not found" });
    return;
  }
  const [newCase] = await db.insert(casesTable).values({
    id: randomUUID(),
    caseNumber,
    clientId: data.clientId,
    intakeDate: data.intakeDate.toISOString().slice(0, 10),
    offenceDate: data.offenceDate.toISOString().slice(0, 10),
    ticketNumber: data.ticketNumber || null,
    statuteCode: data.statuteCode || null,
    offenceDescription: data.offenceDescription || null,
    officeCode: data.officeCode || null,
    courtLocation: data.courtLocation || null,
    status: data.status || "Open",
    totalFee: String(data.totalFee),
    nextFollowUpDate: data.nextFollowUpDate ? data.nextFollowUpDate.toISOString().slice(0, 10) : null,
  }).returning();
  if (data.firstNote) await addNote(newCase.id, data.firstNote);
  const response = toCase({ ...newCase, clientName: client.fullName, phone: client.phone, email: client.email, leadSourceChannel: client.leadSourceChannel, leadSourceDetail: client.leadSourceDetail });
  res.status(201).json(CreateCaseResponse.parse(response));
});

router.get("/cases/:id", async (req, res): Promise<void> => {
  const parsed = GetCaseParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseDetail = await getCaseDetail(parsed.data.id);
  if (!caseDetail) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(GetCaseResponse.parse(caseDetail));
});

router.patch("/cases/:id", async (req, res): Promise<void> => {
  const params = UpdateCaseParams.safeParse(req.params);
  const parsed = UpdateCaseBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data;
  const [updated] = await db.update(casesTable).set({
    intakeDate: data.intakeDate ? data.intakeDate.toISOString().slice(0, 10) : undefined,
    offenceDate: data.offenceDate ? data.offenceDate.toISOString().slice(0, 10) : undefined,
    ticketNumber: data.ticketNumber,
    statuteCode: data.statuteCode,
    offenceDescription: data.offenceDescription,
    officeCode: data.officeCode,
    courtLocation: data.courtLocation,
    status: data.status,
    totalFee: data.totalFee === undefined ? undefined : String(data.totalFee),
    nextFollowUpDate: data.nextFollowUpDate === undefined
      ? undefined
      : data.nextFollowUpDate === null
        ? null
        : data.nextFollowUpDate.toISOString().slice(0, 10),
    updatedAt: new Date(),
  }).where(eq(casesTable.id, params.data.id)).returning();
  if (data.status && data.status !== existing.status) {
    await createAuditNote(existing.id, `Status changed from ${existing.status} to ${data.status}`);
  }
  const detail = await getCaseDetail(updated.id);
  res.json(UpdateCaseResponse.parse(detail));
});

router.delete("/cases/:id", async (req, res): Promise<void> => {
  const parsed = DeleteCaseParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db.update(casesTable).set({ isDeleted: true, updatedAt: new Date() }).where(eq(casesTable.id, parsed.data.id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/cases/:id/payments", async (req, res): Promise<void> => {
  const params = CreatePaymentParams.safeParse(req.params);
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [caseItem] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data;
  const [payment] = await db.insert(paymentsTable).values({
    id: randomUUID(),
    caseId: params.data.id,
    amount: String(data.amount),
    date: data.date.toISOString().slice(0, 10),
    method: data.method || null,
    note: data.note || null,
  }).returning();
  const response = { ...payment, amount: Number(payment.amount) };
  res.status(201).json(CreatePaymentResponse.parse(response));
});

router.post("/cases/:id/notes", async (req, res): Promise<void> => {
  const params = CreateNoteParams.safeParse(req.params);
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [caseItem] = await db.select().from(casesTable).where(eq(casesTable.id, params.data.id));
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const note = await addNote(params.data.id, parsed.data.text);
  res.status(201).json(CreateNoteResponse.parse(note));
});

router.get("/reports/summary", async (_req, res): Promise<void> => {
  await seedTrafficData();
  const cases = await getCaseRows();
  const clients = await db.select().from(clientsTable);
  const countBy = (values: string[]) => Array.from(new Set(values)).map((label) => ({ label, count: values.filter((value) => value === label).length }));
  const reports = {
    leadSources: countBy(clients.map((client) => client.leadSourceChannel)),
    referralBreakdown: countBy(clients.filter((client) => client.leadSourceChannel === "Referral").map((client) => client.leadSourceDetail || "Unspecified")),
    statusCounts: countBy(cases.map((item) => item.status)),
    outstandingCases: cases.filter((item) => item.balanceOwing > 0),
  };
  res.json(GetReportsSummaryResponse.parse(reports));
});

router.get("/reports/outstanding.csv", async (_req, res): Promise<void> => {
  const cases = await getCaseRows({ outstanding: true });
  const lines = [
    "Case Number,Client,Ticket Number,Status,Total Fee,Amount Received,Balance Owing",
    ...cases.map((item) => [item.caseNumber, item.clientName, item.ticketNumber ?? "", item.status, item.totalFee.toFixed(2), item.amountReceived.toFixed(2), item.balanceOwing.toFixed(2)]
      .map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(",")),
  ];
  res.type("text/csv").send(lines.join("\n"));
});

router.post("/imports/preview", async (req, res): Promise<void> => {
  const parsed = PreviewImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(PreviewImportResponse.parse({
    rowCount: parsed.data.rows.length,
    sample: parsed.data.rows.slice(0, 5),
  }));
});

router.post("/imports/commit", async (req, res): Promise<void> => {
  const parsed = CommitImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let imported = 0;
  for (const row of parsed.data.rows) {
    const name = row[parsed.data.mapping?.clientName ?? "client_name"]?.trim();
    if (!name) continue;
    const [existing] = await db.select().from(clientsTable).where(eq(clientsTable.fullName, name));
    const client = existing ?? (await db.insert(clientsTable).values({
      id: randomUUID(),
      fullName: name,
      leadSourceChannel: "Other",
      leadSourceDetail: "Legacy import",
    }).returning())[0];
    const [newCase] = await db.insert(casesTable).values({
      id: randomUUID(),
      caseNumber: await getNextCaseNumber(),
      clientId: client.id,
      intakeDate: row[parsed.data.mapping?.intakeDate ?? "intake_date"] || today(),
      offenceDate: row[parsed.data.mapping?.offenceDate ?? "offence_date"] || today(),
      ticketNumber: row[parsed.data.mapping?.ticketNumber ?? "ticket_number"] || null,
      statuteCode: row[parsed.data.mapping?.statuteCode ?? "statute_code"] || null,
      offenceDescription: row[parsed.data.mapping?.offenceDescription ?? "offence_description"] || null,
      officeCode: row[parsed.data.mapping?.officeCode ?? "office_code"] || null,
      status: "Open",
      totalFee: "0",
    }).returning();
    const rawNote = row[parsed.data.mapping?.rawNote ?? "notes"]?.trim();
    if (rawNote) await addNote(newCase.id, rawNote);
    imported++;
  }
  res.json(CommitImportResponse.parse({ imported, skipped: parsed.data.rows.length - imported }));
});

export default router;