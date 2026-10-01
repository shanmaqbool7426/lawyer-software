import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  CreateCaseBody,
  CreateClientBody,
  CreateCourtDateBody,
  CreateCourtDateParams,
  CreateCourtDateResponse,
  CreateDocumentBody,
  CreateDocumentParams,
  CreateDocumentResponse,
  CreateNoteBody,
  CreatePaymentBody,
  CreatePaymentParams,
  CreateNoteParams,
  DeleteCaseParams,
  DeleteClientParams,
  DeleteCourtDateParams,
  DeleteDocumentParams,
  DeleteNoteParams,
  GetCaseParams,
  GetClientParams,
  GetClientResponse,
  GetDashboardResponse,
  GetDocumentParams,
  GetDocumentResponse,
  GetReportsSummaryResponse,
  ListCaseDocumentsParams,
  ListCaseDocumentsResponse,
  ListCasesQueryParams,
  ListCasesResponse,
  ListClientsQueryParams,
  ListClientsResponse,
  UpdateCaseBody,
  UpdateCaseParams,
  UpdateCaseResponse,
  UpdateClientBody,
  UpdateClientParams,
  UpdateClientResponse,
  UpdateNoteBody,
  UpdateNoteParams,
  UpdateNoteResponse,
  CreateCaseResponse,
  CreateClientResponse,
  CreateNoteResponse,
  CreatePaymentResponse,
  GetCaseResponse,
  PreviewImportResponse,
  CommitImportResponse,
  PreviewImportBody,
  CommitImportBody,
  ListWorkspacesResponse,
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  GetNotificationsResponse,
  GetCalendarFeedResponse,
  RegenerateCalendarFeedResponse,
  GetCalendarFeedFileParams,
  CreatePortalLinkParams,
  CreatePortalLinkResponse,
  RevokePortalLinkParams,
  ListTrustEntriesParams,
  ListTrustEntriesResponse,
  CreateTrustEntryParams,
  CreateTrustEntryBody,
  CreateTrustEntryResponse,
  DeleteTrustEntryParams,
  ListSignatureRequestsParams,
  ListSignatureRequestsResponse,
  CreateSignatureRequestParams,
  CreateSignatureRequestBody,
  CreateSignatureRequestResponse,
  DeleteSignatureRequestParams,
  GetPortalViewParams,
  GetPortalViewResponse,
  DownloadPortalDocumentParams,
  DownloadPortalDocumentResponse,
  GetSignatureRequestParams,
  GetSignatureRequestResponse,
  SignSignatureRequestParams,
  SignSignatureRequestBody,
} from "@workspace/api-zod";
import {
  ClientModel,
  CaseModel,
  CourtDateModel,
  DocumentModel,
  NoteModel,
  OrganizationModel,
  PaymentModel,
  SignatureRequestModel,
  TrustEntryModel,
} from "@workspace/db";
import {
  addNote,
  buildWorkspaceCalendar,
  CASE_STATUSES,
  CLOSED_STATUSES,
  createAuditNote,
  getCaseDetail,
  getCaseRows,
  getNextCaseNumber,
  getNotificationFeed,
  toCase,
} from "../lib/traffic";
import { getDefaultOrganization, randomToken } from "../lib/tenancy";

const router: IRouter = Router();
// Token-authenticated routes mounted without the Clerk/userId guard.
const publicRouter: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const tenantOf = (res: { locals: Record<string, unknown> }): string => String(res.locals.tenantId ?? "");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// Zod coerce.date() yields Date objects; case date columns are stored as "YYYY-MM-DD" strings
function toDayString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  const match = cleaned.match(/^-?(\d+(?:\.\d{1,2})?)$/);
  return match ? Number(match[1]) : null;
}

function parseStatusFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(w\/d|withdrawn)\b/.test(lower)) return "Withdrawn";
  if (/\b(resolved|settled|reduced|plea)\b/.test(lower)) return "Resolved";
  if (/\b(closed?)\b/.test(lower)) return "Closed";
  if (/\bfiled\b/.test(lower)) return "Filed";
  if (/\bresummon(ed)?\b/.test(lower)) return "Resummoned";
  if (/\bdisclosure\b/.test(lower)) return "Disclosure Requested";
  if (/\b(awaiting|waiting for).{0,25}(trial|court)\b/.test(lower)) return "Awaiting Trial";
  return null;
}

function parseLegacyPayments(text: string): Array<{ amount: number; note: string }> {
  const payments: Array<{ amount: number; note: string }> = [];
  if (!text) return payments;
  const regex = /\b(pd|paid|received|pmt|payment)\s*[$]?\s*(\d+(?:\.\d{1,2})?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    payments.push({ amount: Number(match[2]), note: `Extracted from legacy note: "${match[0]}"` });
  }
  return payments;
}

function getColumn(
  row: Record<string, string>,
  mapping: Record<string, string> | undefined,
  key: string,
  defaults: string[],
): string | undefined {
  const mapped = mapping?.[key]?.trim();
  if (mapped) {
    const value = row[mapped];
    if (value !== undefined) return value.trim();
  }
  for (const def of defaults) {
    if (def in row) return row[def].trim();
  }
  return undefined;
}

function isValidStatus(status: string): status is (typeof CASE_STATUSES)[number] {
  return CASE_STATUSES.includes(status as (typeof CASE_STATUSES)[number]);
}

function plainClient(client: {
  id: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  leadSourceChannel: string;
  leadSourceDetail?: string | null;
  portalToken?: string | null;
  createdAt: Date;
}) {
  return {
    id: client.id,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
    leadSourceChannel: client.leadSourceChannel,
    leadSourceDetail: client.leadSourceDetail,
    portalToken: client.portalToken ?? null,
    createdAt: client.createdAt,
  };
}

