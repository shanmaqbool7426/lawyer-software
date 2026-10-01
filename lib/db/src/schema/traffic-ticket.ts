import { Schema, model, type InferSchemaType, type Model } from "mongoose";
import { randomUUID } from "node:crypto";

const uid = () => randomUUID();

const clientSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    tenantId: { type: String, required: true, index: true },
    fullName: { type: String, required: true },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    leadSourceChannel: { type: String, required: true },
    leadSourceDetail: { type: String, default: null },
    portalToken: { type: String, default: null, index: true },
    isDeleted: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

const caseSchema = new Schema(
  {
    id:          { type: String, required: true, unique: true, index: true, default: uid },
    tenantId:    { type: String, required: true, index: true },
    caseNumber:  { type: Number, required: true },
    clientId:    { type: String, required: true, index: true },

    // ── Dates ────────────────────────────────────────────────────────────────
    intakeDate:         { type: String, required: true },
    offenceDate:        { type: String, required: true },
    responseDeadline:   { type: String, default: null },   // deadline to respond / answer date

    // ── Citation / Ticket ────────────────────────────────────────────────────
    ticketNumber:        { type: String, default: null }, // aka citation number / infraction number
    citationIssuingAgency: { type: String, default: null }, // e.g. "Ontario Provincial Police", "NYPD", "Metropolitan Police"
    officerName:         { type: String, default: null },
    officerBadgeNumber:  { type: String, default: null },

    // ── Offence ──────────────────────────────────────────────────────────────
    statuteCode:         { type: String, default: null }, // e.g. "HTA 128(1)", "VC 22350", "RTA 1988 s.3"
    offenceDescription:  { type: String, default: null },
    offenceLocation:     { type: String, default: null }, // street / highway where offence occurred
    speedAlleged:        { type: Number, default: null }, // km/h or mph alleged by officer
    speedLimit:          { type: Number, default: null }, // posted speed limit
    speedUnit:           { type: String, default: "km/h" }, // "km/h" | "mph"

    // ── Vehicle ──────────────────────────────────────────────────────────────
    licencePlate:        { type: String, default: null },
    licencePlateRegion:  { type: String, default: null }, // e.g. "ON", "CA", "NY", "QC"
    vehicleMake:         { type: String, default: null }, // e.g. "Toyota"
    vehicleModel:        { type: String, default: null }, // e.g. "Corolla"
    vehicleYear:         { type: Number, default: null },
    vehicleColour:       { type: String, default: null },
    vehicleVIN:          { type: String, default: null }, // Vehicle Identification Number (for serious matters)

    // ── Driver / Defendant ───────────────────────────────────────────────────
    driversLicenceNumber: { type: String, default: null },
    driversLicenceRegion: { type: String, default: null }, // issuing province/state
    driversLicenceExpiry: { type: String, default: null },

    // ── Court ────────────────────────────────────────────────────────────────
    courtFileNumber:     { type: String, default: null }, // assigned by court after first appearance
    courtLocation:       { type: String, default: null }, // e.g. "Ontario Court of Justice — 361 University Ave"
    courtRoomNumber:     { type: String, default: null }, // e.g. "102", "Courtroom B"
    courtJurisdiction:   { type: String, default: null }, // e.g. "Ontario", "California", "England & Wales"
    // officeCode → renamed to jurisdictionCode for global clarity (kept as officeCode in DB for backward compat)
    officeCode:          { type: String, default: null }, // ICON location code (CA), court district (US), tribunal code (UK)
    hearingType:         { type: String, default: null }, // "First Appearance" | "Early Resolution" | "Trial" | "Motion" | "Sentencing" | "Appeal"
    partType:            { type: String, default: null }, // "Part I" | "Part II" | "Part III" | "Misdemeanor" | "FPN" (Fixed Penalty Notice UK)

    // ── Financials ───────────────────────────────────────────────────────────
    totalFee:            { type: Number, required: true, default: 0 }, // lawyer fee
    retainerAmount:      { type: Number, default: null }, // upfront retainer agreed
    retainerPaidDate:    { type: String, default: null },
    setFine:             { type: Number, default: null }, // govt-mandated fine (e.g. $95 for HTA 128)
    victimSurcharge:     { type: Number, default: null }, // additional surcharge levied by court
    disbursements:       { type: Number, default: 0 },   // filing fees, courier etc. passed to client

    // ── Case outcome ─────────────────────────────────────────────────────────
    status:              { type: String, required: true, default: "Open" },
    outcome:             { type: String, default: null }, // "Withdrawn" | "Guilty" | "Not Guilty" | "Plea Bargain" | "Amended" | "Dismissed" | "Diverted"
    reducedCharge:       { type: String, default: null }, // if amended, what it was reduced to
    courtFineAmount:     { type: Number, default: null }, // fine imposed by court on client
    demeritPoints:       { type: Number, default: null }, // points added to licence
    licenceSuspended:    { type: Boolean, default: null }, // was licence suspended?
    suspensionDays:      { type: Number, default: null },  // if suspended, for how long
    closedDate:          { type: String, default: null },  // when case was officially closed

    // ── Workflow ─────────────────────────────────────────────────────────────
    nextFollowUpDate:    { type: String, default: null },
    disclosureRequestedDate: { type: String, default: null }, // when disclosure was requested
    disclosureReceivedDate:  { type: String, default: null }, // when disclosure was received
    priority:            { type: String, default: "Normal" }, // "Low" | "Normal" | "High" | "Urgent"
    tags:                { type: [String], default: [] },     // custom labels e.g. ["DUI","Commercial","Young Offender"]
    assignedTo:          { type: String, default: null },     // staff member name/id

    isDeleted:   { type: Boolean, required: true, default: false },
    createdAt:   { type: Date, default: () => new Date() },
    updatedAt:   { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
// Case numbers restart per tenant
caseSchema.index({ tenantId: 1, caseNumber: 1 }, { unique: true });
caseSchema.index({ tenantId: 1, status: 1 });
caseSchema.index({ tenantId: 1, nextFollowUpDate: 1 });
caseSchema.index({ tenantId: 1, closedDate: 1 });

const paymentSchema = new Schema(
  {
    id:              { type: String, required: true, unique: true, index: true, default: uid },
    tenantId:        { type: String, required: true, index: true },
    caseId:          { type: String, required: true, index: true },
    amount:          { type: Number, required: true },
    date:            { type: String, required: true },
    // Extended payment fields
    method:          { type: String, default: null },  // "Cash"|"Cheque"|"E-Transfer"|"Wire"|"Card"|"Money Order"|"Other"
    reference:       { type: String, default: null },  // cheque#, e-transfer ref, transaction ID
    allocationType:  { type: String, default: "General" }, // "Retainer"|"Installment"|"Final Payment"|"Disbursement"|"General"
    receivedBy:      { type: String, default: null },  // staff member who received it
    note:            { type: String, default: null },
    // Void / refund support
    isVoided:        { type: Boolean, required: true, default: false },
    voidedAt:        { type: Date, default: null },
    voidReason:      { type: String, default: null },
    // Refund tracking
    isRefund:        { type: Boolean, required: true, default: false }, // true = this is a refund (negative effect)
    refundForId:     { type: String, default: null }, // which payment this refunds
    // Audit
    createdAt:       { type: Date, default: () => new Date() },
    updatedAt:       { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
paymentSchema.index({ tenantId: 1, caseId: 1, date: -1 });
paymentSchema.index({ tenantId: 1, isVoided: 1 });

const noteSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    tenantId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    text: { type: String, required: true },
    author: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

const courtDateSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    tenantId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    date: { type: String, required: true },
    outcome: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { versionKey: false },
);

const documentSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    tenantId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, default: null },
    size: { type: Number, required: true, default: 0 },
    dataUrl: { type: String, required: true },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

const organizationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    name: { type: String, required: true },
    // Links the workspace to its Clerk organization when Clerk is enabled.
    externalId: { type: String, default: null, index: true },
    isDefault: { type: Boolean, required: true, default: false },
    calendarToken: { type: String, default: null, index: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

const trustEntrySchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    tenantId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    clientId: { type: String, required: true },
    type: { type: String, required: true, enum: ["deposit", "withdrawal", "transfer"] },
    amount: { type: Number, required: true },
    date: { type: String, required: true },
    note: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

const signatureRequestSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    tenantId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    clientId: { type: String, required: true },
    title: { type: String, required: true },
    documentId: { type: String, default: null },
    agreementText: { type: String, default: null },
    status: { type: String, required: true, default: "pending", enum: ["pending", "signed"] },
    token: { type: String, required: true, unique: true, index: true },
    signerName: { type: String, default: null },
    signatureData: { type: String, default: null },
    signedAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

const invoiceItemSchema = new Schema(
  {
    id: { type: String, required: true, default: uid },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    unitPrice: { type: Number, required: true },
    amount: { type: Number, required: true },
  },
  { _id: false, versionKey: false },
);

const invoiceSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true, default: uid },
    tenantId: { type: String, required: true, index: true },
    invoiceNumber: { type: Number, required: true },
    clientId: { type: String, required: true, index: true },
    caseId: { type: String, default: null, index: true },
    status: { type: String, required: true, default: "draft", enum: ["draft", "sent", "paid", "void"] },
    issueDate: { type: String, required: true },
    dueDate: { type: String, required: true },
    items: { type: [invoiceItemSchema], required: true, default: [] },
    subtotal: { type: Number, required: true, default: 0 },
    taxRate: { type: Number, required: true, default: 0 },
    taxAmount: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },
    notes: { type: String, default: null },
    isDeleted: { type: Boolean, required: true, default: false },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
invoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });

const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export type Client = InferSchemaType<typeof clientSchema>;
export type Case = InferSchemaType<typeof caseSchema>;
export type Payment = InferSchemaType<typeof paymentSchema>;
export type Note = InferSchemaType<typeof noteSchema>;
export type CourtDate = InferSchemaType<typeof courtDateSchema>;
export type CaseDocument = InferSchemaType<typeof documentSchema>;
export type Organization = InferSchemaType<typeof organizationSchema>;
export type TrustEntry = InferSchemaType<typeof trustEntrySchema>;
export type SignatureRequest = InferSchemaType<typeof signatureRequestSchema>;
export type InvoiceItem = InferSchemaType<typeof invoiceItemSchema>;
export type Invoice = InferSchemaType<typeof invoiceSchema>;

export const ClientModel: Model<Client> = model<Client>("Client", clientSchema);
export const CaseModel: Model<Case> = model<Case>("Case", caseSchema);
export const PaymentModel: Model<Payment> = model<Payment>("Payment", paymentSchema);
export const NoteModel: Model<Note> = model<Note>("Note", noteSchema);
export const CourtDateModel: Model<CourtDate> = model<CourtDate>("CourtDate", courtDateSchema);
export const DocumentModel: Model<CaseDocument> = model<CaseDocument>("CaseDocument", documentSchema);
export const OrganizationModel: Model<Organization> = model<Organization>("Organization", organizationSchema);
export const TrustEntryModel: Model<TrustEntry> = model<TrustEntry>("TrustEntry", trustEntrySchema);
export const SignatureRequestModel: Model<SignatureRequest> = model<SignatureRequest>("SignatureRequest", signatureRequestSchema);
export const InvoiceModel: Model<Invoice> = model<Invoice>("Invoice", invoiceSchema);

// ─── Expense ─────────────────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  "Filing Fees",
  "Court Fees",
  "Travel",
  "Parking",
  "Postage & Courier",
  "Printing & Copying",
  "Phone & Communication",
  "Office Supplies",
  "Professional Fees",
  "Expert Witness",
  "Process Server",
  "Transcripts",
  "Software & Subscriptions",
  "Marketing",
  "Other",
] as const;

