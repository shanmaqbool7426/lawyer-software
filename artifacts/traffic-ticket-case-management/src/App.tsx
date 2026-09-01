import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, RedirectToSignIn, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, BriefcaseBusiness,
  Check, ClipboardList, FilePlus2, FileSpreadsheet, FolderOpen, Import, LayoutDashboard, Loader2,
  LogOut, Mail, NotebookPen, Plus, Receipt, Search, Settings2, ShieldCheck, Trash2, Upload, UserRound,
  UsersRound, X,
} from 'lucide-react';
import {
  getGetCaseQueryKey, getGetDashboardQueryKey, getGetReportsSummaryQueryKey, getListCasesQueryKey,
  getListClientsQueryKey, getExportOutstandingQueryKey, useCommitImport, useCreateCase, useCreateClient,
  useCreateNote, useCreatePayment, useDeleteCase, useExportOutstanding, useGetCase, useGetDashboard,
  useGetReportsSummary, useHealthCheck, useListCases, useListClients, usePreviewImport, useUpdateCase,
} from '@workspace/api-client-react';
import type { Case, Client } from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const statuses = ['Open', 'Disclosure Requested', 'Filed', 'Resummoned', 'Awaiting Trial', 'Withdrawn', 'Resolved', 'Closed'];
const leadSources = ['Referral', 'Website', 'Google Search', 'Google Ads', 'Meta Ads', 'AI Assistant / Chatbot', 'Walk-in', 'Repeat Client', 'Other'];
const clerkAppearance = {
  theme: shadcn,
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
    formButtonPrimary: 'bg-[#1c2b3c] hover:bg-[#263c53]',
    formFieldInput: 'border-[#dfe3e5]',
    footerAction: 'border-t border-[#dfe3e5]',
    dividerLine: 'bg-[#dfe3e5]',
    alert: 'border-[#b8403f]',
    otpCodeFieldInput: 'border-[#dfe3e5]',
    formFieldRow: 'gap-2',
    main: 'bg-transparent',
  },
};
const money = (value = 0) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
const dateLabel = (value?: string | null) => value ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';
const compactDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
const initials = (name = 'Admin') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

function StatusPill({ status }: { status?: string | null }) {
  const slug = (status || 'pending').toLowerCase().replace(/\s/g, '-');
  return <span data-testid={`status-${slug}`} className={`pill pill-${slug}`}>{status || 'Pending'}</span>;
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

function NavLink({ href, icon: Icon, children }: { href: string; icon: typeof LayoutDashboard; children: React.ReactNode }) {
  const [location] = useLocation();
  const active = href === '/' ? location === '/' : location.startsWith(href);
  return <Link href={href} data-testid={`link-${href.slice(1) || 'dashboard'}`} className={`nav-link ${active ? 'active' : ''}`}><Icon /> <span>{children}</span></Link>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const health = useHealthCheck();
  const { signOut } = useClerk();
  const nav = <><NavLink href="/" icon={LayoutDashboard}>Overview</NavLink><NavLink href="/cases" icon={BriefcaseBusiness}>Cases</NavLink><NavLink href="/clients" icon={UsersRound}>Clients</NavLink><NavLink href="/reports" icon={BarChart3}>Reports</NavLink><NavLink href="/import" icon={Import}>Import legacy</NavLink></>;
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand" data-testid="link-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', gap: 10, alignItems: 'center' }}><div className="brand-mark">TT</div><div><div className="brand-name">Docketline</div><div className="brand-sub">Ontario traffic law</div></div></Link>
      <div className="nav-label">Workspace</div><nav>{nav}</nav>
       <div className="nav-label">Account</div><button className="nav-link" data-testid="link-sign-out" onClick={() => signOut({ redirectUrl: `${basePath}/sign-in` })}><LogOut /><span>Sign out</span></button>
      <div className="sidebar-foot"><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><div className="admin-avatar">AM</div><div><div style={{ fontSize: 12, fontWeight: 700 }}>Avery McLean</div><div style={{ fontSize: 10, color: 'hsl(var(--sidebar-foreground) / .5)', marginTop: 3 }}>Principal paralegal</div></div></div><div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, color: 'hsl(var(--sidebar-foreground) / .5)', fontSize: 10 }}><div className="health-dot" style={{ width: 6, height: 6 }} /> {health.isError ? 'Offline mode' : health.isLoading ? 'Checking system' : 'System operational'}</div></div>
    </aside>
    <div className="main-column">
      <div className="mobile-top"><Link href="/" data-testid="link-mobile-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 9 }}><div className="brand-mark">TT</div><strong>Docketline</strong></Link><Link href="/login" data-testid="link-mobile-account" style={{ color: 'inherit' }}><UserRound size={18} /></Link></div>
      <div className="mobile-nav">{nav}</div>
      <header className="topbar"><div className="muted" style={{ fontSize: 12 }}>Ontario / <strong style={{ color: 'hsl(var(--foreground))' }}>Operations desk</strong></div><div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><div className="health-dot" /><span className="muted" style={{ fontSize: 11 }}>{health.isError ? 'Connection issue' : 'Synced just now'}</span><button className="button button-ghost" data-testid="button-settings" onClick={() => window.alert('Workspace settings are managed by the principal administrator.')} style={{ minHeight: 30, padding: '0 8px' }}><Settings2 size={14} /></button></div></header>
      <main className="page-wrap fade-in">{children}</main>
    </div>
  </div>;
}

