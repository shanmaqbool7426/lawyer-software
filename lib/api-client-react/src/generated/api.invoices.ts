import {
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';

import type {
  Invoice,
  InvoiceInput,
  InvoiceList,
  InvoiceStatusUpdate,
  ListInvoicesParams,
} from './api.schemas';

import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';

type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

const withQueryKey = <T extends object, K>(query: T, queryKey: K): T & { queryKey: K } => {
  const result = { queryKey } as T & { queryKey: K };
  for (const key of Object.keys(query)) {
    if (key === 'queryKey') continue;
    Object.defineProperty(result, key, {
      enumerable: true,
      configurable: true,
      get: () => (query as Record<string, unknown>)[key],
    });
  }
  return result;
};

// ─── List invoices ───────────────────────────────────────────────────────────

export const getListInvoicesUrl = (params?: ListInvoicesParams) => {
  const sp = new URLSearchParams();
  if (params?.clientId) sp.set('clientId', params.clientId);
  if (params?.caseId)   sp.set('caseId',   params.caseId);
  if (params?.status)   sp.set('status',   params.status);
  if (params?.page  != null) sp.set('page',  String(params.page));
  if (params?.limit != null) sp.set('limit', String(params.limit));
  const qs = sp.toString();
  return `/api/invoices${qs ? `?${qs}` : ''}`;
};

export const getListInvoicesQueryKey = (params?: ListInvoicesParams) =>
  [`/api/invoices`, ...(params ? [params] : [])] as const;

export const listInvoices = async (
  params?: ListInvoicesParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<InvoiceList> =>
  customFetch<InvoiceList>(getListInvoicesUrl(params), { ...options, method: 'GET' });

export const getListInvoicesQueryOptions = <
  TData = Awaited<ReturnType<typeof listInvoices>>,
  TError = ErrorType<unknown>,
>(
  params?: ListInvoicesParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof listInvoices>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListInvoicesQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listInvoices>>> = ({ signal }) =>
    listInvoices(params, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof listInvoices>>, TError, TData> & { queryKey: QueryKey };
};

export function useListInvoices<
  TData = Awaited<ReturnType<typeof listInvoices>>,
  TError = ErrorType<unknown>,
>(
  params?: ListInvoicesParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof listInvoices>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListInvoicesQueryOptions(params, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ─── Get single invoice ──────────────────────────────────────────────────────

export const getGetInvoiceQueryKey = (id: string) => [`/api/invoices/${id}`] as const;

export const getInvoice = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<Invoice> =>
  customFetch<Invoice>(`/api/invoices/${id}`, { ...options, method: 'GET' });

export function useGetInvoice<
  TData = Awaited<ReturnType<typeof getInvoice>>,
  TError = ErrorType<unknown>,
>(
  id: string,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getInvoice>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetInvoiceQueryKey(id);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getInvoice>>> = ({ signal }) =>
    getInvoice(id, { signal, ...requestOptions });
  const qo = { queryKey, queryFn, enabled: !!id, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getInvoice>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ─── Create invoice ──────────────────────────────────────────────────────────

export const createInvoice = async (
  data: BodyType<InvoiceInput>,
  options?: Parameters<typeof customFetch>[1],
): Promise<Invoice> =>
  customFetch<Invoice>('/api/invoices', { ...options, method: 'POST', body: JSON.stringify(data) });

export const getCreateInvoiceMutationOptions = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof createInvoice>>, TError, { data: BodyType<InvoiceInput> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationOptions<Awaited<ReturnType<typeof createInvoice>>, TError, { data: BodyType<InvoiceInput> }, TContext> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof createInvoice>>, { data: BodyType<InvoiceInput> }> =
    ({ data }) => createInvoice(data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export function useCreateInvoice<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof createInvoice>>, TError, { data: BodyType<InvoiceInput> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof createInvoice>>, TError, { data: BodyType<InvoiceInput> }, TContext> {
  return useMutation(getCreateInvoiceMutationOptions(options));
}

// ─── Update invoice status ───────────────────────────────────────────────────

export const updateInvoiceStatus = async (
  id: string,
  data: BodyType<InvoiceStatusUpdate>,
  options?: Parameters<typeof customFetch>[1],
): Promise<Invoice> =>
  customFetch<Invoice>(`/api/invoices/${id}/status`, { ...options, method: 'PATCH', body: JSON.stringify(data) });

export const getUpdateInvoiceStatusMutationOptions = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateInvoiceStatus>>, TError, { id: string; data: BodyType<InvoiceStatusUpdate> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationOptions<Awaited<ReturnType<typeof updateInvoiceStatus>>, TError, { id: string; data: BodyType<InvoiceStatusUpdate> }, TContext> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof updateInvoiceStatus>>, { id: string; data: BodyType<InvoiceStatusUpdate> }> =
    ({ id, data }) => updateInvoiceStatus(id, data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export function useUpdateInvoiceStatus<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateInvoiceStatus>>, TError, { id: string; data: BodyType<InvoiceStatusUpdate> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof updateInvoiceStatus>>, TError, { id: string; data: BodyType<InvoiceStatusUpdate> }, TContext> {
  return useMutation(getUpdateInvoiceStatusMutationOptions(options));
}

// ─── Delete invoice ──────────────────────────────────────────────────────────

export const deleteInvoice = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<void> =>
  customFetch<void>(`/api/invoices/${id}`, { ...options, method: 'DELETE' });

export const getDeleteInvoiceMutationOptions = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteInvoice>>, TError, { id: string }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationOptions<Awaited<ReturnType<typeof deleteInvoice>>, TError, { id: string }, TContext> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof deleteInvoice>>, { id: string }> =
    ({ id }) => deleteInvoice(id, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export function useDeleteInvoice<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteInvoice>>, TError, { id: string }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof deleteInvoice>>, TError, { id: string }, TContext> {
  return useMutation(getDeleteInvoiceMutationOptions(options));
}
