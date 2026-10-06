import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router, { publicRouter } from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { tenantContext } from "./middlewares/tenantContext";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Clerk production domains that cannot hold DNS records (vercel.app) configure
// the proxy as https://<domain>/__clerk — no /api prefix. Serve the same
// handler there so the Clerk-Proxy-Url header matches the dashboard value.
app.use('/__clerk', clerkProxyMiddleware('/__clerk'));
app.use(cors({ credentials: true, origin: true }));
// 16 MB JSON limit so base64 document uploads fit under the MongoDB 16 MB doc cap
app.use(express.json({ limit: "16mb" }));
app.use(express.urlencoded({ extended: true }));

// DEMO_MODE=1 opts a public deployment into the local-demo auth bypass so the
// app can run end-to-end without real Clerk credentials. The production
// publishable key is public (it identifies the instance and is embedded in the
// SPA bundle anyway), so a hardcoded fallback is safe; an env var still wins
// for local dev with pk_test.
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY || 'pk_live_Y2xlcmsubGF3eWVyLXNvZnR3YXJlLW5pbmUudmVyY2VsLmFwcCQ';
const clerkEnabled = !!CLERK_PUBLISHABLE_KEY && process.env.DEMO_MODE !== '1';

if (clerkEnabled) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
} else {
  app.use((req, _res, next) => {
    (req as { auth?: unknown }).auth = { userId: "local-demo", sessionClaims: {} };
    next();
  });
}

app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Public, token-authenticated endpoints: client portal, signature pages and
// the subscribable calendar feed. Mounted before the auth guard so clients
// can open these links without a session.
app.use("/api", publicRouter);

app.use("/api", (req, res, next) => {
  // @clerk/express v2 exposes req.auth as an AuthFn (a function returning the
  // AuthObject) — call it. The demo-mode fallback above sets a plain object,
  // so handle both shapes.
  const auth = (req as { auth?: unknown }).auth;
  const authObj =
    typeof auth === "function"
      ? (auth as () => { sessionClaims?: { userId?: string | null } | null; userId?: string | null } | null)()
      : (auth as { sessionClaims?: { userId?: string | null } | null; userId?: string | null } | null | undefined);
  const userId = authObj?.sessionClaims?.userId || authObj?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}, tenantContext, router);

export default app;
