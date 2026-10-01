export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  tenantId: string;
  clientId?: string | null;
  clientName?: string | null;
  caseId?: string | null;
  caseNumber?: number | null;
  title: string;
  type: string;
  startAt: Date;
  endAt: Date;
  location?: string | null;
  notes?: string | null;
  status: AppointmentStatus;
  reminderSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppointmentInput {
  clientId?: string;
  caseId?: string;
  title: string;
  type: string;
  startAt: string;
  endAt: string;
  location?: string;
  notes?: string;
  status?: AppointmentStatus;
}

export interface AppointmentUpdate {
  clientId?: string | null;
  caseId?: string | null;
  title?: string;
  type?: string;
  startAt?: string;
  endAt?: string;
  location?: string | null;
  notes?: string | null;
  status?: AppointmentStatus;
}

export interface AppointmentList {
  data: Appointment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ConflictCheck {
  hasConflict: boolean;
  conflicts: Appointment[];
}

export type ListAppointmentsParams = {
  clientId?: string;
  caseId?: string;
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  upcoming?: boolean;
  page?: number;
  limit?: number;
};

export type CalendarParams = {
  year: number;
  month: number; // 1-12
};
