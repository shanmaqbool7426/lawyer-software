import { randomUUID } from "node:crypto";
import {
  CaseModel,
  ClientModel,
  CourtDateModel,
  CounterModel,
  NoteModel,
  OrganizationModel,
  PaymentModel,
  SignatureRequestModel,
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
  tenantId: string;
  search?: string;
  status?: string;
  source?: string;
  clientId?: string;
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
  responseDeadline?: string | null;
  ticketNumber?: string | null;
  citationIssuingAgency?: string | null;
  officerName?: string | null;
  officerBadgeNumber?: string | null;
  statuteCode?: string | null;
  offenceDescription?: string | null;
  offenceLocation?: string | null;
  speedAlleged?: number | null;
  speedLimit?: number | null;
  speedUnit?: string | null;
  licencePlate?: string | null;
  licencePlateRegion?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  vehicleColour?: string | null;
  vehicleVIN?: string | null;
  driversLicenceNumber?: string | null;
  driversLicenceRegion?: string | null;
  driversLicenceExpiry?: string | null;
  courtFileNumber?: string | null;
  courtLocation?: string | null;
  courtRoomNumber?: string | null;
  courtJurisdiction?: string | null;
  officeCode?: string | null;
  hearingType?: string | null;
  partType?: string | null;
  totalFee: number | string;
  retainerAmount?: number | null;
  retainerPaidDate?: string | null;
  setFine?: number | null;
  victimSurcharge?: number | null;
  disbursements?: number | null;
  status: string;
  outcome?: string | null;
  reducedCharge?: string | null;
  courtFineAmount?: number | null;
  demeritPoints?: number | null;
  licenceSuspended?: boolean | null;
  suspensionDays?: number | null;
  closedDate?: string | null;
  nextFollowUpDate?: string | null;
  disclosureRequestedDate?: string | null;
  disclosureReceivedDate?: string | null;
  priority?: string | null;
  tags?: string[];
  assignedTo?: string | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  clientName: string;
  phone?: string | null;
  email?: string | null;
  leadSourceChannel: string;
  leadSourceDetail?: string | null;
};

type PaymentRow = {
  id: string;
  caseId: string;
  amount: number | string;
  date: string;
  method?: string | null;
  reference?: string | null;
  allocationType?: string | null;
  receivedBy?: string | null;
  note?: string | null;
  isVoided?: boolean;
  voidedAt?: Date | null;
  voidReason?: string | null;
  isRefund?: boolean;
  refundForId?: string | null;
  createdAt?: Date;
};

export function asNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

export function toPayment(payment: PaymentRow) {
  return {
    id:             payment.id,
    caseId:         payment.caseId,
    amount:         asNumber(payment.amount),
    date:           payment.date,
    method:         payment.method        ?? null,
    reference:      payment.reference     ?? null,
    allocationType: payment.allocationType ?? "General",
    receivedBy:     payment.receivedBy    ?? null,
    note:           payment.note          ?? null,
    isVoided:       Boolean(payment.isVoided),
    voidedAt:       payment.voidedAt      ?? null,
    voidReason:     payment.voidReason    ?? null,
    isRefund:       Boolean(payment.isRefund),
    refundForId:    payment.refundForId   ?? null,
    createdAt:      payment.createdAt     ?? null,
  };
}

