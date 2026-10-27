import { useQuery } from '@tanstack/react-query';
import type { QueryFunction, QueryKey, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { ExportReportParams, ReportsAnalytics, ReportsAnalyticsParams, ReportsCollections } from './api.schemas';
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

// ── Reports analytics (money, aging, resolutions) ─────────────────────────────

export const getReportsAnalyticsUrl = (params: ReportsAnalyticsParams = {}) =>
  `/api/reports/analytics${buildQs({ from: params.from, to: params.to })}`;

export const getReportsAnalytics = async (
  params: ReportsAnalyticsParams = {},
  options?: Parameters<typeof customFetch>[1],
): Promise<ReportsAnalytics> => customFetch<ReportsAnalytics>(getReportsAnalyticsUrl(params), { ...options, method: 'GET' });

export const getGetReportsAnalyticsQueryKey = (params: ReportsAnalyticsParams = {}) =>
  ['/api/reports/analytics', params.from ?? null, params.to ?? null] as const;

export const getGetReportsAnalyticsQueryOptions = <
  TData extends unknown = Awaited<ReturnType<typeof getReportsAnalytics>>,
  TError = ErrorType<unknown>,
>(params: ReportsAnalyticsParams = {}, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getReportsAnalytics>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetReportsAnalyticsQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getReportsAnalytics>>> = ({ signal }) =>
    getReportsAnalytics(params, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getReportsAnalytics>>, TError, TData
  > & { queryKey: QueryKey };
};

export type GetReportsAnalyticsQueryResult = NonNullable<Awaited<ReturnType<typeof getReportsAnalytics>>>;
export type GetReportsAnalyticsQueryError = ErrorType<unknown>;

export function useGetReportsAnalytics<
  TData = Awaited<ReturnType<typeof getReportsAnalytics>>,
  TError = ErrorType<unknown>,
>(params: ReportsAnalyticsParams = {}, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getReportsAnalytics>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetReportsAnalyticsQueryOptions(params, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ── Collections day book & earnings ───────────────────────────────────────────

export const getReportCollectionsUrl = (params: ReportsAnalyticsParams = {}) =>
  `/api/reports/collections${buildQs({ from: params.from, to: params.to })}`;

export const getReportCollections = async (
  params: ReportsAnalyticsParams = {},
  options?: Parameters<typeof customFetch>[1],
): Promise<ReportsCollections> => customFetch<ReportsCollections>(getReportCollectionsUrl(params), { ...options, method: 'GET' });

export const getGetReportCollectionsQueryKey = (params: ReportsAnalyticsParams = {}) =>
  ['/api/reports/collections', params.from ?? null, params.to ?? null] as const;

export const getGetReportCollectionsQueryOptions = <
  TData extends unknown = Awaited<ReturnType<typeof getReportCollections>>,
  TError = ErrorType<unknown>,
>(params: ReportsAnalyticsParams = {}, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getReportCollections>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetReportCollectionsQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getReportCollections>>> = ({ signal }) =>
    getReportCollections(params, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getReportCollections>>, TError, TData
  > & { queryKey: QueryKey };
};

export type GetReportCollectionsQueryResult = NonNullable<Awaited<ReturnType<typeof getReportCollections>>>;
export type GetReportCollectionsQueryError = ErrorType<unknown>;

export function useGetReportCollections<
  TData = Awaited<ReturnType<typeof getReportCollections>>,
  TError = ErrorType<unknown>,
>(params: ReportsAnalyticsParams = {}, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getReportCollections>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetReportCollectionsQueryOptions(params, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ── CSV export (fired manually, never cached) ────────────────────────────────

export const getExportReportUrl = (params: ExportReportParams) =>
  `/api/reports/export.csv${buildQs({ report: params.report, from: params.from, to: params.to })}`;

export const exportReport = async (params: ExportReportParams, options?: Parameters<typeof customFetch>[1]): Promise<string> =>
  customFetch<string>(getExportReportUrl(params), { ...options, method: 'GET' });

export const getExportReportQueryKey = (params: ExportReportParams) =>
  ['/api/reports/export.csv', params.report, params.from ?? null, params.to ?? null] as const;

export const getExportReportQueryOptions = <
  TData extends unknown = Awaited<ReturnType<typeof exportReport>>,
  TError = ErrorType<unknown>,
>(params: ExportReportParams, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof exportReport>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getExportReportQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof exportReport>>> = ({ signal }) =>
    exportReport(params, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof exportReport>>, TError, TData
  > & { queryKey: QueryKey };
};

export type ExportReportQueryResult = NonNullable<Awaited<ReturnType<typeof exportReport>>>;
export type ExportReportQueryError = ErrorType<unknown>;

export function useExportReport<
  TData = Awaited<ReturnType<typeof exportReport>>,
  TError = ErrorType<unknown>,
>(params: ExportReportParams, options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof exportReport>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getExportReportQueryOptions(params, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}
