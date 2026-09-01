import {
  boolean,
  date,
  decimal,
  integer,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const clientsTable = pgTable("clients", {
  id: varchar("id", { length: 36 }).primaryKey(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  leadSourceChannel: text("lead_source_channel").notNull(),
  leadSourceDetail: text("lead_source_detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const casesTable = pgTable("cases", {
  id: varchar("id", { length: 36 }).primaryKey(),
  caseNumber: integer("case_number").unique().notNull(),
  clientId: varchar("client_id", { length: 36 }).notNull(),
  intakeDate: date("intake_date", { mode: "string" }).notNull(),
  offenceDate: date("offence_date", { mode: "string" }).notNull(),
  ticketNumber: text("ticket_number"),
  statuteCode: text("statute_code"),
  offenceDescription: text("offence_description"),
  officeCode: text("office_code"),
  courtLocation: text("court_location"),
  status: text("status").notNull().default("Open"),
  totalFee: decimal("total_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  nextFollowUpDate: date("next_follow_up_date", { mode: "string" }),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentsTable = pgTable("payments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  caseId: varchar("case_id", { length: 36 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  date: date("date", { mode: "string" }).notNull(),
  method: text("method"),
  note: text("note"),
});

export const notesTable = pgTable("case_notes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  caseId: varchar("case_id", { length: 36 }).notNull(),
  text: text("text").notNull(),
  author: text("author"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courtDatesTable = pgTable("court_dates", {
  id: varchar("id", { length: 36 }).primaryKey(),
  caseId: varchar("case_id", { length: 36 }).notNull(),
  date: date("date", { mode: "string" }).notNull(),
  outcome: text("outcome"),
});

export const insertClientSchema = createInsertSchema(clientsTable);
export const insertCaseSchema = createInsertSchema(casesTable);
export const insertPaymentSchema = createInsertSchema(paymentsTable);
export const insertNoteSchema = createInsertSchema(notesTable);
export const insertCourtDateSchema = createInsertSchema(courtDatesTable);

export type Client = typeof clientsTable.$inferSelect;
export type Case = typeof casesTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type Note = typeof notesTable.$inferSelect;
export type CourtDate = typeof courtDatesTable.$inferSelect;