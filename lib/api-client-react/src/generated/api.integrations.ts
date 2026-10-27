import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  MutationFunction, QueryFunction, QueryKey,
  UseMutationOptions, UseMutationResult,
  UseQueryOptions, UseQueryResult,
} from '@tanstack/react-query';
import type {
  GoogleIntegrationStatus,
  GoogleIntegrationStart,
  GoogleIntegrationSyncResult,
  GoogleIntegrationDisconnectResult,
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

// ── Status ────────────────────────────────────────────────────────────────────
export const getGoogleIntegrationQueryKey = () => [`/api/integrations/google`] as const;

export const getGoogleIntegration = async (
  options?: Parameters<typeof customFetch>[1],
): Promise<GoogleIntegrationStatus> =>
  customFetch<GoogleIntegrationStatus>(`/api/integrations/google`, { ...options, method: 'GET' });

export function useGoogleIntegration<
  TData = Awaited<ReturnType<typeof getGoogleIntegration>>,
  TError = ErrorType<unknown>,
>(
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getGoogleIntegration>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGoogleIntegrationQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getGoogleIntegration>>> = ({ signal }) =>
    getGoogleIntegration({ signal, ...requestOptions });
  const qo = { queryKey, queryFn, staleTime: 30_000, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getGoogleIntegration>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ── Connect (returns the Google consent URL) ──────────────────────────────────
export const startGoogleIntegration = async (
  options?: Parameters<typeof customFetch>[1],
): Promise<GoogleIntegrationStart> =>
  customFetch<GoogleIntegrationStart>(`/api/integrations/google/start`, { ...options, method: 'GET' });

export function useStartGoogleIntegration<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof startGoogleIntegration>>, TError, void, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof startGoogleIntegration>>, TError, void, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof startGoogleIntegration>>, void> =
    () => startGoogleIntegration(requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}

// ── Sync both ways ────────────────────────────────────────────────────────────
export const syncGoogleIntegration = async (
  options?: Parameters<typeof customFetch>[1],
): Promise<GoogleIntegrationSyncResult> =>
  customFetch<GoogleIntegrationSyncResult>(`/api/integrations/google/sync`, { ...options, method: 'POST' });

export function useSyncGoogleIntegration<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof syncGoogleIntegration>>, TError, void, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof syncGoogleIntegration>>, TError, void, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof syncGoogleIntegration>>, void> =
    () => syncGoogleIntegration(requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}

// ── Disconnect ────────────────────────────────────────────────────────────────
export const disconnectGoogleIntegration = async (
  options?: Parameters<typeof customFetch>[1],
): Promise<GoogleIntegrationDisconnectResult> =>
  customFetch<GoogleIntegrationDisconnectResult>(`/api/integrations/google`, { ...options, method: 'DELETE' });

export function useDisconnectGoogleIntegration<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof disconnectGoogleIntegration>>, TError, void, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof disconnectGoogleIntegration>>, TError, void, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof disconnectGoogleIntegration>>, void> =
    () => disconnectGoogleIntegration(requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}
