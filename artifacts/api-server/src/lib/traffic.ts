import { and, desc, eq, ilike, max, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  casesTable,
  clientsTable,
  courtDatesTable,
  db,
  notesTable,
  paymentsTable,
} from "@workspace/db";

export const CASE_STATUSES = [
  "Open",
  "Disclosure Requested",
  "Filed",
  "Resummoned",
  "Awaiting Trial",
  "Withdrawn",
  "Resolved",
  "Closed",
] as const;

export const CLOSED_STATUSES = ["Withdrawn", "Resolved", "Closed"] as const;

export type CaseListFilters = {
  search?: string;
  status?: string;
  source?: string;
  outstanding?: boolean;
  dateFrom?: string;
  dateTo?: string;
};

type CaseRow = {
  id: string;
  caseNumber: number;
  clientId: string;
  intakeDate: string;
  offenceDate: string;
  ticketNumber: string | null;
  statuteCode: string | null;
  offenceDescription: string | null;
  officeCode: string | null;
  courtLocation: string | null;
  status: string;
  totalFee: string;
  nextFollowUpDate: string | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  clientName: string;
  phone: string | null;
  email: string | null;
  leadSourceChannel: string;
  leadSourceDetail: string | null;
};

type PaymentRow = typeof paymentsTable.$inferSelect;

export function asNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

export function toPayment(payment: PaymentRow) {
  return {
    id: payment.id,
    caseId: payment.caseId,
    amount: asNumber(payment.amount),
    date: payment.date,
    method: payment.method,
    note: payment.note,
  };
}

export function toCase(row: CaseRow, payments: PaymentRow[] = []) {
  const amountReceived = payments.reduce((sum, payment) => sum + asNumber(payment.amount), 0);
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    clientId: row.clientId,
    clientName: row.clientName,
    phone: row.phone,
    ticketNumber: row.ticketNumber,
    statuteCode: row.statuteCode,
    offenceDescription: row.offenceDescription,
    officeCode: row.officeCode,
    courtLocation: row.courtLocation,
    intakeDate: row.intakeDate,
    offenceDate: row.offenceDate,
    status: row.status,
    totalFee: asNumber(row.totalFee),
    amountReceived,
    balanceOwing: Math.max(asNumber(row.totalFee) - amountReceived, 0),
    nextFollowUpDate: row.nextFollowUpDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getPaymentMap() {
  const payments = await db.select().from(paymentsTable);
  const map = new Map<string, PaymentRow[]>();
  for (const payment of payments) {
    const existing = map.get(payment.caseId) ?? [];
    existing.push(payment);
    map.set(payment.caseId, existing);
  }
  return map;
}

export async function getCaseRows(filters: CaseListFilters = {}) {
  const conditions = [eq(casesTable.isDeleted, false)];
  if (filters.status) conditions.push(eq(casesTable.status, filters.status));
  if (filters.source) conditions.push(eq(clientsTable.leadSourceChannel, filters.source));
  if (filters.dateFrom) conditions.push(sql`${casesTable.intakeDate} >= ${filters.dateFrom}`);
  if (filters.dateTo) conditions.push(sql`${casesTable.intakeDate} <= ${filters.dateTo}`);
  if (filters.search) {
    const search = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(clientsTable.fullName, search),
        ilike(casesTable.ticketNumber, search),
        ilike(casesTable.statuteCode, search),
        ilike(casesTable.offenceDescription, search),
        sql`${casesTable.caseNumber}::text ILIKE ${search}`,
      )!,
    );
  }

  const rows = await db
    .select({
      id: casesTable.id,
      caseNumber: casesTable.caseNumber,
      clientId: casesTable.clientId,
      intakeDate: casesTable.intakeDate,
      offenceDate: casesTable.offenceDate,
      ticketNumber: casesTable.ticketNumber,
      statuteCode: casesTable.statuteCode,
      offenceDescription: casesTable.offenceDescription,
      officeCode: casesTable.officeCode,
      courtLocation: casesTable.courtLocation,
      status: casesTable.status,
      totalFee: casesTable.totalFee,
      nextFollowUpDate: casesTable.nextFollowUpDate,
      isDeleted: casesTable.isDeleted,
      createdAt: casesTable.createdAt,
      updatedAt: casesTable.updatedAt,
      clientName: clientsTable.fullName,
      phone: clientsTable.phone,
      email: clientsTable.email,
      leadSourceChannel: clientsTable.leadSourceChannel,
      leadSourceDetail: clientsTable.leadSourceDetail,
    })
    .from(casesTable)
    .innerJoin(clientsTable, eq(casesTable.clientId, clientsTable.id))
    .where(and(...conditions))
    .orderBy(desc(casesTable.caseNumber));

  const paymentMap = await getPaymentMap();
  const result = rows.map((row) => toCase(row, paymentMap.get(row.id)));
  return filters.outstanding ? result.filter((item) => item.balanceOwing > 0) : result;
}