router.get("/dashboard", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const allCases = await getCaseRows({ tenantId });
  const active = allCases.filter((item) => !CLOSED_STATUSES.includes(item.status as (typeof CLOSED_STATUSES)[number]));
  const closed = allCases.filter((item) => CLOSED_STATUSES.includes(item.status as (typeof CLOSED_STATUSES)[number]));
  const due = active.filter((item) => item.nextFollowUpDate && item.nextFollowUpDate <= today());
  const statusCounts = Object.fromEntries(
    CASE_STATUSES.map((status) => [status, allCases.filter((item) => item.status === status).length]),
  );
  const recentPayments = await PaymentModel.find({ tenantId })
    .sort({ date: -1 })
    .limit(5)
    .lean();

  // Upcoming court dates within the next 7 days (inclusive of today)
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const upcomingCourtDates = await CourtDateModel.find({
    tenantId,
    date: { $gte: today(), $lte: weekAhead },
  })
    .sort({ date: 1 })
    .lean();
  const courtCaseIds = Array.from(new Set(upcomingCourtDates.map((cd) => cd.caseId)));
  const courtCases = courtCaseIds.length
    ? await CaseModel.find({ tenantId, id: { $in: courtCaseIds }, isDeleted: false }).lean()
    : [];
  const courtClientIds = Array.from(new Set(courtCases.map((c) => c.clientId)));
  const courtClients = courtClientIds.length
    ? await ClientModel.find({ tenantId, id: { $in: courtClientIds } }).lean()
    : [];
  const courtCaseById = new Map(courtCases.map((c) => [c.id, c]));
  const courtClientById = new Map(courtClients.map((c) => [c.id, c]));
  const courtDateFeed = upcomingCourtDates
    .flatMap((cd) => {
      const caseItem = courtCaseById.get(cd.caseId);
      if (!caseItem) return [];
      return [{
        caseId: cd.caseId,
        caseNumber: caseItem.caseNumber,
        clientName: courtClientById.get(caseItem.clientId)?.fullName ?? "Unknown",
        date: cd.date,
        outcome: cd.outcome ?? null,
      }];
    });

  const response = {
    activeCases: active.length,
    closedCases: closed.length,
    totalFees: active.reduce((sum, item) => sum + Number(item.totalFee), 0),
    totalCollected: active.reduce((sum, item) => sum + Number(item.amountReceived), 0),
    outstandingBalance: active.reduce((sum, item) => sum + Number(item.balanceOwing), 0),
    dueFollowUps: due.length,
    attentionCases: due.sort((a, b) => (a.nextFollowUpDate ?? "").localeCompare(b.nextFollowUpDate ?? "")),
    recentPayments: recentPayments.map((p) => ({
      id: p.id,
      caseId: p.caseId,
      amount: Number(p.amount),
      date: p.date,
      method: p.method ?? null,
      note: p.note ?? null,
    })),
    courtDates: courtDateFeed,
    statusCounts,
  };
  res.json(GetDashboardResponse.parse(response));
});

router.get("/clients", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListClientsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search;
  // $ne: true also matches documents written before the isDeleted field existed
  const query: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (search) {
    const rx = { $regex: escapeRegExp(search), $options: "i" };
    query.$or = [{ fullName: rx }, { phone: rx }, { email: rx }];
  }

  const page = Math.max(1, Math.floor(parsed.data.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(parsed.data.limit ?? 20)));
  const total = await ClientModel.countDocuments(query);
  const clients = await ClientModel.find(query)
    .sort({ fullName: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json(
    ListClientsResponse.parse({
      data: clients.map(plainClient),
      total,
      page,
      pageSize: limit,
    }),
  );
});

router.post("/clients", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const client = await ClientModel.create({
    id: randomUUID(),
    tenantId,
    fullName: data.fullName,
    phone: data.phone || null,
    email: data.email || null,
    leadSourceChannel: data.leadSourceChannel,
    leadSourceDetail: data.leadSourceDetail || null,
  });
  res.status(201).json(CreateClientResponse.parse(plainClient(client.toObject() as any)));
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetClientParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const client = await ClientModel.findOne({ id: parsed.data.id, tenantId, isDeleted: { $ne: true } }).lean();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(GetClientResponse.parse(plainClient(client)));
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = UpdateClientParams.safeParse(req.params);
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await ClientModel.findOne({ id: params.data.id, tenantId, isDeleted: { $ne: true } }).lean();
  if (!existing) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const data = parsed.data;
  const updated = await ClientModel.findOneAndUpdate(
    { id: params.data.id, tenantId },
    {
      $set: {
        fullName: data.fullName === undefined ? existing.fullName : data.fullName,
        phone: data.phone === undefined ? existing.phone : data.phone || null,
        email: data.email === undefined ? existing.email : data.email || null,
        leadSourceChannel: data.leadSourceChannel === undefined ? existing.leadSourceChannel : data.leadSourceChannel,
        leadSourceDetail: data.leadSourceDetail === undefined ? existing.leadSourceDetail : data.leadSourceDetail || null,
      },
    },
    { new: true },
  ).lean();
  if (!updated) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(UpdateClientResponse.parse(plainClient(updated)));
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteClientParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await ClientModel.findOne({ id: parsed.data.id, tenantId, isDeleted: { $ne: true } }).lean();
  if (!existing) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const activeCases = await CaseModel.countDocuments({ tenantId, clientId: parsed.data.id, isDeleted: false });
  if (activeCases > 0) {
    res.status(409).json({ error: "Client still has active cases. Delete or close their cases first." });
    return;
  }
  await ClientModel.updateOne({ id: parsed.data.id, tenantId }, { $set: { isDeleted: true } });
  res.sendStatus(204);
});

router.get("/cases", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListCasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { page: rawPage, limit: rawLimit, dateFrom, dateTo, ...caseFilters } = parsed.data;
  const page = Math.max(1, Math.floor(rawPage ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(rawLimit ?? 20)));

  const allCases = await getCaseRows({
    ...caseFilters,
    tenantId,
    dateFrom: dateFrom?.toISOString().slice(0, 10),
    dateTo: dateTo?.toISOString().slice(0, 10),
  });
  const total = allCases.length;
  const start = (page - 1) * limit;
  const pagedCases = allCases.slice(start, start + limit);

  res.json(
    ListCasesResponse.parse({
      data: pagedCases,
      total,
      page,
      pageSize: limit,
    }),
  );
});

