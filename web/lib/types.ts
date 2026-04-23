export type PatientStatus = "waiting" | "consultation" | "done";

export interface Patient {
  id: string;
  name: string;
  phone: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  status: PatientStatus;
  billed: boolean;
  created_at: string;
  last_visit_at: string;
}

export interface PatientMatch {
  id: string;
  name: string;
  phone: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  status: PatientStatus;
  billed: boolean;
  created_at: string;
  last_visit_at: string;
}

export interface PatientVisit {
  id: string;
  patient_id: string;
  name: string;
  phone: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  source: string;
  appointment_id: string | null;
  created_at: string;
  status: PatientStatus;
  billed: boolean;
  last_visit_at: string;
}

export type AppointmentStatus = "scheduled" | "checked_in" | "cancelled";

export interface Appointment {
  id: string;
  org_id: string;
  name: string;
  phone: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  scheduled_for: string;
  status: AppointmentStatus;
  checked_in_patient_id: string | null;
  checked_in_at: string | null;
  created_at: string;
}

export type PatientTimelineEventType =
  | "patient_created"
  | "visit_recorded"
  | "appointment_booked"
  | "appointment_checked_in"
  | "consultation_note"
  | "invoice_created"
  | "bill_sent"
  | "follow_up_scheduled"
  | "follow_up_completed";

export interface PatientTimelineEvent {
  id: string;
  type: PatientTimelineEventType;
  title: string;
  timestamp: string;
  description: string;
  entity_type?: string | null;
  entity_id?: string | null;
}

export interface ConsultationNote {
  id: string;
  patient_id: string;
  content: string;
  status: "draft" | "final" | "sent";
  version_number: number;
  root_note_id: string | null;
  amended_from_note_id: string | null;
  snapshot_content: string | null;
  finalized_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_by_name?: string | null;
  sent_to: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  actor_name: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TestScoreEntry {
  id?: string;
  label: string;
  value: string;
}

export interface EyeExamEntry {
  eye: "right" | "left";
  sphere: string;
  cylinder: string;
  axis: string;
  vision: string;
}

export interface GenerateNotePayload {
  note_id?: string;
  patient_id?: string;
  symptoms: string;
  diagnosis: string;
  medications: string;
  notes: string;
  blood_pressure_systolic?: number | null;
  blood_pressure_diastolic?: number | null;
  pulse?: number | null;
  spo2?: number | null;
  blood_sugar?: number | null;
  test_scores?: TestScoreEntry[];
  eye_exam?: EyeExamEntry[];
}

export interface GenerateNoteResponse {
  note_id?: string | null;
  status?: "draft" | "final" | "sent" | null;
  content: string;
}

export interface GenerateLetterPayload {
  to: string;
  subject: string;
  content: string;
}

export interface GenerateLetterResponse {
  content: string;
}

export type FollowUpStatus = "scheduled" | "completed" | "cancelled";

export interface FollowUp {
  id: string;
  org_id: string;
  patient_id: string;
  patient_name?: string | null;
  created_by: string | null;
  scheduled_for: string;
  notes: string;
  status: FollowUpStatus;
  completed_at: string | null;
  created_at: string;
}

export type CatalogItemType = "service" | "medicine";
export type PaymentStatus = "unpaid" | "paid" | "partial";

export interface CatalogItem {
  id: string;
  org_id: string;
  name: string;
  item_type: CatalogItemType;
  default_price: number;
  track_inventory: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  unit: string;
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  catalog_item_id?: string | null;
  item_type: CatalogItemType;
  label: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  org_id: string;
  patient_id: string;
  subtotal: number;
  total: number;
  payment_status: PaymentStatus;
  amount_paid: number;
  balance_due: number;
  paid_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name?: string | null;
  sent_at: string | null;
  created_at: string;
  items: InvoiceItem[];
}

export interface ClinicSettings {
  id: string;
  org_id: string;
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  doctor_name: string;
  custom_header: string;
  custom_footer: string;
  document_template_name: string | null;
  document_template_url: string | null;
  document_template_notes_enabled: boolean;
  document_template_letters_enabled: boolean;
  document_template_invoices_enabled: boolean;
  document_template_margin_top: number;
  document_template_margin_right: number;
  document_template_margin_bottom: number;
  document_template_margin_left: number;
  updated_at: string | null;
}

export type UserRole = "admin" | "staff";

export interface AuthUser {
  id: string;
  org_id: string;
  name: string;
  identifier: string;
  role: UserRole;
  created_at: string;
}

export interface RegisterPayload {
  identifier: string;
  password: string;
  admin_name: string;
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  doctor_name: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface OperationResult {
  success: boolean;
  message: string;
}

export interface StaffUserCreatePayload {
  identifier: string;
  password: string;
}

export interface CatalogItemCreatePayload {
  name: string;
  item_type: CatalogItemType;
  default_price: number;
  track_inventory: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  unit: string;
}

export interface CatalogStockUpdatePayload {
  delta: number;
}

export interface InvoiceItemInput {
  catalog_item_id?: string | null;
  item_type: CatalogItemType;
  label: string;
  quantity: number;
  unit_price: number;
}

export interface InvoiceCreatePayload {
  patient_id: string;
  items: InvoiceItemInput[];
  payment_status: PaymentStatus;
  amount_paid?: number | null;
}

export interface SendInvoicePayload {
  invoice_id: string;
  recipient: string;
}

export interface AppointmentCreatePayload {
  name: string;
  phone: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  scheduled_for: string;
}

export interface AppointmentUpdatePayload {
  scheduled_for?: string;
  status?: AppointmentStatus;
}

export interface AppointmentCheckInPayload {
  existing_patient_id?: string;
  force_new?: boolean;
}

export interface FollowUpCreatePayload {
  scheduled_for: string;
  notes: string;
}

export interface FollowUpUpdatePayload {
  status?: FollowUpStatus;
  scheduled_for?: string;
  notes?: string;
}

export interface PatientInput {
  name: string;
  phone: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
}

export interface FinalizeNotePayload {
  note_id: string;
}

export interface GeneratePdfPayload {
  patient_id: string;
  content: string;
}

export interface GenerateLetterPdfPayload {
  content: string;
}

export interface SendLetterPayload {
  recipient: string;
  content: string;
}

export interface SendNotePayload {
  note_id: string;
  patient_id: string;
  phone: string;
}

export interface ClinicSettingsUpdatePayload {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  doctor_name: string;
  custom_header: string;
  custom_footer: string;
  document_template_name: string | null;
  document_template_url: string | null;
  document_template_notes_enabled: boolean;
  document_template_letters_enabled: boolean;
  document_template_invoices_enabled: boolean;
  document_template_margin_top: number;
  document_template_margin_right: number;
  document_template_margin_bottom: number;
  document_template_margin_left: number;
}
