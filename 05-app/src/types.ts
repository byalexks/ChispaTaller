export type ServiceType = "maintenance" | "revision" | "warranty" | "part";

export type AppointmentStatus =
  | "scheduled"
  | "to_confirm"
  | "confirmed"
  | "attended"
  | "no_show"
  | "rescheduled"
  | "cancelled";

export type PaymentStatus = "paid" | "pending" | "free" | "warranty";

export type Severity = "high" | "medium" | "low";

export type WindowKey = "morning" | "afternoon";

export interface Alert {
  code: string;
  field: string;
  severity: Severity;
  message: string;
}

/** Raw output of the parser, before it becomes a stored appointment. */
export interface Draft {
  type: ServiceType | null;
  secondaryType: ServiceType | null;
  status: AppointmentStatus;
  name: string | null;
  model: string | null;
  date: string | null;
  weekday: number | null;
  time: string | null;
  endTime: string | null;
  isWindow: boolean;
  phone: string | null;
  location: string | null;
  address: string | null;
  part: string | null;
  description: string | null;
  instructions: string | null;
  amount: number | null;
  payment: PaymentStatus;
  plate: string | null;
  serial: string | null;
  extras: Record<string, string>;
  originalText: string;
  receivedAt: string;
  intent?: DraftIntent;
  alerts?: Alert[];
}

export interface ParseResult {
  appointment: Draft;
  alerts: Alert[];
  missing: string[];
  inbox: boolean;
}

/** Draft with the location chosen in the review step. */
export interface ReviewDraft extends Draft {
  locationId: string | null;
  mode: DraftMode;
  matchId: string | null;
  matchLabel: string | null;
}

export type DraftMode = "create" | "update" | "reschedule" | "cancel";

export type DraftIntent = "create" | "reschedule" | "cancel";

export interface Appointment extends Draft {
  id: string;
  technicianId: string;
  clientId: string | null;
  vehicleId: string | null;
  locationId: string | null;
  alerts: Alert[];
  notes: string | null;
  closedAt: string | null;
  photoId: string | null;
  photoIds?: string[];
  previousDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VisitPhoto {
  id: string;
  appointmentId: string;
  blob: Blob;
  mimeType: string;
  createdAt: string;
}

export interface Technician {
  id: string;
  name: string;
  pin: string;
  color: string;
  active: boolean;
}

export interface TechnicianClient {
  clientId: string;
  name: string;
  phone: string | null;
  visits: number;
  lastDate: string | null;
  nextDate: string | null;
}

export interface Client {
  id: string;
  name: string;
  normalizedName: string;
  phones: string[];
}

export interface Vehicle {
  id: string;
  clientId: string;
  model: string | null;
  plate: string | null;
  serial: string | null;
}

export interface Location {
  id: string;
  name: string;
  city: string;
  aliases: string[];
  active?: boolean;
}

export interface ScheduleBlock {
  id: string;
  technicianId: string;
  weekday: number;
  from: string;
  to: string;
  locationId: string;
  window: WindowKey;
  capacity: number;
  active: boolean;
}

export interface AvailabilityBlock extends ScheduleBlock {
  locationName: string;
  occupied: number;
  free: number;
  state: "available" | "last" | "full";
}

export interface InboxMessage {
  id: string;
  text: string;
  receivedAt: string;
  appointmentId: string | null;
  inInbox: number;
}

export interface DaySummary {
  date: string;
  appointments: number;
  free: number;
}
