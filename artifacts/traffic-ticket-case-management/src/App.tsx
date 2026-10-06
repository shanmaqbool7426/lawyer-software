import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, RedirectToSignIn, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, Bell, BriefcaseBusiness,
  Building2, Calendar, CalendarClock, Car, Check, ClipboardList, Copy, Download, ExternalLink, FilePlus2,
  FileSpreadsheet, FileText, FolderOpen, Import, LayoutDashboard, Link2, Loader2, LogOut, Mail,
  NotebookPen, Paperclip, PenLine, Plus, Receipt, Search, Settings2, ShieldCheck, Trash2, TrendingUp,
  Upload, UserRound, Users, UsersRound, X, ReceiptText, Wallet, CalendarDays, ShieldAlert,
} from 'lucide-react';
import { InvoicesPage, NewInvoicePage, InvoiceDetailPage } from '@/pages/invoices';
import { ExpensesPage, CaseExpensesPanel } from '@/pages/expenses';
import { AppointmentsPage, UpcomingAppointmentsPanel } from '@/pages/appointments';
import { ConflictCheckerPage, InlineClientConflictWarning, InlineCaseConflictWarning } from '@/pages/conflict-checker';
import {
  AreaChart, Area, BarChart, Bar, Cell, PieChart, Pie, Tooltip, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import {
  getDocument, getGetCaseQueryKey, getGetClientQueryKey, getGetDashboardQueryKey, getGetNotificationsQueryKey,
  getGetReportsSummaryQueryKey, getListCasesQueryKey, getListCaseDocumentsQueryKey, getListClientsQueryKey,
  getListSignatureRequestsQueryKey, getListTrustEntriesQueryKey, getListWorkspacesQueryKey, getExportOutstandingQueryKey,
  getPortalView, getSignatureRequest, signSignatureRequest, downloadPortalDocument, setWorkspaceId,
  useCommitImport, useCreateCase, useCreateClient, useCreateCourtDate, useCreateDocument, useCreateNote,
  useCreatePayment, useCreatePortalLink, useCreateSignatureRequest, useCreateTrustEntry, useCreateWorkspace,
  useDeleteCase, useDeleteCaseNote, useDeleteClient, useDeleteCourtDate, useDeleteDocument, useDeleteSignatureRequest,
  useDeleteTrustEntry, useExportOutstanding, useGetCalendarFeed, useGetCase, useGetClient, useGetDashboard,
  useGetNotifications, useGetReportsSummary, useHealthCheck, useListCases, useListCaseDocuments, useListClients,
  useListSignatureRequests, useListTrustEntries, useListWorkspaces, usePreviewImport, useRegenerateCalendarFeed,
  useRevokePortalLink, useSendPortalEmail, useRefundCasePayment, useUpdateCase, useUpdateCaseNote, useUpdateClient, useVoidCasePayment,
} from '@workspace/api-client-react';
import type { Case, CaseDetail, Client, Payment } from '@workspace/api-client-react';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
// The production publishable key is public by design (it ships in every
// visitor's bundle), so embedding it is safe. Env vars still win when set,
// keeping localhost on the pk_test development key from .env.local.
const PROD_CLERK_PUBLISHABLE_KEY = 'pk_live_Y2xlcmsubGF3eWVyLXNvZnR3YXJlLW5pbmUudmVyY2VsLmFwcCQ';
const rawClerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || (import.meta.env.PROD ? PROD_CLERK_PUBLISHABLE_KEY : undefined);
const clerkPubKey = (() => {
  try {
    return publishableKeyFromHost(window.location.hostname, rawClerkPubKey) || rawClerkPubKey;
  } catch {
    return rawClerkPubKey;
  }
})();
// On vercel.app deployments Clerk runs through the app-origin proxy path
// (vercel.app domains cannot hold DNS records), so derive it from the host —
// no env var needed. Localhost dev uses pk_test against the real Frontend API
// and needs no proxy.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || (import.meta.env.PROD ? `https://${window.location.host}/__clerk` : undefined);
const demoMode = !rawClerkPubKey && (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === '1');
const statuses = ['Open', 'Disclosure Requested', 'Filed', 'Resummoned', 'Awaiting Trial', 'Withdrawn', 'Resolved', 'Closed'];
const leadSources = ['Referral', 'Website', 'Google Search', 'Google Ads', 'Meta Ads', 'AI Assistant / Chatbot', 'Walk-in', 'Repeat Client', 'Other'];
const clerkAppearance = {
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#c95743',
    colorForeground: '#1c2b3c',
    colorMutedForeground: '#647080',
    colorDanger: '#b8403f',
    colorBackground: '#fbfaf6',
    colorInput: '#ffffff',
    colorInputForeground: '#1c2b3c',
    colorNeutral: '#dfe3e5',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf6] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#1c2b3c]',
    headerSubtitle: 'text-[#647080]',
    socialButtonsBlockButtonText: 'text-[#1c2b3c]',
    formFieldLabel: 'text-[#1c2b3c]',
    footerActionLink: 'text-[#c95743]',
    footerActionText: 'text-[#647080]',
    dividerText: 'text-[#647080]',
    identityPreviewEditButton: 'text-[#c95743]',
    formFieldSuccessText: 'text-[#2e8f7b]',
    alertText: 'text-[#b8403f]',
    logoBox: 'rounded-xl',
    logoImage: 'max-h-12',
    socialButtonsBlockButton: 'border-[#dfe3e5]',
    formButtonPrimary: '!bg-[#c95743] hover:!bg-[#b04836] !text-white',
    formFieldInput: '!bg-white !border-[#dfe3e5] !text-[#1c2b3c]',
    footerAction: 'border-t border-[#dfe3e5]',
    dividerLine: 'bg-[#dfe3e5]',
    alert: 'border-[#b8403f]',
    otpCodeFieldInput: '!bg-white !border-[#dfe3e5] !text-[#1c2b3c]',
    formFieldRow: 'gap-2',
    main: 'bg-transparent',
  },
};
const money = (value = 0) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
const dateLabel = (value?: string | null) => value ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';
const compactDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
const initials = (name = 'Admin') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

// Court date countdown helpers
const daysUntil = (dateStr?: string | null): number | null => {
  if (!dateStr) return null;
  const diff = new Date(dateStr).setHours(0,0,0,0) - new Date().setHours(0,0,0,0);
  return Math.round(diff / 86400000);
};
const countdownLabel = (days: number | null): string => {
  if (days === null) return '';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days}d`;
};
const countdownColor = (days: number | null): string => {
  if (days === null) return '';
  if (days < 0) return 'hsl(var(--destructive))';
  if (days <= 3) return 'hsl(var(--accent))';
  if (days <= 14) return 'hsl(var(--chart-3))';
  return 'hsl(var(--chart-2))';
};

// Legacy localStorage document store — read once per browser, migrated to the server, then cleared
type LegacyDocEntry = { name?: string; type?: string; size?: number; dataUrl?: string; caseId?: string };
const DOCS_KEY = 'docketline_docs_v1';
const readLegacyDocs = (): LegacyDocEntry[] => { try { return JSON.parse(localStorage.getItem(DOCS_KEY) || '[]'); } catch { return []; } };
const clearLegacyDocs = () => localStorage.removeItem(DOCS_KEY);
const formatBytes = (b: number) => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(1)}MB`;

function StatusPill({ status }: { status?: string | null }) {
  const slug = (status || 'pending').toLowerCase().replace(/\s/g, '-');
  return <span data-testid={`status-${slug}`} className={`pill pill-${slug}`}>{status || 'Pending'}</span>;
}

function CountdownBadge({ date }: { date?: string | null }) {
  const days = daysUntil(date);
  if (days === null) return null;
  const label = countdownLabel(days);
  const color = countdownColor(days);
  return (
    <span className="countdown-badge" style={{ color, borderColor: color, background: `${color}18` }}>
      <CalendarClock size={11} />
      {label}
    </span>
  );
}

function LoadingState({ rows = 4 }: { rows?: number }) {
  return <div className="card" data-testid="state-loading">{Array.from({ length: rows }).map((_, i) => <div key={i} style={{ height: 54, margin: '0 16px', borderBottom: '1px solid hsl(var(--border))', display: 'flex', alignItems: 'center', gap: 14 }}><div className="skeleton" style={{ width: 34, height: 24 }} /><div className="skeleton" style={{ width: `${42 + (i * 11) % 32}%`, height: 11 }} /></div>)}</div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="card error-panel" data-testid="state-error"><AlertCircle size={18} /><span>We couldn't load this view.</span><button className="button button-ghost" data-testid="button-retry" onClick={onRetry}>Try again</button></div>;
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-state" data-testid="state-empty"><div className="empty-icon"><FolderOpen size={20} /></div><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: React.ReactNode }) {
  return <div className="section-head" style={{ alignItems: 'flex-start', marginBottom: 25 }}><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1>{copy && <p className="page-copy">{copy}</p>}</div>{action && <div className="button-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{action}</div>}</div>;
}

function PaginationControls({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const maxVisible = 5;
  let visiblePages: (number | string)[] = [];
  if (totalPages <= maxVisible) {
    visiblePages = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    const half = Math.floor(maxVisible / 2);
    let left = Math.max(1, page - half);
    let right = Math.min(totalPages, left + maxVisible - 1);
    if (right - left < maxVisible - 1) left = Math.max(1, right - maxVisible + 1);
    visiblePages = Array.from({ length: right - left + 1 }, (_, i) => left + i);
    if (left > 1) visiblePages = [1, '…', ...visiblePages];
    if (right < totalPages) visiblePages = [...visiblePages, '…', totalPages];
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid hsl(var(--border))' }}>
      <div className="muted" style={{ fontSize: 11 }}>Showing {start}–{end} of {total}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="button button-ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)} style={{ minHeight: 28, padding: '0 10px' }}>Previous</button>
        {visiblePages.map((p, i) => (
          p === '…'
            ? <span key={`ellipsis-${i}`} className="muted" style={{ padding: '0 6px' }}>…</span>
            : <button key={p} className={`button ${p === page ? 'button-primary' : 'button-ghost'}`} onClick={() => onPageChange(p as number)} style={{ minHeight: 28, padding: '0 12px' }}>{p}</button>
        ))}
        <button className="button button-ghost" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} style={{ minHeight: 28, padding: '0 10px' }}>Next</button>
      </div>
    </div>
  );
}

function NavLink({ href, icon: Icon, children }: { href: string; icon: typeof LayoutDashboard; children: React.ReactNode }) {
  const [location] = useLocation();
  const active = href === '/' ? location === '/' : location.startsWith(href);
  return <Link href={href} data-testid={`link-${href.slice(1) || 'dashboard'}`} className={`nav-link ${active ? 'active' : ''}`}><Icon /> <span>{children}</span></Link>;
}

function NavSoon({ icon: Icon, children }: { icon: typeof LayoutDashboard; children: React.ReactNode }) {
  return <div className="nav-link nav-soon" aria-disabled="true" title="Coming soon"><Icon /> <span>{children}</span><span className="pill-soon">Soon</span></div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const health = useHealthCheck();
  const signOut = demoMode ? undefined : useClerk().signOut;
  const nav = <><NavLink href="/" icon={LayoutDashboard}>Overview</NavLink><NavLink href="/cases" icon={BriefcaseBusiness}>Cases</NavLink><NavLink href="/clients" icon={UsersRound}>Clients</NavLink><NavSoon icon={ReceiptText}>Invoices</NavSoon><NavSoon icon={Wallet}>Expenses</NavSoon><NavSoon icon={CalendarDays}>Appointments</NavSoon><NavSoon icon={ShieldAlert}>Conflict Check</NavSoon><NavSoon icon={BarChart3}>Reports</NavSoon><NavSoon icon={Import}>Import legacy</NavSoon></>;
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand" data-testid="link-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', gap: 10, alignItems: 'center' }}><div className="brand-mark">TT</div><div><div className="brand-name">Docketline</div><div className="brand-sub">Ontario traffic law</div></div></Link>
      <div className="nav-label">Workspace</div><nav>{nav}</nav>
       <div className="nav-label">Account</div><button className="nav-link" data-testid="link-sign-out" onClick={() => signOut?.({ redirectUrl: `${basePath}/sign-in` })}><LogOut /><span>Sign out</span></button>
      <div className="sidebar-foot"><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><div className="admin-avatar">AM</div><div><div style={{ fontSize: 12, fontWeight: 700 }}>Avery McLean</div><div style={{ fontSize: 10, color: 'hsl(var(--sidebar-foreground) / .5)', marginTop: 3 }}>Principal paralegal</div></div></div><div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, color: 'hsl(var(--sidebar-foreground) / .5)', fontSize: 10 }}><div className="health-dot" style={{ width: 6, height: 6 }} /> {health.isError ? 'Offline mode' : health.isLoading ? 'Checking system' : 'System operational'}</div></div>
    </aside>
    <div className="main-column">
      <div className="mobile-top"><Link href="/" data-testid="link-mobile-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 9 }}><div className="brand-mark">TT</div><strong>Docketline</strong></Link><Link href="/login" data-testid="link-mobile-account" style={{ color: 'inherit' }}><UserRound size={18} /></Link></div>
      <div className="mobile-nav">{nav}</div>
      <header className="topbar"><div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}><WorkspaceSwitcher /><div className="muted" style={{ fontSize: 12 }}>Ontario / <strong style={{ color: 'hsl(var(--foreground))' }}>Operations desk</strong></div></div><div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><div className="health-dot" /><span className="muted" style={{ fontSize: 11 }}>{health.isError ? 'Connection issue' : 'Synced just now'}</span><NotificationsBell /><WorkspaceSettings /></div></header>
      <main className="page-wrap fade-in">{children}</main>
    </div>
  </div>;
}

// ─── Shared chart tooltip ────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, money: isMoney }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'hsl(var(--sidebar))', border: '1px solid hsl(var(--sidebar-border))', borderRadius: 10, padding: '10px 14px', fontSize: 12, boxShadow: '0 8px 32px rgba(0,0,0,.18)', color: 'hsl(var(--sidebar-foreground))' }}>
      {label && <div style={{ fontWeight: 700, marginBottom: 7, fontSize: 11, opacity: .7, letterSpacing: '.06em', textTransform: 'uppercase', fontFamily: 'var(--app-font-mono)' }}>{label}</div>}
      {payload.map((entry: any) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ opacity: .65 }}>{entry.name}:</span>
          <strong>{isMoney ? money(entry.value) : entry.value}</strong>
        </div>
      ))}
    </div>
  );
}

// ─── Animated counter ────────────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useMemo(() => {
    let start = 0;
    const end = value;
    if (start === end) { setDisplay(end); return; }
    const duration = 900;
    const step = 16;
    const increment = (end - start) / (duration / step);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(Math.floor(start));
    }, step);
    return () => clearInterval(timer);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

// ─── Workspace / notifications / calendar sync ──────────────────────────────
const WORKSPACE_KEY = 'docketline_workspace';
const copyText = async (text: string) => {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
};

