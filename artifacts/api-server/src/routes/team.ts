import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { MemberModel } from "@workspace/db";
import { isModuleKey, MODULES, MODULE_KEYS } from "../lib/modules";
import {
  currentMember,
  permissionsPayload,
  requireOwner,
} from "../middlewares/membership";

const router: IRouter = Router();

type MemberRow = {
  id: string;
  clerkUserId: string;
  name: string;
  email: string | null;
  role: "owner" | "staff";
  permissions: string[];
  status: "active" | "disabled";
  createdBy: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
};

function tenantOf(res: { locals: Record<string, unknown> }): string {
  return String(res.locals.tenantId ?? "");
}

function view(row: MemberRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? null,
    role: row.role,
    permissions: row.permissions ?? [],
    status: row.status,
    lastSeenAt: row.lastSeenAt ?? null,
    createdAt: row.createdAt,
  };
}

/** A password an owner can read out loud and that Clerk will accept. */
function tempPassword(): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (source: string, count: number) =>
    Array.from(randomBytes(count), (byte) => source[byte % source.length]).join("");
  // 16 characters with mixed case, digits and a symbol: the Clerk instance
  // requires 15+, and 0/O and 1/l are left out so it can be read over the phone.
  return `${pick(upper, 4)}${pick(lower, 6)}${pick(digits, 5)}!`;
}

/** Clerk's own explanation is far more useful than its generic status text. */
function clerkDetail(err: unknown, fallback: string): string {
  const errors = (err as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  const detail = first?.longMessage || first?.message;
  if (detail) return detail;
  return err instanceof Error && err.message ? err.message : fallback;
}

function cleanPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (isModuleKey(entry)) seen.add(entry);
  }
  // Stable order so the UI never shows the same set in two different orders.
  return MODULE_KEYS.filter((key) => seen.has(key));
}

// ─── Who am I ────────────────────────────────────────────────────────────────
// The SPA calls this once to know which sidebar entries to draw.
router.get("/me", (_req, res): void => {
  const member = currentMember(res);
  res.json(permissionsPayload(member));
});

// ─── Team list (owner only) ──────────────────────────────────────────────────
router.get("/team", requireOwner, async (_req, res): Promise<void> => {
  const rows = await MemberModel.find({ tenantId: tenantOf(res) })
    .sort({ role: 1, createdAt: 1 })
    .lean<MemberRow[]>();
  res.json({
    members: rows.map(view),
    modules: MODULES,
  });
});

// ─── Add an employee ─────────────────────────────────────────────────────────
router.post("/team", requireOwner, async (req, res): Promise<void> => {
  const body = req.body as { name?: unknown; email?: unknown; permissions?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const permissions = cleanPermissions(body?.permissions);

  if (!name) {
    res.status(400).json({ error: "Enter the person's name." });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }

  const tenantId = tenantOf(res);
  const owner = currentMember(res);
  const duplicate = await MemberModel.findOne({ tenantId, email }).lean<MemberRow>();
  if (duplicate) {
    res.status(409).json({ error: `${name} is already on the team.` });
    return;
  }

  const [firstName, ...rest] = name.split(/\s+/);
  let clerkUserId: string | null = null;
  let password: string | null = null;

  try {
    // An existing login (the owner's own, or someone who signed up earlier) is
    // linked rather than duplicated; anyone new gets a one-time password.
    const existing = await clerkClient.users.getUserList({ emailAddress: [email] });
    if (existing.data.length > 0) {
      clerkUserId = existing.data[0].id;
    } else {
      password = tempPassword();
      const created = await clerkClient.users.createUser({
        emailAddress: [email],
        password,
        firstName: firstName || undefined,
        lastName: rest.join(" ") || undefined,
        skipPasswordChecks: false,
      });
      clerkUserId = created.id;
    }
  } catch (err) {
    res.status(400).json({ error: `Could not create the login: ${clerkDetail(err, "Clerk rejected the account.")}` });
    return;
  }

  const alreadyMember = await MemberModel.findOne({ tenantId, clerkUserId }).lean<MemberRow>();
  if (alreadyMember) {
    res.status(409).json({ error: "That login is already part of this workspace." });
    return;
  }

  const row = await MemberModel.create({
    tenantId,
    clerkUserId,
    name,
    email,
    role: "staff",
    permissions,
    status: "active",
    createdBy: owner.id,
  });

  res.status(201).json({ member: view(row.toObject() as MemberRow), password });
});

// ─── Edit a member: name, modules, access ────────────────────────────────────
router.patch("/team/:id", requireOwner, async (req, res): Promise<void> => {
  const row = await MemberModel.findOne({ tenantId: tenantOf(res), id: req.params.id }).lean<MemberRow>();
  if (!row) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  if (row.role === "owner") {
    res.status(400).json({ error: "The owner keeps every module. Add a separate account for a limited employee." });
    return;
  }

  const body = req.body as { name?: unknown; permissions?: unknown; status?: unknown } | null;
  const update: Record<string, unknown> = {};

  if (typeof body?.name === "string" && body.name.trim() && body.name.trim() !== row.name) {
    update.name = body.name.trim();
  }
  if (body && body.permissions !== undefined) {
    update.permissions = cleanPermissions(body.permissions);
  }
  if (body?.status === "active" || body?.status === "disabled") {
    update.status = body.status;
  }

  if (Object.keys(update).length === 0) {
    res.json({ member: view(row) });
    return;
  }

  const saved = await MemberModel.findOneAndUpdate(
    { tenantId: tenantOf(res), id: row.id },
    update,
    { new: true },
  ).lean<MemberRow>();
  res.json({ member: view(saved as MemberRow) });
});

// ─── Remove a member ─────────────────────────────────────────────────────────
// The login stays in Clerk so the same person can be re-added later; only the
// workspace membership is withdrawn.
router.delete("/team/:id", requireOwner, async (req, res): Promise<void> => {
  const row = await MemberModel.findOne({ tenantId: tenantOf(res), id: req.params.id }).lean<MemberRow>();
  if (!row) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  if (row.role === "owner") {
    res.status(400).json({ error: "The workspace owner cannot be removed." });
    return;
  }
  if (row.id === currentMember(res).id) {
    res.status(400).json({ error: "You cannot remove your own account." });
    return;
  }
  await MemberModel.deleteOne({ tenantId: tenantOf(res), id: row.id });
  res.json({ ok: true });
});

// ─── Give a member a fresh password ──────────────────────────────────────────
router.post("/team/:id/password", requireOwner, async (req, res): Promise<void> => {
  const row = await MemberModel.findOne({ tenantId: tenantOf(res), id: req.params.id }).lean<MemberRow>();
  if (!row) {
    res.status(404).json({ error: "Team member not found" });
    return;
  }
  const password = tempPassword();
  try {
    await clerkClient.users.updateUser(row.clerkUserId, { password });
  } catch (err) {
    res.status(400).json({ error: `Could not reset the password: ${clerkDetail(err, "Clerk rejected the password change.")}` });
    return;
  }
  res.json({ password });
});

export default router;