function Dashboard() {
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), staleTime: 30000 } });
  if (dashboard.isLoading) return <><PageHeader eyebrow="Monday, 14 October 2024" title="Good morning, Avery." copy="Here’s the state of your docket at a glance." /><LoadingState rows={6} /></>;
  if (dashboard.isError || !dashboard.data) return <><PageHeader eyebrow="Operations desk" title="Your docket" /><ErrorState onRetry={() => dashboard.refetch()} /></>;
  const data = dashboard.data;
  const countEntries = Object.entries(data.statusCounts || {});
  const maxCount = Math.max(...countEntries.map(([, count]) => count), 1);
  return <><PageHeader eyebrow="Monday, 14 October 2024" title="Good morning, Avery." copy="Here’s the state of your docket at a glance." action={<Link href="/cases/new" className="button button-accent" data-testid="link-new-case"><Plus size={16} /> New case</Link>} />
    <div className="stat-grid" style={{ marginBottom: 18 }}>
      <div className="card stat-card card-hover"><div className="stat-label">Active cases</div><div className="stat-value" data-testid="value-active-cases">{data.activeCases}</div><div className="stat-foot">Across your current docket</div></div>
      <div className="card stat-card card-hover"><div className="stat-label">Outstanding balance</div><div className="stat-value" data-testid="value-outstanding-balance">{money(data.outstandingBalance)}</div><div className="stat-foot">Across open matters</div></div>
      <div className="card stat-card card-hover"><div className="stat-label">Follow-ups due</div><div className="stat-value" data-testid="value-due-followups">{data.dueFollowUps}</div><div className="stat-foot">Needs a touch this week</div></div>
      <div className="card stat-card card-hover"><div className="stat-label">Docket health</div><div className="stat-value" style={{ color: 'hsl(var(--chart-2))' }}>On track</div><div className="stat-foot">No system issues detected</div></div>
    </div>
    <div className="content-grid">
      <section className="card"><div style={{ padding: '18px 18px 2px' }}><div className="section-title">Needs your attention</div><div className="section-kicker">Cases with the next operational move</div></div><div className="attention-list">{data.attentionCases?.length ? data.attentionCases.map((item) => <Link href={`/cases/${item.id}`} key={item.id} className="attention-row" data-testid={`row-attention-${item.id}`}><div className="priority-line" /><div><div className="row-title">{item.clientName}</div><div className="row-meta">#{item.caseNumber} · {item.offenceDescription || item.statuteCode || 'Traffic matter'}</div></div><div className="row-value"><StatusPill status={item.status} /><div style={{ marginTop: 6, color: 'hsl(var(--accent))' }}>{item.nextFollowUpDate ? compactDate(item.nextFollowUpDate) : money(item.balanceOwing)}</div></div><ArrowRight size={15} className="muted" /></Link>) : <EmptyState title="No urgent cases" copy="Your attention queue is clear. Nice work." />}</div></section>
      <section className="card"><div style={{ padding: '18px 18px 2px' }}><div className="section-title">Case mix</div><div className="section-kicker">Current status distribution</div></div><div className="status-bars">{countEntries.length ? countEntries.map(([label, count]) => <div className="status-bar" key={label}><div className="status-bar-head"><span>{label}</span><strong className="mono">{count}</strong></div><div className="status-bar-track"><div className="status-bar-fill" style={{ width: `${Math.max(7, count / maxCount * 100)}%` }} /></div></div>) : <EmptyState title="No status data" copy="Status counts will appear once cases are added." />}</div></section>
    </div>
    <div className="card" style={{ marginTop: 18, padding: 18, display: 'flex', alignItems: 'center', gap: 14, background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))' }}><ShieldCheck size={21} color="hsl(var(--accent))" /><div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>Your docket is the source of truth.</div><div style={{ color: 'hsl(var(--primary-foreground) / .62)', fontSize: 11, marginTop: 4 }}>Every intake, payment, and follow-up stays attached to the case record.</div></div><Link href="/import" className="button" data-testid="link-import-banner" style={{ color: 'hsl(var(--primary-foreground))', borderColor: 'hsl(var(--primary-foreground) / .25)' }}>Review legacy import <ArrowRight size={14} /></Link></div>
  </>;
}

function Cases() {
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') || '');
  const [status, setStatus] = useState('');
  const [outstanding, setOutstanding] = useState(false);
  const [sort, setSort] = useState<'updatedAt' | 'balanceOwing' | 'nextFollowUpDate'>('updatedAt');
  const params = useMemo(() => ({ search: search || undefined, status: status || undefined, outstanding: outstanding || undefined }), [search, status, outstanding]);
  const cases = useListCases(params, { query: { queryKey: getListCasesQueryKey(params), staleTime: 15000 } });
  const rows = useMemo(() => [...(cases.data || [])].sort((a, b) => String(b[sort] || '').localeCompare(String(a[sort] || ''))), [cases.data, sort]);
  return <><PageHeader eyebrow="Operations / Register" title="Cases" copy="Search the docket, spot balances, and move the next matter forward." action={<Link href="/cases/new" className="button button-accent" data-testid="link-cases-new"><Plus size={16} /> New case</Link>} />
    <section className="card table-card"><div className="toolbar"><div className="input-wrap"><Search /><input className="field" data-testid="input-case-search" placeholder="Search by client, ticket, or case number" value={search} onChange={(e) => setSearch(e.target.value)} /></div><select className="select" data-testid="select-case-status" style={{ width: 145 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map((item) => <option value={item} key={item}>{item}</option>)}</select><button className={`button ${outstanding ? 'button-accent' : 'button-ghost'}`} data-testid="button-outstanding-filter" onClick={() => setOutstanding((value) => !value)}><Receipt size={14} /> Outstanding</button><select className="select" data-testid="select-case-sort" style={{ width: 145 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="updatedAt">Recently updated</option><option value="balanceOwing">Balance owing</option><option value="nextFollowUpDate">Follow-up date</option></select></div>
      {cases.isLoading ? <LoadingState rows={7} /> : cases.isError ? <ErrorState onRetry={() => cases.refetch()} /> : rows.length === 0 ? <EmptyState title="No cases found" copy="Try a different search or clear your filters." action={<button className="button button-ghost" data-testid="button-clear-case-filters" onClick={() => { setSearch(''); setStatus(''); setOutstanding(false); }}>Clear filters</button>} /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Case</th><th>Client</th><th>Status</th><th>Next follow-up</th><th>Fee</th><th>Balance</th><th>Updated</th><th /></tr></thead><tbody>{rows.map((item) => <tr key={item.id} data-testid={`row-case-${item.id}`}><td><Link href={`/cases/${item.id}`} className="data-link mono" data-testid={`link-case-${item.id}`}>#{item.caseNumber}</Link><div className="muted mono" style={{ marginTop: 4 }}>{item.ticketNumber || 'No ticket no.'}</div></td><td><Link href={`/cases/${item.id}`} className="data-link" data-testid={`link-client-case-${item.id}`}>{item.clientName}</Link><div className="muted" style={{ marginTop: 4 }}>{item.offenceDescription || item.statuteCode || 'Traffic matter'}</div></td><td><StatusPill status={item.status} /></td><td className="mono">{compactDate(item.nextFollowUpDate)}</td><td className="mono">{money(item.totalFee)}</td><td className="mono" style={{ color: item.balanceOwing > 0 ? 'hsl(var(--accent))' : 'hsl(var(--chart-2))' }}>{money(item.balanceOwing)}</td><td className="muted mono">{compactDate(item.updatedAt)}</td><td><Link href={`/cases/${item.id}`} className="button button-ghost" data-testid={`button-open-case-${item.id}`} style={{ minHeight: 28, padding: '0 8px' }}>Open</Link></td></tr>)}</tbody></table></div>}</section>
    <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>{rows.length} {rows.length === 1 ? 'case' : 'cases'} shown</div>
  </>;
}

function ClientForm({ onCreated }: { onCreated: (client: Client) => void }) {
  const create = useCreateClient();
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', leadSourceChannel: 'Referral', leadSourceDetail: '' });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => { if (!form.fullName.trim()) return; create.mutate({ data: { ...form, fullName: form.fullName.trim(), phone: form.phone || undefined, email: form.email || undefined, leadSourceDetail: form.leadSourceDetail || undefined } }, { onSuccess: (client) => { queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); onCreated(client); } }); };
  return <div className="card detail-card"><div className="section-title">Add a client</div><div className="section-kicker">Create the client record first, then attach this case.</div><div className="form-grid" style={{ marginTop: 18 }}><div className="form-field full"><label className="form-label">Full name</label><input className="field" data-testid="input-client-name" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Jordan Pereira" /></div><div className="form-field"><label className="form-label">Phone</label><input className="field" data-testid="input-client-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="416 555 0182" /></div><div className="form-field"><label className="form-label">Email</label><input className="field" type="email" data-testid="input-client-email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="jordan@email.com" /></div><div className="form-field"><label className="form-label">Lead source</label><select className="select" data-testid="select-client-source" value={form.leadSourceChannel} onChange={(e) => set('leadSourceChannel', e.target.value)}>{leadSources.map((source) => <option key={source}>{source}</option>)}</select></div><div className="form-field"><label className="form-label">Source detail</label><input className="field" data-testid="input-client-source-detail" value={form.leadSourceDetail} onChange={(e) => set('leadSourceDetail', e.target.value)} placeholder="Who sent them?" /></div></div>{create.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 12 }}>Client could not be saved. Try again.</div>}<button className="button button-primary" data-testid="button-create-client" disabled={create.isPending || !form.fullName.trim()} onClick={submit} style={{ marginTop: 17 }}>{create.isPending ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Create client</button></div>;
}

function NewCase() {
  const [, setLocation] = useLocation();
  const clients = useListClients(undefined, { query: { queryKey: getListClientsQueryKey(), staleTime: 15000 } });
  const create = useCreateCase();
  const [showClient, setShowClient] = useState(false);
  const [selectedClient, setSelectedClient] = useState('');
  const [createdClient, setCreatedClient] = useState<Client | null>(null);
  const [form, setForm] = useState({ intakeDate: new Date().toISOString().slice(0, 10), offenceDate: '', ticketNumber: '', statuteCode: '', offenceDescription: '', officeCode: '', courtLocation: 'Ontario Court of Justice', status: 'Open', totalFee: '', nextFollowUpDate: '', firstNote: '' });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => { if (!selectedClient || !form.offenceDate || !form.totalFee) return; create.mutate({ data: { ...form, clientId: selectedClient, totalFee: Number(form.totalFee), ticketNumber: form.ticketNumber || undefined, statuteCode: form.statuteCode || undefined, offenceDescription: form.offenceDescription || undefined, officeCode: form.officeCode || undefined, nextFollowUpDate: form.nextFollowUpDate || undefined, firstNote: form.firstNote || undefined } }, { onSuccess: (item) => { queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation(`/cases/${item.id}`); } }); };
  if (clients.isLoading) return <><PageHeader eyebrow="Operations / Intake" title="New case" /><LoadingState rows={5} /></>;
  return <><PageHeader eyebrow="Operations / Intake" title="Open a new matter" copy="Start with the client, then capture only what the docket needs to move." action={<Link href="/cases" className="button button-ghost" data-testid="link-cancel-intake"><ArrowLeft size={15} /> Cancel</Link>} />
    {(!clients.data?.length && !createdClient) || showClient ? <div style={{ marginBottom: 18 }}><ClientForm onCreated={(client) => { setCreatedClient(client); setSelectedClient(client.id); setShowClient(false); }} /></div> : null}
    <section className="card detail-card"><div className="section-title">Case intake</div><div className="section-kicker">Required fields are kept intentionally short. You can edit the record later.</div><div className="form-grid" style={{ marginTop: 20 }}><div className="form-field full"><label className="form-label">Client</label><div style={{ display: 'flex', gap: 8 }}><select className="select" data-testid="select-intake-client" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}><option value="">Select a client</option>{(clients.data || []).map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select>{!showClient && <button className="button button-ghost" data-testid="button-add-intake-client" onClick={() => setShowClient(true)}><Plus size={15} /> New client</button>}</div></div><div className="form-field"><label className="form-label">Intake date</label><input className="field" type="date" data-testid="input-intake-date" value={form.intakeDate} onChange={(e) => set('intakeDate', e.target.value)} /></div><div className="form-field"><label className="form-label">Offence date</label><input className="field" type="date" data-testid="input-offence-date" value={form.offenceDate} onChange={(e) => set('offenceDate', e.target.value)} /></div><div className="form-field"><label className="form-label">Ticket number</label><input className="field" data-testid="input-ticket-number" value={form.ticketNumber} onChange={(e) => set('ticketNumber', e.target.value)} placeholder="e.g. T12345678" /></div><div className="form-field"><label className="form-label">Statute code</label><input className="field" data-testid="input-statute-code" value={form.statuteCode} onChange={(e) => set('statuteCode', e.target.value)} placeholder="HTA 128" /></div><div className="form-field full"><label className="form-label">Offence description</label><input className="field" data-testid="input-offence-description" value={form.offenceDescription} onChange={(e) => set('offenceDescription', e.target.value)} placeholder="Driving while under suspension" /></div><div className="form-field"><label className="form-label">Office code</label><input className="field" data-testid="input-office-code" value={form.officeCode} onChange={(e) => set('officeCode', e.target.value)} placeholder="TOR-03" /></div><div className="form-field"><label className="form-label">Court location</label><input className="field" data-testid="input-court-location" value={form.courtLocation} onChange={(e) => set('courtLocation', e.target.value)} /></div><div className="form-field"><label className="form-label">Status</label><select className="select" data-testid="select-intake-status" value={form.status} onChange={(e) => set('status', e.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></div><div className="form-field"><label className="form-label">Total fee (CAD)</label><input className="field" type="number" min="0" data-testid="input-total-fee" value={form.totalFee} onChange={(e) => set('totalFee', e.target.value)} placeholder="1250" /></div><div className="form-field"><label className="form-label">Next follow-up</label><input className="field" type="date" data-testid="input-next-followup" value={form.nextFollowUpDate} onChange={(e) => set('nextFollowUpDate', e.target.value)} /></div><div className="form-field full"><label className="form-label">First note <span className="muted">(optional)</span></label><textarea className="textarea" data-testid="input-first-note" value={form.firstNote} onChange={(e) => set('firstNote', e.target.value)} placeholder="What should you remember when you return to this file?" /></div></div>{create.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 12, marginTop: 15 }}>Case could not be created. Check the required fields and try again.</div>}<div className="form-actions"><Link href="/cases" className="button button-ghost" data-testid="button-cancel-case">Cancel</Link><button className="button button-accent" data-testid="button-create-case" disabled={create.isPending || !selectedClient || !form.offenceDate || !form.totalFee} onClick={submit}>{create.isPending ? <Loader2 className="animate-spin" size={15} /> : <FilePlus2 size={15} />} Open case</button></div></section>
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
  const [paymentForm, setPaymentForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: 'e-transfer', note: '' });
  const [noteText, setNoteText] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const item = detail.data;
  const startEdit = () => { if (!item) return; setForm({ intakeDate: item.intakeDate?.slice(0, 10) || '', offenceDate: item.offenceDate?.slice(0, 10) || '', ticketNumber: item.ticketNumber || '', statuteCode: item.statuteCode || '', offenceDescription: item.offenceDescription || '', officeCode: item.officeCode || '', courtLocation: item.courtLocation || '', status: item.status || 'Open', totalFee: String(item.totalFee), nextFollowUpDate: item.nextFollowUpDate?.slice(0, 10) || '' }); setEditing(true); };
  const saveEdit = () => { if (!item) return; update.mutate({ id, data: { ...form, totalFee: Number(form.totalFee), nextFollowUpDate: form.nextFollowUpDate || null } }, { onSuccess: (updated) => { queryClient.setQueryData(getGetCaseQueryKey(id), (old) => old ? { ...old, ...updated } : updated); queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setEditing(false); } }); };
  const addPayment = () => { if (!paymentForm.amount) return; payment.mutate({ id, data: { amount: Number(paymentForm.amount), date: paymentForm.date, method: paymentForm.method, note: paymentForm.note || undefined } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetReportsSummaryQueryKey() }); setPaymentForm((current) => ({ ...current, amount: '', note: '' })); } }); };
  const addNote = () => { if (!noteText.trim()) return; note.mutate({ id, data: { text: noteText.trim() } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(id) }); setNoteText(''); } }); };
  const deleteThis = () => { if (window.confirm('Move this case out of the active docket?')) remove.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setLocation('/cases'); } }); };
  if (detail.isLoading) return <><PageHeader eyebrow="Case file" title="Loading case…" /><LoadingState rows={6} /></>;
  if (detail.isError || !item) return <><PageHeader eyebrow="Case file" title="Case unavailable" /><ErrorState onRetry={() => detail.refetch()} /></>;
  const timeline = [...(item.notes || []).map((entry) => ({ key: `n-${entry.id}`, date: entry.createdAt, title: 'Case note', copy: entry.text })), ...(item.payments || []).map((entry) => ({ key: `p-${entry.id}`, date: entry.date, title: `Payment recorded · ${money(entry.amount)}`, copy: [entry.method, entry.note].filter(Boolean).join(' · ') || 'Payment activity' })), ...(item.courtDates || []).map((entry) => ({ key: `c-${entry.id}`, date: entry.date, title: 'Court date', copy: entry.outcome || 'Scheduled appearance' }))].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const setField = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <><div className="detail-hero"><div><Link href="/cases" className="muted" data-testid="link-back-cases" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none', fontSize: 11 }}><ArrowLeft size={13} /> Case register</Link><div className="eyebrow" style={{ marginTop: 20 }}>Case file / Active record</div><h1 className="page-title">{item.clientName}</h1><div className="detail-id">CASE #{item.caseNumber} <span style={{ opacity: .45 }}>·</span> {item.ticketNumber || 'Ticket number pending'}</div></div><div className="button-row" style={{ display: 'flex', gap: 8 }}><StatusPill status={item.status} /><button className="button button-ghost" data-testid="button-edit-case" onClick={() => editing ? setEditing(false) : startEdit()}>{editing ? <X size={15} /> : <NotebookPen size={15} />} {editing ? 'Cancel edit' : 'Edit record'}</button><button className="button button-danger" data-testid="button-delete-case" onClick={deleteThis} disabled={remove.isPending}><Trash2 size={14} /></button></div></div>
    <div className="money-band"><div className="money-cell"><div className="money-label">Total fee</div><div className="money-value">{money(item.totalFee)}</div></div><div className="money-cell"><div className="money-label">Received</div><div className="money-value" style={{ color: 'hsl(var(--chart-2))' }}>{money(item.amountReceived)}</div></div><div className="money-cell"><div className="money-label">Balance owing</div><div className="money-value warn">{money(item.balanceOwing)}</div></div></div>
    {editing ? <section className="card detail-card" style={{ marginBottom: 18 }}><div className="section-head"><div><div className="section-title">Edit case record</div><div className="section-kicker">Changes save back to the case register.</div></div><button className="button button-accent" data-testid="button-save-case" disabled={update.isPending} onClick={saveEdit}>{update.isPending ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Save changes</button></div><div className="form-grid">{[['intakeDate','Intake date','date'],['offenceDate','Offence date','date'],['ticketNumber','Ticket number','text'],['statuteCode','Statute code','text'],['officeCode','Office code','text'],['courtLocation','Court location','text'],['totalFee','Total fee (CAD)','number'],['nextFollowUpDate','Next follow-up','date']].map(([key, label, type]) => <div className="form-field" key={key}><label className="form-label">{label}</label><input className="field" type={type} data-testid={`input-edit-${key}`} value={form[key] || ''} onChange={(e) => setField(key, e.target.value)} /></div>)}<div className="form-field"><label className="form-label">Status</label><select className="select" data-testid="select-edit-status" value={form.status || ''} onChange={(e) => setField('status', e.target.value)}>{statuses.map((entry) => <option key={entry}>{entry}</option>)}</select></div><div className="form-field full"><label className="form-label">Offence description</label><input className="field" data-testid="input-edit-offence-description" value={form.offenceDescription || ''} onChange={(e) => setField('offenceDescription', e.target.value)} /></div></div>{update.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 13 }}>Could not save changes.</div>}</section> : null}
    <div className="detail-grid"><div className="stack"><section className="card detail-card"><div className="section-head"><div><div className="section-title">Matter details</div><div className="section-kicker">The facts you need at a glance.</div></div><ClipboardList size={18} className="muted" /></div><div className="form-grid"><div><div className="form-label">Offence</div><div style={{ fontSize: 13, marginTop: 5 }}>{item.offenceDescription || 'Not provided'}</div></div><div><div className="form-label">Statute</div><div className="mono" style={{ marginTop: 5 }}>{item.statuteCode || '—'}</div></div><div><div className="form-label">Court location</div><div style={{ fontSize: 13, marginTop: 5 }}>{item.courtLocation || 'Not provided'}</div></div><div><div className="form-label">Next follow-up</div><div style={{ fontSize: 13, marginTop: 5, color: 'hsl(var(--accent))' }}>{dateLabel(item.nextFollowUpDate)}</div></div><div><div className="form-label">Intake date</div><div className="mono" style={{ marginTop: 5 }}>{dateLabel(item.intakeDate)}</div></div><div><div className="form-label">Last updated</div><div className="mono" style={{ marginTop: 5 }}>{dateLabel(item.updatedAt)}</div></div></div></section><section className="card detail-card"><div className="section-head"><div><div className="section-title">Activity timeline</div><div className="section-kicker">Notes, payments, and appearances in one thread.</div></div><Activity size={18} className="muted" /></div>{timeline.length ? <div className="timeline">{timeline.map((entry) => <div className="timeline-item" key={entry.key}><div className="timeline-dot" /><div className="timeline-date">{dateLabel(entry.date)}</div><div className="timeline-title">{entry.title}</div><div className="timeline-copy">{entry.copy}</div></div>)}</div> : <EmptyState title="No activity yet" copy="Add the first note or payment to start the case history." />}</section></div>
      <div className="stack"><section className="card detail-card"><div className="section-title">Record a payment</div><div className="section-kicker">Keep the ledger current.</div><div className="mini-form"><div className="form-field"><label className="form-label">Amount (CAD)</label><input className="field" type="number" min="0.01" data-testid="input-payment-amount" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} placeholder="250" /></div><div className="form-grid" style={{ marginTop: 12 }}><div className="form-field"><label className="form-label">Date</label><input className="field" type="date" data-testid="input-payment-date" value={paymentForm.date} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} /></div><div className="form-field"><label className="form-label">Method</label><select className="select" data-testid="select-payment-method" value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}><option>e-transfer</option><option>cash</option><option>cheque</option><option>credit card</option></select></div></div><input className="field" style={{ marginTop: 12 }} data-testid="input-payment-note" value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} placeholder="Optional note" /><button className="button button-primary" data-testid="button-record-payment" disabled={payment.isPending || !paymentForm.amount} onClick={addPayment}>{payment.isPending ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />} Record payment</button>{payment.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Payment was not recorded.</div>}</div></section><section className="card detail-card"><div className="section-title">Add a note</div><div className="section-kicker">Leave a clear breadcrumb for future you.</div><div className="mini-form"><textarea className="textarea" data-testid="input-case-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Client sent disclosure by email…" /><button className="button button-primary" data-testid="button-add-note" disabled={note.isPending || !noteText.trim()} onClick={addNote}>{note.isPending ? <Loader2 className="animate-spin" size={15} /> : <NotebookPen size={15} />} Add note</button>{note.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 8 }}>Note was not added.</div>}</div></section></div>
    </div>
  </>;
}

