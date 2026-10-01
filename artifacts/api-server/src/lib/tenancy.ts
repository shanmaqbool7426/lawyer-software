import { randomBytes, randomUUID } from "node:crypto";
import {
  CaseModel,
  ClientModel,
  CourtDateModel,
  CounterModel,
  DocumentModel,
  NoteModel,
  OrganizationModel,
  PaymentModel,
} from "@workspace/db";

export type OrganizationDoc = {
  id: string;
  name: string;
  externalId?: string | null;
  isDefault: boolean;
  calendarToken?: string | null;
  createdAt: Date;
};

/** URL-safe random token for portal links, signature requests and calendar feeds. */
export const randomToken = () => randomBytes(24).toString("base64url");

let cachedDefaultOrg: OrganizationDoc | null = null;

export async function getDefaultOrganization(): Promise<OrganizationDoc | null> {
  if (cachedDefaultOrg) return cachedDefaultOrg;
  const org = await OrganizationModel.findOne({ isDefault: true }).lean<OrganizationDoc>();
  if (org) cachedDefaultOrg = org;
  return org;
}

/**
 * One-time migration that brings a pre-tenancy database up to speed:
 * creates the default workspace, backfills tenantId on every domain
 * collection, moves the global case-number counter to a per-tenant key and
 * drops the legacy global unique index on caseNumber. Safe to run on every
 * boot — every step is a no-op once applied.
 */
export async function ensureTenancyMigration(): Promise<OrganizationDoc> {
  let org = await OrganizationModel.findOne({ isDefault: true }).lean<OrganizationDoc>();
  if (!org) {
    await OrganizationModel.create({
      id: randomUUID(),
      name: "Docketline HQ",
      isDefault: true,
      calendarToken: randomToken(),
    });
    org = await OrganizationModel.findOne({ isDefault: true }).lean<OrganizationDoc>();
    if (!org) throw new Error("Unable to create the default workspace");
  }

  const tenantScoped = [ClientModel, CaseModel, PaymentModel, NoteModel, CourtDateModel, DocumentModel];
  for (const model of tenantScoped) {
    await model.updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: org.id } });
  }

  // Move the legacy global counter onto the per-tenant key.
  const legacy = await CounterModel.findOne({ key: "caseNumber" }).lean();
  if (legacy) {
    await CounterModel.updateOne(
      { key: `caseNumber:${org.id}` },
      { $set: { value: legacy.value } },
      { upsert: true },
    );
    await CounterModel.deleteOne({ key: "caseNumber" });
  }

  // Case numbers are now unique per tenant; the old global unique index would
  // reject case #1 of a second workspace.
  try {
    await CaseModel.collection.dropIndex("caseNumber_1");
  } catch {
    // Index absent or already dropped — nothing to do.
  }

  cachedDefaultOrg = org;
  return org;
}