export function toCase(row: CaseRow, payments: PaymentRow[] = []) {
  // Only count non-voided, non-refund payments toward received amount
  const activePayments = payments.filter((p) => !p.isVoided && !p.isRefund);
  const refundPayments = payments.filter((p) => !p.isVoided && p.isRefund);
  const amountReceived =
    activePayments.reduce((sum, p) => sum + asNumber(p.amount), 0) -
    refundPayments.reduce((sum, p) => sum + asNumber(p.amount), 0);
  const totalFee = asNumber(row.totalFee);
  const disbursements = asNumber(row.disbursements ?? 0);
  const totalOwed = totalFee + disbursements;
  return {
    id:           row.id,
    caseNumber:   row.caseNumber,
    clientId:     row.clientId,
    clientName:   row.clientName,
    phone:        row.phone,
    // Citation / Ticket
    ticketNumber:          row.ticketNumber,
    citationIssuingAgency: row.citationIssuingAgency ?? null,
    officerName:           row.officerName           ?? null,
    officerBadgeNumber:    row.officerBadgeNumber    ?? null,
    // Offence
    statuteCode:        row.statuteCode,
    offenceDescription: row.offenceDescription,
    offenceLocation:    row.offenceLocation     ?? null,
    speedAlleged:       row.speedAlleged        ?? null,
    speedLimit:         row.speedLimit          ?? null,
    speedUnit:          row.speedUnit           ?? "km/h",
    // Vehicle
    licencePlate:       row.licencePlate        ?? null,
    licencePlateRegion: row.licencePlateRegion  ?? null,
    vehicleMake:        row.vehicleMake         ?? null,
    vehicleModel:       row.vehicleModel        ?? null,
    vehicleYear:        row.vehicleYear         ?? null,
    vehicleColour:      row.vehicleColour       ?? null,
    vehicleVIN:         row.vehicleVIN          ?? null,
    // Driver
    driversLicenceNumber: row.driversLicenceNumber ?? null,
    driversLicenceRegion: row.driversLicenceRegion ?? null,
    driversLicenceExpiry: row.driversLicenceExpiry ?? null,
    // Court
    courtFileNumber:   row.courtFileNumber   ?? null,
    courtLocation:     row.courtLocation,
    courtRoomNumber:   row.courtRoomNumber   ?? null,
    courtJurisdiction: row.courtJurisdiction ?? null,
    officeCode:        row.officeCode,
    hearingType:       row.hearingType       ?? null,
    partType:          row.partType          ?? null,
    // Dates
    intakeDate:               row.intakeDate,
    offenceDate:              row.offenceDate,
    responseDeadline:         row.responseDeadline         ?? null,
    disclosureRequestedDate:  row.disclosureRequestedDate  ?? null,
    disclosureReceivedDate:   row.disclosureReceivedDate   ?? null,
    closedDate:               row.closedDate               ?? null,
    nextFollowUpDate:         row.nextFollowUpDate,
    // Financials
    totalFee,
    retainerAmount:  row.retainerAmount  ?? null,
    retainerPaidDate:row.retainerPaidDate ?? null,
    setFine:         row.setFine         ?? null,
    victimSurcharge: row.victimSurcharge ?? null,
    disbursements,
    amountReceived:  Math.round(amountReceived * 100) / 100,
    balanceOwing:    Math.max(Math.round((totalOwed - amountReceived) * 100) / 100, 0),
    isFullyPaid:     amountReceived >= totalOwed,
    // Outcome
    status:           row.status,
    outcome:          row.outcome          ?? null,
    reducedCharge:    row.reducedCharge    ?? null,
    courtFineAmount:  row.courtFineAmount  ?? null,
    demeritPoints:    row.demeritPoints    ?? null,
    licenceSuspended: row.licenceSuspended ?? null,
    suspensionDays:   row.suspensionDays   ?? null,
    // Workflow
    priority:   row.priority   ?? "Normal",
    tags:       row.tags       ?? [],
    assignedTo: row.assignedTo ?? null,
    createdAt:  row.createdAt,
    updatedAt:  row.updatedAt,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getPaymentMap(tenantId: string) {
  const payments = await PaymentModel.find({ tenantId }).lean();
  const map = new Map<string, PaymentRow[]>();
  for (const payment of payments) {
    const existing = map.get(payment.caseId) ?? [];
    existing.push(payment);
    map.set(payment.caseId, existing);
  }
  return map;
}

export async function getCaseRows(filters: CaseListFilters) {
  const { search, tenantId } = filters;

  const sourceClientIds = filters.source
    ? (
        await ClientModel.find({ tenantId, leadSourceChannel: filters.source })
          .select("id")
          .lean()
      ).map((client) => client.id)
    : null;

  const nameMatchIds = search
    ? (
        await ClientModel.find({
          tenantId,
          $or: [
            { fullName: { $regex: escapeRegExp(search), $options: "i" } },
            { phone: { $regex: escapeRegExp(search), $options: "i" } },
            { email: { $regex: escapeRegExp(search), $options: "i" } },
          ],
        })
          .select("id")
          .lean()
      ).map((client) => client.id)
    : null;

  const caseQ: Record<string, unknown> = { tenantId, isDeleted: false };
  if (filters.status) caseQ.status = filters.status;
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, unknown> = {};
    if (filters.dateFrom) range.$gte = filters.dateFrom;
    if (filters.dateTo) range.$lte = filters.dateTo;
    caseQ.intakeDate = range;
  }
  if (sourceClientIds) caseQ.clientId = { $in: sourceClientIds };
  if (filters.clientId) caseQ.clientId = filters.clientId;
  if (search) {
    const caseRegex = new RegExp(escapeRegExp(search), "i");
    const ors: Record<string, unknown>[] = [];
    if (nameMatchIds?.length) {
      ors.push({ clientId: { $in: nameMatchIds } });
    }
    ors.push({
      $or: [
        { ticketNumber: caseRegex },
        { statuteCode: caseRegex },
        { offenceDescription: caseRegex },
        { licencePlate: caseRegex },
        { courtFileNumber: caseRegex },
        { driversLicenceNumber: caseRegex },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$caseNumber" },
              regex: search,
              options: "i",
            },
          },
        },
      ],
    });
    caseQ.$and = [{ $or: ors }];
  }

  const rows = await CaseModel.find(caseQ).sort({ caseNumber: -1 }).lean();
  const clientIds = Array.from(new Set(rows.map((row) => row.clientId)));
  const clients = await ClientModel.find({ tenantId, id: { $in: clientIds } }).lean();
  const clientById = new Map(clients.map((client) => [client.id, client]));

  const paymentMap = await getPaymentMap(tenantId);
  const result = rows.map((row) => {
    const client = clientById.get(row.clientId);
    return toCase(
      {
        ...row,
        clientName: client?.fullName ?? "Unknown",
        phone: client?.phone ?? null,
        email: client?.email ?? null,
        leadSourceChannel: client?.leadSourceChannel ?? "Other",
        leadSourceDetail: client?.leadSourceDetail ?? null,
      },
      paymentMap.get(row.id),
    );
  });
  return filters.outstanding ? result.filter((item) => item.balanceOwing > 0) : result;
}

