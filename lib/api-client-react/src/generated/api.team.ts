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
  MeView,
  PasswordReset,
  TeamList,
  TeamMember,
  TeamMemberCreated,
  TeamMemberInput,
  TeamMemberUpdate,
} from './api.schemas';

import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';

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

// ─── Who am I: role and the sidebar modules this account may open ────────────

export const getGetMeQueryKey = () => [`/api/me`] as const;

export const getMe = async (
  options?: Parameters<typeof customFetch>[1],
): Promise<MeView> =>
  customFetch<MeView>('/api/me', { ...options, method: 'GET' });

export function useGetMe<
  TData = Awaited<ReturnType<typeof getMe>>,
  TError = ErrorType<unknown>,
>(
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetMeQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getMe>>> = ({ signal }) =>
    getMe({ signal, ...requestOptions });
  const qo = { queryKey, queryFn, staleTime: 30_000, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ─── Team list (owner only) ──────────────────────────────────────────────────

export const getListTeamQueryKey = () => [`/api/team`] as const;

export const listTeam = async (
  options?: Parameters<typeof customFetch>[1],
): Promise<TeamList> =>
  customFetch<TeamList>('/api/team', { ...options, method: 'GET' });

export function useListTeam<
  TData = Awaited<ReturnType<typeof listTeam>>,
  TError = ErrorType<unknown>,
>(
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof listTeam>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListTeamQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listTeam>>> = ({ signal }) =>
    listTeam({ signal, ...requestOptions });
  const qo = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof listTeam>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ─── Add an employee ─────────────────────────────────────────────────────────

export const createTeamMember = async (
  data: BodyType<TeamMemberInput>,
  options?: Parameters<typeof customFetch>[1],
): Promise<TeamMemberCreated> =>
  customFetch<TeamMemberCreated>('/api/team', { ...options, method: 'POST', body: JSON.stringify(data) });

export function useCreateTeamMember<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof createTeamMember>>, TError, { data: BodyType<TeamMemberInput> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof createTeamMember>>, TError, { data: BodyType<TeamMemberInput> }, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof createTeamMember>>, { data: BodyType<TeamMemberInput> }> =
    ({ data }) => createTeamMember(data, requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}

// ─── Edit a member's name, modules or access ─────────────────────────────────

export const updateTeamMember = async (
  id: string,
  data: BodyType<TeamMemberUpdate>,
  options?: Parameters<typeof customFetch>[1],
): Promise<{ member: TeamMember }> =>
  customFetch<{ member: TeamMember }>(`/api/team/${id}`, { ...options, method: 'PATCH', body: JSON.stringify(data) });

export function useUpdateTeamMember<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateTeamMember>>, TError, { id: string; data: BodyType<TeamMemberUpdate> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof updateTeamMember>>, TError, { id: string; data: BodyType<TeamMemberUpdate> }, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof updateTeamMember>>, { id: string; data: BodyType<TeamMemberUpdate> }> =
    ({ id, data }) => updateTeamMember(id, data, requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}

// ─── Remove a member ─────────────────────────────────────────────────────────

export const deleteTeamMember = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<{ ok: boolean }> =>
  customFetch<{ ok: boolean }>(`/api/team/${id}`, { ...options, method: 'DELETE' });

export function useDeleteTeamMember<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteTeamMember>>, TError, { id: string }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof deleteTeamMember>>, TError, { id: string }, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof deleteTeamMember>>, { id: string }> =
    ({ id }) => deleteTeamMember(id, requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}

// ─── Issue a fresh password ──────────────────────────────────────────────────

export const resetTeamMemberPassword = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<PasswordReset> =>
  customFetch<PasswordReset>(`/api/team/${id}/password`, { ...options, method: 'POST' });

export function useResetTeamMemberPassword<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetTeamMemberPassword>>, TError, { id: string }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof resetTeamMemberPassword>>, TError, { id: string }, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof resetTeamMemberPassword>>, { id: string }> =
    ({ id }) => resetTeamMemberPassword(id, requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}
