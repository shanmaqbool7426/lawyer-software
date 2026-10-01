import { useState, useMemo, useEffect } from 'react';
import { Link } from 'wouter';
import {
  AlertTriangle, ArrowRight, Check, ExternalLink,
  FolderOpen, Loader2, Search, ShieldCheck, User, X,
} from 'lucide-react';
import {
  useUnifiedSearch,
  useCheckClientConflict,
  useCheckCaseConflict,
  getCheckClientConflictQueryKey,
  getCheckCaseConflictQueryKey,
} from '@workspace/api-client-react';
import type {
  ClientConflictResult,
  CaseConflictResult,
  ConflictMatchType,
  CheckClientConflictParams,
  CheckCaseConflictParams,
  UnifiedSearchClient,
  UnifiedSearchCase,
} from '@workspace/api-client-react';

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (v?: string | Date | null) =>
  v ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
        .format(new Date(v as string)) : '—';

function useDebounce<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── Match type badge ─────────────────────────────────────────────────────────
const MATCH_META: Record<ConflictMatchType, { label: string; color: string; bg: string }> = {
  exact:    { label: 'Exact match',  color: '#b8403f', bg: '#b8403f14' },
  strong:   { label: 'Strong match', color: '#c97043', bg: '#c9704314' },
  possible: { label: 'Possible',     color: '#4b7bb5', bg: '#4b7bb514' },
};

function MatchBadge({ type, score }: { type: ConflictMatchType; score: number }) {
  const m = MATCH_META[type];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 22,
      borderRadius: 5, padding: '0 8px', fontSize: 10,
      fontFamily: 'var(--app-font-mono)', fontWeight: 700,
      color: m.color, background: m.bg,
    }}>
      {type === 'exact' && <AlertTriangle size={10} />}
      {m.label} · {score}%
    </span>
  );
}

// ─── Score bar ────────────────────────────────────────────────────────────────
function ScoreBar({ score }: { score: number }) {
  const color = score >= 95 ? '#b8403f' : score >= 70 ? '#c97043' : '#4b7bb5';
  return (
    <div style={{ height: 4, background: 'hsl(var(--muted))', borderRadius: 2, width: 60, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 2,
        transition: 'width .4s ease' }} />
    </div>
  );
}

// ─── Client conflict card ─────────────────────────────────────────────────────
function ClientConflictCard({ result }: { result: ClientConflictResult }) {
  return (
    <div className="card" style={{
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
      borderLeft: `3px solid ${MATCH_META[result.matchType].color}`,
      animation: 'fade-in .2s ease both',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: 'hsl(var(--muted))', display: 'grid', placeItems: 'center',
        color: 'hsl(var(--accent))',
      }}>
        <User size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{result.fullName}</div>
        <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3,
          display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {result.phone && <span>{result.phone}</span>}
          {result.email && <span>{result.email}</span>}
          <span>Since {fmtDate(result.createdAt)}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {result.reasons.map((r, i) => (
            <span key={i} style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))',
              background: 'hsl(var(--muted))', padding: '1px 7px', borderRadius: 4 }}>
              {r}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        <MatchBadge type={result.matchType} score={result.score} />
        <ScoreBar score={result.score} />
        <Link href={`/clients/${result.id}`}
          className="button button-ghost"
          style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}>
          View client <ExternalLink size={11} />
        </Link>
      </div>
    </div>
  );
}

// ─── Case conflict card ───────────────────────────────────────────────────────
function CaseConflictCard({ result }: { result: CaseConflictResult }) {
  return (
    <div className="card" style={{
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
      borderLeft: `3px solid ${MATCH_META[result.matchType].color}`,
      animation: 'fade-in .2s ease both',
    }}>
      <div style={{
        fontFamily: 'var(--app-font-mono)', fontSize: 13, fontWeight: 700,
        color: 'hsl(var(--accent))', flexShrink: 0, width: 44,
      }}>
        #{result.caseNumber}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{result.clientName}</div>
        <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3,
          display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {result.ticketNumber  && <span>Ticket: {result.ticketNumber}</span>}
          {result.statuteCode   && <span>{result.statuteCode}</span>}
          {result.offenceDescription && <span>{result.offenceDescription}</span>}
          <span>{result.status} · {fmtDate(result.intakeDate)}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {result.reasons.map((r, i) => (
            <span key={i} style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))',
              background: 'hsl(var(--muted))', padding: '1px 7px', borderRadius: 4 }}>
              {r}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        <MatchBadge type={result.matchType} score={result.score} />
        <ScoreBar score={result.score} />
        <Link href={`/cases/${result.id}`}
          className="button button-ghost"
          style={{ minHeight: 26, padding: '0 9px', fontSize: 11 }}>
          View case <ExternalLink size={11} />
        </Link>
      </div>
    </div>
  );
}

