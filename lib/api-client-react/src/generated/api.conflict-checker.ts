import { useQuery } from '@tanstack/react-query';
import type {
  QueryFunction, QueryKey,
  UseQueryOptions, UseQueryResult,
} from '@tanstack/react-query';
import type {
  ClientConflictResponse,
  CaseConflictResponse,
  UnifiedSearchResponse,
  CheckClientConflictParams,
  CheckCaseConflictParams,
} from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType } from '../custom-fetch';

type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

const withQueryKey = <T extends object, K>(query: T, queryKey: K): T & { queryKey: K } => {
  const result = { queryKey } as T & { queryKey: K };
  for (const key of Object.keys(query)) {
    if (key === 'queryKey') continue;
    Object.defineProperty(result, key, {
      enumerable: true, configurable: true,
      get: () => (query as Record<string, unknown>)[key],
    });
  }
  return result;
};

function buildQs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ── Check client conflicts ────────────────────────────────────────────────────

export const getCheckClientConflictQueryKey = (params: CheckClientConflictParams) =>
  [`/api/conflict-check/clients`, params] as const;

export const checkClientConflict = async (
  params: CheckClientConflictParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<ClientConflictResponse> =>
  customFetch<ClientConflictResponse>(
    `/api/conflict-check/clients${buildQs(params as Record<string, string | undefined>)}`,
    { ...options, method: 'GET' },
  );

export function useCheckClientConflict<
  TData = Awaited<ReturnType<typeof checkClientConflict>>,
  TError = ErrorType<unknown>,
>(
  params: CheckClientConflictParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof checkClientConflict>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const hasInput = !!(params.name || params.phone || params.email);
  const queryKey = queryOptions?.queryKey ?? getCheckClientConflictQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof checkClientConflict>>> = ({ signal }) =>
    checkClientConflict(params, { signal, ...requestOptions });
  const qo = {
    queryKey, queryFn,
    enabled: hasInput,
    staleTime: 8000,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof checkClientConflict>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ── Check case conflicts ──────────────────────────────────────────────────────

export const getCheckCaseConflictQueryKey = (params: CheckCaseConflictParams) =>
  [`/api/conflict-check/cases`, params] as const;

export const checkCaseConflict = async (
  params: CheckCaseConflictParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<CaseConflictResponse> =>
  customFetch<CaseConflictResponse>(
    `/api/conflict-check/cases${buildQs(params as Record<string, string | undefined>)}`,
    { ...options, method: 'GET' },
  );

export function useCheckCaseConflict<
  TData = Awaited<ReturnType<typeof checkCaseConflict>>,
  TError = ErrorType<unknown>,
>(
  params: CheckCaseConflictParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof checkCaseConflict>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const hasInput = !!(params.ticketNumber || params.statuteCode || params.clientId);
  const queryKey = queryOptions?.queryKey ?? getCheckCaseConflictQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof checkCaseConflict>>> = ({ signal }) =>
    checkCaseConflict(params, { signal, ...requestOptions });
  const qo = {
    queryKey, queryFn,
    enabled: hasInput,
    staleTime: 8000,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof checkCaseConflict>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ── Unified search ────────────────────────────────────────────────────────────

export const getUnifiedSearchQueryKey = (q: string) =>
  [`/api/conflict-check/search`, q] as const;

export const unifiedSearch = async (
  q: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<UnifiedSearchResponse> =>
  customFetch<UnifiedSearchResponse>(
    `/api/conflict-check/search?q=${encodeURIComponent(q)}`,
    { ...options, method: 'GET' },
  );

export function useUnifiedSearch<
  TData = Awaited<ReturnType<typeof unifiedSearch>>,
  TError = ErrorType<unknown>,
>(
  q: string,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof unifiedSearch>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getUnifiedSearchQueryKey(q);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof unifiedSearch>>> = ({ signal }) =>
    unifiedSearch(q, { signal, ...requestOptions });
  const qo = {
    queryKey, queryFn,
    enabled: q.trim().length >= 2,
    staleTime: 8000,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof unifiedSearch>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}