router.post("/cases", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CreateCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const caseNumber = await getNextCaseNumber(tenantId);
  const client = await ClientModel.findOne({ id: data.clientId, tenantId }).lean();
  if (!client) {
    res.status(400).json({ error: "Client not found" });
    return;
  }
  const d = data as any;
  const newCase = await CaseModel.create({
    id:          randomUUID(),
    tenantId,
    caseNumber,
    clientId:    data.clientId,
    intakeDate:  data.intakeDate.toISOString().slice(0, 10),
    offenceDate: data.offenceDate.toISOString().slice(0, 10),
    responseDeadline: toDayString(d.responseDeadline),
    // Citation
    ticketNumber:          d.ticketNumber          || null,
    citationIssuingAgency: d.citationIssuingAgency || null,
    officerName:           d.officerName           || null,
    officerBadgeNumber:    d.officerBadgeNumber    || null,
    // Offence
    statuteCode:         d.statuteCode         || null,
    offenceDescription:  d.offenceDescription  || null,
    offenceLocation:     d.offenceLocation     || null,
    speedAlleged:        d.speedAlleged        ?? null,
    speedLimit:          d.speedLimit          ?? null,
    speedUnit:           d.speedUnit           || "km/h",
    // Vehicle
    licencePlate:        d.licencePlate        || null,
    licencePlateRegion:  d.licencePlateRegion  || null,
    vehicleMake:         d.vehicleMake         || null,
    vehicleModel:        d.vehicleModel        || null,
    vehicleYear:         d.vehicleYear         ?? null,
    vehicleColour:       d.vehicleColour       || null,
    vehicleVIN:          d.vehicleVIN          || null,
    // Driver
    driversLicenceNumber: d.driversLicenceNumber || null,
    driversLicenceRegion: d.driversLicenceRegion || null,
    driversLicenceExpiry: toDayString(d.driversLicenceExpiry),
    // Court
    courtFileNumber:   d.courtFileNumber   || null,
    courtLocation:     d.courtLocation     || null,
    courtRoomNumber:   d.courtRoomNumber   || null,
    courtJurisdiction: d.courtJurisdiction || null,
    officeCode:        d.officeCode        || null,
    hearingType:       d.hearingType       || null,
    partType:          d.partType          || null,
    // Financials
    totalFee:         data.totalFee,
    retainerAmount:   d.retainerAmount    ?? null,
    retainerPaidDate: toDayString(d.retainerPaidDate),
    setFine:          d.setFine           ?? null,
    victimSurcharge:  d.victimSurcharge   ?? null,
    disbursements:    d.disbursements     ?? 0,
    // Outcome
    outcome:          d.outcome           || null,
    reducedCharge:    d.reducedCharge     || null,
    courtFineAmount:  d.courtFineAmount   ?? null,
    demeritPoints:    d.demeritPoints     ?? null,
    licenceSuspended: d.licenceSuspended  ?? null,
    suspensionDays:   d.suspensionDays    ?? null,
    closedDate:       toDayString(d.closedDate),
    // Status & workflow
    status:           data.status || "Open",
    priority:         d.priority  || "Normal",
    tags:             d.tags      || [],
    assignedTo:       d.assignedTo || null,
    nextFollowUpDate: toDayString(data.nextFollowUpDate),
    disclosureRequestedDate: toDayString(d.disclosureRequestedDate),
    disclosureReceivedDate:  toDayString(d.disclosureReceivedDate),
  });
  if (data.firstNote) await addNote(tenantId, newCase.id, data.firstNote);
  const response = toCase({ ...newCase.toObject(), clientName: client.fullName, phone: client.phone, email: client.email, leadSourceChannel: client.leadSourceChannel, leadSourceDetail: client.leadSourceDetail } as any);
  res.status(201).json(CreateCaseResponse.parse(response));
});

router.get("/cases/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetCaseParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseDetail = await getCaseDetail(tenantId, parsed.data.id);
  if (!caseDetail) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json(GetCaseResponse.parse(caseDetail));
});

router.patch("/cases/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
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
  const existing = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!existing) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data as any;
  const ex   = existing as any;

  // Helper: undefined = keep existing, null/value = set new
  const keep = <T>(newVal: T | undefined, existing: T) => newVal === undefined ? existing : newVal;
  const keepDate = (newVal: any, existing: string | null) =>
    newVal === undefined ? existing : (newVal === null ? null : (newVal instanceof Date ? newVal.toISOString().slice(0, 10) : newVal));

  const updated = await CaseModel.findOneAndUpdate(
    { id: params.data.id, tenantId },
    {
      $set: {
        // Core dates
        intakeDate:  data.intakeDate  ? new Date(data.intakeDate).toISOString().slice(0, 10)  : ex.intakeDate,
        offenceDate: data.offenceDate ? new Date(data.offenceDate).toISOString().slice(0, 10) : ex.offenceDate,
        responseDeadline: keepDate(data.responseDeadline, ex.responseDeadline),
        // Citation
        ticketNumber:          keep(data.ticketNumber,          ex.ticketNumber),
        citationIssuingAgency: keep(data.citationIssuingAgency, ex.citationIssuingAgency),
        officerName:           keep(data.officerName,           ex.officerName),
        officerBadgeNumber:    keep(data.officerBadgeNumber,    ex.officerBadgeNumber),
        // Offence
        statuteCode:         keep(data.statuteCode,         ex.statuteCode),
        offenceDescription:  keep(data.offenceDescription,  ex.offenceDescription),
        offenceLocation:     keep(data.offenceLocation,     ex.offenceLocation),
        speedAlleged:        keep(data.speedAlleged,        ex.speedAlleged),
        speedLimit:          keep(data.speedLimit,          ex.speedLimit),
        speedUnit:           keep(data.speedUnit,           ex.speedUnit),
        // Vehicle
        licencePlate:        keep(data.licencePlate,        ex.licencePlate),
        licencePlateRegion:  keep(data.licencePlateRegion,  ex.licencePlateRegion),
        vehicleMake:         keep(data.vehicleMake,         ex.vehicleMake),
        vehicleModel:        keep(data.vehicleModel,        ex.vehicleModel),
        vehicleYear:         keep(data.vehicleYear,         ex.vehicleYear),
        vehicleColour:       keep(data.vehicleColour,       ex.vehicleColour),
        vehicleVIN:          keep(data.vehicleVIN,          ex.vehicleVIN),
        // Driver
        driversLicenceNumber: keep(data.driversLicenceNumber, ex.driversLicenceNumber),
        driversLicenceRegion: keep(data.driversLicenceRegion, ex.driversLicenceRegion),
        driversLicenceExpiry: keepDate(data.driversLicenceExpiry, ex.driversLicenceExpiry),
        // Court
        courtFileNumber:   keep(data.courtFileNumber,   ex.courtFileNumber),
        courtLocation:     keep(data.courtLocation,     ex.courtLocation),
        courtRoomNumber:   keep(data.courtRoomNumber,   ex.courtRoomNumber),
        courtJurisdiction: keep(data.courtJurisdiction, ex.courtJurisdiction),
        officeCode:        keep(data.officeCode,        ex.officeCode),
        hearingType:       keep(data.hearingType,       ex.hearingType),
        partType:          keep(data.partType,          ex.partType),
        // Financials
        totalFee:         keep(data.totalFee,         ex.totalFee),
        retainerAmount:   keep(data.retainerAmount,   ex.retainerAmount),
        retainerPaidDate: keepDate(data.retainerPaidDate, ex.retainerPaidDate),
        setFine:          keep(data.setFine,          ex.setFine),
        victimSurcharge:  keep(data.victimSurcharge,  ex.victimSurcharge),
        disbursements:    keep(data.disbursements,    ex.disbursements),
        // Outcome
        status:           keep(data.status,           ex.status),
        outcome:          keep(data.outcome,          ex.outcome),
        reducedCharge:    keep(data.reducedCharge,    ex.reducedCharge),
        courtFineAmount:  keep(data.courtFineAmount,  ex.courtFineAmount),
        demeritPoints:    keep(data.demeritPoints,    ex.demeritPoints),
        licenceSuspended: keep(data.licenceSuspended, ex.licenceSuspended),
        suspensionDays:   keep(data.suspensionDays,   ex.suspensionDays),
        closedDate:       keepDate(data.closedDate,   ex.closedDate),
        // Workflow
        nextFollowUpDate:         keepDate(data.nextFollowUpDate, ex.nextFollowUpDate),
        disclosureRequestedDate:  keepDate(data.disclosureRequestedDate, ex.disclosureRequestedDate),
        disclosureReceivedDate:   keepDate(data.disclosureReceivedDate, ex.disclosureReceivedDate),
        priority:  keep(data.priority,  ex.priority),
        tags:      data.tags !== undefined ? data.tags : ex.tags,
        assignedTo:keep(data.assignedTo, ex.assignedTo),
        updatedAt: new Date(),
      },
    },
    { new: true },
  ).lean();
  if (!updated) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  if (data.status && data.status !== existing.status) {
    await createAuditNote(tenantId, existing.id, `Status changed from ${existing.status} to ${data.status}`);
  }
  const detail = await getCaseDetail(tenantId, updated.id);
  res.json(UpdateCaseResponse.parse(detail));
});

