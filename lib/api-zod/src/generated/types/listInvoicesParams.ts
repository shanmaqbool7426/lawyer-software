import type { InvoiceStatus } from './invoiceStatus';

export interface ListInvoicesParams {
  clientId?: string;
  caseId?: string;
  status?: InvoiceStatus;
  page?: number;
  limit?: number;
}