function Clients() {
  const [search, setSearch] = useState('');
  const params = useMemo(() => ({ search: search || undefined }), [search]);
  const clients = useListClients(params, { query: { queryKey: getListClientsQueryKey(params), staleTime: 15000 } });
  return <><PageHeader eyebrow="Directory" title="Clients" copy="One clean list for every person behind the paperwork." action={<Link href="/cases/new" className="button button-accent" data-testid="link-client-new-case"><Plus size={16} /> New case</Link>} /><section className="card table-card"><div className="toolbar"><div className="input-wrap"><Search /><input className="field" data-testid="input-client-search" placeholder="Search clients by name, phone, or email" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>{clients.isLoading ? <LoadingState rows={6} /> : clients.isError ? <ErrorState onRetry={() => clients.refetch()} /> : !clients.data?.length ? <EmptyState title="No clients found" copy="Your client directory is empty for this search." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Client</th><th>Contact</th><th>Lead source</th><th>Added</th><th /></tr></thead><tbody>{clients.data.map((client) => <tr key={client.id} data-testid={`row-client-${client.id}`}><td><div className="data-link">{client.fullName}</div><div className="muted mono" style={{ marginTop: 4 }}>{initials(client.fullName)} · Client record</div></td><td><div>{client.phone || 'No phone'}</div><div className="muted" style={{ marginTop: 4 }}>{client.email || 'No email'}</div></td><td><StatusPill status={client.leadSourceChannel} /><div className="muted" style={{ marginTop: 4 }}>{client.leadSourceDetail || '—'}</div></td><td className="mono">{dateLabel(client.createdAt)}</td><td><Link href={`/cases?search=${encodeURIComponent(client.fullName)}`} className="button button-ghost" data-testid={`button-client-cases-${client.id}`} style={{ minHeight: 28, padding: '0 8px' }}>View cases</Link></td></tr>)}</tbody></table></div>}</section></>;
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

function ImportPage() {
  const preview = usePreviewImport();
  const commit = useCommitImport();
  const [raw, setRaw] = useState('');
  const [payload, setPayload] = useState<{ rows: Record<string, string>[] } | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const parse = () => { const lines = raw.trim().split(/\r?\n/).filter(Boolean); if (lines.length < 2) return; const headers = lines[0].split(',').map((entry) => entry.trim()); const rows = lines.slice(1).map((line) => { const values = line.split(','); return headers.reduce<Record<string, string>>((acc, key, index) => { acc[key] = (values[index] || '').trim(); return acc; }, {}); }); const next = { rows }; setPayload(next); setResult(null); preview.mutate({ data: next }); };
  const commitRows = () => { if (!payload) return; commit.mutate({ data: payload }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCasesQueryKey() }); queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); } }); };
  const example = 'clientName,ticketNumber,offenceDate,totalFee,status\\nJordan Pereira,T12345678,2024-08-16,1250,Open\\nMina Okafor,T12345991,2024-08-22,980,Awaiting Trial';
  return <><PageHeader eyebrow="Migration / One-time" title="Bring in the old docket" copy="Preview your legacy rows before they become part of the system of record." /><div className="import-layout"><section className="card detail-card"><div className="section-title">1. Paste legacy rows</div><div className="section-kicker">CSV exports from Excel work best. Keep the first row as headers.</div><textarea className="textarea" data-testid="input-import-csv" style={{ minHeight: 170, marginTop: 18, fontFamily: 'var(--app-font-mono)', fontSize: 10 }} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={example} /><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 11 }}><button className="button button-ghost" data-testid="button-use-example" onClick={() => setRaw(example)}><FileSpreadsheet size={15} /> Use example</button><button className="button button-accent" data-testid="button-preview-import" disabled={preview.isPending || !raw.trim()} onClick={parse}>{preview.isPending ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />} Preview rows</button></div>{preview.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 12 }}>The preview could not be generated. Check the CSV headers.</div>}</section><section className="card detail-card"><div className="section-title">2. Review and commit</div><div className="section-kicker">Nothing imports until you confirm the preview.</div>{preview.data ? <><div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 18 }}><div className="stat-card" style={{ minHeight: 90 }}><div className="stat-label">Rows detected</div><div className="stat-value" data-testid="value-import-rows">{preview.data.rowCount}</div></div><div className="stat-card" style={{ minHeight: 90 }}><div className="stat-label">Showing sample</div><div className="stat-value">{preview.data.sample.length}</div></div></div><div className="table-scroll" style={{ marginTop: 18 }}><table className="data-table"><thead><tr>{Object.keys(preview.data.sample[0] || {}).slice(0, 5).map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{preview.data.sample.map((row, index) => <tr key={index}>{Object.keys(preview.data.sample[0] || {}).slice(0, 5).map((key) => <td key={key} className="mono">{row[key] || '—'}</td>)}</tr>)}</tbody></table></div><button className="button button-primary" data-testid="button-commit-import" style={{ marginTop: 18 }} disabled={commit.isPending} onClick={commitRows}>{commit.isPending ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Commit {preview.data.rowCount} rows</button></> : result ? <div className="empty-state"><div className="empty-icon"><Check size={20} /></div><h3>Import complete</h3><p>{result.imported} rows imported and {result.skipped} skipped. Your register is up to date.</p><button className="button button-ghost" data-testid="button-import-another" onClick={() => { setRaw(''); setPayload(null); setResult(null); }}>Import another file</button></div> : <div className="dropzone" style={{ marginTop: 18 }}><div><Upload /><p>Preview will appear here</p><small>Rows, sample values, and validation status</small></div></div>}{commit.isError && <div style={{ color: 'hsl(var(--destructive))', fontSize: 11, marginTop: 12 }}>Import failed. No rows were changed.</div>}{commit.data && !result ? <div className="login-status" data-testid="status-import-success">Imported {commit.data.imported} rows; {commit.data.skipped} skipped.</div> : null}</section></div></>;
}

