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
  Expense,
  ExpenseInput,
  ExpenseUpdate,
  ExpenseList,
  ExpenseSummary,
  ListExpensesParams,
  GetExpenseSummaryParams,
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

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildExpenseQs(params?: ListExpensesParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  if (params.caseId)             sp.set('caseId',    params.caseId);
  if (params.clientId)           sp.set('clientId',  params.clientId);
  if (params.category)           sp.set('category',  params.category);
  if (params.firmOnly  != null)  sp.set('firmOnly',  String(params.firmOnly));
  if (params.billable  != null)  sp.set('billable',  String(params.billable));
  if (params.billed    != null)  sp.set('billed',    String(params.billed));
  if (params.dateFrom)           sp.set('dateFrom',  params.dateFrom);
  if (params.dateTo)             sp.set('dateTo',    params.dateTo);
  if (params.search)             sp.set('search',    params.search);
  if (params.page  != null)      sp.set('page',      String(params.page));
  if (params.limit != null)      sp.set('limit',     String(params.limit));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ─── List expenses ────────────────────────────────────────────────────────────

export const getListExpensesUrl = (params?: ListExpensesParams) =>
  `/api/expenses${buildExpenseQs(params)}`;

export const getListExpensesQueryKey = (params?: ListExpensesParams) =>
  [`/api/expenses`, ...(params ? [params] : [])] as const;

export const listExpenses = async (
  params?: ListExpensesParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<ExpenseList> =>
  customFetch<ExpenseList>(getListExpensesUrl(params), { ...options, method: 'GET' });

export const getListExpensesQueryOptions = <
  TData = Awaited<ReturnType<typeof listExpenses>>,
  TError = ErrorType<unknown>,
>(
  params?: ListExpensesParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof listExpenses>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListExpensesQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listExpenses>>> = ({ signal }) =>
    listExpenses(params, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof listExpenses>>, TError, TData> & { queryKey: QueryKey };
};

export function useListExpenses<
  TData = Awaited<ReturnType<typeof listExpenses>>,
  TError = ErrorType<unknown>,
>(
  params?: ListExpensesParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof listExpenses>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListExpensesQueryOptions(params, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ─── Get single expense ───────────────────────────────────────────────────────

export const getGetExpenseQueryKey = (id: string) => [`/api/expenses/${id}`] as const;

export const getExpense = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<Expense> =>
  customFetch<Expense>(`/api/expenses/${id}`, { ...options, method: 'GET' });

export function useGetExpense<
  TData = Awaited<ReturnType<typeof getExpense>>,
  TError = ErrorType<unknown>,
>(
  id: string,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getExpense>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetExpenseQueryKey(id);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getExpense>>> = ({ signal }) =>
    getExpense(id, { signal, ...requestOptions });
  const qo = { queryKey, queryFn, enabled: !!id, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getExpense>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ─── Expense summary ──────────────────────────────────────────────────────────

export const getGetExpenseSummaryQueryKey = (params?: GetExpenseSummaryParams) =>
  [`/api/expenses/summary`, ...(params ? [params] : [])] as const;

export const getExpenseSummary = async (
  params?: GetExpenseSummaryParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<ExpenseSummary> => {
  const sp = new URLSearchParams();
  if (params?.dateFrom) sp.set('dateFrom', params.dateFrom);
  if (params?.dateTo)   sp.set('dateTo',   params.dateTo);
  if (params?.caseId)   sp.set('caseId',   params.caseId);
  const qs = sp.toString();
  return customFetch<ExpenseSummary>(`/api/expenses/summary${qs ? `?${qs}` : ''}`, { ...options, method: 'GET' });
};

export function useGetExpenseSummary<
  TData = Awaited<ReturnType<typeof getExpenseSummary>>,
  TError = ErrorType<unknown>,
>(
  params?: GetExpenseSummaryParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getExpenseSummary>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetExpenseSummaryQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getExpenseSummary>>> = ({ signal }) =>
    getExpenseSummary(params, { signal, ...requestOptions });
  const qo = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getExpenseSummary>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ─── Create expense ───────────────────────────────────────────────────────────

export const createExpense = async (
  data: BodyType<ExpenseInput>,
  options?: Parameters<typeof customFetch>[1],
): Promise<Expense> =>
  customFetch<Expense>('/api/expenses', { ...options, method: 'POST', body: JSON.stringify(data) });

export const getCreateExpenseMutationOptions = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof createExpense>>, TError, { data: BodyType<ExpenseInput> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationOptions<Awaited<ReturnType<typeof createExpense>>, TError, { data: BodyType<ExpenseInput> }, TContext> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof createExpense>>, { data: BodyType<ExpenseInput> }> =
    ({ data }) => createExpense(data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export function useCreateExpense<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof createExpense>>, TError, { data: BodyType<ExpenseInput> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof createExpense>>, TError, { data: BodyType<ExpenseInput> }, TContext> {
  return useMutation(getCreateExpenseMutationOptions(options));
}

// ─── Update expense ───────────────────────────────────────────────────────────

export const updateExpense = async (
  id: string,
  data: BodyType<ExpenseUpdate>,
  options?: Parameters<typeof customFetch>[1],
): Promise<Expense> =>
  customFetch<Expense>(`/api/expenses/${id}`, { ...options, method: 'PATCH', body: JSON.stringify(data) });

export const getUpdateExpenseMutationOptions = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateExpense>>, TError, { id: string; data: BodyType<ExpenseUpdate> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationOptions<Awaited<ReturnType<typeof updateExpense>>, TError, { id: string; data: BodyType<ExpenseUpdate> }, TContext> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof updateExpense>>, { id: string; data: BodyType<ExpenseUpdate> }> =
    ({ id, data }) => updateExpense(id, data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export function useUpdateExpense<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateExpense>>, TError, { id: string; data: BodyType<ExpenseUpdate> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof updateExpense>>, TError, { id: string; data: BodyType<ExpenseUpdate> }, TContext> {
  return useMutation(getUpdateExpenseMutationOptions(options));
}

// ─── Delete expense ───────────────────────────────────────────────────────────

export const deleteExpense = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<void> =>
  customFetch<void>(`/api/expenses/${id}`, { ...options, method: 'DELETE' });

export const getDeleteExpenseMutationOptions = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteExpense>>, TError, { id: string }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationOptions<Awaited<ReturnType<typeof deleteExpense>>, TError, { id: string }, TContext> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof deleteExpense>>, { id: string }> =
    ({ id }) => deleteExpense(id, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export function useDeleteExpense<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteExpense>>, TError, { id: string }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof deleteExpense>>, TError, { id: string }, TContext> {
  return useMutation(getDeleteExpenseMutationOptions(options));
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

export const getExportExpensesQueryKey = (params?: ListExpensesParams) =>
  [`/api/expenses/export.csv`, ...(params ? [params] : [])] as const;

export const exportExpensesCsv = async (
  params?: ListExpensesParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<string> =>
  customFetch<string>(`/api/expenses/export.csv${buildExpenseQs(params)}`, {
    ...options,
    method: 'GET',
  });

export function useExportExpenses<
  TData = Awaited<ReturnType<typeof exportExpensesCsv>>,
  TError = ErrorType<unknown>,
>(
  params?: ListExpensesParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof exportExpensesCsv>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getExportExpensesQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof exportExpensesCsv>>> = ({ signal }) =>
    exportExpensesCsv(params, { signal, ...requestOptions });
  const qo = { queryKey, queryFn, enabled: false, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof exportExpensesCsv>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}
