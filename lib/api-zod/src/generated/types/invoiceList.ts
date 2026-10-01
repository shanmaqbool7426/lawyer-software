import type { Invoice } from './invoice';

export interface InvoiceList {
  data: Invoice[];
  total: number;
  page: number;
  pageSize: number;
}