function Login() {
  return <div className="login-page"><div className="login-signal"><Link href="/" data-testid="link-login-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}><div className="brand-mark">TT</div><div><div className="brand-name">Docketline</div><div className="brand-sub">Ontario traffic law</div></div></Link><div className="login-quote">The calm behind every court date.</div><p className="login-note">A focused case desk for one practice, one source of truth, and fewer spreadsheet surprises.</p></div><div className="login-form-side"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={clerkAppearance} /></div></div>;
}

function SignUpPage() {
  return <div className="login-page"><div className="login-signal"><Link href="/" data-testid="link-signup-brand" style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}><div className="brand-mark">TT</div><div><div className="brand-name">Docketline</div><div className="brand-sub">Ontario traffic law</div></div></Link><div className="login-quote">One practice. One source of truth.</div></div><div className="login-form-side"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} appearance={clerkAppearance} /></div></div>;
}

function ProtectedRoutes() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="login-page"><LoadingState rows={4} /></div>;
  if (!isSignedIn) return <RedirectToSignIn redirectUrl={basePath || '/'} />;
  return <Shell><Switch><Route path="/" component={Dashboard} /><Route path="/cases/new" component={NewCase} /><Route path="/cases/:id" component={CaseDetailPage} /><Route path="/cases" component={Cases} /><Route path="/clients" component={Clients} /><Route path="/reports" component={Reports} /><Route path="/import" component={ImportPage} /><Route component={() => <EmptyState title="Page not found" copy="That docket page does not exist." action={<Link href="/" className="button button-primary" data-testid="link-not-found-home">Back to overview</Link>} />} /></Switch></Shell>;
}

function Router() {
  return <Switch><Route path="/login" component={() => <Redirect to="/sign-in" />} /><Route path="/sign-in/*?" component={Login} /><Route path="/sign-up/*?" component={SignUpPage} /><Route component={ProtectedRoutes} /></Switch>;
}

function RoutedErrorBoundary({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in environment.');
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}><RoutedErrorBoundary><Router /></RoutedErrorBoundary></ClerkProvider><Toaster /></WouterRouter></QueryClientProvider>;
}

export default App;