export async function getCaseDetail(tenantId: string, id: string) {
  const rows = await getCaseRows({ tenantId });
  const caseItem = rows.find((item) => item.id === id);
  if (!caseItem) return null;

  const [notes, courtDates, payments] = await Promise.all([
    NoteModel.find({ tenantId, caseId: id }).sort({ createdAt: -1 }).lean(),
    CourtDateModel.find({ tenantId, caseId: id }).sort({ date: -1 }).lean(),
    PaymentModel.find({ tenantId, caseId: id }).sort({ date: -1 }).lean(),
  ]);
  return {
    ...caseItem,
    notes: notes.map((note) => ({
      id: note.id,
      text: note.text,
      author: note.author,
      clientVisible: note.clientVisible ?? false,
      createdAt: note.createdAt,
    })),
    courtDates: courtDates.map((courtDate) => ({
      id: courtDate.id,
      date: courtDate.date,
      outcome: courtDate.outcome,
      notes: courtDate.notes ?? null,
    })),
    payments: payments.map(toPayment),
  };
}

export async function addNote(
  tenantId: string,
  caseId: string,
  text: string,
  author = "Admin",
  clientVisible = false,
) {
  const note = await NoteModel.create({
    id: randomUUID(),
    tenantId,
    caseId,
    text,
    author,
    clientVisible,
  });
  return {
    id: note.id,
    text: note.text,
    author: note.author,
    clientVisible: note.clientVisible ?? false,
    createdAt: note.createdAt,
  };
}

