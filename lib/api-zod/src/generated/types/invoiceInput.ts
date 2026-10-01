import type { InvoiceItemInput } from './invoiceItemInput';

export interface InvoiceInput {
  clientId: string;
  caseId?: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItemInput[];
  taxRate?: number;
  notes?: string;
}