router.delete("/cases/:id", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteCaseParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await CaseModel.findOneAndUpdate(
    { id: parsed.data.id, tenantId },
    { $set: { isDeleted: true, updatedAt: new Date() } },
    { new: true },
  ).lean();
  if (!updated) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/cases/:id/payments", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
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
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data as any;
  const payment = await PaymentModel.create({
    id:             randomUUID(),
    tenantId,
    caseId:         params.data.id,
    amount:         data.amount,
    date:           data.date instanceof Date ? data.date.toISOString().slice(0, 10) : data.date,
    method:         data.method         || null,
    reference:      data.reference      || null,
    allocationType: data.allocationType || "General",
    receivedBy:     data.receivedBy     || null,
    note:           data.note           || null,
    isVoided:       false,
    isRefund:       false,
  });
  const obj = payment.toObject();
  res.status(201).json({
    id:             obj.id,
    caseId:         obj.caseId,
    amount:         Number(obj.amount),
    date:           obj.date,
    method:         obj.method         ?? null,
    reference:      obj.reference      ?? null,
    allocationType: obj.allocationType ?? "General",
    receivedBy:     obj.receivedBy     ?? null,
    note:           obj.note           ?? null,
    isVoided:       false,
    voidedAt:       null,
    voidReason:     null,
    isRefund:       false,
    refundForId:    null,
    createdAt:      obj.createdAt      ?? null,
  });
});

// ── PATCH /cases/:id/payments/:paymentId/void ─────────────────────────────────
router.patch("/cases/:id/payments/:paymentId/void", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const { id: caseId, paymentId } = req.params;
  const { reason } = req.body as { reason?: string };

  const payment = await PaymentModel.findOne({ id: paymentId, caseId, tenantId }).lean();
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  if ((payment as any).isVoided) { res.status(422).json({ error: "Payment is already voided" }); return; }
  if ((payment as any).isRefund) { res.status(422).json({ error: "Cannot void a refund — delete it instead" }); return; }

  await PaymentModel.findOneAndUpdate(
    { id: paymentId, tenantId },
    { $set: { isVoided: true, voidedAt: new Date(), voidReason: reason?.trim() || "Voided", updatedAt: new Date() } },
  ).lean();

  await createAuditNote(tenantId, caseId,
    `Payment of $${Number((payment as any).amount).toFixed(2)} voided${reason ? ` — ${reason}` : ""}`);

  const detail = await getCaseDetail(tenantId, caseId);
  if (!detail) { res.status(404).json({ error: "Case not found" }); return; }
  res.json(detail);
});

