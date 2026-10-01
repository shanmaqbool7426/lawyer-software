import type { Request, Response } from "express";
import app from "./app";
import { connectDatabase } from "@workspace/db";
import { ensureTenancyMigration } from "./lib/tenancy";

// Vercel serverless entry: keep one database connection warm across
// invocations and delegate each request to the Express app.
let ready: Promise<unknown> | null = null;

function ensureReady() {
  ready ??= (async () => {
    await connectDatabase();
    // Bring a pre-tenancy database up to speed (default workspace, tenantId
    // backfill, per-tenant case counter) before anything reads or writes.
    await ensureTenancyMigration();
  })();
  return ready;
}

export default async function handler(req: Request, res: Response) {
  try {
    await ensureReady();
  } catch (err) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }
  app(req, res);
}
