import { Router, type IRouter, type Request, type Response } from "express";
import {
  DisconnectGoogleIntegrationResponse,
  GetGoogleIntegrationResponse,
  StartGoogleIntegrationResponse,
  SyncGoogleIntegrationResponse,
} from "@workspace/api-zod";
import {
  baseUrlFromRequest,
  createOAuthState,
  disconnect,
  exchangeCodeForTokens,
  fetchGoogleEmail,
  googleAuthUrl,
  googleConfigured,
  googleRedirectUri,
  googleStatus,
  readOAuthState,
  runGoogleSync,
  saveConnection,
  scopeHasCalendar,
} from "../lib/googleCalendar";
import { backfillCourtMirrors } from "../lib/courtSchedule";

const router: IRouter = Router();
const publicRouter: IRouter = Router();

const tenantOf = (res: Response): string => String(res.locals.tenantId ?? "");

/** The signed-in lawyer. Demo mode resolves to a stable synthetic id. */
function userIdOf(req: Request): string {
  const auth = (req as { auth?: unknown }).auth;
  const obj =
    typeof auth === "function"
      ? (auth as () => { sessionClaims?: { userId?: string | null } | null; userId?: string | null } | null)()
      : (auth as { sessionClaims?: { userId?: string | null } | null; userId?: string | null } | null | undefined);
  return String(obj?.sessionClaims?.userId || obj?.userId || "local-demo");
}

/**
 * Origin of the SPA, used both for the OAuth redirect_uri and for sending the
 * lawyer back to the schedule afterwards. In development the SPA runs on a
 * different port than the API, so the request's own host is not enough.
 */
function appBaseUrlFromRequest(req: Request): string {
  const configured = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  if (configured) return configured;

  const origin = String(req.headers.origin ?? "").replace(/\/+$/, "");
  if (origin) return origin;

  const referer = String(req.headers.referer ?? "");
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }
  return baseUrlFromRequest(req);
}

// ─── GET /integrations/google ────────────────────────────────────────────────
router.get("/integrations/google", async (_req, res): Promise<void> => {
  const status = await googleStatus(tenantOf(res));
  res.json(GetGoogleIntegrationResponse.parse(status));
});

// ─── GET /integrations/google/start ──────────────────────────────────────────
router.get("/integrations/google/start", (req, res): void => {
  if (!googleConfigured()) {
    res.json(
      StartGoogleIntegrationResponse.parse({
        configured: false,
        url: null,
        error:
          "Google Calendar is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      }),
    );
    return;
  }
  const appBaseUrl = appBaseUrlFromRequest(req);
  const state = createOAuthState({
    tenantId: tenantOf(res),
    userId: userIdOf(req),
    appBaseUrl,
  });
  const redirectUri = googleRedirectUri(appBaseUrl);
  res.json(
    StartGoogleIntegrationResponse.parse({
      configured: true,
      url: googleAuthUrl(redirectUri, state),
      error: null,
    }),
  );
});

// ─── GET /integrations/google/callback (public) ──────────────────────────────
// Google redirects the browser here, so there is no Clerk session and no
// tenant middleware. Trust comes from the HMAC-signed state parameter, which
// also carries the SPA origin to return to.
publicRouter.get("/integrations/google/callback", async (req, res): Promise<void> => {
  const state = readOAuthState(String(req.query.state ?? ""));
  const appBaseUrl = state?.appBaseUrl ?? appBaseUrlFromRequest(req);
  const back = (params: string) => `${appBaseUrl}/appointments?${params}`;

  if (!state) {
    res.redirect(back("google=error&reason=expired"));
    return;
  }
  const denied = req.query.error;
  if (denied) {
    res.redirect(back(`google=error&reason=${encodeURIComponent(String(denied))}`));
    return;
  }
  const code = String(req.query.code ?? "");
  if (!code) {
    res.redirect(back("google=error&reason=missing_code"));
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code, googleRedirectUri(appBaseUrl));
    // The consent screen has a calendar tick box. If it was cleared, the token
    // still answers the email lookup but every calendar call 403s — refuse it
    // here instead of storing a connection that can never push an event.
    if (!scopeHasCalendar(tokens.scope)) {
      res.redirect(back("google=error&reason=nocalendar"));
      return;
    }
    const accountEmail = await fetchGoogleEmail(tokens.accessToken);
    await saveConnection({
      tenantId: state.tenantId,
      userId: state.userId,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
      accountEmail,
    });
    // First sync: mirrors the whole register into the new calendar.
    await backfillCourtMirrors(state.tenantId);
    await runGoogleSync(state.tenantId);
    res.redirect(back("google=connected"));
  } catch (error: any) {
    const reason = String(error?.message ?? "connect_failed").slice(0, 140);
    res.redirect(back(`google=error&reason=${encodeURIComponent(reason)}`));
  }
});

// ─── POST /integrations/google/sync ──────────────────────────────────────────
router.post("/integrations/google/sync", async (_req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  if (!googleConfigured()) {
    res.status(400).json({ error: "Google Calendar is not configured on this server" });
    return;
  }
  // Legacy workspaces have court dates but no mirror rows yet.
  await backfillCourtMirrors(tenantId);
  const result = await runGoogleSync(tenantId);
  res.json(SyncGoogleIntegrationResponse.parse(result));
});

// ─── DELETE /integrations/google ─────────────────────────────────────────────
router.delete("/integrations/google", async (_req, res): Promise<void> => {
  const removed = await disconnect(tenantOf(res));
  res.json(DisconnectGoogleIntegrationResponse.parse({ disconnected: removed }));
});

export default router;
export { publicRouter as googlePublicRouter };