// ── POST /cases/:id/payments/:paymentId/refund ────────────────────────────────
router.post("/cases/:id/payments/:paymentId/refund", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const { id: caseId, paymentId } = req.params;
  const { amount: rawAmount, date: rawDate, reason } = req.body as { amount?: number; date?: string; reason?: string };

  const originalPayment = await PaymentModel.findOne({ id: paymentId, caseId, tenantId }).lean();
  if (!originalPayment) { res.status(404).json({ error: "Original payment not found" }); return; }
  if ((originalPayment as any).isVoided) { res.status(422).json({ error: "Cannot refund a voided payment" }); return; }
  if ((originalPayment as any).isRefund) { res.status(422).json({ error: "Cannot refund a refund" }); return; }

  const origAmount = Number((originalPayment as any).amount);
  const refundAmt  = rawAmount ? Number(rawAmount) : origAmount;

  if (refundAmt <= 0) { res.status(400).json({ error: "Refund amount must be positive" }); return; }
  if (refundAmt > origAmount) {
    res.status(422).json({ error: `Refund amount ($${refundAmt}) exceeds original payment ($${origAmount})` });
    return;
  }

  // Check total refunds already issued for this payment
  const existingRefunds = await PaymentModel.find({ refundForId: paymentId, tenantId, isVoided: false }).lean();
  const alreadyRefunded = existingRefunds.reduce((s, r) => s + Number((r as any).amount), 0);
  if (alreadyRefunded + refundAmt > origAmount) {
    res.status(422).json({
      error: `Total refunds ($${(alreadyRefunded + refundAmt).toFixed(2)}) would exceed original payment ($${origAmount.toFixed(2)})`,
    });
    return;
  }

  const refundDate = rawDate || new Date().toISOString().slice(0, 10);
  await PaymentModel.create({
    id:             randomUUID(),
    tenantId,
    caseId,
    amount:         refundAmt,
    date:           refundDate,
    method:         (originalPayment as any).method ?? null,
    allocationType: "Refund",
    note:           reason?.trim() || "Refund issued",
    isVoided:       false,
    isRefund:       true,
    refundForId:    paymentId,
  });

  await createAuditNote(tenantId, caseId,
    `Refund of $${refundAmt.toFixed(2)} issued for payment $${paymentId.slice(0, 8)}${reason ? ` — ${reason}` : ""}`);

  const detail = await getCaseDetail(tenantId, caseId);
  if (!detail) { res.status(404).json({ error: "Case not found" }); return; }
  res.json(detail);
});

// ── DELETE /cases/:id/payments/:paymentId ─────────────────────────────────────
router.delete("/cases/:id/payments/:paymentId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const { id: caseId, paymentId } = req.params;

  const payment = await PaymentModel.findOne({ id: paymentId, caseId, tenantId }).lean();
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

  // Edge: only allow delete if voided OR it's a refund OR case balance won't go negative after
  // Soft-safety: if payment is not voided and not a refund, require explicit override or void first
  if (!(payment as any).isVoided && !(payment as any).isRefund) {
    const { force } = req.query as { force?: string };
    if (force !== "true") {
      res.status(422).json({
        error: "Payment must be voided before deletion. Pass ?force=true to force delete, or use the void endpoint.",
        hint: `PATCH /cases/${caseId}/payments/${paymentId}/void`,
      });
      return;
    }
    await createAuditNote(tenantId, caseId,
      `Payment of $${Number((payment as any).amount).toFixed(2)} force-deleted`);
  }

  await PaymentModel.deleteOne({ id: paymentId, tenantId });
  const detail = await getCaseDetail(tenantId, caseId);
  res.json(detail);
});

router.post("/cases/:id/notes", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
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
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const note = await addNote(tenantId, params.data.id, parsed.data.text, parsed.data.author ?? "Admin");
  res.status(201).json(CreateNoteResponse.parse(note));
});

router.patch("/cases/:id/notes/:noteId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = UpdateNoteParams.safeParse(req.params);
  const parsed = UpdateNoteBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const note = await NoteModel.findOne({ id: params.data.noteId, tenantId, caseId: params.data.id });
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const data = parsed.data;
  if (data.text !== undefined) note.text = data.text;
  if (data.author !== undefined) note.author = data.author ?? null;
  await note.save();
  res.json(
    UpdateNoteResponse.parse({ id: note.id, text: note.text, author: note.author, createdAt: note.createdAt }),
  );
});

router.delete("/cases/:id/notes/:noteId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = DeleteNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const result = await NoteModel.deleteOne({ id: params.data.noteId, tenantId, caseId: params.data.id });
  if (result.deletedCount === 0) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/cases/:id/court-dates", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = CreateCourtDateParams.safeParse(req.params);
  const parsed = CreateCourtDateBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data;
  const courtDate = await CourtDateModel.create({
    id: randomUUID(),
    tenantId,
    caseId: params.data.id,
    date: data.date.toISOString().slice(0, 10),
    outcome: data.outcome || null,
    notes: data.notes || null,
  });
  await CaseModel.updateOne({ id: params.data.id, tenantId }, { $set: { updatedAt: new Date() } });
  res.status(201).json(
    CreateCourtDateResponse.parse({
      id: courtDate.id,
      date: courtDate.date,
      outcome: courtDate.outcome,
      notes: courtDate.notes,
    }),
  );
});

router.delete("/cases/:id/court-dates/:courtDateId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteCourtDateParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const removed = await CourtDateModel.findOneAndDelete({
    id: parsed.data.courtDateId,
    caseId: parsed.data.id,
    tenantId,
  }).lean();
  if (!removed) {
    res.status(404).json({ error: "Court date not found" });
    return;
  }
  await CaseModel.updateOne({ id: parsed.data.id, tenantId }, { $set: { updatedAt: new Date() } });
  res.sendStatus(204);
});

function plainDocument(doc: {
  id: string;
  caseId: string;
  name: string;
  type?: string | null;
  size: number;
  uploadedAt: Date;
}) {
  return {
    id: doc.id,
    caseId: doc.caseId,
    name: doc.name,
    type: doc.type ?? null,
    size: doc.size,
    uploadedAt: doc.uploadedAt,
  };
}

router.get("/cases/:id/documents", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListCaseDocumentsParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const docs = await DocumentModel.find({ tenantId, caseId: parsed.data.id })
    .sort({ uploadedAt: -1 })
    .select("-dataUrl")
    .lean();
  res.json(ListCaseDocumentsResponse.parse({ data: docs.map(plainDocument) }));
});

router.post("/cases/:id/documents", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = CreateDocumentParams.safeParse(req.params);
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data;
  const doc = await DocumentModel.create({
    id: randomUUID(),
    tenantId,
    caseId: params.data.id,
    name: data.name,
    type: data.type || null,
    size: data.size ?? 0,
    dataUrl: data.dataUrl,
  });
  await CaseModel.updateOne({ id: params.data.id, tenantId }, { $set: { updatedAt: new Date() } });
  res.status(201).json(CreateDocumentResponse.parse(plainDocument(doc.toObject() as any)));
});

router.get("/cases/:id/documents/:documentId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = GetDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const doc = await DocumentModel.findOne({
    id: parsed.data.documentId,
    caseId: parsed.data.id,
    tenantId,
  }).lean();
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(GetDocumentResponse.parse({ ...plainDocument(doc), dataUrl: doc.dataUrl }));
});

