import type { InvoiceItem } from './invoiceItem';
import type { InvoiceStatus } from './invoiceStatus';

export interface Invoice {
  id: string;
  invoiceNumber: number;
  clientId: string;
  clientName: string;
  /** @nullable */
  caseId?: string | null;
  /** @nullable */
  caseNumber?: number | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  /** @nullable */
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