// ─── Main Conflict Checker Page ───────────────────────────────────────────────
export function ConflictCheckerPage() {
  const [query, setQuery]     = useState('');
  const debouncedQ            = useDebounce(query, 350);
  const [activeTab, setActiveTab] = useState<'all' | 'clients' | 'cases'>('all');

  const search = useUnifiedSearch(debouncedQ, {
    query: { queryKey: ['unified-search', debouncedQ], staleTime: 10000 },
  });

  const isLoading  = search.isFetching;
  const results    = search.data;
  const hasResults = !!results && (results.clients.length + results.cases.length) > 0;
  const noResults  = !!results && results.total === 0 && debouncedQ.length >= 2;

  const tabClients = (results?.clients ?? []) as UnifiedSearchClient[];
  const tabCases   = (results?.cases   ?? []) as UnifiedSearchCase[];

  return (
    <>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <div className="eyebrow">Due Diligence</div>
        <h1 className="page-title">Conflict Checker</h1>
        <p className="page-copy">
          Search for duplicate clients or cases before creating a new record.
          Powered by fuzzy name, phone, email, and ticket matching.
        </p>
      </div>

      {/* How it works strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { icon: <Search size={16} />, title: 'Type to search', desc: 'Name, phone, email, ticket number, statute code — anything' },
          { icon: <AlertTriangle size={16} />, title: 'Similarity scoring', desc: 'Each result scored 0–100% — exact, strong, or possible match' },
          { icon: <ShieldCheck size={16} />, title: 'Prevent duplicates', desc: 'Open the existing record and update instead of creating a new one' },
        ].map((item) => (
          <div key={item.title} className="card" style={{ padding: '14px 16px', display: 'flex', gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              background: 'hsl(var(--accent) / .1)', display: 'grid', placeItems: 'center',
              color: 'hsl(var(--accent))' }}>
              {item.icon}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{item.title}</div>
              <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3, lineHeight: 1.5 }}>
                {item.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search bar */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
          color: 'hsl(var(--muted-foreground))', pointerEvents: 'none' }}>
          {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </div>
        <input
          className="field"
          style={{ paddingLeft: 44, paddingRight: query ? 40 : 14, height: 48, fontSize: 15, borderRadius: 10 }}
          placeholder="Search name, phone, email, ticket #, statute code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'hsl(var(--muted-foreground))', padding: 4 }}>
            <X size={16} />
          </button>
        )}
      </div>

      {/* Tabs */}
      {hasResults && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[
            { key: 'all',     label: `All (${results!.total})` },
            { key: 'clients', label: `Clients (${tabClients.length})` },
            { key: 'cases',   label: `Cases (${tabCases.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`button ${activeTab === tab.key ? 'button-primary' : 'button-ghost'}`}
              style={{ minHeight: 32, padding: '0 14px', fontSize: 12 }}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {debouncedQ.length < 2 ? (
        <div className="card empty-state">
          <div className="empty-icon"><Search size={20} /></div>
          <h3>Start typing to check for duplicates</h3>
          <p>Enter at least 2 characters — client name, phone, email, ticket number, or statute code.</p>
        </div>
      ) : noResults ? (
        <div className="card empty-state">
          <div className="empty-icon"><Check size={20} style={{ color: 'hsl(var(--chart-2))' }} /></div>
          <h3 style={{ color: 'hsl(var(--chart-2))' }}>No conflicts found</h3>
          <p>No existing clients or cases match <strong>"{debouncedQ}"</strong>. Safe to create a new record.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4 }}>
            <Link href="/clients" className="button button-ghost" style={{ fontSize: 12 }}>
              <User size={13} /> New client
            </Link>
            <Link href="/cases/new" className="button button-accent" style={{ fontSize: 12 }}>
              <ArrowRight size={13} /> New case
            </Link>
          </div>
        </div>
      ) : hasResults ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

          {/* Clients section */}
          {(activeTab === 'all' || activeTab === 'clients') && tabClients.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Clients</div>
                <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))',
                  background: 'hsl(var(--muted))', padding: '1px 8px', borderRadius: 20 }}>
                  {tabClients.length} match{tabClients.length !== 1 ? 'es' : ''}
                </span>
                <div style={{ flex: 1, height: 1, background: 'hsl(var(--border))' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tabClients.map((c) => (
                  <ClientConflictCard
                    key={c.id}
                    result={{ ...c, reasons: [], matchType: c.score >= 95 ? 'exact' : c.score >= 70 ? 'strong' : 'possible' } as ClientConflictResult}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Cases section */}
          {(activeTab === 'all' || activeTab === 'cases') && tabCases.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Cases</div>
                <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))',
                  background: 'hsl(var(--muted))', padding: '1px 8px', borderRadius: 20 }}>
                  {tabCases.length} match{tabCases.length !== 1 ? 'es' : ''}
                </span>
                <div style={{ flex: 1, height: 1, background: 'hsl(var(--border))' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {tabCases.map((c) => (
                  <CaseConflictCard
                    key={c.id}
                    result={{ ...c, reasons: [], matchType: c.score >= 95 ? 'exact' : c.score >= 70 ? 'strong' : 'possible',
                      courtLocation: null } as CaseConflictResult}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card skeleton" style={{ height: 72, borderRadius: 8 }} />
          ))}
        </div>
      ) : null}
    </>
  );
}

// ─── Inline conflict warning — for use inside forms ───────────────────────────
// Used inside NewCase and NewClient forms to show conflicts as user types.

interface InlineClientConflictProps {
  name: string;
  phone?: string;
  email?: string;
  excludeId?: string;
}

export function InlineClientConflictWarning({ name, phone, email, excludeId }: InlineClientConflictProps) {
  const dName  = useDebounce(name,  500);
  const dPhone = useDebounce(phone  ?? '', 500);
  const dEmail = useDebounce(email  ?? '', 500);

  const params = useMemo<CheckClientConflictParams>(() => ({
    name:      dName.length  >= 3 ? dName  : undefined,
    phone:     dPhone.length >= 7 ? dPhone : undefined,
    email:     dEmail.includes('@') ? dEmail : undefined,
    excludeId,
  }), [dName, dPhone, dEmail, excludeId]);

  const conflict = useCheckClientConflict(params, {
    query: { queryKey: getCheckClientConflictQueryKey(params), staleTime: 8000 },
  });

  const results = conflict.data?.results ?? [];
  if (!results.length) return null;

  const top = results[0];
  const isExact = top.matchType === 'exact';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', borderRadius: 7, marginTop: 6,
      background: isExact ? 'hsl(var(--destructive) / .07)' : 'hsl(var(--accent) / .07)',
      border: `1px solid ${isExact ? 'hsl(var(--destructive) / .3)' : 'hsl(var(--accent) / .3)'}`,
      animation: 'fade-in .2s ease both',
    }}>
      <AlertTriangle size={15} style={{
        color: isExact ? 'hsl(var(--destructive))' : 'hsl(var(--accent))',
        flexShrink: 0, marginTop: 1,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12,
          color: isExact ? 'hsl(var(--destructive))' : 'hsl(var(--accent))' }}>
          {isExact ? 'Possible duplicate client' : `${results.length} similar client${results.length > 1 ? 's' : ''} found`}
        </div>
        <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
          {results.slice(0, 3).map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontWeight: 600 }}>{r.fullName}</span>
              {r.phone && <span>· {r.phone}</span>}
              <MatchBadge type={r.matchType} score={r.score} />
              <Link href={`/clients/${r.id}`} style={{ color: 'hsl(var(--accent))',
                textDecoration: 'none', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                View <ExternalLink size={10} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface InlineCaseConflictProps {
  ticketNumber?: string;
  statuteCode?: string;
  clientId?: string;
  excludeId?: string;
}

export function InlineCaseConflictWarning({ ticketNumber, statuteCode, clientId, excludeId }: InlineCaseConflictProps) {
  const dTicket  = useDebounce(ticketNumber ?? '', 500);
  const dStatute = useDebounce(statuteCode  ?? '', 500);

  const params = useMemo<CheckCaseConflictParams>(() => ({
    ticketNumber: dTicket.length  >= 3 ? dTicket  : undefined,
    statuteCode:  dStatute.length >= 2 ? dStatute : undefined,
    clientId:     clientId || undefined,
    excludeId,
  }), [dTicket, dStatute, clientId, excludeId]);

  const conflict = useCheckCaseConflict(params, {
    query: { queryKey: getCheckCaseConflictQueryKey(params), staleTime: 8000 },
  });

  const results = conflict.data?.results ?? [];
  if (!results.length) return null;

  const top     = results[0];
  const isExact = top.matchType === 'exact';

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', borderRadius: 7, marginTop: 6,
      background: isExact ? 'hsl(var(--destructive) / .07)' : 'hsl(var(--accent) / .07)',
      border: `1px solid ${isExact ? 'hsl(var(--destructive) / .3)' : 'hsl(var(--accent) / .3)'}`,
      animation: 'fade-in .2s ease both',
    }}>
      <AlertTriangle size={15} style={{
        color: isExact ? 'hsl(var(--destructive))' : 'hsl(var(--accent))',
        flexShrink: 0, marginTop: 1,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12,
          color: isExact ? 'hsl(var(--destructive))' : 'hsl(var(--accent))' }}>
          {isExact ? 'Duplicate ticket detected' : `${results.length} similar case${results.length > 1 ? 's' : ''} found`}
        </div>
        <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 3 }}>
          {results.slice(0, 3).map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--app-font-mono)', fontWeight: 700 }}>#{r.caseNumber}</span>
              <span>{r.clientName}</span>
              {r.ticketNumber && <span>· {r.ticketNumber}</span>}
              <MatchBadge type={r.matchType} score={r.score} />
              <Link href={`/cases/${r.id}`} style={{ color: 'hsl(var(--accent))',
                textDecoration: 'none', fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                View <ExternalLink size={10} />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