router.delete("/cases/:id/documents/:documentId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const removed = await DocumentModel.findOneAndDelete({
    id: parsed.data.documentId,
    caseId: parsed.data.id,
    tenantId,
  }).lean();
  if (!removed) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  await CaseModel.updateOne({ id: parsed.data.id, tenantId }, { $set: { updatedAt: new Date() } });
  res.sendStatus(204);
});

router.get("/reports/summary", async (_req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const cases = await getCaseRows({ tenantId });
  const clients = await ClientModel.find({ tenantId, isDeleted: { $ne: true } }).lean();
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
  const tenantId = tenantOf(res);
  const cases = await getCaseRows({ tenantId, outstanding: true });
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
  const tenantId = tenantOf(res);
  const parsed = CommitImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const mapping = parsed.data.mapping;
  let imported = 0;
  for (const row of parsed.data.rows) {
    const name = getColumn(row, mapping, "clientName", [
      "clientName",
      "client_name",
      "Client Name",
      "client name",
    ]);
    if (!name) continue;

    const existing = await ClientModel.findOne({ tenantId, fullName: name }).lean();
    const client =
      existing ??
      (await ClientModel.create({
        id: randomUUID(),
        tenantId,
        fullName: name,
        leadSourceChannel: "Other",
        leadSourceDetail: "Legacy import",
      }));

    const rawNote = getColumn(row, mapping, "rawNote", [
      "notes",
      "note",
      "statusNotes",
      "status_notes",
      "Notes",
    ]);
    const mappedStatus = getColumn(row, mapping, "status", ["status", "Status"]);
    const inferredStatus = rawNote ? parseStatusFromText(rawNote) : null;
    let status = "Open";
    if (mappedStatus && isValidStatus(mappedStatus)) {
      status = mappedStatus;
    } else if (inferredStatus) {
      status = inferredStatus;
    }

    const intakeDate =
      normalizeDate(
        getColumn(row, mapping, "intakeDate", [
          "intakeDate",
          "intake_date",
          "Intake Date",
          "intake date",
        ]),
      ) ?? today();
    const offenceDate =
      normalizeDate(
        getColumn(row, mapping, "offenceDate", [
          "offenceDate",
          "offence_date",
          "Offence Date",
          "offence date",
        ]),
      ) ?? today();

    const totalFee =
      parseMoney(
        getColumn(row, mapping, "totalFee", [
          "totalFee",
          "total_fee",
          "Total Fee",
          "total fee",
          "fee",
          "Fee",
        ]),
      ) ?? 0;

    const newCase = await CaseModel.create({
      id: randomUUID(),
      tenantId,
      caseNumber: await getNextCaseNumber(tenantId),
      clientId: client.id,
      intakeDate,
      offenceDate,
      ticketNumber:
        getColumn(row, mapping, "ticketNumber", [
          "ticketNumber",
          "ticket_number",
          "Ticket Number",
          "ticket number",
          "ticket",
          "Ticket",
        ]) || null,
      statuteCode:
        getColumn(row, mapping, "statuteCode", [
          "statuteCode",
          "statute_code",
          "Statute Code",
          "statute code",
        ]) || null,
      offenceDescription:
        getColumn(row, mapping, "offenceDescription", [
          "offenceDescription",
          "offence_description",
          "Offence Description",
          "offence description",
        ]) || null,
      officeCode:
        getColumn(row, mapping, "officeCode", [
          "officeCode",
          "office_code",
          "Office Code",
          "office code",
        ]) || null,
      status,
      totalFee,
    });

    if (rawNote) await addNote(tenantId, newCase.id, rawNote);

    const extractedPayments = rawNote ? parseLegacyPayments(rawNote) : [];
    for (const payment of extractedPayments) {
      await PaymentModel.create({
        id: randomUUID(),
        tenantId,
        caseId: newCase.id,
        amount: payment.amount,
        date: intakeDate,
        method: null,
        note: payment.note,
      });
    }
    imported++;
  }
  res.json(
    CommitImportResponse.parse({
      imported,
      skipped: parsed.data.rows.length - imported,
    }),
  );
});

// --- Workspaces -----------------------------------------------------------

function plainWorkspace(org: {
  id: string;
  name: string;
  calendarToken?: string | null;
  createdAt: Date;
}) {
  return {
    id: org.id,
    name: org.name,
    calendarToken: org.calendarToken ?? null,
    createdAt: org.createdAt,
  };
}

router.get("/workspaces", async (_req, res): Promise<void> => {
  const orgs = await OrganizationModel.find().sort({ createdAt: 1 }).lean();
  const fallback = await getDefaultOrganization();
  res.json(
    ListWorkspacesResponse.parse({
      data: orgs.map(plainWorkspace),
      defaultWorkspaceId: fallback?.id ?? null,
    }),
  );
});

router.post("/workspaces", async (req, res): Promise<void> => {
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.externalId) {
    const clash = await OrganizationModel.findOne({ externalId: parsed.data.externalId }).lean();
    if (clash) {
      res.status(409).json({ error: "A workspace already exists for this organization" });
      return;
    }
  }
  const org = await OrganizationModel.create({
    id: randomUUID(),
    name: parsed.data.name,
    externalId: parsed.data.externalId || null,
    calendarToken: randomToken(),
  });
  res.status(201).json(CreateWorkspaceResponse.parse(plainWorkspace(org.toObject() as any)));
});

// --- Notifications + calendar feed ----------------------------------------

router.get("/notifications", async (_req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const feed = await getNotificationFeed(tenantId);
  res.json(GetNotificationsResponse.parse(feed));
});

const calendarFeedUrl = (token: string) => `/api/calendar/${token}/feed.ics`;

router.get("/calendar-feed", async (_req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  let org = await OrganizationModel.findOne({ id: tenantId }).lean();
  if (!org) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (!org.calendarToken) {
    org = await OrganizationModel.findOneAndUpdate(
      { id: tenantId },
      { $set: { calendarToken: randomToken() } },
      { new: true },
    ).lean();
  }
  res.json(
    GetCalendarFeedResponse.parse({
      token: org!.calendarToken!,
      url: calendarFeedUrl(org!.calendarToken!),
    }),
  );
});

