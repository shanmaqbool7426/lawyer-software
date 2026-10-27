// The sidebar is the permission model: one key per module in the nav, and the
// owner grants them per employee. Labels live here so the Team screen and the
// API can never drift apart.
export const MODULES = [
  { key: "overview", label: "Overview" },
  { key: "cases", label: "Cases" },
  { key: "clients", label: "Clients" },
  { key: "invoices", label: "Invoices" },
  { key: "expenses", label: "Expenses" },
  { key: "appointments", label: "Appointments" },
  { key: "conflicts", label: "Conflict Check" },
  { key: "reports", label: "Reports" },
  { key: "imports", label: "Import legacy" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_KEYS: ModuleKey[] = MODULES.map((module) => module.key);

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as string[]).includes(value);
}

// First URL segment -> module. Endpoints that are not listed here are shared
// (workspace list, notification bell, calendar feed, Google connect) and stay
// open to any member, as do the public token routes mounted before the guard.
const PREFIX_MODULES: Record<string, ModuleKey> = {
  dashboard: "overview",
  cases: "cases",
  clients: "clients",
  invoices: "invoices",
  expenses: "expenses",
  appointments: "appointments",
  "conflict-check": "conflicts",
  reports: "reports",
  imports: "imports",
};

export function moduleForPath(path: string): ModuleKey | null {
  const first = path.split("/").filter(Boolean)[0] ?? "";
  return PREFIX_MODULES[first] ?? null;
}