const expenseSchema = new Schema(
  {
    id:          { type: String, required: true, unique: true, index: true, default: uid },
    tenantId:    { type: String, required: true, index: true },
    // null = firm-level expense (not linked to a specific case)
    caseId:      { type: String, default: null, index: true },
    clientId:    { type: String, default: null, index: true },
    category:    { type: String, required: true },
    amount:      { type: Number, required: true },
    date:        { type: String, required: true },
    description: { type: String, required: true },
    vendor:      { type: String, default: null },
    receiptUrl:  { type: String, default: null },
    isBillable:  { type: Boolean, required: true, default: false },
    isBilled:    { type: Boolean, required: true, default: false },
    isDeleted:   { type: Boolean, required: true, default: false },
    createdAt:   { type: Date, default: () => new Date() },
    updatedAt:   { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
expenseSchema.index({ tenantId: 1, date: -1 });
expenseSchema.index({ tenantId: 1, caseId: 1, date: -1 });
expenseSchema.index({ tenantId: 1, category: 1 });

export type Expense = InferSchemaType<typeof expenseSchema>;
export const ExpenseModel: Model<Expense> = model<Expense>("Expense", expenseSchema);

// ─── Appointment ─────────────────────────────────────────────────────────────
export const APPOINTMENT_TYPES = [
  "Consultation",
  "Court Appearance",
  "Client Meeting",
  "Phone Call",
  "Video Call",
  "Document Review",
  "Mediation",
  "Deposition",
  "Site Visit",
  "Other",
] as const;

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
] as const;

const appointmentSchema = new Schema(
  {
    id:           { type: String, required: true, unique: true, index: true, default: uid },
    tenantId:     { type: String, required: true, index: true },
    clientId:     { type: String, default: null, index: true },
    caseId:       { type: String, default: null, index: true },
    title:        { type: String, required: true },
    type:         { type: String, required: true, default: "Consultation" },
    startAt:      { type: Date,   required: true },
    endAt:        { type: Date,   required: true },
    location:     { type: String, default: null },
    notes:        { type: String, default: null },
    status:       { type: String, required: true, default: "scheduled" },
    reminderSent: { type: Boolean, required: true, default: false },
    isDeleted:    { type: Boolean, required: true, default: false },
    createdAt:    { type: Date, default: () => new Date() },
    updatedAt:    { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
// Index for overlap / calendar queries
appointmentSchema.index({ tenantId: 1, startAt: 1 });
appointmentSchema.index({ tenantId: 1, startAt: 1, endAt: 1 });
appointmentSchema.index({ tenantId: 1, clientId: 1, startAt: 1 });

export type Appointment = InferSchemaType<typeof appointmentSchema>;
export const AppointmentModel: Model<Appointment> = model<Appointment>("Appointment", appointmentSchema);

export const CounterModel = model(
  "Counter",
  counterSchema,
  "counters",
);