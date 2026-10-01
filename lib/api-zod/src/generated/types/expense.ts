export interface Expense {
  id: string;
  tenantId: string;
  caseId?: string | null;
  caseNumber?: number | null;
  clientId?: string | null;
  clientName?: string | null;
  category: string;
  amount: number;
  date: string;
  description: string;
  vendor?: string | null;
  receiptUrl?: string | null;
  isBillable: boolean;
  isBilled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseInput {
  caseId?: string;
  category: string;
  amount: number;
  date: string;
  description: string;
  vendor?: string;
  receiptUrl?: string;
  isBillable?: boolean;
}

export interface ExpenseUpdate {
  caseId?: string | null;
  category?: string;
  amount?: number;
  date?: string;
  description?: string;
  vendor?: string | null;
  receiptUrl?: string | null;
  isBillable?: boolean;
  isBilled?: boolean;
}

export interface ExpenseList {
  data: Expense[];
  total: number;
  totalAmount: number;
  page: number;
  pageSize: number;
}

export interface ExpenseCategoryBreakdown {
  category: string;
  amount: number;
  count: number;
}

export interface ExpenseMonthBreakdown {
  month: string;
  amount: number;
  count: number;
}

export interface ExpenseVendorBreakdown {
  vendor: string;
  amount: number;
  count: number;
}

export interface ExpenseSummary {
  totalAmount: number;
  billableAmount: number;
  billedAmount: number;
  unbilledAmount: number;
  firmAmount: number;
  caseAmount: number;
  count: number;
  byCategory: ExpenseCategoryBreakdown[];
  byMonth: ExpenseMonthBreakdown[];
  topVendors: ExpenseVendorBreakdown[];
}

export interface ListExpensesParams {
  caseId?: string;
  clientId?: string;
  category?: string;
  firmOnly?: boolean;
  billable?: boolean;
  billed?: boolean;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}
