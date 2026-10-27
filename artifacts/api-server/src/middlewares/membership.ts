import type { NextFunction, Request, Response } from "express";
import { clerkClient } from "@clerk/express";
import { MemberModel } from "@workspace/db";
import { MODULE_KEYS, MODULES, moduleForPath, type ModuleKey } from "../lib/modules";

type AuthLike = { auth?: unknown };
type SessionUser = { userId?: string | null; sessionClaims?: { userId?: string | null } | null };

// @clerk/express v2 exposes req.auth as a function; the demo fallback sets a
// plain object. Handle both, exactly like the auth guard in app.ts.
function currentUserId(req: Request): string | null {
  const auth = (req as AuthLike).auth;
  const obj = (typeof auth === "function" ? (auth as () => SessionUser | null)() : auth) as SessionUser | null | undefined;
  return obj?.sessionClaims?.userId ?? obj?.userId ?? null;
}

type MemberRecord = {
  id: string;
  name: string;
  email: string | null;
  role: "owner" | "staff";
  permissions: string[];
  status: "active" | "disabled";
};

export type MemberLocals = { member: MemberRecord };

/** Who the request is speaking as, cached on res.locals by `membership`. */
export function currentMember(res: Response): MemberRecord {
  return (res.locals as MemberLocals).member;
}

function canOpen(member: MemberRecord, key: ModuleKey): boolean {
  return member.role === "owner" || member.permissions.includes(key);
}

/**
 * Resolves the signed-in Clerk user to a team member of the current workspace.
 *
 * The first person to reach a workspace claims it as owner, which is what makes
 * an existing single-account install keep working. After that a signed-in
 * account with no membership row is refused: being able to authenticate is not
 * the same as being allowed in.
 */
export async function membership(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = String(res.locals.tenantId ?? "");
    const userId = currentUserId(req);
    if (!tenantId || !userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let member = await MemberModel.findOne({ tenantId, clerkUserId: userId }).lean<MemberRecord>();

    if (!member) {
      // A demo deployment created its owner with the synthetic id "local-demo".
      // That row must not make the workspace look claimed once real Clerk auth
      // is switched on, or the actual owner would be locked out.
      const claimed = await MemberModel.exists({ tenantId, role: "owner", clerkUserId: { $ne: "local-demo" } });
      if (claimed) {
        res.status(403).json({
          error: "This account has not been added to the workspace. Ask the owner to add you.",
          code: "not_a_member",
        });
        return;
      }

      await MemberModel.deleteMany({ tenantId, clerkUserId: "local-demo" });

      let name = "Workspace owner";
      let email: string | null = null;
      try {
        const profile = await clerkClient.users.getUser(userId);
        const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
        name = fullName || profile.username || profile.emailAddresses?.[0]?.emailAddress || name;
        email = profile.emailAddresses?.[0]?.emailAddress ?? null;
      } catch {
        // Demo mode (or Clerk unreachable): the workspace still needs an owner.
      }

      const created = await MemberModel.create({
        tenantId,
        clerkUserId: userId,
        name,
        email,
        role: "owner",
        permissions: MODULE_KEYS,
        status: "active",
        lastSeenAt: new Date(),
      });
      member = created.toObject() as MemberRecord;
    }

    if (member.status === "disabled") {
      res.status(403).json({
        error: "The workspace owner has turned off access for this account.",
        code: "disabled",
      });
      return;
    }

    res.locals.member = member;
    // "Last seen" only needs minute resolution; skip the write on hot paths.
    const stale = !(member as unknown as { lastSeenAt?: Date }).lastSeenAt ||
      Date.now() - new Date((member as unknown as { lastSeenAt: Date }).lastSeenAt).getTime() > 5 * 60_000;
    if (stale) {
      void MemberModel.updateOne({ id: member.id }, { lastSeenAt: new Date() }).catch(() => {});
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Refuses a request for a module the member was not granted. Applied to every
 * route group, so hiding a menu item is not the only thing standing in the way.
 */
export function moduleGuard(req: Request, res: Response, next: NextFunction): void {
  const key = moduleForPath(req.path);
  if (!key) {
    next();
    return;
  }
  const member = currentMember(res);
  if (canOpen(member, key)) {
    next();
    return;
  }
  const label = MODULES.find((module) => module.key === key)?.label ?? key;
  res.status(403).json({
    error: `You do not have access to ${label}. Ask the workspace owner for permission.`,
    code: "module_forbidden",
    module: key,
  });
}

export function requireOwner(_req: Request, res: Response, next: NextFunction): void {
  const member = currentMember(res);
  if (member?.role !== "owner") {
    res.status(403).json({ error: "Only the workspace owner can manage the team.", code: "owner_only" });
    return;
  }
  next();
}

/** The payload the SPA uses to draw the sidebar. */
export function permissionsPayload(member: MemberRecord) {
  return {
    user: { id: member.id, name: member.name, email: member.email, role: member.role },
    role: member.role,
    modules: MODULES.map((module) => ({
      key: module.key,
      label: module.label,
      allowed: canOpen(member, module.key),
    })),
    canManageTeam: member.role === "owner",
  };
}