router.post("/calendar-feed", async (_req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const org = await OrganizationModel.findOneAndUpdate(
    { id: tenantId },
    { $set: { calendarToken: randomToken() } },
    { new: true },
  ).lean();
  if (!org) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  res.json(
    RegenerateCalendarFeedResponse.parse({
      token: org.calendarToken!,
      url: calendarFeedUrl(org.calendarToken!),
    }),
  );
});

// --- Client portal links ---------------------------------------------------

router.post("/clients/:id/portal", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = CreatePortalLinkParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const client = await ClientModel.findOneAndUpdate(
    { id: parsed.data.id, tenantId, isDeleted: { $ne: true } },
    { $set: { portalToken: randomToken() } },
    { new: true },
  ).lean();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.status(201).json(CreatePortalLinkResponse.parse({ token: client.portalToken! }));
});

router.delete("/clients/:id/portal", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = RevokePortalLinkParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const client = await ClientModel.findOneAndUpdate(
    { id: parsed.data.id, tenantId },
    { $set: { portalToken: null } },
  ).lean();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.sendStatus(204);
});

// --- Trust ledger -----------------------------------------------------------

function plainTrustEntry(entry: {
  id: string;
  caseId: string;
  type: string;
  amount: number | string;
  date: string;
  note?: string | null;
  createdAt: Date;
}) {
  return {
    id: entry.id,
    caseId: entry.caseId,
    type: entry.type,
    amount: Number(entry.amount),
    date: entry.date,
    note: entry.note ?? null,
    createdAt: entry.createdAt,
  };
}

// Withdrawals and transfers both take money out of trust; only deposits add.
const trustBalanceOf = (entries: Array<{ type: string; amount: number | string }>) =>
  entries.reduce(
    (sum, entry) => (entry.type === "deposit" ? sum + Number(entry.amount) : sum - Number(entry.amount)),
    0,
  );

router.get("/cases/:id/trust-entries", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListTrustEntriesParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const entries = await TrustEntryModel.find({ tenantId, caseId: parsed.data.id })
    .sort({ date: 1, createdAt: 1 })
    .lean();
  res.json(
    ListTrustEntriesResponse.parse({
      data: entries.map(plainTrustEntry),
      trustBalance: trustBalanceOf(entries),
    }),
  );
});

router.post("/cases/:id/trust-entries", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = CreateTrustEntryParams.safeParse(req.params);
  const parsed = CreateTrustEntryBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data;
  const existingEntries = await TrustEntryModel.find({ tenantId, caseId: caseItem.id }).lean();
  if (data.type !== "deposit" && data.amount > trustBalanceOf(existingEntries)) {
    res.status(422).json({ error: "Insufficient trust balance for this entry" });
    return;
  }
  const entry = await TrustEntryModel.create({
    id: randomUUID(),
    tenantId,
    caseId: caseItem.id,
    clientId: caseItem.clientId,
    type: data.type,
    amount: data.amount,
    date: data.date.toISOString().slice(0, 10),
    note: data.note || null,
  });
  res.status(201).json(CreateTrustEntryResponse.parse(plainTrustEntry(entry.toObject() as any)));
});

router.delete("/cases/:id/trust-entries/:entryId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteTrustEntryParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const removed = await TrustEntryModel.findOneAndDelete({
    id: parsed.data.entryId,
    caseId: parsed.data.id,
    tenantId,
  }).lean();
  if (!removed) {
    res.status(404).json({ error: "Trust entry not found" });
    return;
  }
  res.sendStatus(204);
});

// --- Signature requests ------------------------------------------------------

function plainSignatureRequest(
  request: {
    id: string;
    caseId: string;
    title: string;
    documentId?: string | null;
    status: string;
    token: string;
    signerName?: string | null;
    signedAt?: Date | null;
    createdAt: Date;
  },
  documentName: string | null,
) {
  return {
    id: request.id,
    caseId: request.caseId,
    title: request.title,
    documentId: request.documentId ?? null,
    documentName,
    status: request.status,
    token: request.token,
    signerName: request.signerName ?? null,
    signedAt: request.signedAt ?? null,
    createdAt: request.createdAt,
  };
}

router.get("/cases/:id/signature-requests", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = ListSignatureRequestsParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const requests = await SignatureRequestModel.find({ tenantId, caseId: parsed.data.id })
    .sort({ createdAt: -1 })
    .lean();
  const docIds = Array.from(new Set(requests.map((request) => request.documentId).filter((id): id is string => !!id)));
  const docs = docIds.length
    ? await DocumentModel.find({ tenantId, id: { $in: docIds } }).select("id name").lean()
    : [];
  const docNameById = new Map(docs.map((doc) => [doc.id, doc.name]));
  res.json(
    ListSignatureRequestsResponse.parse({
      data: requests.map((request) =>
        plainSignatureRequest(request, request.documentId ? docNameById.get(request.documentId) ?? null : null),
      ),
    }),
  );
});

router.post("/cases/:id/signature-requests", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const params = CreateSignatureRequestParams.safeParse(req.params);
  const parsed = CreateSignatureRequestBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: params.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const data = parsed.data;
  if (!data.documentId && !data.agreementText) {
    res.status(400).json({ error: "Provide a documentId or agreementText to sign" });
    return;
  }
  let documentName: string | null = null;
  if (data.documentId) {
    const doc = await DocumentModel.findOne({ id: data.documentId, tenantId, caseId: caseItem.id }).lean();
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    documentName = doc.name;
  }
  const request = await SignatureRequestModel.create({
    id: randomUUID(),
    tenantId,
    caseId: caseItem.id,
    clientId: caseItem.clientId,
    title: data.title,
    documentId: data.documentId || null,
    agreementText: data.agreementText || null,
    status: "pending",
    token: randomToken(),
  });
  await createAuditNote(tenantId, caseItem.id, `Signature request sent — "${data.title}".`);
  res.status(201).json(CreateSignatureRequestResponse.parse(plainSignatureRequest(request.toObject() as any, documentName)));
});

router.delete("/cases/:id/signature-requests/:requestId", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const parsed = DeleteSignatureRequestParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const caseItem = await CaseModel.findOne({ id: parsed.data.id, tenantId }).lean();
  if (!caseItem) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  const removed = await SignatureRequestModel.findOneAndDelete({
    id: parsed.data.requestId,
    caseId: parsed.data.id,
    tenantId,
  }).lean();
  if (!removed) {
    res.status(404).json({ error: "Signature request not found" });
    return;
  }
  res.sendStatus(204);
});