function WorkspaceSwitcher() {
  const workspaces = useListWorkspaces({ query: { queryKey: getListWorkspacesQueryKey(), staleTime: 60000 } });
  const create = useCreateWorkspace();
  const [current, setCurrent] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    const stored = localStorage.getItem(WORKSPACE_KEY) || '';
    if (stored) setWorkspaceId(stored);
    setCurrent(stored);
  }, []);
  const options = workspaces.data?.data ?? [];
  const selected = current || workspaces.data?.defaultWorkspaceId || '';
  const switchTo = (id: string) => {
    setCurrent(id);
    localStorage.setItem(WORKSPACE_KEY, id);
    setWorkspaceId(id || null);
    queryClient.invalidateQueries();
  };
  const submitWorkspace = () => {
    if (!name.trim()) return;
    create.mutate({ data: { name: name.trim() } }, {
      onSuccess: (ws) => {
        queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
        setName('');
        setAdding(false);
        switchTo(ws.id);
      },
    });
  };
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <Building2 size={13} className="muted" />
      <select
        className="select"
        data-testid="select-workspace"
        style={{ minHeight: 30, maxWidth: 170 }}
        value={selected}
        disabled={workspaces.isLoading}
        onChange={(e) => switchTo(e.target.value)}
        title="Switch workspace"
      >
        {options.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
      </select>
      <button className="button button-ghost" data-testid="button-new-workspace" style={{ minHeight: 30, padding: '0 7px' }} title="New workspace" onClick={() => setAdding((v) => !v)}><Plus size={13} /></button>
      {adding && (
        <>
          <div className="popover-backdrop" onClick={() => setAdding(false)} />
          <div className="topbar-popover" style={{ minWidth: 260 }} data-testid="panel-new-workspace">
            <div className="notif-head">New workspace</div>
            <div style={{ padding: '12px 14px' }}>
              <div className="form-kicker" style={{ marginBottom: 6 }}>Each workspace keeps its own clients, cases and numbering.</div>
              <input className="field" data-testid="input-workspace-name" style={{ minHeight: 32 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North York office" onKeyDown={(e) => e.key === 'Enter' && submitWorkspace()} />
              {create.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Workspace could not be created.</div>}
              <button className="button button-primary" data-testid="button-create-workspace" style={{ marginTop: 10 }} disabled={create.isPending || !name.trim()} onClick={submitWorkspace}>{create.isPending ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Create workspace</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const NOTIF_ICONS: Record<string, { icon: typeof Bell; bg: string; color: string }> = {
  'court-date': { icon: CalendarClock, bg: 'hsl(var(--accent) / .12)', color: 'hsl(var(--accent))' },
  'follow-up': { icon: Bell, bg: 'hsl(var(--chart-3) / .14)', color: 'hsl(var(--chart-3))' },
  outstanding: { icon: Receipt, bg: 'hsl(var(--chart-4) / .12)', color: 'hsl(var(--chart-4))' },
  signature: { icon: PenLine, bg: 'hsl(var(--chart-2) / .12)', color: 'hsl(var(--chart-2))' },
};

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const feed = useGetNotifications({ query: { queryKey: getGetNotificationsQueryKey(), refetchInterval: 60000, staleTime: 30000 } });
  const items = feed.data?.items ?? [];
  const count = feed.data?.total ?? 0;
  return (
    <div style={{ position: 'relative' }}>
      <button className="button button-ghost" data-testid="button-notifications" style={{ minHeight: 30, padding: '0 8px', position: 'relative' }} onClick={() => setOpen((v) => !v)} title="Reminders">
        <Bell size={14} />
        {count > 0 && <span className="notif-count" data-testid="value-notification-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="topbar-popover notif-panel" data-testid="panel-notifications">
            <div className="notif-head">Reminders <span className="muted" style={{ fontWeight: 500 }}>· court dates, follow-ups, balances, signatures</span></div>
            {feed.isLoading ? (
              <div className="notif-empty">Loading reminders…</div>
            ) : !items.length ? (
              <div className="notif-empty">Nothing needs your attention. Enjoy the quiet docket.</div>
            ) : items.slice(0, 12).map((item, i) => {
              const meta = NOTIF_ICONS[item.kind] ?? NOTIF_ICONS['follow-up'];
              const Icon = meta.icon;
              return (
                <Link key={`${item.caseId}-${item.kind}-${i}`} href={`/cases/${item.caseId}`} className="notif-row" data-testid={`row-notification-${i}`} onClick={() => setOpen(false)}>
                  <div className="notif-kind" style={{ background: meta.bg, color: meta.color }}><Icon size={13} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{item.title} · {item.clientName}</div>
                    <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>#{item.caseNumber}{item.detail ? ` · ${item.detail}` : ''}{item.date ? ` · ${compactDate(item.date)}` : ''}</div>
                  </div>
                  <span className="notif-days" style={{ color: countdownColor(item.days) }}>{countdownLabel(item.days)}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function WorkspaceSettings() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const feed = useGetCalendarFeed({ query: { queryKey: ['calendar-feed', 'current'], enabled: open, staleTime: 300000 } });
  const regen = useRegenerateCalendarFeed();
  const feedUrl = feed.data ? `${window.location.origin}${basePath}${feed.data.url}` : '';
  const copyFeed = async () => {
    if (!feedUrl) return;
    setCopied(await copyText(feedUrl));
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="button button-ghost" data-testid="button-settings" style={{ minHeight: 30, padding: '0 8px' }} onClick={() => setOpen((v) => !v)} title="Workspace settings"><Settings2 size={14} /></button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="topbar-popover" style={{ minWidth: 330 }} data-testid="panel-settings">
            <div className="notif-head">Calendar sync</div>
            <div style={{ padding: '12px 14px' }}>
              <div className="form-kicker" style={{ marginBottom: 8 }}>Subscribe once and court dates plus follow-ups appear in Google Calendar, Outlook or Apple Calendar automatically.</div>
              {feed.isLoading ? <div className="muted" style={{ fontSize: 11 }}>Loading feed…</div> : feed.isError ? (
                <div style={{ color: 'hsl(var(--destructive))', fontSize: 11 }}>The calendar feed could not be loaded.</div>
              ) : (
                <>
                  <div className="portal-link-box mono" data-testid="value-calendar-url" style={{ fontSize: 10 }}>{feedUrl}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <a className="button button-primary" data-testid="button-open-calendar" style={{ textDecoration: 'none' }} href={feedUrl} target="_blank" rel="noreferrer"><Calendar size={14} /> Open feed</a>
                    <button className="button button-ghost" data-testid="button-copy-calendar" onClick={copyFeed}><Copy size={14} /> {copied ? 'Copied' : 'Copy URL'}</button>
                    <button className="button button-ghost" data-testid="button-regenerate-calendar" disabled={regen.isPending} title="Generate a new token (old subscriptions stop updating)" onClick={() => regen.mutate(undefined, { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['calendar-feed'] }) })}>{regen.isPending ? <Loader2 className="animate-spin" size={14} /> : <ArrowDownToLine size={14} />} Reset</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Signature pad (public sign page) ───────────────────────────────────────
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1c2b3c';
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    inked.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (inked.current) onChange(canvasRef.current?.toDataURL('image/png') ?? null);
  };
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
    onChange(null);
  };
  return (
    <div>
      <canvas ref={canvasRef} className="sig-canvas" data-testid="input-signature-pad" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 7 }}>
        <button type="button" className="button button-ghost" data-testid="button-clear-signature" style={{ minHeight: 27, padding: '0 10px', fontSize: 11 }} onClick={clear}>Clear signature</button>
      </div>
    </div>
  );
}

// ─── First-run onboarding checklist (dashboard) ─────────────────────────────
function OnboardingCard({ caseCount, clientCount }: { caseCount: number; clientCount: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (caseCount > 0 || dismissed) return null;
  const steps = [
    { done: clientCount > 0, label: 'Create your first client', copy: 'Clients live in the directory and power every case.', action: <Link href="/cases/new" className="button button-ghost" data-testid="link-onboard-client" style={{ minHeight: 27, padding: '0 10px' }}>Add client</Link> },
    { done: caseCount > 0, label: 'Open your first case', copy: 'Capture the ticket, the fee, and the first follow-up date.', action: <Link href="/cases/new" className="button button-ghost" data-testid="link-onboard-case" style={{ minHeight: 27, padding: '0 10px' }}>Open case</Link> },
    { done: false, label: 'Invite the client to their portal', copy: 'Issue a secure link from any client profile — clients check dates and documents on their own.', action: <Link href="/clients" className="button button-ghost" data-testid="link-onboard-portal" style={{ minHeight: 27, padding: '0 10px' }}>Clients</Link> },
    { done: false, label: 'Sync your calendar', copy: 'Use the gear icon above to subscribe Google, Outlook or Apple Calendar to your docket.', action: null },
  ];
  return (
    <section className="card detail-card onboard-card" data-testid="section-onboarding">
      <div className="section-head">
        <div>
          <div className="section-title">Set up your workspace</div>
          <div className="section-kicker">Four small steps and Docketline is running at full tilt.</div>
        </div>
        <button className="button button-ghost" data-testid="button-dismiss-onboarding" style={{ minHeight: 27, padding: '0 8px' }} onClick={() => setDismissed(true)}><X size={13} /></button>
      </div>
      <div className="onboard-list">
        {steps.map((step, i) => (
          <div className="onboard-row" key={step.label}>
            <div className="onboard-check" style={{ background: step.done ? 'hsl(var(--chart-2) / .14)' : 'hsl(var(--muted))', color: step.done ? 'hsl(var(--chart-2))' : 'hsl(var(--muted-foreground))' }}>
              {step.done ? <Check size={13} /> : <span style={{ fontSize: 11, fontWeight: 800 }}>{i + 1}</span>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{step.label}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{step.copy}</div>
            </div>
            {step.action}
          </div>
        ))}
      </div>
    </section>
  );
}

function Dashboard() {
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), staleTime: 30000 } });
  const cases     = useListCases({ page: 1, limit: 100 },  { query: { queryKey: getListCasesQueryKey({ page: 1, limit: 100 }),   staleTime: 30000 } });
  const clients   = useListClients({ page: 1, limit: 100 },{ query: { queryKey: getListClientsQueryKey({ page: 1, limit: 100 }), staleTime: 30000 } });
  const reports   = useGetReportsSummary(    { query: { queryKey: getGetReportsSummaryQueryKey(), staleTime: 30000 } });
  const caseRows = cases.data?.data ?? [];
  const clientTotal = clients.data?.total ?? 0;

  const hour = new Date().getHours();
  const greeting  = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greetIcon = hour < 12 ? '🌤' : hour < 17 ? '☀️' : '🌙';
  const todayStr  = new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());

  // ── Urgent court dates (next 7 days, served by the dashboard feed) ──
  const urgentCourtDates = useMemo(() =>
    (dashboard.data?.courtDates || [])
      .map((cd: any) => ({ caseId: cd.caseId, caseNumber: String(cd.caseNumber), clientName: cd.clientName, date: cd.date, days: daysUntil(cd.date) ?? 0 }))
      .filter((e) => e.days >= 0 && e.days <= 7)
      .sort((a, b) => a.days - b.days),
  [dashboard.data]);

  // ── Status donut ──
  const CHART_COLORS = ['#c95743','#2e8f7b','#e8a83e','#3d5e82','#a0765a','#7a8fa6'];
  const statusChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    caseRows.forEach((c: any) => { counts[c.status || 'Unknown'] = (counts[c.status || 'Unknown'] || 0) + 1; });
    return Object.entries(counts).map(([name, value], i) => ({ name, value, color: CHART_COLORS[i % CHART_COLORS.length] }));
  }, [caseRows]);

  // ── Lead source bar ──
  const leadSourceData = useMemo(() =>
    (reports.data?.leadSources || []).slice(0, 7).map((r: any) => ({
      name: r.label.length > 10 ? r.label.slice(0, 10) + '…' : r.label,
      fullName: r.label, cases: r.count,
    })),
  [reports.data]);

  // ── Revenue area (12 months) ──
  const revenueData = useMemo(() => {
    const now = new Date();
    const buckets: { month: string; collected: number; outstanding: number; total: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ month: d.toLocaleString('en-CA', { month: 'short' }), collected: 0, outstanding: 0, total: 0 });
    }
    caseRows.forEach((c: any) => {
      const d = new Date(c.intakeDate || c.updatedAt || '');
      if (isNaN(d.getTime())) return;
      const mo = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
      if (mo >= 0 && mo <= 11) {
        const idx = 11 - mo;
        const fee = c.totalFee || 0;
        const bal = c.balanceOwing || 0;
        buckets[idx].collected   += fee - bal;
        buckets[idx].outstanding += bal;
        buckets[idx].total       += fee;
      }
    });
    return buckets;
  }, [caseRows]);

  // ── Monthly new cases ──
  const caseVolumeData = useMemo(() => {
    const now = new Date();
    const buckets: { month: string; new: number; closed: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ month: d.toLocaleString('en-CA', { month: 'short' }), new: 0, closed: 0 });
    }
    caseRows.forEach((c: any) => {
      const d = new Date(c.intakeDate || c.updatedAt || '');
      if (isNaN(d.getTime())) return;
      const mo = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
      if (mo >= 0 && mo <= 5) {
        buckets[5 - mo].new += 1;
        if (c.status === 'Closed' || c.status === 'Resolved') buckets[5 - mo].closed += 1;
      }
    });
    return buckets;
  }, [caseRows]);

  if (dashboard.isLoading || cases.isLoading) return (
    <div className="db-loading-shell">
      <div className="db-loading-hero">
        <div className="skeleton" style={{ width: 220, height: 14, borderRadius: 4 }} />
        <div className="skeleton" style={{ width: 380, height: 42, marginTop: 12, borderRadius: 8 }} />
        <div className="skeleton" style={{ width: 280, height: 14, marginTop: 10, borderRadius: 4 }} />
      </div>
      <div className="kpi-grid" style={{ marginTop: 32 }}>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="card kpi-card" style={{ minHeight: 120 }}><div className="skeleton" style={{ width: 36, height: 36, borderRadius: 9 }} /><div className="skeleton" style={{ width: '60%', height: 10, marginTop: 18, borderRadius: 4 }} /><div className="skeleton" style={{ width: '80%', height: 28, marginTop: 10, borderRadius: 6 }} /></div>)}
      </div>
      <LoadingState rows={4} />
    </div>
  );
  if (dashboard.isError || !dashboard.data) return <><PageHeader eyebrow="Practice Overview" title="Dashboard" /><ErrorState onRetry={() => dashboard.refetch()} /></>;

  const data            = dashboard.data as any;
  const totalFees       = data.totalFees       || 0;
  const totalCollected  = data.totalCollected  || 0;
  const outstandingBal  = data.outstandingBalance || 0;
  const collectionRate  = totalFees > 0 ? Math.round(totalCollected / totalFees * 100) : 0;
  const totalClients    = clientTotal;
  const resolvedCases   = caseRows.filter((c: any) => c.status === 'Resolved' || c.status === 'Closed').length;
  const winRate         = caseRows.length > 0 ? Math.round(resolvedCases / caseRows.length * 100) : 0;

  // ── KPI definitions ──
  const kpis = [
    { label: 'Active Cases',        value: data.activeCases,  rawValue: data.activeCases,  icon: BriefcaseBusiness, palette: 'accent',  foot: 'Matters in progress',        badge: null,                                  testid: 'value-active-cases' },
    { label: 'Revenue Collected',   value: money(totalCollected), rawValue: totalCollected, icon: TrendingUp,        palette: 'green',   foot: `${collectionRate}% of total billed`, badge: `${collectionRate}%`,          testid: 'value-total-collected' },
    { label: 'Outstanding',         value: money(outstandingBal), rawValue: outstandingBal, icon: Receipt,           palette: outstandingBal > 0 ? 'amber' : 'green', foot: outstandingBal > 0 ? 'Awaiting payment' : 'All settled', badge: null, testid: 'value-outstanding-balance' },
    { label: 'Follow-ups Due',      value: data.dueFollowUps, rawValue: data.dueFollowUps, icon: Bell,              palette: data.dueFollowUps > 0 ? 'amber' : 'green', foot: data.dueFollowUps > 0 ? 'Clients to call back' : 'All clear', badge: null, testid: 'value-due-followups' },
    { label: 'Total Clients',       value: totalClients,      rawValue: totalClients,       icon: Users,             palette: 'blue',    foot: 'Unique client records',      badge: null,                                  testid: 'value-total-clients' },
    { label: 'Court Dates / Week',  value: urgentCourtDates.length, rawValue: urgentCourtDates.length, icon: CalendarClock, palette: urgentCourtDates.length > 0 ? 'accent' : 'green', foot: urgentCourtDates.length > 0 ? 'Appearances this week' : 'Clear week ahead', badge: null, testid: 'value-court-week' },
  ] as const;

  const paletteMap: Record<string, { color: string; bg: string; glow: string }> = {
    accent: { color: '#c95743', bg: 'rgba(201,87,67,.1)',  glow: 'rgba(201,87,67,.18)' },
    green:  { color: '#2e8f7b', bg: 'rgba(46,143,123,.1)', glow: 'rgba(46,143,123,.15)' },
    amber:  { color: '#e8a83e', bg: 'rgba(232,168,62,.1)', glow: 'rgba(232,168,62,.15)' },
    blue:   { color: '#3d5e82', bg: 'rgba(61,94,130,.1)',  glow: 'rgba(61,94,130,.15)' },
  };

  return (
    <div className="db-root">

      {/* ══ HERO HEADER ══════════════════════════════════════════════════════ */}
      <div className="db-hero">
        <div className="db-hero-left">
          <div className="db-hero-eyebrow">
            <span className="db-live-dot" />
            {todayStr}
          </div>
          <h1 className="db-hero-title">
            {greetIcon} {greeting}, Avery.
          </h1>
          <p className="db-hero-sub">
            Your Ontario traffic law practice — live snapshot across {caseRows.length} {caseRows.length === 1 ? 'matter' : 'matters'} and {totalClients} {totalClients === 1 ? 'client' : 'clients'}.
          </p>
        </div>
        <div className="db-hero-actions">
          <Link href="/clients" className="button button-ghost" data-testid="link-view-clients" style={{ gap: 7 }}><Users size={14} /> Clients</Link>
          <Link href="/cases"   className="button button-ghost" data-testid="link-view-cases"   style={{ gap: 7 }}><BriefcaseBusiness size={14} /> Cases</Link>
          <Link href="/cases/new" className="button button-accent" data-testid="link-new-case"  style={{ gap: 7 }}><Plus size={14} /> New case</Link>
        </div>
      </div>

      {/* ══ FIRST-RUN ONBOARDING ════════════════════════════════════════════ */}
      <OnboardingCard caseCount={caseRows.length} clientCount={clientTotal} />

      {/* ══ COURT DATE ALERT ════════════════════════════════════════════════ */}
      {urgentCourtDates.length > 0 && (
        <div className="db-alert" data-testid="alert-urgent-court-dates">
          <div className="db-alert-pulse" />
          <Bell size={14} style={{ color: '#c95743', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 13 }}>Court appearances this week</strong>
            <div className="db-alert-rows">
              {urgentCourtDates.map((e) => (
                <Link href={`/cases/${e.caseId}`} key={`${e.caseId}-${e.date}`} className="db-alert-row" data-testid={`alert-court-${e.caseId}`}>
                  <span style={{ fontWeight: 600 }}>{e.clientName}</span>
                  <span className="muted" style={{ fontSize: 11 }}>#{e.caseNumber}</span>
                  <CountdownBadge date={e.date} />
                  <span className="muted" style={{ fontSize: 10, marginLeft: 'auto' }}>{dateLabel(e.date)}</span>
                  <ArrowRight size={11} style={{ opacity: .5 }} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ KPI GRID ════════════════════════════════════════════════════════ */}
      <div className="kpi-grid">
        {kpis.map((kpi) => {
          const p = paletteMap[kpi.palette as string] ?? paletteMap.accent;
          return (
            <div className="db-kpi" key={kpi.label} style={{ '--kpi-color': p.color, '--kpi-bg': p.bg, '--kpi-glow': p.glow } as React.CSSProperties}>
              <div className="db-kpi-top">
                <div className="db-kpi-icon"><kpi.icon size={16} /></div>
                {kpi.badge && <span className="db-kpi-badge">{kpi.badge}</span>}
              </div>
              <div className="db-kpi-label">{kpi.label}</div>
              <div className="db-kpi-value" data-testid={kpi.testid}>{kpi.value}</div>
              <div className="db-kpi-foot">{kpi.foot}</div>
              <div className="db-kpi-bar">
                <div className="db-kpi-bar-fill" style={{ width: typeof kpi.rawValue === 'number' && kpi.rawValue > 0 ? '100%' : '0%' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ══ ROW 1 — Revenue + Status + Volume ══════════════════════════════ */}
      <div className="db-row db-row-top">

        {/* Revenue 12-month area chart */}
        <div className="card db-panel" style={{ flex: 2.2 }}>
          <div className="db-panel-head">
            <div>
              <div className="db-panel-title">Revenue Overview</div>
              <div className="db-panel-sub">Collected vs outstanding · last 12 months</div>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div className="db-legend-item"><span style={{ background: '#2e8f7b' }} />Collected</div>
              <div className="db-legend-item" style={{ opacity: .7 }}><span style={{ background: '#c95743' }} />Outstanding</div>
            </div>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#2e8f7b" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#2e8f7b" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gO" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#c95743" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#c95743" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={42} />
                <Tooltip content={<ChartTooltip money />} />
                <Area type="monotone" dataKey="collected"   name="Collected"   stroke="#2e8f7b" strokeWidth={2.5} fill="url(#gC)" dot={false} activeDot={{ r: 5, fill: '#2e8f7b' }} />
                <Area type="monotone" dataKey="outstanding" name="Outstanding" stroke="#c95743" strokeWidth={2}   fill="url(#gO)" dot={false} activeDot={{ r: 4, fill: '#c95743' }} strokeDasharray="5 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* Summary bar below chart */}
          <div className="db-revenue-summary">
            <div className="db-rev-item">
              <div className="db-rev-label">Total Billed</div>
              <div className="db-rev-value">{money(totalFees)}</div>
            </div>
            <div className="db-rev-divider" />
            <div className="db-rev-item">
              <div className="db-rev-label">Collected</div>
              <div className="db-rev-value" style={{ color: '#2e8f7b' }}>{money(totalCollected)}</div>
            </div>
            <div className="db-rev-divider" />
            <div className="db-rev-item">
              <div className="db-rev-label">Outstanding</div>
              <div className="db-rev-value" style={{ color: '#c95743' }}>{money(outstandingBal)}</div>
            </div>
            <div className="db-rev-divider" />
            <div className="db-rev-item">
              <div className="db-rev-label">Collection Rate</div>
              <div className="db-rev-value" style={{ color: collectionRate >= 80 ? '#2e8f7b' : '#e8a83e' }}>{collectionRate}%</div>
            </div>
          </div>
        </div>

        {/* Case status donut */}
        <div className="card db-panel" style={{ flex: 1 }}>
          <div className="db-panel-head">
            <div>
              <div className="db-panel-title">Docket by Status</div>
              <div className="db-panel-sub">Active matter distribution</div>
            </div>
          </div>
          {statusChartData.length > 0 ? (
            <>
              <div style={{ position: 'relative', height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={76} paddingAngle={3} dataKey="value" stroke="none" animationBegin={0} animationDuration={900}>
                      {statusChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return <div style={{ background: 'hsl(var(--sidebar))', border: '1px solid hsl(var(--sidebar-border))', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'hsl(var(--sidebar-foreground))' }}><strong>{d.name}</strong><br /><span style={{ opacity: .7 }}>{d.value} {d.value === 1 ? 'case' : 'cases'}</span></div>;
                    }} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center label */}
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.04em' }}>{caseRows.length}</div>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.1em', opacity: .5, marginTop: 2 }}>Total</div>
                </div>
              </div>
              <div className="db-donut-legend">
                {statusChartData.map((e) => (
                  <div key={e.name} className="db-donut-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 7, height: 7, borderRadius: 2, background: e.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 11 }}>{e.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="db-donut-track"><div className="db-donut-fill" style={{ width: `${Math.round(e.value / Math.max(1, caseRows.length) * 100)}%`, background: e.color }} /></div>
                      <strong style={{ fontSize: 11, fontFamily: 'var(--app-font-mono)', minWidth: 16, textAlign: 'right' }}>{e.value}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyState title="No cases yet" copy="Case status breakdown appears once matters are opened." />}
        </div>

        {/* Case volume grouped bar */}
        <div className="card db-panel" style={{ flex: 1 }}>
          <div className="db-panel-head">
            <div>
              <div className="db-panel-title">Case Volume</div>
              <div className="db-panel-sub">New vs closed · last 6 months</div>
            </div>
          </div>
          <div style={{ height: 170, marginTop: 6 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={caseVolumeData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barGap={2} barSize={10}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="new"    name="New"    fill="#3d5e82" radius={[3,3,0,0]} />
                <Bar dataKey="closed" name="Closed" fill="#2e8f7b" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 12, borderTop: '1px solid hsl(var(--border))' }}>
            <div className="db-legend-item"><span style={{ background: '#3d5e82' }} />New</div>
            <div className="db-legend-item"><span style={{ background: '#2e8f7b' }} />Closed</div>
          </div>
          <div className="db-win-rate">
            <div style={{ fontSize: 11, opacity: .6 }}>Resolution rate</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: winRate >= 50 ? '#2e8f7b' : '#e8a83e', letterSpacing: '-.04em', marginTop: 4 }}>{winRate}%</div>
            <div className="db-win-track"><div className="db-win-fill" style={{ width: `${winRate}%` }} /></div>
          </div>
        </div>
      </div>

      {/* ══ ROW 2 — Lead Sources + Priority Cases + Payments ═══════════════ */}
      <div className="db-row db-row-bottom">

        {/* Lead source horizontal bars */}
        <div className="card db-panel" style={{ flex: 1 }}>
          <div className="db-panel-head">
            <div>
              <div className="db-panel-title">Lead Sources</div>
              <div className="db-panel-sub">Where clients originate</div>
            </div>
          </div>
          {leadSourceData.length > 0 ? (
            <div style={{ height: 200, marginTop: 8 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadSourceData} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }} barSize={10}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={68} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return <div style={{ background: 'hsl(var(--sidebar))', border: '1px solid hsl(var(--sidebar-border))', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'hsl(var(--sidebar-foreground))' }}><strong>{d.fullName}</strong><br /><span style={{ opacity: .7 }}>{d.cases} {d.cases === 1 ? 'case' : 'cases'}</span></div>;
                  }} />
                  <Bar dataKey="cases" name="Cases" radius={[0, 4, 4, 0]}>
                    {leadSourceData.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState title="No lead data" copy="Lead source stats appear after cases are created." />}
        </div>

        {/* Priority cases list */}
        <div className="card db-panel" style={{ flex: 1.5 }}>
          <div className="db-panel-head">
            <div>
              <div className="db-panel-title">Priority Cases</div>
              <div className="db-panel-sub">Matters needing your next action</div>
            </div>
            <Link href="/cases" className="db-panel-link">All cases <ArrowRight size={11} /></Link>
          </div>
          <div className="db-priority-list">
            {(data as any).attentionCases?.length
              ? (data as any).attentionCases.slice(0, 7).map((item: any, idx: number) => (
                  <Link href={`/cases/${item.id}`} key={item.id} className="db-priority-row" data-testid={`row-attention-${item.id}`} style={{ animationDelay: `${idx * 55}ms` }}>
                    <div className="db-priority-num">{String(idx + 1).padStart(2, '0')}</div>
                    <div className="db-priority-accent" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.clientName}</div>
                      <div style={{ fontSize: 10, opacity: .55, marginTop: 3 }}>#{item.caseNumber} · {item.offenceDescription || item.statuteCode || 'Traffic matter'}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                      <StatusPill status={item.status} />
                      <span style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', color: '#c95743' }}>
                        {item.nextFollowUpDate ? compactDate(item.nextFollowUpDate) : money(item.balanceOwing)}
                      </span>
                    </div>
                    <ArrowRight size={13} style={{ opacity: .35, flexShrink: 0 }} />
                  </Link>
                ))
              : <EmptyState title="All clear" copy="No overdue follow-ups right now. Nice work." />}
          </div>
        </div>

        {/* Recent payments feed */}
        <div className="card db-panel" style={{ flex: 1 }}>
          <div className="db-panel-head">
            <div>
              <div className="db-panel-title">Recent Payments</div>
              <div className="db-panel-sub">Latest receipts across the practice</div>
            </div>
          </div>

          {/* Collected progress ring */}
          <div className="db-collection-ring">
            <svg width="86" height="86" viewBox="0 0 86 86">
              <circle cx="43" cy="43" r="36" fill="none" stroke="hsl(var(--muted))" strokeWidth="7" />
              <circle cx="43" cy="43" r="36" fill="none" stroke="#2e8f7b" strokeWidth="7"
                strokeDasharray={`${2 * Math.PI * 36 * collectionRate / 100} ${2 * Math.PI * 36}`}
                strokeLinecap="round" transform="rotate(-90 43 43)"
                style={{ transition: 'stroke-dasharray .9s cubic-bezier(.4,0,.2,1)' }} />
              <text x="43" y="39" textAnchor="middle" style={{ fontSize: 15, fontWeight: 700, fill: 'hsl(var(--foreground))', fontFamily: 'var(--app-font-mono)' }}>{collectionRate}%</text>
              <text x="43" y="53" textAnchor="middle" style={{ fontSize: 8, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--app-font-mono)', textTransform: 'uppercase' }}>collected</text>
            </svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, opacity: .55 }}>Total billed</div>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{money(totalFees)}</div>
              <div style={{ fontSize: 11, opacity: .55, marginTop: 8 }}>Collected</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2e8f7b', marginTop: 2 }}>{money(totalCollected)}</div>
            </div>
          </div>

          <div className="db-payments-feed">
            {(data as any).recentPayments?.length
              ? (data as any).recentPayments.slice(0, 5).map((p: any) => (
                  <div key={p.id} className="db-payment-row">
                    <div className="db-payment-dot"><Check size={11} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{money(p.amount)}</div>
                      <div style={{ fontSize: 10, opacity: .55, marginTop: 2 }}>{p.method || 'Payment'}</div>
                    </div>
                    <div style={{ fontSize: 10, fontFamily: 'var(--app-font-mono)', opacity: .5 }}>{compactDate(p.date)}</div>
                  </div>
                ))
              : <EmptyState title="No payments yet" copy="Payments recorded on cases will show here." />}
          </div>
        </div>

        {/* Upcoming appointments panel */}
        <div className="card db-panel" style={{ flex: 1 }}>
          <div className="db-panel-head">
            <div>
              <div className="db-panel-title">Upcoming Appointments</div>
              <div className="db-panel-sub">Next scheduled meetings &amp; court dates</div>
            </div>
            <Link href="/appointments" className="db-panel-link">Calendar <ArrowRight size={11} /></Link>
          </div>
          <div style={{ padding: '4px 18px 14px' }}>
            <UpcomingAppointmentsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function Cases() {
  const PAGE_SIZE = 20;
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [outstanding, setOutstanding] = useState(false);
  const [sort, setSort] = useState<'updatedAt' | 'balanceOwing' | 'nextFollowUpDate'>('updatedAt');
  const [page, setPage] = useState(1);
  const filters = useMemo(() => ({ search: search || undefined, status: status || undefined, source: source || undefined, outstanding: outstanding || undefined }), [search, status, source, outstanding]);
  const params = useMemo(() => ({ ...filters, page, limit: PAGE_SIZE }), [filters, page]);
  const cases = useListCases(params, { query: { queryKey: getListCasesQueryKey(params), staleTime: 15000 } });
  const rows = useMemo(() => [...(cases.data?.data || [])].sort((a, b) => String(b[sort] || '').localeCompare(String(a[sort] || ''))), [cases.data?.data, sort]);
  useEffect(() => { setPage(1); }, [filters]);
  return <><PageHeader eyebrow="Operations / Register" title="Cases" copy="Search the docket, spot balances, and move the next matter forward." action={<Link href="/cases/new" className="button button-accent" data-testid="link-cases-new"><Plus size={16} /> New case</Link>} />
    <section className="card table-card"><div className="toolbar"><div className="input-wrap"><Search /><input className="field" data-testid="input-case-search" placeholder="Search client, phone, ticket, plate, court file, or case no." value={search} onChange={(e) => setSearch(e.target.value)} /></div><select className="select" data-testid="select-case-status" style={{ width: 145 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((item) => <option value={item} key={item}>{item}</option>)}</select><select className="select" data-testid="select-case-source" style={{ width: 145 }} value={source} onChange={(e) => setSource(e.target.value)}><option value="">All sources</option>{leadSources.map((item) => <option value={item} key={item}>{item}</option>)}</select><button className={`button ${outstanding ? 'button-accent' : 'button-ghost'}`} data-testid="button-outstanding-filter" onClick={() => setOutstanding((value) => !value)}><Receipt size={14} /> Outstanding</button><select className="select" data-testid="select-case-sort" style={{ width: 145 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="updatedAt">Recently updated</option><option value="balanceOwing">Balance owing</option><option value="nextFollowUpDate">Follow-up date</option></select></div>
      {cases.isLoading ? <LoadingState rows={7} /> : cases.isError ? <ErrorState onRetry={() => cases.refetch()} /> : rows.length === 0 ? <EmptyState title="No cases found" copy="Try a different search or clear your filters." action={<button className="button button-ghost" data-testid="button-clear-case-filters" onClick={() => { setSearch(''); setStatus(''); setSource(''); setOutstanding(false); setPage(1); }}>Clear filters</button>} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Case</th><th>Client</th><th>Status</th><th>Next follow-up</th><th>Fee</th><th>Balance</th><th>Updated</th><th /></tr></thead><tbody>{rows.map((item) => <tr key={item.id} data-testid={`row-case-${item.id}`}><td><Link href={`/cases/${item.id}`} className="data-link mono" data-testid={`link-case-${item.id}`}>#{item.caseNumber}</Link><div className="muted mono" style={{ marginTop: 4 }}>{item.ticketNumber || 'No ticket no.'}</div></td><td><Link href={`/cases/${item.id}`} className="data-link" data-testid={`link-client-case-${item.id}`}>{item.clientName}</Link><div className="muted" style={{ marginTop: 4 }}>{item.offenceDescription || item.statuteCode || 'Traffic matter'}</div></td><td><StatusPill status={item.status} /></td><td className="mono">{compactDate(item.nextFollowUpDate)}</td><td className="mono">{money(item.totalFee)}</td><td className="mono" style={{ color: item.balanceOwing > 0 ? 'hsl(var(--accent))' : 'hsl(var(--chart-2))' }}>{money(item.balanceOwing)}</td><td className="muted mono">{compactDate(item.updatedAt)}</td><td><Link href={`/cases/${item.id}`} className="button button-ghost" data-testid={`button-open-case-${item.id}`} style={{ minHeight: 28, padding: '0 8px' }}>Open</Link></td></tr>)}</tbody></table></div>}
      <PaginationControls page={cases.data?.page ?? 1} pageSize={cases.data?.pageSize ?? PAGE_SIZE} total={cases.data?.total ?? 0} onPageChange={setPage} />
    </section>
  </>;
}

function ClientForm({ onCreated }: { onCreated: (client: Client) => void }) {
  const create = useCreateClient();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', leadSourceChannel: 'Referral', leadSourceDetail: '' });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => { if (!form.fullName.trim()) return; create.mutate({ data: { ...form, fullName: form.fullName.trim(), phone: form.phone || undefined, email: form.email || undefined, leadSourceDetail: form.leadSourceDetail || undefined } }, { onSuccess: (client) => { queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); onCreated(client); } }); };
  return <div className="card detail-card"><div className="section-title">Add a client</div><div className="section-kicker">Create the client record first, then attach this case.</div><div className="form-grid" style={{ marginTop: 18 }}><div className="form-field full"><label className="form-label">Full name</label><input className="field" data-testid="input-client-name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Jordan Pereira" /><InlineClientConflictWarning name={form.fullName} phone={form.phone} email={form.email} /></div><div className="form-field"><label className="form-label">Phone</label><input className="field" data-testid="input-client-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="416 555 0182" /></div><div className="form-field"><label className="form-label">Email</label><input className="field" type="email" data-testid="input-client-email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="jordan@email.com" /></div><div className="form-field"><label className="form-label">Lead source</label><select className="select" data-testid="select-client-source" value={form.leadSourceChannel} onChange={(e) => set('leadSourceChannel', e.target.value)}>{leadSources.map((source) => <option key={source}>{source}</option>)}</select></div><div className="form-field"><label className="form-label">Source detail</label><input className="field" data-testid="input-client-source-detail" value={form.leadSourceDetail} onChange={(e) => set('leadSourceDetail', e.target.value)} placeholder="Who sent them?" /></div></div>{create.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 12 }}>Client could not be saved. Try again.</div>}<button className="button button-primary" data-testid="button-create-client" disabled={create.isPending || !form.fullName.trim()} onClick={submit} style={{ marginTop: 17 }}>{create.isPending ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Create client</button></div>;
}

function NewCase() {
  const [, setLocation] = useLocation();
  const clients = useListClients({ page: 1, limit: 100 }, { query: { queryKey: getListClientsQueryKey({ page: 1, limit: 100 }), staleTime: 15000 } });
  const create = useCreateCase();
  const [showClient, setShowClient] = useState(false);
  const [selectedClient, setSelectedClient] = useState('');
  const [createdClient, setCreatedClient] = useState<Client | null>(null);
  const [form, setForm] = useState({ intakeDate: new Date().toISOString().slice(0, 10), offenceDate: '', ticketNumber: '', statuteCode: '', offenceDescription: '', officeCode: '', courtLocation: 'Ontario Court of Justice', status: 'Open', totalFee: '', nextFollowUpDate: '', firstNote: '', responseDeadline: '', citationIssuingAgency: '', officerName: '', officerBadgeNumber: '', offenceLocation: '', speedAlleged: '', speedLimit: '', speedUnit: 'km/h', licencePlate: '', licencePlateRegion: 'ON', vehicleMake: '', vehicleModel: '', vehicleYear: '', vehicleColour: '', vehicleVIN: '', driversLicenceNumber: '', driversLicenceRegion: 'ON', driversLicenceExpiry: '', courtFileNumber: '', courtRoomNumber: '', courtJurisdiction: '', hearingType: '', partType: '', retainerAmount: '', retainerPaidDate: '', setFine: '', victimSurcharge: '', disbursements: '', priority: 'Normal', assignedTo: '', tags: '', disclosureRequestedDate: '', disclosureReceivedDate: '' });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const txt = (v: string) => (v.trim() ? v.trim() : undefined);
  const submit = () => { if (!selectedClient || !form.offenceDate || !form.totalFee) return; create.mutate({ data: { clientId: selectedClient, intakeDate: form.intakeDate, offenceDate: form.offenceDate, status: form.status, totalFee: Number(form.totalFee), ticketNumber: txt(form.ticketNumber), statuteCode: txt(form.statuteCode), offenceDescription: txt(form.offenceDescription), officeCode: txt(form.officeCode), courtLocation: txt(form.courtLocation), nextFollowUpDate: form.nextFollowUpDate || undefined, firstNote: txt(form.firstNote), responseDeadline: form.responseDeadline || undefined, citationIssuingAgency: txt(form.citationIssuingAgency), officerName: txt(form.officerName), officerBadgeNumber: txt(form.officerBadgeNumber), offenceLocation: txt(form.offenceLocation), speedAlleged: num(form.speedAlleged), speedLimit: num(form.speedLimit), speedUnit: (form.speedUnit as 'km/h' | 'mph' | undefined) || undefined, licencePlate: txt(form.licencePlate), licencePlateRegion: txt(form.licencePlateRegion), vehicleMake: txt(form.vehicleMake), vehicleModel: txt(form.vehicleModel), vehicleYear: num(form.vehicleYear), vehicleColour: txt(form.vehicleColour), vehicleVIN: txt(form.vehicleVIN), driversLicenceNumber: txt(form.driversLicenceNumber), driversLicenceRegion: txt(form.driversLicenceRegion), driversLicenceExpiry: form.driversLicenceExpiry || undefined, courtFileNumber: txt(form.courtFileNumber), courtRoomNumber: txt(form.courtRoomNumber), courtJurisdiction: txt(form.courtJurisdiction), hearingType: txt(form.hearingType), partType: txt(form.partType), retainerAmount: num(form.retainerAmount), retainerPaidDate: form.retainerPaidDate || undefined, setFine: num(form.setFine), victimSurcharge: num(form.victimSurcharge), disbursements: num(form.disbursements), priority: (form.priority as 'Low' | 'Normal' | 'High' | 'Urgent' | undefined) || undefined, assignedTo: txt(form.assignedTo), tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined, disclosureRequestedDate: form.disclosureRequestedDate || undefined, disclosureReceivedDate: form.disclosureReceivedDate || undefined } }, { onSuccess: (item) => { queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation(`/cases/${item.id}`); } }); };
  if (clients.isLoading) return <><PageHeader eyebrow="Operations / Intake" title="New case" /><LoadingState rows={5} /></>;
  return <><PageHeader eyebrow="Operations / Intake" title="Open a new matter" copy="Start with the client, then capture only what the docket needs to move." action={<Link href="/cases" className="button button-ghost" data-testid="link-cancel-intake"><ArrowLeft size={15} /> Cancel</Link>} />
    {(!clients.data?.data?.length && !createdClient) || showClient ? <div style={{ marginBottom: 18 }}><ClientForm onCreated={(client) => { setCreatedClient(client); setSelectedClient(client.id); setShowClient(false); }} /></div> : null}
    <section className="card detail-card"><div className="section-title">Case intake</div><div className="section-kicker">Required fields are kept intentionally short. You can edit the record later.</div><div className="form-grid" style={{ marginTop: 20 }}><div className="form-field full"><label className="form-label">Client</label><div style={{ display: 'flex', gap: 8 }}><select className="select" data-testid="select-intake-client" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}><option value="">Select a client</option>{(clients.data?.data || []).map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select>{!showClient && <button className="button button-ghost" data-testid="button-add-intake-client" onClick={() => setShowClient(true)}><Plus size={15} /> New client</button>}</div></div><div className="form-field"><label className="form-label">Intake date</label><input className="field" type="date" data-testid="input-intake-date" value={form.intakeDate} onChange={(e) => set('intakeDate', e.target.value)} /></div><div className="form-field"><label className="form-label">Offence date</label><input className="field" type="date" data-testid="input-offence-date" value={form.offenceDate} onChange={(e) => set('offenceDate', e.target.value)} /></div><div className="form-field"><label className="form-label">Ticket number</label><input className="field" data-testid="input-ticket-number" value={form.ticketNumber} onChange={(e) => set('ticketNumber', e.target.value)} placeholder="e.g. T12345678" /></div><div className="form-field"><label className="form-label">Statute code</label><input className="field" data-testid="input-statute-code" value={form.statuteCode} onChange={(e) => set('statuteCode', e.target.value)} placeholder="HTA 128" /></div><div className="form-field full"><InlineCaseConflictWarning ticketNumber={form.ticketNumber} statuteCode={form.statuteCode} clientId={selectedClient || undefined} /></div><div className="form-field full"><label className="form-label">Offence description</label><input className="field" data-testid="input-offence-description" value={form.offenceDescription} onChange={(e) => set('offenceDescription', e.target.value)} placeholder="Driving while under suspension" /></div><div className="form-field"><label className="form-label">Office code</label><input className="field" data-testid="input-office-code" value={form.officeCode} onChange={(e) => set('officeCode', e.target.value)} placeholder="TOR-03" /></div><div className="form-field"><label className="form-label">Court location</label><input className="field" data-testid="input-court-location" value={form.courtLocation} onChange={(e) => set('courtLocation', e.target.value)} /></div><div className="form-field"><label className="form-label">Status</label><select className="select" data-testid="select-intake-status" value={form.status} onChange={(e) => set('status', e.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></div><div className="form-field"><label className="form-label">Total fee (CAD)</label><input className="field" type="number" min="0" data-testid="input-total-fee" value={form.totalFee} onChange={(e) => set('totalFee', e.target.value)} placeholder="1250" /></div><div className="form-field"><label className="form-label">Next follow-up</label><input className="field" type="date" data-testid="input-next-followup" value={form.nextFollowUpDate} onChange={(e) => set('nextFollowUpDate', e.target.value)} /></div><div className="form-field full"><label className="form-label">First note <span className="muted">(optional)</span></label><textarea className="textarea" data-testid="input-first-note" value={form.firstNote} onChange={(e) => set('firstNote', e.target.value)} placeholder="What should you remember when you return to this file?" /></div></div><details className="intake-extra" data-testid="details-intake-extended"><summary>Add ticket, vehicle, driver, court &amp; fee details (optional)</summary><div className="form-grid" style={{ marginTop: 14 }}><div className="form-field full"><div className="form-label" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10 }}>Ticket &amp; officer</div></div><div className="form-field"><label className="form-label">Response deadline</label><input className="field" type="date" data-testid="input-response-deadline" value={form.responseDeadline} onChange={(e) => set('responseDeadline', e.target.value)} /></div><div className="form-field"><label className="form-label">Issuing agency</label><input className="field" data-testid="input-citation-agency" value={form.citationIssuingAgency} onChange={(e) => set('citationIssuingAgency', e.target.value)} placeholder="Peel Regional Police" /></div><div className="form-field"><label className="form-label">Officer name</label><input className="field" data-testid="input-officer-name" value={form.officerName} onChange={(e) => set('officerName', e.target.value)} placeholder="Const. J. Whitfield" /></div><div className="form-field"><label className="form-label">Badge number</label><input className="field" data-testid="input-officer-badge" value={form.officerBadgeNumber} onChange={(e) => set('officerBadgeNumber', e.target.value)} /></div><div className="form-field"><label className="form-label">Offence location</label><input className="field" data-testid="input-offence-location" value={form.offenceLocation} onChange={(e) => set('offenceLocation', e.target.value)} placeholder="Hwy 410 @ Courtneypark" /></div><div className="form-field full"><div className="form-label" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10, marginTop: 6 }}>Vehicle &amp; speed</div></div><div className="form-field"><label className="form-label">Speed alleged</label><input className="field" type="number" data-testid="input-speed-alleged" value={form.speedAlleged} onChange={(e) => set('speedAlleged', e.target.value)} /></div><div className="form-field"><label className="form-label">Speed limit</label><input className="field" type="number" data-testid="input-speed-limit" value={form.speedLimit} onChange={(e) => set('speedLimit', e.target.value)} /></div><div className="form-field"><label className="form-label">Speed unit</label><select className="select" data-testid="select-speed-unit" value={form.speedUnit} onChange={(e) => set('speedUnit', e.target.value)}><option>km/h</option><option>mph</option></select></div><div className="form-field"><label className="form-label">Licence plate</label><input className="field" data-testid="input-licence-plate" value={form.licencePlate} onChange={(e) => set('licencePlate', e.target.value)} placeholder="CXQD 882" /></div><div className="form-field"><label className="form-label">Plate region</label><input className="field" data-testid="input-plate-region" value={form.licencePlateRegion} onChange={(e) => set('licencePlateRegion', e.target.value)} /></div><div className="form-field"><label className="form-label">Make</label><input className="field" data-testid="input-vehicle-make" value={form.vehicleMake} onChange={(e) => set('vehicleMake', e.target.value)} placeholder="Honda" /></div><div className="form-field"><label className="form-label">Model</label><input className="field" data-testid="input-vehicle-model" value={form.vehicleModel} onChange={(e) => set('vehicleModel', e.target.value)} placeholder="Civic" /></div><div className="form-field"><label className="form-label">Year</label><input className="field" type="number" data-testid="input-vehicle-year" value={form.vehicleYear} onChange={(e) => set('vehicleYear', e.target.value)} placeholder="2023" /></div><div className="form-field"><label className="form-label">Colour</label><input className="field" data-testid="input-vehicle-colour" value={form.vehicleColour} onChange={(e) => set('vehicleColour', e.target.value)} /></div><div className="form-field"><label className="form-label">VIN</label><input className="field" data-testid="input-vehicle-vin" value={form.vehicleVIN} onChange={(e) => set('vehicleVIN', e.target.value)} /></div><div className="form-field full"><div className="form-label" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10, marginTop: 6 }}>Driver's licence</div></div><div className="form-field"><label className="form-label">Licence number</label><input className="field" data-testid="input-dl-number" value={form.driversLicenceNumber} onChange={(e) => set('driversLicenceNumber', e.target.value)} /></div><div className="form-field"><label className="form-label">Licence region</label><input className="field" data-testid="input-dl-region" value={form.driversLicenceRegion} onChange={(e) => set('driversLicenceRegion', e.target.value)} /></div><div className="form-field"><label className="form-label">Licence expiry</label><input className="field" type="date" data-testid="input-dl-expiry" value={form.driversLicenceExpiry} onChange={(e) => set('driversLicenceExpiry', e.target.value)} /></div><div className="form-field full"><div className="form-label" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10, marginTop: 6 }}>Court</div></div><div className="form-field"><label className="form-label">Court file no.</label><input className="field" data-testid="input-court-file" value={form.courtFileNumber} onChange={(e) => set('courtFileNumber', e.target.value)} placeholder="CF-26-009871" /></div><div className="form-field"><label className="form-label">Room</label><input className="field" data-testid="input-court-room" value={form.courtRoomNumber} onChange={(e) => set('courtRoomNumber', e.target.value)} /></div><div className="form-field"><label className="form-label">Jurisdiction</label><input className="field" data-testid="input-court-jurisdiction" value={form.courtJurisdiction} onChange={(e) => set('courtJurisdiction', e.target.value)} placeholder="Brampton" /></div><div className="form-field"><label className="form-label">Hearing type</label><input className="field" data-testid="input-hearing-type" value={form.hearingType} onChange={(e) => set('hearingType', e.target.value)} placeholder="Trial" /></div><div className="form-field"><label className="form-label">Part type</label><input className="field" data-testid="input-part-type" value={form.partType} onChange={(e) => set('partType', e.target.value)} placeholder="Part I" /></div><div className="form-field full"><div className="form-label" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10, marginTop: 6 }}>Fees, retainer &amp; workflow</div></div><div className="form-field"><label className="form-label">Retainer amount</label><input className="field" type="number" data-testid="input-retainer-amount" value={form.retainerAmount} onChange={(e) => set('retainerAmount', e.target.value)} /></div><div className="form-field"><label className="form-label">Retainer paid date</label><input className="field" type="date" data-testid="input-retainer-paid" value={form.retainerPaidDate} onChange={(e) => set('retainerPaidDate', e.target.value)} /></div><div className="form-field"><label className="form-label">Set fine</label><input className="field" type="number" data-testid="input-set-fine" value={form.setFine} onChange={(e) => set('setFine', e.target.value)} /></div><div className="form-field"><label className="form-label">Victim surcharge</label><input className="field" type="number" data-testid="input-victim-surcharge" value={form.victimSurcharge} onChange={(e) => set('victimSurcharge', e.target.value)} /></div><div className="form-field"><label className="form-label">Disbursements</label><input className="field" type="number" data-testid="input-disbursements" value={form.disbursements} onChange={(e) => set('disbursements', e.target.value)} /></div><div className="form-field"><label className="form-label">Priority</label><select className="select" data-testid="select-priority" value={form.priority} onChange={(e) => set('priority', e.target.value)}>{['Low', 'Normal', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</select></div><div className="form-field"><label className="form-label">Assigned to</label><input className="field" data-testid="input-assigned-to" value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)} /></div><div className="form-field"><label className="form-label">Tags <span className="muted">(comma separated)</span></label><input className="field" data-testid="input-tags" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="speeding, trial" /></div><div className="form-field"><label className="form-label">Disclosure requested</label><input className="field" type="date" data-testid="input-disclosure-requested" value={form.disclosureRequestedDate} onChange={(e) => set('disclosureRequestedDate', e.target.value)} /></div><div className="form-field"><label className="form-label">Disclosure received</label><input className="field" type="date" data-testid="input-disclosure-received" value={form.disclosureReceivedDate} onChange={(e) => set('disclosureReceivedDate', e.target.value)} /></div></div></details>{create.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 12, marginTop: 15 }}>Case could not be created. Check the required fields and try again.</div>}<div className="form-actions"><Link href="/cases" className="button button-ghost" data-testid="button-cancel-case">Cancel</Link><button className="button button-accent" data-testid="button-create-case" disabled={create.isPending || !selectedClient || !form.offenceDate || !form.totalFee} onClick={submit}>{create.isPending ? <Loader2 className="animate-spin" size={15} /> : <FilePlus2 size={15} />} Open case</button></div></section>
  </>;
}

function CaseDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const detail = useGetCase(id, { query: { queryKey: getGetCaseQueryKey(id), staleTime: 10000 } });
  const update = useUpdateCase();
  const remove = useDeleteCase();
  const payment = useCreatePayment();
  const note = useCreateNote();
  const [editing, setEditing] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: 'E-transfer', note: '', reference: '', allocationType: 'Installment', receivedBy: '' });
  const [noteText, setNoteText] = useState('');
  const [noteVisible, setNoteVisible] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const item = detail.data;
  const startEdit = () => { if (!item) return; setForm({ intakeDate: item.intakeDate?.slice(0, 10) || '', offenceDate: item.offenceDate?.slice(0, 10) || '', ticketNumber: item.ticketNumber || '', statuteCode: item.statuteCode || '', offenceDescription: item.offenceDescription || '', officeCode: item.officeCode || '', courtLocation: item.courtLocation || '', status: item.status || 'Open', totalFee: String(item.totalFee), nextFollowUpDate: item.nextFollowUpDate?.slice(0, 10) || '', responseDeadline: item.responseDeadline?.slice(0, 10) || '', citationIssuingAgency: item.citationIssuingAgency || '', officerName: item.officerName || '', officerBadgeNumber: item.officerBadgeNumber || '', offenceLocation: item.offenceLocation || '', speedAlleged: String(item.speedAlleged ?? ''), speedLimit: String(item.speedLimit ?? ''), speedUnit: item.speedUnit || 'km/h', licencePlate: item.licencePlate || '', licencePlateRegion: item.licencePlateRegion || '', vehicleMake: item.vehicleMake || '', vehicleModel: item.vehicleModel || '', vehicleYear: String(item.vehicleYear ?? ''), vehicleColour: item.vehicleColour || '', vehicleVIN: item.vehicleVIN || '', driversLicenceNumber: item.driversLicenceNumber || '', driversLicenceRegion: item.driversLicenceRegion || '', driversLicenceExpiry: item.driversLicenceExpiry?.slice(0, 10) || '', courtFileNumber: item.courtFileNumber || '', courtRoomNumber: item.courtRoomNumber || '', courtJurisdiction: item.courtJurisdiction || '', hearingType: item.hearingType || '', partType: item.partType || '', retainerAmount: String(item.retainerAmount ?? ''), retainerPaidDate: item.retainerPaidDate?.slice(0, 10) || '', setFine: String(item.setFine ?? ''), victimSurcharge: String(item.victimSurcharge ?? ''), disbursements: String(item.disbursements ?? ''), outcome: item.outcome || '', reducedCharge: item.reducedCharge || '', courtFineAmount: String(item.courtFineAmount ?? ''), demeritPoints: String(item.demeritPoints ?? ''), licenceSuspended: item.licenceSuspended == null ? '' : String(item.licenceSuspended), closedDate: item.closedDate?.slice(0, 10) || '', priority: item.priority || 'Normal', assignedTo: item.assignedTo || '', tags: (item.tags || []).join(', '), disclosureRequestedDate: item.disclosureRequestedDate?.slice(0, 10) || '', disclosureReceivedDate: item.disclosureReceivedDate?.slice(0, 10) || '' }); setEditing(true); };
  const editNum = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
  const editTxt = (v?: string) => (v === undefined || v.trim() === '' ? null : v.trim());
  const editDay = (v?: string) => (v === undefined || v === '' ? null : v);
  const saveEdit = () => { if (!item) return; update.mutate({ id, data: { intakeDate: form.intakeDate, offenceDate: form.offenceDate, ticketNumber: form.ticketNumber || undefined, statuteCode: form.statuteCode || undefined, offenceDescription: form.offenceDescription || undefined, officeCode: form.officeCode || undefined, courtLocation: form.courtLocation || undefined, status: form.status, totalFee: Number(form.totalFee), nextFollowUpDate: form.nextFollowUpDate || null, responseDeadline: editDay(form.responseDeadline), citationIssuingAgency: editTxt(form.citationIssuingAgency), officerName: editTxt(form.officerName), officerBadgeNumber: editTxt(form.officerBadgeNumber), offenceLocation: editTxt(form.offenceLocation), speedAlleged: editNum(form.speedAlleged), speedLimit: editNum(form.speedLimit), speedUnit: editTxt(form.speedUnit), licencePlate: editTxt(form.licencePlate), licencePlateRegion: editTxt(form.licencePlateRegion), vehicleMake: editTxt(form.vehicleMake), vehicleModel: editTxt(form.vehicleModel), vehicleYear: editNum(form.vehicleYear), vehicleColour: editTxt(form.vehicleColour), vehicleVIN: editTxt(form.vehicleVIN), driversLicenceNumber: editTxt(form.driversLicenceNumber), driversLicenceRegion: editTxt(form.driversLicenceRegion), driversLicenceExpiry: editDay(form.driversLicenceExpiry), courtFileNumber: editTxt(form.courtFileNumber), courtRoomNumber: editTxt(form.courtRoomNumber), courtJurisdiction: editTxt(form.courtJurisdiction), hearingType: editTxt(form.hearingType), partType: editTxt(form.partType), retainerAmount: editNum(form.retainerAmount), retainerPaidDate: editDay(form.retainerPaidDate), setFine: editNum(form.setFine), victimSurcharge: editNum(form.victimSurcharge), disbursements: editNum(form.disbursements), outcome: editTxt(form.outcome), reducedCharge: editTxt(form.reducedCharge), courtFineAmount: editNum(form.courtFineAmount), demeritPoints: editNum(form.demeritPoints), licenceSuspended: form.licenceSuspended === '' ? null : form.licenceSuspended === 'true', closedDate: editDay(form.closedDate), priority: editTxt(form.priority), assignedTo: editTxt(form.assignedTo), tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : null, disclosureRequestedDate: editDay(form.disclosureRequestedDate), disclosureReceivedDate: editDay(form.disclosureReceivedDate) } }, { onSuccess: (updated) => { queryClient.setQueryData(getGetCaseQueryKey(id), (old) => old ? { ...old, ...updated } : updated); queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setEditing(false); } }); };
  const addPayment = () => { if (!paymentForm.amount) return; payment.mutate({ id, data: { amount: Number(paymentForm.amount), date: paymentForm.date, method: paymentForm.method, note: paymentForm.note || undefined, reference: paymentForm.reference.trim() || undefined, allocationType: paymentForm.allocationType as 'Retainer' | 'Installment' | 'Final Payment' | 'Disbursement' | 'General', receivedBy: paymentForm.receivedBy.trim() || undefined } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetReportsSummaryQueryKey() }); setPaymentForm((current) => ({ ...current, amount: '', note: '', reference: '' })); } }); };
  const addNote = () => { if (!noteText.trim()) return; note.mutate({ id, data: { text: noteText.trim(), clientVisible: noteVisible || undefined } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }); setNoteText(''); setNoteVisible(false); } }); };
  const noteUpdate = useUpdateCaseNote();
  const noteDelete = useDeleteCaseNote();
  const voidPayment = useVoidCasePayment();
  const refundPayment = useRefundCasePayment();
  const afterPaymentChange = (updated: CaseDetail) => { queryClient.setQueryData(getGetCaseQueryKey(id), updated); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetReportsSummaryQueryKey() }); queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); };
  const editNote = (noteId: string, text: string) => { const next = window.prompt('Edit note', text); if (next === null || !next.trim() || next.trim() === text) return; noteUpdate.mutate({ id, noteId, data: { text: next.trim() } }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }) }); };
  const deleteNote = (noteId: string) => { if (!window.confirm('Delete this note? This cannot be undone.')) return; noteDelete.mutate({ id, noteId }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }) }); };
  const voidPay = (paymentId: string, amount: number) => { const reason = window.prompt(`Void the ${money(amount)} payment? Reason:`, ''); if (reason === null) return; voidPayment.mutate({ id, paymentId, data: { reason: reason.trim() || 'Voided' } }, { onSuccess: afterPaymentChange }); };
  const refundPay = (paymentId: string, amount: number) => { const reason = window.prompt(`Refund the ${money(amount)} payment. Reason:`, ''); if (reason === null) return; refundPayment.mutate({ id, paymentId, data: { reason: reason.trim() || 'Refund issued' } }, { onSuccess: afterPaymentChange }); };
  const deleteThis = () => { if (window.confirm('Move this case out of the active docket?')) remove.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation('/cases'); } }); };

  // Court dates (server-synced)
  const courtDate = useCreateCourtDate();
  const removeCourtDate = useDeleteCourtDate();
  const [courtForm, setCourtForm] = useState({ date: '', outcome: '', notes: '' });

  // Documents (server-synced)
  const uploadDoc = useCreateDocument();
  const removeDoc = useDeleteDocument();
  const docsQuery = useListCaseDocuments(id, { query: { queryKey: getListCaseDocumentsQueryKey(id), staleTime: 10000 } });
  const docs = docsQuery.data?.data || [];
  const fileRef = useRef<HTMLInputElement>(null);

  // Trust ledger + signature requests
  const trustQuery = useListTrustEntries(id, { query: { queryKey: getListTrustEntriesQueryKey(id) } });
  const trustCreate = useCreateTrustEntry();
  const trustDelete = useDeleteTrustEntry();
  const [trustForm, setTrustForm] = useState({ type: 'deposit', amount: '', date: new Date().toISOString().slice(0, 10), note: '' });
  const trustEntries = trustQuery.data?.data ?? [];
  const addTrustEntry = () => {
    if (!trustForm.amount) return;
    trustCreate.mutate(
      { id, data: { type: trustForm.type as 'deposit' | 'withdrawal' | 'transfer', amount: Number(trustForm.amount), date: trustForm.date, note: trustForm.note || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTrustEntriesQueryKey(id) });
          setTrustForm((current) => ({ ...current, amount: '', note: '' }));
        },
      },
    );
  };
  const deleteTrustEntry = (entryId: string) => {
    trustDelete.mutate({ id, entryId }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListTrustEntriesQueryKey(id) }) });
  };

  const sigQuery = useListSignatureRequests(id, { query: { queryKey: getListSignatureRequestsQueryKey(id) } });
  const sigCreate = useCreateSignatureRequest();
  const sigDelete = useDeleteSignatureRequest();
  const [sigForm, setSigForm] = useState({ title: '', documentId: '', agreementText: '' });
  const [copiedSig, setCopiedSig] = useState('');
  const signatureRequests = sigQuery.data?.data ?? [];
  const addSignatureRequest = () => {
    if (!sigForm.title.trim()) return;
    sigCreate.mutate(
      { id, data: { title: sigForm.title.trim(), documentId: sigForm.documentId || undefined, agreementText: sigForm.agreementText || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSignatureRequestsQueryKey(id) });
          setSigForm({ title: '', documentId: '', agreementText: '' });
        },
      },
    );
  };
  const deleteSignatureRequest = (requestId: string) => {
    sigDelete.mutate({ id, requestId }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSignatureRequestsQueryKey(id) }) });
  };
  const copySignLink = async (token: string) => {
    const copied = await copyText(`${window.location.origin}${basePath}/sign/${token}`);
    if (copied) {
      setCopiedSig(token);
      setTimeout(() => setCopiedSig(''), 1800);
    }
  };

  const courtDates = useMemo(
    () => [...(item?.courtDates || [])].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [item?.courtDates],
  );

  // One-time migration: push legacy localStorage documents to the server, then clear the key
  const docsMigrated = useRef(false);
  useEffect(() => {
    if (!item || docsMigrated.current) return;
    docsMigrated.current = true;
    const legacy = readLegacyDocs();
    if (!legacy.length) return;
    clearLegacyDocs();
    (async () => {
      for (const entry of legacy) {
        if (!entry.caseId || !entry.name || !entry.dataUrl) continue;
        try {
          await uploadDoc.mutateAsync({ id: entry.caseId, data: { name: entry.name, type: entry.type || undefined, size: entry.size ?? undefined, dataUrl: entry.dataUrl } });
        } catch { /* skip entries that fail validation */ }
      }
      queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(id) });
    })();
  }, [item]);

  // One-time migration: push legacy localStorage court dates to the server, then clear the key
  const courtMigrated = useRef(false);
  useEffect(() => {
    if (!item || courtMigrated.current) return;
    courtMigrated.current = true;
    const key = `docketline_court_${id}`;
    let legacy: { date?: string; outcome?: string; notes?: string }[] = [];
    try { legacy = JSON.parse(localStorage.getItem(key) || '[]'); } catch { legacy = []; }
    if (!legacy.length) return;
    localStorage.removeItem(key);
    (async () => {
      for (const entry of legacy) {
        if (!entry.date) continue;
        try {
          await courtDate.mutateAsync({ id, data: { date: entry.date, outcome: entry.outcome || undefined, notes: entry.notes || undefined } });
        } catch { /* skip entries that fail validation */ }
      }
      queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    })();
  }, [item]);

  const addCourtDate = () => {
    if (!courtForm.date) return;
    courtDate.mutate({ id, data: { date: courtForm.date, outcome: courtForm.outcome || undefined, notes: courtForm.notes || undefined } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
        setCourtForm({ date: '', outcome: '', notes: '' });
      },
    });
  };

  const deleteCourtDate = (cdId: string) => {
    removeCourtDate.mutate({ id, courtDateId: cdId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      },
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach((file) => {
      if (file.size > 5 * 1024 * 1024) return; // ~8 MB after base64 inflation; server caps the payload
      const reader = new FileReader();
      reader.onload = () => {
        uploadDoc.mutate({ id, data: { name: file.name, type: file.type || undefined, size: file.size, dataUrl: reader.result as string } }, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
          },
        });
      };
      reader.readAsDataURL(file);
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDownloadDoc = async (docId: string) => {
    try {
      const doc = await getDocument(id, docId);
      const anchor = document.createElement('a');
      anchor.href = doc.dataUrl;
      anchor.download = doc.name;
      anchor.click();
    } catch { /* download failed */ }
  };

  const handleDeleteDoc = (docId: string) => {
    removeDoc.mutate({ id, documentId: docId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCaseDocumentsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) });
      },
    });
  };
  if (detail.isLoading) return <><PageHeader eyebrow="Case file" title="Loading case…" /><LoadingState rows={6} /></>;
  if (detail.isError || !item) return <><PageHeader eyebrow="Case file" title="Case unavailable" /><ErrorState onRetry={() => detail.refetch()} /></>;
  const timeline = [...(item.notes || []).map((entry) => ({ key: `n-${entry.id}`, kind: 'note' as const, noteId: entry.id, text: entry.text, date: entry.createdAt, title: 'Case note', copy: entry.text, clientVisible: entry.clientVisible ?? false, payment: undefined as Payment | undefined })), ...(item.payments || []).map((entry) => ({ key: `p-${entry.id}`, kind: 'payment' as const, noteId: '', text: '', clientVisible: false, date: entry.date, title: entry.isVoided ? `Payment voided · ${money(entry.amount)}` : entry.isRefund ? `Refund issued · −${money(entry.amount)}` : `Payment recorded · ${money(entry.amount)}`, copy: [entry.method, entry.isVoided ? (entry.voidReason || 'Voided') : null, entry.note].filter(Boolean).join(' · ') || 'Payment activity', payment: entry as Payment | undefined })), ...(item.courtDates || []).map((entry) => ({ key: `c-${entry.id}`, kind: 'court' as const, noteId: '', text: '', clientVisible: false, date: entry.date, title: 'Court date', copy: entry.outcome || 'Scheduled appearance', payment: undefined as Payment | undefined }))].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const setField = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <><div className="detail-hero"><div><Link href="/cases" className="muted" data-testid="link-back-cases" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', fontSize: 11 }}><ArrowLeft size={13} /> Case register</Link><div className="eyebrow" style={{ marginTop: 20 }}>Case file / Active record</div><h1 className="page-title">{item.clientName}</h1><div className="detail-id">CASE #{item.caseNumber} <span style={{ opacity: .45 }}>·</span> {item.ticketNumber || 'Ticket number pending'}</div></div><div className="button-row" style={{ display: 'flex', gap: 8 }}><StatusPill status={item.status} /><button className="button button-ghost" data-testid="button-edit-case" onClick={() => editing ? setEditing(false) : startEdit()}>{editing ? <X size={15} /> : <NotebookPen size={15} />} {editing ? 'Cancel edit' : 'Edit record'}</button><button className="button button-danger" data-testid="button-delete-case" onClick={deleteThis} disabled={remove.isPending}><Trash2 size={14} /></button></div></div>
    <div className="money-band"><div className="money-cell"><div className="money-label">Total fee</div><div className="money-value">{money(item.totalFee)}</div></div><div className="money-cell"><div className="money-label">Received</div><div className="money-value" style={{ color: 'hsl(var(--chart-2))' }}>{money(item.amountReceived)}</div></div><div className="money-cell"><div className="money-label">Balance owing</div><div className="money-value warn">{money(item.balanceOwing)}</div></div></div>
    {editing ? <section className="card detail-card" style={{ marginBottom: 18 }}><div className="section-head"><div><div className="section-title">Edit case record</div><div className="section-kicker">Changes save back to the case register.</div></div><button className="button button-accent" data-testid="button-save-case" disabled={update.isPending} onClick={saveEdit}>{update.isPending ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Save changes</button></div><div className="form-grid">{[['intakeDate','Intake date','date'],['offenceDate','Offence date','date'],['ticketNumber','Ticket number','text'],['statuteCode','Statute code','text'],['officeCode','Office code','text'],['courtLocation','Court location','text'],['totalFee','Total fee (CAD)','number'],['nextFollowUpDate','Next follow-up','date']].map(([key, label, type]) => <div className="form-field" key={key}><label className="form-label">{label}</label><input className="field" type={type} data-testid={`input-edit-${key}`} value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} /></div>)}<div className="form-field"><label className="form-label">Status</label><select className="select" data-testid="select-edit-status" value={form.status || ''} onChange={(e) => setField('status', e.target.value)}>{statuses.map((entry) => <option key={entry}>{entry}</option>)}</select></div><div className="form-field full"><label className="form-label">Offence description</label><input className="field" data-testid="input-edit-offence-description" value={form.offenceDescription || ''} onChange={(e) => setField('offenceDescription', e.target.value)} /></div><details className="intake-extra"><summary>Edit ticket, vehicle, driver, court, fees &amp; outcome details</summary><div className="form-grid" style={{ marginTop: 14 }}>{[['responseDeadline','Response deadline','date'],['citationIssuingAgency','Issuing agency','text'],['officerName','Officer name','text'],['officerBadgeNumber','Badge number','text'],['offenceLocation','Offence location','text'],['speedAlleged','Speed alleged','number'],['speedLimit','Speed limit','number'],['licencePlate','Licence plate','text'],['licencePlateRegion','Plate region','text'],['vehicleMake','Make','text'],['vehicleModel','Model','text'],['vehicleYear','Vehicle year','number'],['vehicleColour','Colour','text'],['vehicleVIN','VIN','text'],['driversLicenceNumber','Licence number','text'],['driversLicenceRegion','Licence region','text'],['driversLicenceExpiry','Licence expiry','date'],['courtFileNumber','Court file no.','text'],['courtRoomNumber','Room','text'],['courtJurisdiction','Jurisdiction','text'],['hearingType','Hearing type','text'],['partType','Part type','text'],['retainerAmount','Retainer amount','number'],['retainerPaidDate','Retainer paid date','date'],['setFine','Set fine','number'],['victimSurcharge','Victim surcharge','number'],['disbursements','Disbursements','number'],['outcome','Outcome','text'],['reducedCharge','Reduced charge','text'],['courtFineAmount','Court fine (CAD)','number'],['demeritPoints','Demerit points','number'],['closedDate','Closed date','date'],['assignedTo','Assigned to','text']].map(([key, label, type]) => <div className="form-field" key={key}><label className="form-label">{label}</label><input className="field" type={type} data-testid={`input-edit-${key}`} value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} /></div>)}<div className="form-field"><label className="form-label">Speed unit</label><select className="select" value={form.speedUnit || 'km/h'} onChange={(e) => setField('speedUnit', e.target.value)}><option>km/h</option><option>mph</option></select></div><div className="form-field"><label className="form-label">Licence suspended</label><select className="select" value={form.licenceSuspended || ''} onChange={(e) => setField('licenceSuspended', e.target.value)}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></div><div className="form-field"><label className="form-label">Priority</label><select className="select" value={form.priority || 'Normal'} onChange={(e) => setField('priority', e.target.value)}>{['Low', 'Normal', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</select></div><div className="form-field full"><label className="form-label">Tags <span className="muted">(comma separated)</span></label><input className="field" value={form.tags || ''} onChange={(e) => setField('tags', e.target.value)} /></div><div className="form-field"><label className="form-label">Disclosure requested</label><input className="field" type="date" value={form.disclosureRequestedDate || ''} onChange={(e) => setField('disclosureRequestedDate', e.target.value)} /></div><div className="form-field"><label className="form-label">Disclosure received</label><input className="field" type="date" value={form.disclosureReceivedDate || ''} onChange={(e) => setField('disclosureReceivedDate', e.target.value)} /></div></div></details></div>{update.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 13 }}>Could not save changes.</div>}</section> : null}
    <div className="detail-grid"><div className="stack"><section className="card detail-card"><div className="section-head"><div><div className="section-title">Matter details</div><div className="section-kicker">The facts you need at a glance.</div></div><ClipboardList size={18} className="muted" /></div><div className="form-grid"><div><div className="form-label">Offence</div><div style={{ fontSize: 13, marginTop: 5 }}>{item.offenceDescription || 'Not provided'}</div></div><div><div className="form-label">Statute</div><div className="mono" style={{ marginTop: 5 }}>{item.statuteCode || '—'}</div></div><div><div className="form-label">Court location</div><div style={{ fontSize: 13, marginTop: 5 }}>{item.courtLocation || 'Not provided'}</div></div><div><div className="form-label">Next follow-up</div><div style={{ fontSize: 13, marginTop: 5, color: 'hsl(var(--accent))' }}>{dateLabel(item.nextFollowUpDate)}</div></div><div><div className="form-label">Intake date</div><div className="mono" style={{ marginTop: 5 }}>{dateLabel(item.intakeDate)}</div></div><div><div className="form-label">Last updated</div><div className="mono" style={{ marginTop: 5 }}>{dateLabel(item.updatedAt)}</div></div>{([['Officer', item.officerName || ''], ['Badge number', item.officerBadgeNumber || ''], ['Issuing agency', item.citationIssuingAgency || ''], ['Response deadline', item.responseDeadline ? dateLabel(item.responseDeadline) : ''], ['Offence date', item.offenceDate ? dateLabel(item.offenceDate) : ''], ['Court file no.', item.courtFileNumber || ''], ['Hearing', [item.hearingType, item.courtRoomNumber, item.courtJurisdiction].filter(Boolean).join(' · ')]] as [string, string][]).filter(([, value]) => value).map(([label, value]) => <div key={label}><div className="form-label">{label}</div><div className="mono" style={{ fontSize: 12, marginTop: 5 }}>{value}</div></div>)}</div></section>

      {/* ── VEHICLE & DRIVER ── */}
      <section className="card detail-card" data-testid="section-vehicle">
        <div className="section-head">
          <div><div className="section-title">Vehicle, driver &amp; licence</div><div className="section-kicker">Ticket particulars captured at intake.</div></div>
          <Car size={18} className="muted" />
        </div>
        <div className="form-grid">
          {([['Licence plate', item.licencePlate ? `${item.licencePlate}${item.licencePlateRegion ? ` · ${item.licencePlateRegion}` : ''}` : ''], ['Vehicle', [item.vehicleYear, item.vehicleMake, item.vehicleModel].filter(Boolean).join(' ')], ['Colour', item.vehicleColour || ''], ['VIN', item.vehicleVIN || ''], ["Driver's licence", item.driversLicenceNumber ? `${item.driversLicenceNumber}${item.driversLicenceRegion ? ` · ${item.driversLicenceRegion}` : ''}` : ''], ['Licence expiry', item.driversLicenceExpiry ? dateLabel(item.driversLicenceExpiry) : ''], ['Speed alleged', item.speedAlleged ? `${item.speedAlleged} ${item.speedUnit || 'km/h'} (limit ${item.speedLimit ?? '—'})` : ''], ['Offence location', item.offenceLocation || '']] as [string, string][]).filter(([, value]) => value).map(([label, value]) => (
            <div key={label}><div className="form-label">{label}</div><div className="mono" style={{ fontSize: 12, marginTop: 5 }}>{value}</div></div>
          ))}
          {!item.licencePlate && !item.vehicleMake && !item.vehicleVIN && !item.driversLicenceNumber && !item.speedAlleged && !item.offenceLocation && <div className="muted" style={{ fontSize: 12 }}>No vehicle or driver particulars recorded yet — use Edit record to add them.</div>}
        </div>
      </section>

      {/* ── FEES, WORKFLOW & OUTCOME ── */}
      <section className="card detail-card" data-testid="section-workflow">
        <div className="section-head">
          <div><div className="section-title">Fees, workflow &amp; outcome</div><div className="section-kicker">Retainer, disclosure tracking and resolution.</div></div>
          <Wallet size={18} className="muted" />
        </div>
        <div className="form-grid">
          {([['Priority', item.priority || ''], ['Assigned to', item.assignedTo || ''], ['Tags', (item.tags || []).join(', ')], ['Retainer', item.retainerAmount ? `${money(item.retainerAmount)}${item.retainerPaidDate ? ` · paid ${dateLabel(item.retainerPaidDate)}` : ''}` : ''], ['Set fine', item.setFine ? money(item.setFine) : ''], ['Victim surcharge', item.victimSurcharge ? money(item.victimSurcharge) : ''], ['Disbursements', item.disbursements ? money(item.disbursements) : ''], ['Disclosure requested', item.disclosureRequestedDate ? dateLabel(item.disclosureRequestedDate) : ''], ['Disclosure received', item.disclosureReceivedDate ? dateLabel(item.disclosureReceivedDate) : ''], ['Outcome', item.outcome || ''], ['Reduced charge', item.reducedCharge || ''], ['Court fine', item.courtFineAmount ? money(item.courtFineAmount) : ''], ['Demerit points', item.demeritPoints ? String(item.demeritPoints) : ''], ['Licence suspended', item.licenceSuspended === true ? `Yes${item.suspensionDays ? ` · ${item.suspensionDays} days` : ''}` : item.licenceSuspended === false ? 'No' : ''], ['Closed date', item.closedDate ? dateLabel(item.closedDate) : '']] as [string, string][]).filter(([, value]) => value).map(([label, value]) => (
            <div key={label}><div className="form-label">{label}</div><div style={{ fontSize: 13, marginTop: 5 }}>{value}</div></div>
          ))}
        </div>
      </section>

      {/* ── COURT DATES ── */}
      <section className="card detail-card" data-testid="section-court-dates">
        <div className="section-head">
          <div><div className="section-title">Court dates</div><div className="section-kicker">Schedule appearances and log outcomes.</div></div>
          <Calendar size={18} className="muted" />
        </div>
        {courtDates.length > 0 && (
          <div className="court-dates-list">
            {courtDates.map((cd) => {
              const days = daysUntil(cd.date);
              return (
                <div className="court-date-row" key={cd.id} data-testid={`row-court-${cd.id}`}>
                  <div className="court-date-left">
                    <div className="court-date-icon" style={{ background: days !== null && days < 0 ? 'hsl(var(--destructive) / .1)' : days !== null && days <= 3 ? 'hsl(var(--accent) / .1)' : 'hsl(var(--chart-2) / .1)', color: countdownColor(days) }}><Calendar size={14} /></div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{dateLabel(cd.date)}</div>
                      {cd.outcome && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{cd.outcome}</div>}
                      {cd.notes && <div className="muted" style={{ fontSize: 11, marginTop: 2, fontStyle: 'italic' }}>{cd.notes}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CountdownBadge date={cd.date} />
                    <button className="button button-danger" style={{ minHeight: 28, padding: '0 8px' }} data-testid={`button-delete-court-${cd.id}`} onClick={() => deleteCourtDate(cd.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mini-form">
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Date</label>
              <input className="field" type="date" data-testid="input-court-date" value={courtForm.date} onChange={(e) => setCourtForm({ ...courtForm, date: e.target.value })} />
            </div>
            <div className="form-field">
              <label className="form-label">Outcome <span className="muted">(optional)</span></label>
              <input className="field" data-testid="input-court-outcome" value={courtForm.outcome} onChange={(e) => setCourtForm({ ...courtForm, outcome: e.target.value })} placeholder="e.g. Adjourned, Withdrawn" />
            </div>
            <div className="form-field full">
              <label className="form-label">Notes <span className="muted">(optional)</span></label>
              <input className="field" data-testid="input-court-notes" value={courtForm.notes} onChange={(e) => setCourtForm({ ...courtForm, notes: e.target.value })} placeholder="Room number, judge's name, etc." />
            </div>
          </div>
          <button className="button button-primary" data-testid="button-add-court-date" disabled={!courtForm.date || courtDate.isPending} onClick={addCourtDate} style={{ marginTop: 12 }}>{courtDate.isPending ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Add court date</button>
          {courtDate.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Court date was not saved.</div>}
        </div>
      </section>

      {/* ── DOCUMENTS ── */}
      <section className="card detail-card" data-testid="section-documents">
        <div className="section-head">
          <div><div className="section-title">Documents</div><div className="section-kicker">Ticket scans, disclosure, court notices.</div></div>
          <Paperclip size={18} className="muted" />
        </div>
        {docs.length > 0 && (
          <div className="doc-list">
            {docs.map((doc) => (
              <div className="doc-row" key={doc.id} data-testid={`row-doc-${doc.id}`}>
                <div className="doc-icon"><FileText size={15} /></div>
                <div className="doc-meta">
                  <div className="doc-name">{doc.name}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{formatBytes(doc.size)} · {compactDate(doc.uploadedAt)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="button button-ghost" style={{ minHeight: 28, padding: '0 8px' }} data-testid={`button-download-doc-${doc.id}`} onClick={() => handleDownloadDoc(doc.id)}><Download size={13} /></button>
                  <button className="button button-danger" style={{ minHeight: 28, padding: '0 8px' }} data-testid={`button-delete-doc-${doc.id}`} onClick={() => handleDeleteDoc(doc.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mini-form">
          <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.txt,.csv" style={{ display: 'none' }} data-testid="input-file-upload" onChange={handleFileUpload} />
          <div className="dropzone" style={{ cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
            <Upload size={20} />
            <p style={{ margin: '8px 0 3px', fontSize: 12 }}>{uploadDoc.isPending ? 'Uploading…' : 'Click to attach files'}</p>
            <small>PDF, images, Word docs, CSV · up to 5&nbsp;MB each</small>
          </div>
          {uploadDoc.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Document was not uploaded. Keep files under 5 MB.</div>}
        </div>
      </section>

      {/* ── TRUST LEDGER ── */}
      <section className="card detail-card" data-testid="section-trust">
        <div className="section-head">
          <div><div className="section-title">Trust ledger</div><div className="section-kicker">Client funds held in trust for this matter.</div></div>
          <ShieldCheck size={18} className="muted" />
        </div>
        <div className="money-band" style={{ marginBottom: 14 }}>
          <div className="money-cell"><div className="money-label">Trust balance</div><div className="money-value" data-testid="value-trust-balance">{money(trustQuery.data?.trustBalance ?? 0)}</div></div>
          <div className="money-cell"><div className="money-label">Entries</div><div className="money-value">{trustEntries.length}</div></div>
        </div>
        {trustQuery.isLoading ? <LoadingState rows={2} /> : trustEntries.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th><th /></tr></thead>
              <tbody>
                {trustEntries.map((entry) => (
                  <tr key={entry.id} data-testid={`row-trust-${entry.id}`}>
                    <td className="mono">{dateLabel(entry.date)}</td>
                    <td><span className={`pill pill-${entry.type}`}>{entry.type}</span></td>
                    <td className="mono" style={{ color: entry.type === 'deposit' ? 'hsl(var(--chart-2))' : 'hsl(var(--accent))' }}>{entry.type === 'deposit' ? '+' : '−'}{money(entry.amount)}</td>
                    <td className="muted" style={{ fontSize: 11 }}>{entry.note || '—'}</td>
                    <td><button className="button button-danger" data-testid={`button-delete-trust-${entry.id}`} style={{ minHeight: 28, padding: '0 8px' }} onClick={() => deleteTrustEntry(entry.id)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>No trust activity on this file yet.</div>}
        <div className="mini-form">
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Type</label>
              <select className="select" data-testid="select-trust-type" value={trustForm.type} onChange={(e) => setTrustForm({ ...trustForm, type: e.target.value })}>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="transfer">Transfer to fees</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Amount (CAD)</label>
              <input className="field" type="number" min="0.01" step="0.01" data-testid="input-trust-amount" value={trustForm.amount} onChange={(e) => setTrustForm({ ...trustForm, amount: e.target.value })} placeholder="250" />
            </div>
            <div className="form-field">
              <label className="form-label">Date</label>
              <input className="field" type="date" data-testid="input-trust-date" value={trustForm.date} onChange={(e) => setTrustForm({ ...trustForm, date: e.target.value })} />
            </div>
            <div className="form-field">
              <label className="form-label">Note <span className="muted">(optional)</span></label>
              <input className="field" data-testid="input-trust-note" value={trustForm.note} onChange={(e) => setTrustForm({ ...trustForm, note: e.target.value })} placeholder="Retainer for trial" />
            </div>
          </div>
          <button className="button button-primary" data-testid="button-add-trust" disabled={trustCreate.isPending || !trustForm.amount} onClick={addTrustEntry}>{trustCreate.isPending ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Record trust entry</button>
          {trustCreate.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>
            {(trustCreate.error as any)?.status === 422 ? 'Insufficient trust balance for a withdrawal or transfer.' : 'Trust entry was not saved.'}
          </div>}
        </div>
      </section>

      {/* ── EXPENSES ── */}
      <section className="card detail-card" data-testid="section-expenses">
        <CaseExpensesPanel caseId={id} />
      </section>

      {/* ── SIGNATURE REQUESTS ── */}
      <section className="card detail-card" data-testid="section-signatures">
        <div className="section-head">
          <div><div className="section-title">Signature requests</div><div className="section-kicker">Send a document or agreement for the client to sign online.</div></div>
          <PenLine size={18} className="muted" />
        </div>
        {sigQuery.isLoading ? <LoadingState rows={2} /> : signatureRequests.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {signatureRequests.map((request) => (
              <div className="sig-row" key={request.id} data-testid={`row-signature-${request.id}`}>
                <div className="sig-icon"><PenLine size={14} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{request.title}</div>
                  <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>
                    {request.documentName ? `Document · ${request.documentName}` : 'Written agreement'}
                    {request.status === 'signed' && request.signerName ? ` · signed by ${request.signerName} ${compactDate(request.signedAt)}` : ` · sent ${compactDate(request.createdAt)}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`pill pill-${request.status}`} data-testid={`status-signature-${request.id}`}>{request.status}</span>
                  {request.status === 'pending' && (
                    <button className="button button-ghost" data-testid={`button-copy-sign-${request.id}`} style={{ minHeight: 28, padding: '0 8px' }} title="Copy signing link" onClick={() => copySignLink(request.token)}>
                      {copiedSig === request.token ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  )}
                  <button className="button button-danger" data-testid={`button-delete-sign-${request.id}`} style={{ minHeight: 28, padding: '0 8px' }} onClick={() => deleteSignatureRequest(request.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>No signature requests on this file yet.</div>}
        <div className="mini-form">
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Title</label>
              <input className="field" data-testid="input-sign-title" value={sigForm.title} onChange={(e) => setSigForm({ ...sigForm, title: e.target.value })} placeholder="Retainer agreement" />
            </div>
            <div className="form-field">
              <label className="form-label">Attach document <span className="muted">(optional)</span></label>
              <select className="select" data-testid="select-sign-document" value={sigForm.documentId} onChange={(e) => setSigForm({ ...sigForm, documentId: e.target.value })}>
                <option value="">None — written agreement</option>
                {docs.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
              </select>
            </div>
            <div className="form-field full">
              <label className="form-label">Agreement text <span className="muted">(shown instead of a document)</span></label>
              <textarea className="textarea" data-testid="input-sign-agreement" style={{ minHeight: 70 }} value={sigForm.agreementText} onChange={(e) => setSigForm({ ...sigForm, agreementText: e.target.value })} placeholder="I, the client, retain Docketline to represent me on this matter…" />
            </div>
          </div>
          <button className="button button-primary" data-testid="button-add-signature" disabled={sigCreate.isPending || !sigForm.title.trim() || (!sigForm.documentId && !sigForm.agreementText.trim())} onClick={addSignatureRequest}>{sigCreate.isPending ? <Loader2 className="animate-spin" size={15} /> : <PenLine size={15} />} Request signature</button>
          {sigCreate.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Signature request was not created.</div>}
        </div>
      </section>

      <section className="card detail-card"><div className="section-head"><div><div className="section-title">Activity timeline</div><div className="section-kicker">Notes, payments, and appearances in one thread.</div></div><Activity size={18} className="muted" /></div>{timeline.length ? <div className="timeline">{timeline.map((entry) => <div className="timeline-item" key={entry.key}><div className="timeline-dot" /><div className="timeline-date">{dateLabel(entry.date)}</div><div className="timeline-title">{entry.title}{entry.kind === 'note' && entry.clientVisible ? <span className="pill pill-shared" style={{ marginLeft: 6 }}>CLIENT</span> : null}{entry.payment?.isVoided ? <span className="pill pill-void" style={{ marginLeft: 6 }}>VOID</span> : entry.payment?.isRefund ? <span className="pill pill-refund" style={{ marginLeft: 6 }}>REFUND</span> : null}{entry.payment && !entry.payment.isVoided && !entry.payment.isRefund ? <span className="pill pill-default" style={{ marginLeft: 6 }}>{entry.payment.allocationType}</span> : null}</div><div className="timeline-copy">{entry.copy}</div>{entry.kind === 'note' ? <div style={{ display: 'flex', gap: 6, marginTop: 7 }}><button className="button button-ghost" style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }} data-testid={`button-edit-note-${entry.noteId}`} onClick={() => editNote(entry.noteId, entry.text)}><PenLine size={12} /> Edit</button><button className="button button-danger" style={{ minHeight: 24, padding: '0 8px' }} data-testid={`button-delete-note-${entry.noteId}`} onClick={() => deleteNote(entry.noteId)}><Trash2 size={12} /></button></div> : null}{entry.kind === 'payment' && entry.payment && !entry.payment.isVoided && !entry.payment.isRefund ? <div style={{ display: 'flex', gap: 6, marginTop: 7 }}><button className="button button-ghost" style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }} data-testid={`button-void-payment-${entry.payment.id}`} onClick={() => voidPay(entry.payment!.id, entry.payment!.amount)}><X size={12} /> Void</button><button className="button button-ghost" style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }} data-testid={`button-refund-payment-${entry.payment.id}`} onClick={() => refundPay(entry.payment!.id, entry.payment!.amount)}><Receipt size={12} /> Refund</button></div> : null}</div>)}</div> : <EmptyState title="No activity yet" copy="Add the first note or payment to start the case history." />}</section></div>
      <div className="stack"><section className="card detail-card"><div className="section-title">Record a payment</div><div className="section-kicker">Keep the ledger current.</div><div className="mini-form"><div className="form-field"><label className="form-label">Amount (CAD)</label><input className="field" type="number" min="0.01" data-testid="input-payment-amount" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} placeholder="250" /></div><div className="form-grid" style={{ marginTop: 12 }}><div className="form-field"><label className="form-label">Date</label><input className="field" type="date" data-testid="input-payment-date" value={paymentForm.date} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} /></div><div className="form-field"><label className="form-label">Method</label><select className="select" data-testid="select-payment-method" value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}><option>E-transfer</option><option>Cash</option><option>Card</option><option>Cheque</option><option>Other</option></select></div></div><div className="form-grid" style={{ marginTop: 12 }}><div className="form-field"><label className="form-label">Allocation</label><select className="select" data-testid="select-payment-allocation" value={paymentForm.allocationType} onChange={(e) => setPaymentForm({ ...paymentForm, allocationType: e.target.value })}><option>Installment</option><option>Retainer</option><option>Final Payment</option><option>Disbursement</option><option>General</option></select></div><div className="form-field"><label className="form-label">Received by</label><input className="field" data-testid="input-payment-received-by" value={paymentForm.receivedBy} onChange={(e) => setPaymentForm({ ...paymentForm, receivedBy: e.target.value })} placeholder="Front desk" /></div></div><input className="field" style={{ marginTop: 12 }} data-testid="input-payment-reference" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} placeholder="Reference / transaction no. (optional)" /><input className="field" style={{ marginTop: 12 }} data-testid="input-payment-note" value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} placeholder="Optional note" /><button className="button button-primary" data-testid="button-record-payment" disabled={payment.isPending || !paymentForm.amount} onClick={addPayment}>{payment.isPending ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Record payment</button>{payment.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Payment was not recorded.</div>}</div></section><section className="card detail-card"><div className="section-title">Add a note</div><div className="section-kicker">Leave a clear breadcrumb for future you.</div><div className="mini-form"><textarea className="textarea" data-testid="input-case-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Client sent disclosure by email…" /><label className="check-row" data-testid="label-note-client-visible"><input type="checkbox" data-testid="checkbox-note-client-visible" checked={noteVisible} onChange={(e) => setNoteVisible(e.target.checked)} /><span>Share with client — appears on their portal page</span></label><button className="button button-primary" data-testid="button-add-note" disabled={note.isPending || !noteText.trim()} onClick={addNote}>{note.isPending ? <Loader2 className="animate-spin" size={15} /> : <NotebookPen size={15} />} Add note</button>{note.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Note was not added.</div>}</div></section></div>
    </div>
  </>;
}

function Clients() {
  const PAGE_SIZE = 20;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = useMemo(() => ({ search: search || undefined, page, limit: PAGE_SIZE }), [search, page]);
  const clients = useListClients(params, { query: { queryKey: getListClientsQueryKey(params), staleTime: 15000 } });
  const rows = clients.data?.data || [];
  useEffect(() => { setPage(1); }, [search]);
  return <><PageHeader eyebrow="Directory" title="Clients" copy="One clean list for every person behind the paperwork." action={<Link href="/cases/new" className="button button-accent" data-testid="link-client-new-case"><Plus size={16} /> New case</Link>} /><section className="card table-card"><div className="toolbar"><div className="input-wrap"><Search /><input className="field" data-testid="input-client-search" placeholder="Search clients by name, phone, or email" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>{clients.isLoading ? <LoadingState rows={6} /> : clients.isError ? <ErrorState onRetry={() => clients.refetch()} /> : !rows.length ? <EmptyState title="No clients found" copy="Your client directory is empty for this search." action={<button className="button button-ghost" data-testid="button-clear-client-search" onClick={() => { setSearch(''); setPage(1); }}>Clear search</button>} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Client</th><th>Contact</th><th>Lead source</th><th>Added</th><th /></tr></thead><tbody>{rows.map((client) => <tr key={client.id} data-testid={`row-client-${client.id}`}><td><Link href={`/clients/${client.id}`} className="data-link" data-testid={`link-client-${client.id}`}>{client.fullName}</Link><div className="muted mono" style={{ marginTop: 4 }}>{initials(client.fullName)} · Client record</div></td><td><div>{client.phone || 'No phone'}</div><div className="muted" style={{ marginTop: 4 }}>{client.email || 'No email'}</div></td><td><StatusPill status={client.leadSourceChannel} /><div className="muted" style={{ marginTop: 4 }}>{client.leadSourceDetail || '—'}</div></td><td className="mono">{dateLabel(client.createdAt)}</td><td><Link href={`/clients/${client.id}`} className="button button-ghost" data-testid={`button-client-cases-${client.id}`} style={{ minHeight: 28, padding: '0 8px' }}>View profile</Link></td></tr>)}</tbody></table></div>}
      <PaginationControls page={clients.data?.page ?? 1} pageSize={clients.data?.pageSize ?? PAGE_SIZE} total={clients.data?.total ?? 0} onPageChange={setPage} />
    </section></>;
}

function ClientDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const clientQuery = useGetClient(id, { query: { queryKey: getGetClientQueryKey(id), staleTime: 15000 } });
  const allCases = useListCases({ clientId: id, page: 1, limit: 100 }, { query: { queryKey: getListCasesQueryKey({ clientId: id, page: 1, limit: 100 }), staleTime: 15000 } });
  const update = useUpdateClient();
  const remove = useDeleteClient();
  const issuePortal = useCreatePortalLink();
  const revokePortal = useRevokePortalLink();
  const emailPortal = useSendPortalEmail();
  const [copiedPortal, setCopiedPortal] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState('');
  const portalUrl = clientQuery.data?.portalToken ? `${window.location.origin}${basePath}/portal/${clientQuery.data.portalToken}` : '';
  const refreshClient = () => queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
  const copyPortalLink = async () => {
    if (!portalUrl) return;
    setCopiedPortal(await copyText(portalUrl));
    setTimeout(() => setCopiedPortal(false), 1800);
  };
  const emailPortalLink = () => {
    const fallback = clientQuery.data?.email || '';
    const address = window.prompt('Send the portal link to:', fallback);
    if (address === null) return;
    const trimmed = address.trim();
    if (!trimmed) {
      setEmailFeedback('No email address given — add one to the client record or copy the link instead.');
      return;
    }
    emailPortal.mutate({ id, data: { email: trimmed } }, {
      onSuccess: (result) => {
        refreshClient();
        setEmailFeedback(result.emailed
          ? `Portal link emailed to ${result.to ?? trimmed}.`
          : `Email service not configured on the server — the link is ready to copy below (intended for ${result.to ?? trimmed}).`);
      },
    });
  };
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', leadSourceChannel: 'Referral', leadSourceDetail: '' });
  const [deleteError, setDeleteError] = useState('');

  const clientCases = useMemo(() => allCases.data?.data || [], [allCases.data]);

  const totalFees = clientCases.reduce((sum: number, c: any) => sum + (c.totalFee || 0), 0);
  const totalCollected = clientCases.reduce((sum: number, c: any) => sum + ((c.totalFee || 0) - (c.balanceOwing || 0)), 0);
  const totalOwing = clientCases.reduce((sum: number, c: any) => sum + (c.balanceOwing || 0), 0);

  if (clientQuery.isLoading) return <><PageHeader eyebrow="Client file" title="Loading…" /><LoadingState rows={5} /></>;
  if (clientQuery.isError || !clientQuery.data) return <><PageHeader eyebrow="Client file" title="Client not found" /><ErrorState onRetry={() => clientQuery.refetch()} /></>;
  const client = clientQuery.data;

  const setField = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const startEdit = () => {
    setForm({ fullName: client.fullName, phone: client.phone || '', email: client.email || '', leadSourceChannel: client.leadSourceChannel || 'Referral', leadSourceDetail: client.leadSourceDetail || '' });
    setEditing(true);
  };
  const saveEdit = () => {
    if (!form.fullName.trim()) return;
    update.mutate({ id, data: { fullName: form.fullName.trim(), phone: form.phone || undefined, email: form.email || undefined, leadSourceChannel: form.leadSourceChannel, leadSourceDetail: form.leadSourceDetail || undefined } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        setEditing(false);
      },
    });
  };
  const deleteThis = () => {
    if (!window.confirm('Remove this client from the directory?')) return;
    setDeleteError('');
    remove.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        setLocation('/clients');
      },
      onError: (error: any) => {
        setDeleteError(error?.status === 409
          ? 'This client still has active cases. Delete or close those cases first.'
          : 'Client could not be deleted. Try again.');
      },
    });
  };

  return <>
    <div className="detail-hero">
      <div>
        <Link href="/clients" className="muted" data-testid="link-back-clients" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', fontSize: 11 }}><ArrowLeft size={13} /> Client directory</Link>
        <div className="eyebrow" style={{ marginTop: 20 }}>Client profile</div>
        <h1 className="page-title">{client.fullName}</h1>
        <div className="detail-id">CLIENT · Added {dateLabel(client.createdAt)}</div>
      </div>
      <div className="button-row" style={{ display: 'flex', gap: 8 }}>
        <StatusPill status={client.leadSourceChannel} />
        <button className="button button-ghost" data-testid="button-edit-client" onClick={() => editing ? setEditing(false) : startEdit()}>{editing ? <X size={15} /> : <NotebookPen size={15} />} {editing ? 'Cancel edit' : 'Edit record'}</button>
        <button className="button button-accent" data-testid="link-client-new-case-profile" onClick={() => setLocation('/cases/new')}><Plus size={15} /> New case</button>
        <button className="button button-danger" data-testid="button-delete-client" onClick={deleteThis} disabled={remove.isPending || clientCases.length > 0} title={clientCases.length > 0 ? 'Delete or close this client\u2019s cases first' : 'Remove client'}><Trash2 size={14} /></button>
      </div>
    </div>
    {deleteError && <div className="card error-panel" style={{ marginBottom: 18 }} data-testid="status-delete-client-error"><AlertCircle size={16} /><span>{deleteError}</span></div>}
    {editing ? (
      <section className="card detail-card" style={{ marginBottom: 20 }}>
        <div className="section-head">
          <div><div className="section-title">Edit client record</div><div className="section-kicker">Changes save back to the client directory.</div></div>
          <button className="button button-accent" data-testid="button-save-client" disabled={update.isPending || !form.fullName.trim()} onClick={saveEdit}>{update.isPending ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Save changes</button>
        </div>
        <div className="form-grid">
          <div className="form-field full"><label className="form-label">Full name</label><input className="field" data-testid="input-edit-client-name" value={form.fullName} onChange={(e) => setField('fullName', e.target.value)} /></div>
          <div className="form-field"><label className="form-label">Phone</label><input className="field" data-testid="input-edit-client-phone" value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="416 555 0182" /></div>
          <div className="form-field"><label className="form-label">Email</label><input className="field" type="email" data-testid="input-edit-client-email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="client@email.com" /></div>
          <div className="form-field"><label className="form-label">Lead source</label><select className="select" data-testid="select-edit-client-source" value={form.leadSourceChannel} onChange={(e) => setField('leadSourceChannel', e.target.value)}>{leadSources.map((source) => <option key={source}>{source}</option>)}</select></div>
          <div className="form-field"><label className="form-label">Source detail</label><input className="field" data-testid="input-edit-client-source-detail" value={form.leadSourceDetail} onChange={(e) => setField('leadSourceDetail', e.target.value)} placeholder="Who sent them?" /></div>
        </div>
        {update.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 13 }}>Could not save changes.</div>}
      </section>
    ) : null}

    <div className="detail-grid" style={{ marginBottom: 20 }}>
      <div className="stack">
        {/* Contact info card */}
        <section className="card detail-card">
          <div className="section-head">
            <div><div className="section-title">Contact information</div><div className="section-kicker">How to reach this client.</div></div>
            <UserRound size={18} className="muted" />
          </div>
          <div className="form-grid">
            <div>
              <div className="form-label">Phone</div>
              <div style={{ fontSize: 14, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                {client.phone
                  ? <a href={`tel:${client.phone}`} style={{ color: 'hsl(var(--accent))', textDecoration: 'none', fontWeight: 700 }}>{client.phone}</a>
                  : <span className="muted">Not provided</span>}
              </div>
            </div>
            <div>
              <div className="form-label">Email</div>
              <div style={{ fontSize: 14, marginTop: 6 }}>
                {client.email
                  ? <a href={`mailto:${client.email}`} style={{ color: 'hsl(var(--accent))', textDecoration: 'none', fontWeight: 700 }}>{client.email}</a>
                  : <span className="muted">Not provided</span>}
              </div>
            </div>
            <div>
              <div className="form-label">Lead source</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>{client.leadSourceChannel || '—'}</div>
            </div>
            <div>
              <div className="form-label">Source detail</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>{client.leadSourceDetail || '—'}</div>
            </div>
          </div>
        </section>

        {/* Client portal access */}
        <section className="card detail-card" data-testid="section-portal">
          <div className="section-head">
            <div><div className="section-title">Client portal</div><div className="section-kicker">A private link this client can open to see their cases, dates, and documents.</div></div>
            <Link2 size={18} className="muted" />
          </div>
          {portalUrl ? (
            <>
              <div className="portal-link-box mono" data-testid="value-portal-url">{portalUrl}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <a className="button button-primary" data-testid="button-open-portal" style={{ textDecoration: 'none' }} href={portalUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open portal</a>
                <button className="button button-ghost" data-testid="button-copy-portal" onClick={copyPortalLink}><Copy size={14} /> {copiedPortal ? 'Copied' : 'Copy link'}</button>
                                <button className="button button-ghost" data-testid="button-email-portal" disabled={emailPortal.isPending} title="Email this link to the client" onClick={emailPortalLink}><Mail size={14} /> {emailPortal.isPending ? 'Sending…' : 'Email link'}</button>
                <button className="button button-ghost" data-testid="button-rotate-portal" disabled={issuePortal.isPending} title="Issue a fresh link (the old one stops working)" onClick={() => issuePortal.mutate({ id }, { onSuccess: refreshClient })}>{issuePortal.isPending ? 'Rotating…' : 'Rotate'}</button>
                <button className="button button-danger" data-testid="button-revoke-portal" disabled={revokePortal.isPending} onClick={() => { if (window.confirm('Revoke this client\u2019s portal link? They will no longer be able to open it.')) revokePortal.mutate({ id }, { onSuccess: refreshClient }); }}><Trash2 size={14} /> Revoke</button>
              </div>
            </>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12 }}>No portal link yet. Issue one and share it with the client — no login needed on their side.</div>
              <button className="button button-primary" data-testid="button-issue-portal" style={{ marginTop: 12 }} disabled={issuePortal.isPending} onClick={() => issuePortal.mutate({ id }, { onSuccess: refreshClient })}>{issuePortal.isPending ? <Loader2 className="animate-spin" size={15} /> : <Link2 size={15} />} Issue portal link</button>
                            <button className="button button-ghost" data-testid="button-email-portal-new" style={{ marginTop: 8 }} disabled={emailPortal.isPending} onClick={emailPortalLink}><Mail size={14} /> {emailPortal.isPending ? 'Sending…' : 'Email portal link'}</button>
            </>
          )}
          {issuePortal.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 10 }}>Portal link could not be issued.</div>}
                    {emailFeedback && <div data-testid="text-portal-email-feedback" style={{ fontSize: 11, marginTop: 10, color: emailFeedback.startsWith('Portal link emailed') ? 'hsl(var(--chart-2))' : 'hsl(var(--accent))' }}>{emailFeedback}</div>}
        </section>

        {/* Cases for this client */}
        <section className="card table-card">
          <div style={{ padding: '20px 20px 4px' }}>
            <div className="section-title">Cases</div>
            <div className="section-kicker">All matters for this client.</div>
            <div className="section-divider" />
          </div>
          {allCases.isLoading ? <LoadingState rows={3} /> : clientCases.length === 0
            ? <EmptyState title="No cases" copy="No cases are linked to this client yet." action={<Link href="/cases/new" className="button button-ghost">Open a case</Link>} />
            : <div className="table-scroll"><table className="data-table"><thead><tr><th>Case</th><th>Offence</th><th>Status</th><th>Follow-up</th><th>Balance</th><th /></tr></thead><tbody>
              {clientCases.map((c: any) => <tr key={c.id} data-testid={`row-client-case-${c.id}`}>
                <td><Link href={`/cases/${c.id}`} className="data-link mono" data-testid={`link-client-case-detail-${c.id}`}>#{c.caseNumber}</Link><div className="muted mono" style={{ marginTop: 4 }}>{c.ticketNumber || 'No ticket'}</div></td>
                <td><div style={{ fontSize: 12 }}>{c.offenceDescription || c.statuteCode || 'Traffic matter'}</div><div className="muted" style={{ marginTop: 3, fontSize: 11 }}>{c.courtLocation || ''}</div></td>
                <td><StatusPill status={c.status} /></td>
                <td className="mono">{compactDate(c.nextFollowUpDate)}</td>
                <td className="mono" style={{ color: c.balanceOwing > 0 ? 'hsl(var(--accent))' : 'hsl(var(--chart-2))' }}>{money(c.balanceOwing)}</td>
                <td><Link href={`/cases/${c.id}`} className="button button-ghost" style={{ minHeight: 28, padding: '0 8px' }}>Open</Link></td>
              </tr>)}
            </tbody></table></div>}
        </section>
      </div>

      {/* Right column: financial summary */}
      <div className="stack">
        <div className="money-band" style={{ marginBottom: 0 }}>
          <div className="money-cell"><div className="money-label">Total cases</div><div className="money-value">{clientCases.length}</div></div>
          <div className="money-cell"><div className="money-label">Total fees</div><div className="money-value">{money(totalFees)}</div></div>
          <div className="money-cell"><div className="money-label">Balance owing</div><div className={`money-value${totalOwing > 0 ? ' warn' : ''}`}>{money(totalOwing)}</div></div>
        </div>
        <section className="card detail-card">
          <div className="section-title" style={{ marginBottom: 4 }}>Collection summary</div>
          <div className="section-kicker" style={{ marginBottom: 14 }}>Fees vs collected across all matters.</div>
          <div className="section-divider" style={{ marginBottom: 18 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}><span className="muted">Collected</span><strong style={{ fontFamily: 'var(--app-font-mono)', color: 'hsl(var(--chart-2))' }}>{money(totalCollected)}</strong></div>
              <div className="status-bar-track"><div className="status-bar-fill" style={{ width: totalFees > 0 ? `${Math.round(totalCollected / totalFees * 100)}%` : '0%' }} /></div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}><span className="muted">Outstanding</span><strong style={{ fontFamily: 'var(--app-font-mono)', color: 'hsl(var(--accent))' }}>{money(totalOwing)}</strong></div>
              <div className="status-bar-track"><div style={{ height: '100%', background: 'hsl(var(--accent))', borderRadius: 'inherit', width: totalFees > 0 ? `${Math.round(totalOwing / totalFees * 100)}%` : '0%' }} /></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </>;
}

function ReportList({ title, copy, rows }: { title: string; copy: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return <section className="card"><div style={{ padding: '18px 18px 2px' }}><div className="section-title">{title}</div><div className="section-kicker">{copy}</div></div><div className="report-list">{rows.length ? rows.map((row) => <div className="report-line" key={row.label}><div className="report-line-label">{row.label}</div><div className="report-bar"><span style={{ width: `${Math.max(7, row.count / max * 100)}%` }} /></div><div className="report-line-value">{row.count}</div></div>) : <EmptyState title="No report data" copy="There isn't enough activity to show this breakdown yet." />}</div></section>;
}

function Reports() {
  const reports = useGetReportsSummary({ query: { queryKey: getGetReportsSummaryQueryKey(), staleTime: 30000 } });
  const exportQuery = useExportOutstanding({ query: { enabled: false, queryKey: getExportOutstandingQueryKey() } });
  const download = async () => { const result = await exportQuery.refetch(); if (result.data) { const url = URL.createObjectURL(new Blob([result.data], { type: 'text/csv' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'outstanding-cases.csv'; anchor.click(); URL.revokeObjectURL(url); } };
  if (reports.isLoading) return <><PageHeader eyebrow="Reporting" title="Reports" /><LoadingState rows={6} /></>;
  if (reports.isError || !reports.data) return <><PageHeader eyebrow="Reporting" title="Reports" /><ErrorState onRetry={() => reports.refetch()} /></>;
  const data = reports.data;
  return <><PageHeader eyebrow="Reporting / Signal" title="Reports" copy="A practical read on balances, lead sources, and the shape of your book." action={<button className="button button-primary" data-testid="button-export-outstanding" onClick={download} disabled={exportQuery.isFetching}>{exportQuery.isFetching ? <Loader2 className="animate-spin" size={15} /> : <ArrowDownToLine size={15} />} Export outstanding</button>} /><div className="report-grid"><ReportList title="Lead sources" copy="Where new matters originate." rows={data.leadSources || []} /><ReportList title="Referral breakdown" copy="Who is sending work your way." rows={data.referralBreakdown || []} /><ReportList title="Status reporting" copy="Current docket distribution." rows={data.statusCounts || []} /><section className="card"><div style={{ padding: '18px 18px 2px' }}><div className="section-title">Outstanding balances</div><div className="section-kicker">Accounts that still need a close-out.</div></div><div className="attention-list">{data.outstandingCases?.length ? data.outstandingCases.slice(0, 6).map((item) => <Link href={`/cases/${item.id}`} key={item.id} className="attention-row" data-testid={`row-report-outstanding-${item.id}`}><div className="priority-line" /><div><div className="row-title">{item.clientName}</div><div className="row-meta">Case #{item.caseNumber} · {item.status}</div></div><div className="row-value" style={{ color: 'hsl(var(--accent))' }}>{money(item.balanceOwing)}</div><ArrowRight size={15} className="muted" /></Link>) : <EmptyState title="Nothing outstanding" copy="All balances are settled." />}</div></section></div></>;
}

// Legacy import column mapping — keys match the backend's logical field names in getColumn()
const IMPORT_FIELDS: { key: string; label: string; required?: boolean; aliases: string[] }[] = [
  { key: 'clientName', label: 'Client name', required: true, aliases: ['clientName', 'client_name', 'Client Name', 'client name', 'Full Name', 'full name', 'Name', 'name'] },
  { key: 'intakeDate', label: 'Intake date', aliases: ['intakeDate', 'intake_date', 'Intake Date', 'intake date'] },
  { key: 'offenceDate', label: 'Offence date', aliases: ['offenceDate', 'offence_date', 'Offence Date', 'offence date'] },
  { key: 'ticketNumber', label: 'Ticket number', aliases: ['ticketNumber', 'ticket_number', 'Ticket Number', 'ticket number', 'Ticket', 'ticket'] },
  { key: 'statuteCode', label: 'Statute code', aliases: ['statuteCode', 'statute_code', 'Statute Code', 'statute code'] },
  { key: 'offenceDescription', label: 'Offence description', aliases: ['offenceDescription', 'offence_description', 'Offence Description', 'offence description'] },
  { key: 'officeCode', label: 'Office code', aliases: ['officeCode', 'office_code', 'Office Code', 'office code'] },
  { key: 'totalFee', label: 'Total fee', aliases: ['totalFee', 'total_fee', 'Total Fee', 'total fee', 'Fee', 'fee'] },
  { key: 'status', label: 'Status', aliases: ['status', 'Status'] },
  { key: 'rawNote', label: 'Status / payment notes', aliases: ['statusNotes', 'status_notes', 'Notes', 'notes', 'note'] },
];
const autoDetectMapping = (csvHeaders: string[]): Record<string, string> => {
  const byLower = new Map(csvHeaders.filter(Boolean).map((header) => [header.toLowerCase(), header]));
  const detected: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    for (const alias of field.aliases) {
      const match = byLower.get(alias.toLowerCase());
      if (match) { detected[field.key] = match; break; }
    }
  }
  return detected;
};

function ImportPage() {
  const preview = usePreviewImport();
  const commit = useCommitImport();
  const [raw, setRaw] = useState('');
  const [payload, setPayload] = useState<{ rows: Record<string, string>[] } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const parseCsvLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };
  const parse = () => {
    const lines = raw.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return;
    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      return headers.reduce<Record<string, string>>((acc, key, index) => {
        acc[key] = (values[index] || '').trim();
        return acc;
      }, {});
    });
    const next = { rows };
    setHeaders(headers.filter(Boolean));
    setMapping(autoDetectMapping(headers));
    setPayload(next);
    setResult(null);
    preview.mutate({ data: next });
  };
  const commitRows = () => { if (!payload) return; const mappingPayload = Object.fromEntries(Object.entries(mapping).filter(([, column]) => column)); commit.mutate({ data: { rows: payload.rows, mapping: Object.keys(mappingPayload).length ? mappingPayload : undefined } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); } }); };
  const example = 'clientName,ticketNumber,offenceDate,totalFee,status,notes\nJordan Pereira,T12345678,2024-08-16,1250,Open,pd500 initial\nMina Okafor,T12345991,2024-08-22,980,Awaiting Trial,filed and waiting';
  return <><PageHeader eyebrow="Migration / One-time" title="Bring in the old docket" copy="Preview your legacy rows before they become part of the system of record." /><div className="import-layout"><section className="card detail-card"><div className="section-title">1. Paste legacy rows</div><div className="section-kicker">CSV exports from Excel work best. Keep the first row as headers. Payment amounts such as pd500, paid 500, or received 500 are extracted automatically; status keywords like filed, withdrawn, or resummoned are detected from notes.</div><textarea className="textarea" data-testid="input-import-csv" style={{ minHeight: 170, marginTop: 18, fontFamily: 'var(--app-font-mono)', fontSize: 10 }} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={example} /><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 11 }}><button className="button button-ghost" data-testid="button-use-example" onClick={() => setRaw(example)}><FileSpreadsheet size={15} /> Use example</button><button className="button button-accent" data-testid="button-preview-import" disabled={preview.isPending || !raw.trim()} onClick={parse}>{preview.isPending ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />} Preview rows</button></div>{preview.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 12 }}>The preview could not be generated. Check the CSV headers.</div>}</section><section className="card detail-card"><div className="section-title">2. Map columns and commit</div><div className="section-kicker">Columns are auto-detected where headers fit — adjust any assignment before committing.</div>{payload ? <><div className="form-grid" style={{ marginTop: 18 }}>{IMPORT_FIELDS.map((field) => <div className="form-field" key={field.key}><label className="form-label">{field.label}{field.required ? <span className="muted"> *</span> : ''}</label><select className="select" data-testid={`select-map-${field.key}`} value={mapping[field.key] || ''} onChange={(e) => setMapping((current) => ({ ...current, [field.key]: e.target.value }))}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></div>)}</div>{!mapping.clientName ? <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 10 }}>Map the client name column — rows without one are skipped.</div> : null}</> : null}{preview.data ? <><div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 18 }}><div className="stat-card" style={{ minHeight: 90 }}><div className="stat-label">Rows detected</div><div className="stat-value" data-testid="value-import-rows">{preview.data.rowCount}</div></div><div className="stat-card" style={{ minHeight: 90 }}><div className="stat-label">Fields mapped</div><div className="stat-value" data-testid="value-import-mapped">{Object.values(mapping).filter(Boolean).length}/{IMPORT_FIELDS.length}</div></div><div className="stat-card" style={{ minHeight: 90 }}><div className="stat-label">Showing sample</div><div className="stat-value">{preview.data.sample.length}</div></div></div><div className="table-scroll" style={{ marginTop: 18 }}><table className="data-table"><thead><tr>{Object.keys(preview.data.sample[0] || {}).slice(0, 5).map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{preview.data.sample.map((row, index) => <tr key={index}>{Object.keys(preview.data.sample[0] || {}).slice(0, 5).map((key) => <td key={key} className="mono">{row[key] || '—'}</td>)}</tr>)}</tbody></table></div><button className="button button-primary" data-testid="button-commit-import" style={{ marginTop: 18 }} disabled={commit.isPending} onClick={commitRows}>{commit.isPending ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Commit {preview.data.rowCount} rows</button></> : result ? <div className="empty-state"><div className="empty-icon"><Check size={20} /></div><h3>Import complete</h3><p>{result.imported} rows imported and {result.skipped} skipped. Your register is up to date.</p><button className="button button-ghost" data-testid="button-import-another" onClick={() => { setRaw(''); setPayload(null); setResult(null); setHeaders([]); setMapping({}); }}>Import another file</button></div> : <div className="dropzone" style={{ marginTop: 18 }}><div><Upload /><p>Preview will appear here</p><small>Rows, sample values, and validation status</small></div></div>}{commit.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 12 }}>Import failed. No rows were changed.</div>}{commit.data && !result ? <div className="login-status" data-testid="status-import-success">Imported {commit.data.imported} rows; {commit.data.skipped} skipped.</div> : null}</section></div></>;
}

function Login() {
  return <div className="login-page"><div className="login-signal"><Link href="/" data-testid="link-login-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}><div className="brand-mark">TT</div><div><div className="brand-name">Docketline</div><div className="brand-sub">Ontario traffic law</div></div></Link><div className="login-quote">The calm behind every court date.</div><p className="login-note">A focused case desk for one practice, one source of truth, and fewer spreadsheet surprises.</p></div><div className="login-form-side"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={clerkAppearance} /></div></div>;
}

function SignUpPage() {
  return <div className="login-page"><div className="login-signal"><Link href="/" data-testid="link-signup-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}><div className="brand-mark">TT</div><div><div className="brand-name">Docketline</div><div className="brand-sub">Ontario traffic law</div></div></Link><div className="login-quote">One practice. One source of truth.</div></div><div className="login-form-side"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} appearance={clerkAppearance} /></div></div>;
}

// ─── Public pages (token-authenticated, no Clerk) ───────────────────────────
function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="portal-page"><div className="portal-wrap">{children}<div className="portal-foot"><div className="brand-mark" style={{ width: 22, height: 22, fontSize: 9 }}>TT</div><div><strong>Docketline</strong> · Ontario traffic law</div></div></div></div>;
}

function PortalPage() {
  const { token = '' } = useParams<{ token: string }>();
  const portal = useQuery({
    queryKey: ['portal', token],
    queryFn: () => getPortalView(token),
    retry: false,
    staleTime: 30000,
  });
  const downloadDoc = async (documentId: string, name: string) => {
    try {
      const doc = await downloadPortalDocument(token, documentId);
      const anchor = document.createElement('a');
      anchor.href = doc.dataUrl;
      anchor.download = doc.name || name;
      anchor.click();
    } catch { /* download failed */ }
  };
  if (portal.isLoading) return <PublicShell><div className="portal-card"><LoadingState rows={4} /></div></PublicShell>;
  if (portal.isError || !portal.data) return <PublicShell><div className="portal-card"><EmptyState title="This link is no longer active" copy="Ask your paralegal for a fresh portal link. Links can be revoked or rotated at any time." /></div></PublicShell>;
  const data = portal.data;
  return (
    <PublicShell>
      <div className="portal-card" data-testid="section-portal-view">
        <div className="portal-head">
          <div>
            <div className="eyebrow">Client portal</div>
            <h1 className="portal-title">Hello, {data.clientName}</h1>
            <p className="portal-sub">Here is everything on your files right now. Dates first, then payments and documents.</p>
          </div>
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 13 }}>TT</div>
        </div>
        {data.cases.length === 0 ? (
          <EmptyState title="No open files" copy="When your paralegal opens a matter for you, it will appear here." />
        ) : data.cases.map((c) => (
          <div className="portal-case" key={c.id} data-testid={`row-portal-case-${c.id}`}>
            <div className="portal-case-head">
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Case #{c.caseNumber}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{c.offenceDescription || 'Traffic matter'}{c.ticketNumber ? ` · Ticket ${c.ticketNumber}` : ''}</div>
              </div>
              <StatusPill status={c.status} />
            </div>
            <div className="money-band">
              <div className="money-cell"><div className="money-label">Total fee</div><div className="money-value">{money(c.totalFee)}</div></div>
              <div className="money-cell"><div className="money-label">Paid</div><div className="money-value" style={{ color: 'hsl(var(--chart-2))' }}>{money(c.amountReceived)}</div></div>
              <div className="money-cell"><div className="money-label">Balance</div><div className={`money-value${c.balanceOwing > 0 ? ' warn' : ''}`}>{money(c.balanceOwing)}</div></div>
            </div>
            {c.courtDates.length > 0 && (
              <div className="portal-block">
                <div className="portal-block-title"><CalendarClock size={13} /> Court dates</div>
                {c.courtDates.map((cd, i) => (
                  <div className="portal-line" key={i}>
                    <span className="mono">{dateLabel(cd.date)}</span>
                    <span className="muted">{cd.outcome || 'Scheduled appearance'}</span>
                    <CountdownBadge date={cd.date} />
                  </div>
                ))}
              </div>
            )}
            {c.payments.length > 0 && (
              <div className="portal-block">
                <div className="portal-block-title"><Receipt size={13} /> Payments</div>
                {c.payments.map((p, i) => (
                  <div className="portal-line" key={i}>
                    <span className="mono" style={{ fontWeight: 700 }}>{money(p.amount)}</span>
                    <span className="muted">{p.method || 'Payment'} · {dateLabel(p.date)}</span>
                    <span className="muted" style={{ fontSize: 10 }}>{p.note || ''}</span>
                  </div>
                ))}
              </div>
            )}
            {(c.updates?.length ?? 0) > 0 && (
              <div className="portal-block">
                <div className="portal-block-title"><Bell size={13} /> Updates from our office</div>
                {c.updates.map((u, i) => (
                  <div className="portal-line" key={i} data-testid={`portal-update-${i}`}>
                    <span className="mono">{dateLabel(u.createdAt)}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{u.text}{u.author ? ` — ${u.author}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            {c.documents.length > 0 && (
              <div className="portal-block">
                <div className="portal-block-title"><FileText size={13} /> Documents</div>
                {c.documents.map((doc) => (
                  <button className="portal-line portal-doc" key={doc.id} data-testid={`button-portal-doc-${doc.id}`} onClick={() => downloadDoc(doc.id, doc.name)}>
                    <FileText size={13} />
                    <span style={{ fontWeight: 700 }}>{doc.name}</span>
                    <span className="muted" style={{ fontSize: 10 }}>{formatBytes(doc.size)}</span>
                    <Download size={13} style={{ marginLeft: 'auto', opacity: .5 }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="portal-note">Questions about your file? Reply to your paralegal directly — this page is read-only and updates automatically.</div>
      </div>
    </PublicShell>
  );
}

function SignPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const view = useQuery({
    queryKey: ['sign', token],
    queryFn: () => getSignatureRequest(token),
    retry: false,
    staleTime: 30000,
  });
  const sign = async () => {
    if (!signerName.trim() || !signature) return;
    setSubmitting(true);
    setError('');
    try {
      await signSignatureRequest(token, { signerName: signerName.trim(), signatureData: signature });
      view.refetch();
    } catch (err: any) {
      setError(err?.status === 409 ? 'This document has already been signed.' : 'The signature could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };
  if (view.isLoading) return <PublicShell><div className="portal-card"><LoadingState rows={4} /></div></PublicShell>;
  if (view.isError || !view.data) return <PublicShell><div className="portal-card"><EmptyState title="This signing link is no longer active" copy="Ask your paralegal for a fresh signing link." /></div></PublicShell>;
  const data = view.data;
  return (
    <PublicShell>
      <div className="portal-card" data-testid="section-sign-view">
        <div className="portal-head">
          <div>
            <div className="eyebrow">Signature request</div>
            <h1 className="portal-title">{data.title}</h1>
            <p className="portal-sub">Case #{data.caseNumber} · {data.clientName}{data.documentName ? ` · Document: ${data.documentName}` : ''}</p>
          </div>
          <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 13 }}>TT</div>
        </div>
        {data.status === 'signed' ? (
          <div className="portal-signed" data-testid="status-sign-complete">
            <div className="portal-signed-icon"><Check size={22} /></div>
            <h3>Signed{data.signerName ? ` by ${data.signerName}` : ''}</h3>
            <p>This document was signed on {dateLabel(data.signedAt)}. Your paralegal has been notified on the case file.</p>
          </div>
        ) : (
          <>
            {data.agreementText ? (
              <div className="portal-agreement" data-testid="value-agreement-text">{data.agreementText}</div>
            ) : (
              <div className="portal-note">Your paralegal has attached a document for your review. Please sign below to confirm you've received and reviewed it.</div>
            )}
            <div className="portal-sign-form">
              <div className="form-field">
                <label className="form-label">Your full name</label>
                <input className="field" data-testid="input-signer-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Type your legal name" />
              </div>
              <div className="form-field">
                <label className="form-label">Signature</label>
                <SignaturePad onChange={setSignature} />
              </div>
              {error && <div style={{ color: 'hsl(var(--destructive))', fontSize: 12, marginTop: 8 }}>{error}</div>}
              <button className="button button-primary" data-testid="button-submit-signature" style={{ marginTop: 14 }} disabled={submitting || !signerName.trim() || !signature} onClick={sign}>
                {submitting ? <Loader2 className="animate-spin" size={15} /> : <PenLine size={15} />} Sign and submit
              </button>
              <div className="muted" style={{ fontSize: 10, marginTop: 10 }}>By signing you agree that this electronic signature is the legal equivalent of your handwritten signature.</div>
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}

const appRoutes = (
  <Switch><Route path="/" component={Dashboard} /><Route path="/cases/new" component={NewCase} /><Route path="/cases/:id" component={CaseDetailPage} /><Route path="/cases" component={Cases} /><Route path="/clients/:id" component={ClientDetailPage} /><Route path="/clients" component={Clients} /><Route path="/reports" component={Reports} /><Route path="/invoices/new" component={NewInvoicePage} /><Route path="/invoices/:id" component={InvoiceDetailPage} /><Route path="/invoices" component={InvoicesPage} /><Route path="/expenses" component={ExpensesPage} /><Route path="/appointments" component={AppointmentsPage} /><Route path="/conflict-check" component={ConflictCheckerPage} /><Route path="/import" component={ImportPage} /><Route component={() => <EmptyState title="Page not found" copy="That docket page does not exist." action={<Link href="/" className="button button-primary" data-testid="link-not-found-home">Back to overview</Link>} />} /></Switch>
);

function ProtectedRoutes() {
  if (demoMode) return <Shell>{appRoutes}</Shell>;
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="login-page"><LoadingState rows={4} /></div>;
  if (!isSignedIn) return <RedirectToSignIn redirectUrl={basePath || '/'} />;
  return <Shell>{appRoutes}</Shell>;
}

// Attach the Clerk session JWT to every API request as a Bearer token. Without
// this the SPA relies solely on same-origin __session cookies, which only exist
// when Clerk's proxy is active — direct pk_test dev hits send no cookie, so the
// API 401s every call. The getter returns null when signed out (no header).
function AuthTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(async () => (await getToken()) ?? null);
    return () => { setAuthTokenGetter(null); };
  }, [getToken]);
  return null;
}

function Router() {
  return <Switch>
    <Route path="/login" component={() => <Redirect to="/sign-in" />} />
    {/* Clerk components need ClerkProvider; in demo mode bounce to the dashboard */}
    <Route path="/sign-in/*?" component={demoMode ? () => <Redirect to="/" /> : Login} />
    <Route path="/sign-up/*?" component={demoMode ? () => <Redirect to="/" /> : SignUpPage} />
    {/* Public token-authenticated pages — no Clerk session needed */}
    <Route path="/portal/:token" component={PortalPage} />
    <Route path="/sign/:token" component={SignPage} />
    <Route component={ProtectedRoutes} />
  </Switch>;
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  if (!clerkPubKey && !demoMode) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in environment.');
  if (demoMode) {
    return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><RoutedErrorBoundary><Router /></RoutedErrorBoundary><Toaster /></WouterRouter></QueryClientProvider>;
  }
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}><AuthTokenBridge /><RoutedErrorBoundary><Router /></RoutedErrorBoundary></ClerkProvider><Toaster /></WouterRouter></QueryClientProvider>;
}

export default App;