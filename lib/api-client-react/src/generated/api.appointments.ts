import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  MutationFunction, QueryFunction, QueryKey,
  UseMutationOptions, UseMutationResult,
  UseQueryOptions, UseQueryResult,
} from '@tanstack/react-query';
import type {
  Appointment, AppointmentInput, AppointmentUpdate,
  AppointmentList, ConflictCheck,
  ListAppointmentsParams, CalendarParams,
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
      enumerable: true, configurable: true,
      get: () => (query as Record<string, unknown>)[key],
    });
  }
  return result;
};

function buildAppointmentQs(params?: ListAppointmentsParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  if (params.clientId)          sp.set('clientId', params.clientId);
  if (params.caseId)            sp.set('caseId',   params.caseId);
  if (params.type)              sp.set('type',     params.type);
  if (params.status)            sp.set('status',   params.status);
  if (params.dateFrom)          sp.set('dateFrom', params.dateFrom);
  if (params.dateTo)            sp.set('dateTo',   params.dateTo);
  if (params.upcoming != null)  sp.set('upcoming', String(params.upcoming));
  if (params.page != null)      sp.set('page',     String(params.page));
  if (params.limit != null)     sp.set('limit',    String(params.limit));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ── List appointments ─────────────────────────────────────────────────────────
export const getListAppointmentsQueryKey = (params?: ListAppointmentsParams) =>
  [`/api/appointments`, ...(params ? [params] : [])] as const;

export const listAppointments = async (
  params?: ListAppointmentsParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<AppointmentList> =>
  customFetch<AppointmentList>(
    `/api/appointments${buildAppointmentQs(params)}`,
    { ...options, method: 'GET' },
  );

export function useListAppointments<
  TData = Awaited<ReturnType<typeof listAppointments>>,
  TError = ErrorType<unknown>,
>(
  params?: ListAppointmentsParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof listAppointments>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListAppointmentsQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listAppointments>>> = ({ signal }) =>
    listAppointments(params, { signal, ...requestOptions });
  const qo = { queryKey, queryFn, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof listAppointments>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ── Calendar feed ─────────────────────────────────────────────────────────────
export const getCalendarAppointmentsQueryKey = (params: CalendarParams) =>
  [`/api/appointments/calendar`, params] as const;

export const getCalendarAppointments = async (
  params: CalendarParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<Appointment[]> =>
  customFetch<Appointment[]>(
    `/api/appointments/calendar?year=${params.year}&month=${params.month}`,
    { ...options, method: 'GET' },
  );

export function useCalendarAppointments<
  TData = Awaited<ReturnType<typeof getCalendarAppointments>>,
  TError = ErrorType<unknown>,
>(
  params: CalendarParams,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getCalendarAppointments>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getCalendarAppointmentsQueryKey(params);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getCalendarAppointments>>> = ({ signal }) =>
    getCalendarAppointments(params, { signal, ...requestOptions });
  const qo = { queryKey, queryFn, enabled: !!params.year && !!params.month, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getCalendarAppointments>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ── Conflict check ────────────────────────────────────────────────────────────
export const getCheckConflictQueryKey = (startAt: string, endAt: string, excludeId?: string) =>
  [`/api/appointments/conflicts`, { startAt, endAt, excludeId }] as const;

export const checkConflict = async (
  startAt: string,
  endAt: string,
  excludeId?: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<ConflictCheck> => {
  const sp = new URLSearchParams({ startAt, endAt });
  if (excludeId) sp.set('excludeId', excludeId);
  return customFetch<ConflictCheck>(`/api/appointments/conflicts?${sp}`, { ...options, method: 'GET' });
};

export function useCheckConflict<
  TData = Awaited<ReturnType<typeof checkConflict>>,
  TError = ErrorType<unknown>,
>(
  startAt: string,
  endAt: string,
  excludeId?: string,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof checkConflict>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getCheckConflictQueryKey(startAt, endAt, excludeId);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof checkConflict>>> = ({ signal }) =>
    checkConflict(startAt, endAt, excludeId, { signal, ...requestOptions });
  const enabled = !!startAt && !!endAt && new Date(endAt) > new Date(startAt);
  const qo = { queryKey, queryFn, enabled, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof checkConflict>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ── Get single ────────────────────────────────────────────────────────────────
export const getGetAppointmentQueryKey = (id: string) =>
  [`/api/appointments/${id}`] as const;

export const getAppointment = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<Appointment> =>
  customFetch<Appointment>(`/api/appointments/${id}`, { ...options, method: 'GET' });

export function useGetAppointment<
  TData = Awaited<ReturnType<typeof getAppointment>>,
  TError = ErrorType<unknown>,
>(
  id: string,
  options?: { query?: UseQueryOptions<Awaited<ReturnType<typeof getAppointment>>, TError, TData>; request?: SecondParameter<typeof customFetch> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getGetAppointmentQueryKey(id);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getAppointment>>> = ({ signal }) =>
    getAppointment(id, { signal, ...requestOptions });
  const qo = { queryKey, queryFn, enabled: !!id, ...queryOptions } as UseQueryOptions<Awaited<ReturnType<typeof getAppointment>>, TError, TData> & { queryKey: QueryKey };
  const query = useQuery(qo) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, qo.queryKey);
}

// ── Create ────────────────────────────────────────────────────────────────────
export const createAppointment = async (
  data: BodyType<AppointmentInput>,
  options?: Parameters<typeof customFetch>[1],
): Promise<Appointment> =>
  customFetch<Appointment>('/api/appointments', { ...options, method: 'POST', body: JSON.stringify(data) });

export function useCreateAppointment<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAppointment>>, TError, { data: BodyType<AppointmentInput> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof createAppointment>>, TError, { data: BodyType<AppointmentInput> }, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof createAppointment>>, { data: BodyType<AppointmentInput> }> =
    ({ data }) => createAppointment(data, requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}

// ── Update ────────────────────────────────────────────────────────────────────
export const updateAppointment = async (
  id: string,
  data: BodyType<AppointmentUpdate>,
  options?: Parameters<typeof customFetch>[1],
): Promise<Appointment> =>
  customFetch<Appointment>(`/api/appointments/${id}`, { ...options, method: 'PATCH', body: JSON.stringify(data) });

export function useUpdateAppointment<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAppointment>>, TError, { id: string; data: BodyType<AppointmentUpdate> }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof updateAppointment>>, TError, { id: string; data: BodyType<AppointmentUpdate> }, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof updateAppointment>>, { id: string; data: BodyType<AppointmentUpdate> }> =
    ({ id, data }) => updateAppointment(id, data, requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}

// ── Delete ────────────────────────────────────────────────────────────────────
export const deleteAppointment = async (
  id: string,
  options?: Parameters<typeof customFetch>[1],
): Promise<void> =>
  customFetch<void>(`/api/appointments/${id}`, { ...options, method: 'DELETE' });

export function useDeleteAppointment<TError = ErrorType<unknown>, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAppointment>>, TError, { id: string }, TContext>; request?: SecondParameter<typeof customFetch> },
): UseMutationResult<Awaited<ReturnType<typeof deleteAppointment>>, TError, { id: string }, TContext> {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof deleteAppointment>>, { id: string }> =
    ({ id }) => deleteAppointment(id, requestOptions);
  return useMutation({ mutationFn, ...mutationOptions });
}