// --- Public routes (token-authenticated) --------------------------------------

publicRouter.get("/calendar/:token/feed.ics", async (req, res): Promise<void> => {
  const parsed = GetCalendarFeedFileParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const org = await OrganizationModel.findOne({ calendarToken: parsed.data.token }).lean();
  if (!org) {
    res.status(404).json({ error: "Calendar not found" });
    return;
  }
  const ics = await buildWorkspaceCalendar(org.id);
  res
    .type("text/calendar")
    .set("Content-Disposition", 'inline; filename="docketline.ics"')
    .send(ics);
});

publicRouter.get("/portal/:token", async (req, res): Promise<void> => {
  const parsed = GetPortalViewParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const client = await ClientModel.findOne({
    portalToken: parsed.data.token,
    isDeleted: { $ne: true },
  }).lean();
  if (!client) {
    res.status(404).json({ error: "Portal link not found" });
    return;
  }
  const tenantId = client.tenantId;
  const cases = await CaseModel.find({ tenantId, clientId: client.id, isDeleted: false })
    .sort({ caseNumber: 1 })
    .lean();
  const caseIds = cases.map((caseItem) => caseItem.id);
  // An empty $in matches nothing, so no branching is needed for new clients.
  const [courtDates, payments, documents] = await Promise.all([
    CourtDateModel.find({ tenantId, caseId: { $in: caseIds } }).sort({ date: -1 }).lean(),
    PaymentModel.find({ tenantId, caseId: { $in: caseIds } }).sort({ date: -1 }).lean(),
    DocumentModel.find({ tenantId, caseId: { $in: caseIds } })
      .select("-dataUrl")
      .sort({ uploadedAt: -1 })
      .lean(),
  ]);

  res.json(
    GetPortalViewResponse.parse({
      clientName: client.fullName,
      cases: cases.map((caseItem) => {
        const casePayments = payments.filter((payment) => payment.caseId === caseItem.id);
        const amountReceived = casePayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
        return {
          id: caseItem.id,
          caseNumber: caseItem.caseNumber,
          status: caseItem.status,
          ticketNumber: caseItem.ticketNumber ?? null,
          offenceDescription: caseItem.offenceDescription ?? null,
          offenceDate: caseItem.offenceDate,
          totalFee: Number(caseItem.totalFee),
          amountReceived,
          balanceOwing: Math.max(Number(caseItem.totalFee) - amountReceived, 0),
          courtDates: courtDates
            .filter((courtDate) => courtDate.caseId === caseItem.id)
            .map((courtDate) => ({ date: courtDate.date, outcome: courtDate.outcome ?? null })),
          payments: casePayments.map((payment) => ({
            amount: Number(payment.amount),
            date: payment.date,
            method: payment.method ?? null,
            note: payment.note ?? null,
          })),
          documents: documents
            .filter((doc) => doc.caseId === caseItem.id)
            .map((doc) => ({
              id: doc.id,
              caseId: doc.caseId,
              name: doc.name,
              type: doc.type ?? null,
              size: doc.size,
              uploadedAt: doc.uploadedAt,
            })),
        };
      }),
    }),
  );
});

publicRouter.get("/portal/:token/documents/:documentId", async (req, res): Promise<void> => {
  const parsed = DownloadPortalDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const client = await ClientModel.findOne({
    portalToken: parsed.data.token,
    isDeleted: { $ne: true },
  }).lean();
  if (!client) {
    res.status(404).json({ error: "Portal link not found" });
    return;
  }
  const clientCases = await CaseModel.find({ tenantId: client.tenantId, clientId: client.id })
    .select("id")
    .lean();
  const caseIds = new Set(clientCases.map((caseItem) => caseItem.id));
  const doc = await DocumentModel.findOne({ id: parsed.data.documentId, tenantId: client.tenantId }).lean();
  if (!doc || !caseIds.has(doc.caseId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(
    DownloadPortalDocumentResponse.parse({
      id: doc.id,
      caseId: doc.caseId,
      name: doc.name,
      type: doc.type ?? null,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
      dataUrl: doc.dataUrl,
    }),
  );
});

publicRouter.get("/sign/:token", async (req, res): Promise<void> => {
  const parsed = GetSignatureRequestParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const request = await SignatureRequestModel.findOne({ token: parsed.data.token }).lean();
  if (!request) {
    res.status(404).json({ error: "Signature request not found" });
    return;
  }
  const [caseItem, client] = await Promise.all([
    CaseModel.findOne({ id: request.caseId }).lean(),
    ClientModel.findOne({ id: request.clientId }).lean(),
  ]);
  let documentName: string | null = null;
  if (request.documentId) {
    const doc = await DocumentModel.findOne({ id: request.documentId }).select("name").lean();
    documentName = doc?.name ?? null;
  }
  res.json(
    GetSignatureRequestResponse.parse({
      title: request.title,
      agreementText: request.agreementText ?? null,
      documentName,
      status: request.status,
      caseNumber: caseItem?.caseNumber ?? 0,
      clientName: client?.fullName ?? "Unknown",
      signerName: request.signerName ?? null,
      signedAt: request.signedAt ?? null,
      createdAt: request.createdAt,
    }),
  );
});

publicRouter.post("/sign/:token", async (req, res): Promise<void> => {
  const params = SignSignatureRequestParams.safeParse(req.params);
  const parsed = SignSignatureRequestBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const request = await SignatureRequestModel.findOne({ token: params.data.token }).lean();
  if (!request) {
    res.status(404).json({ error: "Signature request not found" });
    return;
  }
  if (request.status === "signed") {
    res.status(409).json({ error: "This document has already been signed" });
    return;
  }
  await SignatureRequestModel.updateOne(
    { id: request.id },
    {
      $set: {
        status: "signed",
        signerName: parsed.data.signerName,
        signatureData: parsed.data.signatureData,
        signedAt: new Date(),
      },
    },
  );
  await addNote(
    request.tenantId,
    request.caseId,
    `Signature received — "${request.title}" signed by ${parsed.data.signerName}.`,
    "Portal",
  );
  res.sendStatus(204);
});

export default router;
export { publicRouter };