export async function getCaseDetail(id: string) {
  const rows = await getCaseRows();
  const caseItem = rows.find((item) => item.id === id);
  if (!caseItem) return null;

  const [notes, courtDates, payments] = await Promise.all([
    db.select().from(notesTable).where(eq(notesTable.caseId, id)).orderBy(desc(notesTable.createdAt)),
    db.select().from(courtDatesTable).where(eq(courtDatesTable.caseId, id)).orderBy(desc(courtDatesTable.date)),
    db.select().from(paymentsTable).where(eq(paymentsTable.caseId, id)).orderBy(desc(paymentsTable.date)),
  ]);
  return {
    ...caseItem,
    notes: notes.map((note) => ({
      id: note.id,
      text: note.text,
      author: note.author,
      createdAt: note.createdAt,
    })),
    courtDates: courtDates.map((courtDate) => ({
      id: courtDate.id,
      date: courtDate.date,
      outcome: courtDate.outcome,
    })),
    payments: payments.map(toPayment),
  };
}

export async function addNote(caseId: string, text: string, author = "Admin") {
  const [note] = await db
    .insert(notesTable)
    .values({ id: randomUUID(), caseId, text, author })
    .returning();
  return { id: note.id, text: note.text, author: note.author, createdAt: note.createdAt };
}

export async function getNextCaseNumber() {
  const [result] = await db.select({ maxCaseNumber: max(casesTable.caseNumber) }).from(casesTable);
  return (result?.maxCaseNumber ?? 0) + 1;
}

export async function createAuditNote(caseId: string, text: string) {
  await addNote(caseId, text);
}

export async function seedTrafficData() {
  const existing = await db.select({ id: casesTable.id }).from(casesTable).limit(1);
  if (existing.length > 0) return;

  const clientId = randomUUID();
  const secondClientId = randomUUID();
  await db.insert(clientsTable).values([
    {
      id: clientId,
      fullName: "Rishad Sahibi",
      phone: "416-555-0142",
      email: "rishad@example.com",
      leadSourceChannel: "Referral",
      leadSourceDetail: "Brother of Rizwan",
    },
    {
      id: secondClientId,
      fullName: "Nadia Kaur",
      phone: "647-555-0189",
      email: "nadia@example.com",
      leadSourceChannel: "Google Search",
      leadSourceDetail: "HTA defence search",
    },
  ]);

  const firstNumber = await getNextCaseNumber();
  const [firstCase, secondCase] = await db
    .insert(casesTable)
    .values([
      {
        id: randomUUID(),
        caseNumber: firstNumber,
        clientId,
        intakeDate: "2026-05-13",
        offenceDate: "2026-04-28",
        ticketNumber: "8725013Z",
        statuteCode: "HTA 128",
        offenceDescription: "Speeding — 28 km/h over limit",
        officeCode: "4862",
        courtLocation: "Toronto East",
        status: "Resummoned",
        totalFee: "425",
        nextFollowUpDate: "2026-09-02",
      },
      {
        id: randomUUID(),
        caseNumber: firstNumber + 1,
        clientId: secondClientId,
        intakeDate: "2026-06-21",
        offenceDate: "2026-06-18",
        ticketNumber: "9154027K",
        statuteCode: "HTA 144",
        offenceDescription: "Fail to stop at stop sign",
        officeCode: "4863",
        courtLocation: "Brampton",
        status: "Disclosure Requested",
        totalFee: "350",
        nextFollowUpDate: "2026-08-28",
      },
    ])
    .returning();

  await db.insert(paymentsTable).values({
    id: randomUUID(),
    caseId: firstCase.id,
    amount: "200",
    date: "2026-05-15",
    method: "E-transfer",
    note: "Initial retainer",
  });
  await db.insert(notesTable).values([
    {
      id: randomUUID(),
      caseId: firstCase.id,
      text: "Client retained the firm. Court advised this file will be resummoned.",
      author: "Admin",
    },
    {
      id: randomUUID(),
      caseId: secondCase.id,
      text: "Disclosure request sent to prosecutor's office.",
      author: "Admin",
    },
  ]);
}