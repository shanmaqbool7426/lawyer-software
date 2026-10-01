import type { NextFunction, Request, Response } from "express";
import { OrganizationModel } from "@workspace/db";
import { getDefaultOrganization } from "../lib/tenancy";

type AuthLike = {
  auth?: { sessionClaims?: Record<string, unknown> | null } | null;
};

/**
 * Resolves the workspace (tenant) for the current request into
 * res.locals.tenantId:
 * - the Clerk organization claim when the session carries one
 *   (v1 claims use `o.id`, v2 claims use `orgId`)
 * - the `x-workspace-id` header for multi-workspace testing and the
 *   workspace switcher in demo mode
 * - the default workspace otherwise
 */
export async function tenantContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const claims = (req as AuthLike).auth?.sessionClaims ?? {};
    const claimOrgId =
      (claims as { orgId?: string | null }).orgId ??
      (claims as { o?: { id?: string | null } | null }).o?.id ??
      null;

    const candidate = claimOrgId || req.header("x-workspace-id")?.trim() || null;
    if (candidate) {
      const org = await OrganizationModel.findOne({
        $or: [{ id: candidate }, { externalId: candidate }],
      }).lean<{ id: string }>();
      if (org) {
        res.locals.tenantId = org.id;
        next();
        return;
      }
    }

    const fallback = await getDefaultOrganization();
    if (!fallback) {
      res.status(500).json({ error: "No workspace available" });
      return;
    }
    res.locals.tenantId = fallback.id;
    next();
  } catch (err) {
    next(err);
  }
}
