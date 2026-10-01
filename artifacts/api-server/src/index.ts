import app from "./app";
import { logger } from "./lib/logger";
import { connectDatabase } from "@workspace/db";
import { ensureTenancyMigration } from "./lib/tenancy";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  await connectDatabase();
  // Bring a pre-tenancy database up to speed (default workspace, tenantId
  // backfill, per-tenant case counter) before anything reads or writes.
  const defaultOrg = await ensureTenancyMigration();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => logger.error({ err }, "Unable to start server"));