export async function getNextCaseNumber(tenantId: string) {
  const counter = await CounterModel.findOneAndUpdate(
    { key: `caseNumber:${tenantId}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true },
  ).lean();
  return counter!.value;
}

export async function createAuditNote(tenantId: string, caseId: string, text: string) {
  await addNote(tenantId, caseId, text);
}

const daysBetween = (dateStr: string): number =>
  Math.round((new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);

export type NotificationFeedItem = {
  kind: "court-date" | "follow-up" | "outstanding" | "signature";
  caseId: string;
  caseNumber: number;
  clientName: string;
  title: string;
  detail?: string | null;
  date?: string | null;
  days: number;
};

/**
 * In-app reminder feed (no email/SMS): court dates in the next two weeks or
 * recently missed, due follow-ups, balances outstanding on stale files and
 * signature requests still waiting.
 */
export async function getNotificationFeed(tenantId: string) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekBack = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const fortnightAhead = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const staleBefore = new Date(Date.now() - 30 * 86400000);

  const items: NotificationFeedItem[] = [];
  const rows = await getCaseRows({ tenantId });
  const caseById = new Map(rows.map((row) => [row.id, row]));

  // Court dates: missed in the last 7 days through the next 14 days.
  const courtDates = await CourtDateModel.find({
    tenantId,
    date: { $gte: weekBack, $lte: fortnightAhead },
  })
    .sort({ date: 1 })
    .lean();
  for (const courtDate of courtDates) {
    const row = caseById.get(courtDate.caseId);
    if (!row) continue;
    items.push({
      kind: "court-date",
      caseId: row.id,
      caseNumber: row.caseNumber,
      clientName: row.clientName,
      title: "Court appearance",
      detail: courtDate.outcome || courtDate.notes || null,
      date: courtDate.date,
      days: daysBetween(courtDate.date),
    });
  }

  // Follow-ups due or overdue on open files.
  for (const row of rows) {
    if (CLOSED_STATUSES.includes(row.status as (typeof CLOSED_STATUSES)[number])) continue;
    if (!row.nextFollowUpDate || row.nextFollowUpDate > todayStr) continue;
    items.push({
      kind: "follow-up",
      caseId: row.id,
      caseNumber: row.caseNumber,
      clientName: row.clientName,
      title: "Follow-up due",
      detail: row.nextFollowUpDate < todayStr ? "Overdue follow-up" : "Due today",
      date: row.nextFollowUpDate,
      days: daysBetween(row.nextFollowUpDate),
    });
  }

  // Balances still owing on files untouched for 30+ days.
  for (const row of rows) {
    if (row.balanceOwing <= 0) continue;
    if (new Date(row.updatedAt) > staleBefore) continue;
    items.push({
      kind: "outstanding",
      caseId: row.id,
      caseNumber: row.caseNumber,
      clientName: row.clientName,
      title: "Outstanding balance",
      detail: `Unchanged for ${Math.abs(daysBetween(row.updatedAt.toISOString().slice(0, 10)))} days`,
      date: null,
      days: daysBetween(row.updatedAt.toISOString().slice(0, 10)),
    });
  }

  // Signature requests still pending.
  const pending = await SignatureRequestModel.find({ tenantId, status: "pending" })
    .sort({ createdAt: 1 })
    .lean();
  for (const request of pending) {
    const row = caseById.get(request.caseId);
    if (!row) continue;
    items.push({
      kind: "signature",
      caseId: row.id,
      caseNumber: row.caseNumber,
      clientName: row.clientName,
      title: "Awaiting signature",
      detail: request.title,
      date: null,
      days: daysBetween(request.createdAt.toISOString().slice(0, 10)),
    });
  }

  items.sort((a, b) => a.days - b.days);
  return { items, total: items.length };
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

const icsDate = (dateStr: string): string => dateStr.replaceAll("-", "");

/**
 * Subscribable ICS feed of court dates and follow-ups for a workspace —
 * works with Google Calendar, Outlook and Apple Calendar without OAuth.
 */
export async function buildWorkspaceCalendar(tenantId: string): Promise<string> {
  const [org, courtDates, cases, clients] = await Promise.all([
    OrganizationModel.findOne({ id: tenantId }).lean(),
    CourtDateModel.find({ tenantId }).lean(),
    CaseModel.find({ tenantId, isDeleted: false }).lean(),
    ClientModel.find({ tenantId }).lean(),
  ]);
  const caseById = new Map(cases.map((row) => [row.id, row]));
  const clientNameById = new Map(clients.map((client) => [client.id, client.fullName]));
  const clientNameOf = (clientId: string) => clientNameById.get(clientId) ?? "Unknown";

  type Event = { uid: string; date: string; summary: string; description: string };
  const events: Event[] = [];
  for (const courtDate of courtDates) {
    const row = caseById.get(courtDate.caseId);
    if (!row) continue;
    events.push({
      uid: `court-${courtDate.id}`,
      date: courtDate.date,
      summary: `Court date — case #${row.caseNumber}`,
      description: `Client: ${clientNameOf(row.clientId)}${courtDate.outcome ? `; outcome: ${courtDate.outcome}` : ""}`,
    });
  }
  for (const row of cases) {
    if (!row.nextFollowUpDate) continue;
    events.push({
      uid: `followup-${row.id}-${row.nextFollowUpDate}`,
      date: row.nextFollowUpDate,
      summary: `Follow-up — case #${row.caseNumber}`,
      description: `Client: ${clientNameOf(row.clientId)}`,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").replaceAll(/\.\d{3}/g, "");
  const endOf = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10).replaceAll("-", "");
  };

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Docketline//Traffic Case Desk//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(`Docketline — ${org?.name ?? "Workspace"}`)}`,
  ];
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}@docketline`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
      `DTEND;VALUE=DATE:${endOf(event.date)}`,
      `SUMMARY:${icsEscape(event.summary)}`,
      `DESCRIPTION:${icsEscape(event.description)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}