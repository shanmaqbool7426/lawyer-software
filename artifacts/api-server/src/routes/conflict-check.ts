import { Router, type IRouter } from "express";
import { CaseModel, ClientModel } from "@workspace/db";

const router: IRouter = Router();

const tenantOf = (res: { locals: Record<string, unknown> }): string =>
  String(res.locals.tenantId ?? "");

// ─── helpers ─────────────────────────────────────────────────────────────────

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalise a phone string to digits only for comparison.
 */
function digitsOnly(s: string) {
  return s.replace(/\D/g, "");
}

/**
 * Simple trigram similarity — 0..1.
 * Fast enough for small collections (<50k docs after MongoDB pre-filter).
 */
function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;

  const trigrams = (s: string) => {
    const padded = `  ${s}  `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };

  const ta = trigrams(na);
  const tb = trigrams(nb);
  let intersection = 0;
  ta.forEach((t) => { if (tb.has(t)) intersection++; });
  return (2 * intersection) / (ta.size + tb.size);
}

/**
 * Levenshtein distance — used for short strings (phone, ticket number).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function phoneScore(a: string, b: string): number {
  const da = digitsOnly(a), db = digitsOnly(b);
  if (!da || !db) return 0;
  if (da === db) return 1;
  // Last 7 digits match → strong match
  if (da.slice(-7) === db.slice(-7)) return 0.9;
  const dist = levenshtein(da, db);
  const maxLen = Math.max(da.length, db.length);
  return Math.max(0, 1 - dist / maxLen);
}

// ─── GET /conflict-check/clients ─────────────────────────────────────────────
// Query: name?, phone?, email?, excludeId?
// Returns up to 10 potential duplicates with a similarity score.
router.get("/conflict-check/clients", async (req, res): Promise<void> => {
  const tenantId  = tenantOf(res);
  const { name, phone, email, excludeId } = req.query as Record<string, string>;

  if (!name && !phone && !email) {
    res.status(400).json({ error: "Provide at least one of: name, phone, email" });
    return;
  }

  // Pre-filter with MongoDB regex (cheap) then score in JS
  const orConditions: Record<string, unknown>[] = [];
  if (name)  orConditions.push({ fullName: { $regex: escapeRegex(name.split(" ")[0] ?? name), $options: "i" } });
  if (phone) {
    const digits = digitsOnly(phone);
    if (digits.length >= 4) orConditions.push({ phone: { $regex: digits.slice(-7), $options: "i" } });
  }
  if (email) orConditions.push({ email: { $regex: escapeRegex(email.split("@")[0] ?? email), $options: "i" } });

  const baseQuery: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (orConditions.length) baseQuery.$or = orConditions;
  if (excludeId) baseQuery.id = { $ne: excludeId };

  const candidates = await ClientModel.find(baseQuery).limit(100).lean();

  // Score each candidate
  const scored = candidates.map((c) => {
    let score = 0;
    let reasons: string[] = [];

    if (name) {
      const ns = trigramSimilarity(name, c.fullName);
      if (ns > 0.3) { score = Math.max(score, ns); reasons.push(`Name similarity: ${Math.round(ns * 100)}%`); }
    }
    if (phone && c.phone) {
      const ps = phoneScore(phone, c.phone);
      if (ps > 0.7) { score = Math.max(score, ps * 0.95); reasons.push(`Phone match: ${Math.round(ps * 100)}%`); }
    }
    if (email && c.email) {
      const exact = email.toLowerCase() === c.email.toLowerCase();
      const domainMatch = email.split("@")[1]?.toLowerCase() === c.email.split("@")[1]?.toLowerCase();
      const emailScore = exact ? 1 : domainMatch ? 0.5 : trigramSimilarity(email, c.email);
      if (emailScore > 0.5) { score = Math.max(score, emailScore); reasons.push(`Email match: ${Math.round(emailScore * 100)}%`); }
    }

    // Exact phone match with same name initials → very high
    if (phone && c.phone && digitsOnly(phone) === digitsOnly(c.phone)) {
      score = Math.max(score, 0.98);
      reasons = ["Exact phone match"];
    }
    if (email && c.email && email.toLowerCase() === c.email.toLowerCase()) {
      score = Math.max(score, 0.99);
      reasons = ["Exact email match"];
    }

    return { client: c, score, reasons };
  });

  const results = scored
    .filter((r) => r.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ client: c, score, reasons }) => ({
      id:               c.id,
      fullName:         c.fullName,
      phone:            c.phone ?? null,
      email:            c.email ?? null,
      leadSourceChannel:c.leadSourceChannel,
      createdAt:        c.createdAt,
      score:            Math.round(score * 100),
      reasons,
      matchType:        score >= 0.95 ? "exact" : score >= 0.7 ? "strong" : "possible",
    }));

  res.json({ results, query: { name, phone, email } });
});

// ─── GET /conflict-check/cases ────────────────────────────────────────────────
// Query: ticketNumber?, statuteCode?, clientId?, excludeId?
router.get("/conflict-check/cases", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const { ticketNumber, statuteCode, clientId, excludeId } = req.query as Record<string, string>;

  if (!ticketNumber && !statuteCode && !clientId) {
    res.status(400).json({ error: "Provide at least one of: ticketNumber, statuteCode, clientId" });
    return;
  }

  const orConditions: Record<string, unknown>[] = [];
  if (ticketNumber) orConditions.push({ ticketNumber: { $regex: escapeRegex(ticketNumber.replace(/\s/g, "")), $options: "i" } });
  if (statuteCode)  orConditions.push({ statuteCode:  { $regex: escapeRegex(statuteCode.trim()), $options: "i" } });
  if (clientId)     orConditions.push({ clientId });

  const baseQuery: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  if (orConditions.length) baseQuery.$or = orConditions;
  if (excludeId) baseQuery.id = { $ne: excludeId };

  const candidates = await CaseModel.find(baseQuery).limit(100).lean();

  // Enrich with client names
  const clientIds = Array.from(new Set(candidates.map((c) => c.clientId)));
  const clients = clientIds.length
    ? await ClientModel.find({ tenantId, id: { $in: clientIds } }).select("id fullName").lean()
    : [];
  const clientNameById = new Map(clients.map((c) => [c.id, c.fullName]));

  const scored = candidates.map((c) => {
    let score = 0;
    const reasons: string[] = [];

    if (ticketNumber && c.ticketNumber) {
      const tn = ticketNumber.replace(/\s/g, "").toUpperCase();
      const cn = c.ticketNumber.replace(/\s/g, "").toUpperCase();
      if (tn === cn) {
        score = 1; reasons.push("Exact ticket number match");
      } else {
        const dist = levenshtein(tn, cn);
        const sim  = Math.max(0, 1 - dist / Math.max(tn.length, cn.length));
        if (sim > 0.7) { score = Math.max(score, sim); reasons.push(`Ticket similarity: ${Math.round(sim * 100)}%`); }
      }
    }

    if (statuteCode && c.statuteCode) {
      const sa = statuteCode.trim().toUpperCase();
      const sb = c.statuteCode.trim().toUpperCase();
      if (sa === sb) { score = Math.max(score, 0.75); reasons.push("Same statute code"); }
      else {
        const sim = trigramSimilarity(sa, sb);
        if (sim > 0.6) { score = Math.max(score, sim * 0.7); reasons.push(`Statute similarity: ${Math.round(sim * 100)}%`); }
      }
    }

    if (clientId && c.clientId === clientId) {
      score = Math.max(score, 0.6); reasons.push("Same client");
    }

    return { case: c, score, reasons, clientName: clientNameById.get(c.clientId) ?? "Unknown" };
  });

  const results = scored
    .filter((r) => r.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ case: c, score, reasons, clientName }) => ({
      id:                 c.id,
      caseNumber:         c.caseNumber,
      clientId:           c.clientId,
      clientName,
      ticketNumber:       c.ticketNumber  ?? null,
      statuteCode:        c.statuteCode   ?? null,
      offenceDescription: c.offenceDescription ?? null,
      courtLocation:      c.courtLocation ?? null,
      status:             c.status,
      intakeDate:         c.intakeDate,
      score:              Math.round(score * 100),
      reasons,
      matchType:          score >= 0.95 ? "exact" : score >= 0.7 ? "strong" : "possible",
    }));

  res.json({ results, query: { ticketNumber, statuteCode, clientId } });
});

// ─── GET /conflict-check/search ───────────────────────────────────────────────
// Unified search: q param searches across clients (name/phone/email) AND
// cases (ticketNumber/statuteCode/offenceDescription)
router.get("/conflict-check/search", async (req, res): Promise<void> => {
  const tenantId = tenantOf(res);
  const { q } = req.query as Record<string, string>;

  if (!q || q.trim().length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  const term    = q.trim();
  const re      = { $regex: escapeRegex(term), $options: "i" };
  const digits  = digitsOnly(term);

  // Parallel search clients + cases
  const clientOrConds: Record<string, unknown>[] = [
    { fullName: re },
    { email:    re },
  ];
  if (digits.length >= 4) clientOrConds.push({ phone: { $regex: digits.slice(-7) } });

  const caseOrConds: Record<string, unknown>[] = [
    { ticketNumber:       re },
    { statuteCode:        re },
    { offenceDescription: re },
    { courtLocation:      re },
  ];
  // If term looks like a case number (#42 or just 42)
  const numTerm = parseInt(term.replace(/^#/, ""), 10);
  if (!isNaN(numTerm)) caseOrConds.push({ caseNumber: numTerm });

  const [rawClients, rawCases] = await Promise.all([
    ClientModel.find({ tenantId, isDeleted: { $ne: true }, $or: clientOrConds }).limit(20).lean(),
    CaseModel.find({ tenantId, isDeleted: { $ne: true }, $or: caseOrConds }).limit(20).lean(),
  ]);

  // Enrich cases with client names
  const caseClientIds = Array.from(new Set(rawCases.map((c) => c.clientId)));
  const caseClients = caseClientIds.length
    ? await ClientModel.find({ tenantId, id: { $in: caseClientIds } }).select("id fullName").lean()
    : [];
  const clientNameById = new Map(caseClients.map((c) => [c.id, c.fullName]));

  const clients = rawClients.map((c) => {
    const nameScore   = trigramSimilarity(term, c.fullName);
    const phoneScore_ = c.phone ? phoneScore(term, c.phone) : 0;
    const emailScore  = c.email ? trigramSimilarity(term, c.email) : 0;
    const score       = Math.max(nameScore, phoneScore_ * 0.95, emailScore);
    return {
      type: "client" as const,
      id:               c.id,
      fullName:         c.fullName,
      phone:            c.phone    ?? null,
      email:            c.email    ?? null,
      leadSourceChannel:c.leadSourceChannel,
      createdAt:        c.createdAt,
      score:            Math.round(Math.max(score, 0.4) * 100),
    };
  });

  const cases = rawCases.map((c) => {
    const tnScore = c.ticketNumber  ? trigramSimilarity(term, c.ticketNumber)  : 0;
    const scScore = c.statuteCode   ? trigramSimilarity(term, c.statuteCode)   : 0;
    const odScore = c.offenceDescription ? trigramSimilarity(term, c.offenceDescription) : 0;
    const cnMatch = !isNaN(numTerm) && c.caseNumber === numTerm ? 1 : 0;
    const score   = Math.max(tnScore, scScore * 0.8, odScore * 0.6, cnMatch);
    return {
      type:               "case" as const,
      id:                 c.id,
      caseNumber:         c.caseNumber,
      clientId:           c.clientId,
      clientName:         clientNameById.get(c.clientId) ?? "Unknown",
      ticketNumber:       c.ticketNumber       ?? null,
      statuteCode:        c.statuteCode        ?? null,
      offenceDescription: c.offenceDescription ?? null,
      status:             c.status,
      intakeDate:         c.intakeDate,
      score:              Math.round(Math.max(score, 0.4) * 100),
    };
  });

  // Sort all by score desc
  const allResults = [...clients, ...cases].sort((a, b) => b.score - a.score);

  res.json({
    query:   term,
    total:   allResults.length,
    clients: clients.sort((a, b) => b.score - a.score),
    cases:   cases.sort((a, b) => b.score - a.score),
    all:     allResults,
  });
});

export default router;
