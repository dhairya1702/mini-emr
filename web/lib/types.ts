import type { ClinicSpecialty } from "@/lib/clinic-specialty";

export type PatientStatus = "waiting" | "consultation" | "done";

export interface Patient {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
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
  email: string;
  address: string;
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
  email: string;
  address: string;
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
  email: string;
  address: string;
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
  | "myopia_measurement"
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
  details?: Record<string, unknown>;
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
  asset_payload?: NoteAsset[];
  snapshot_asset_payload?: NoteAsset[];
  finalized_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_by_name?: string | null;
  sent_to: string | null;
  created_at: string;
}

export interface NoteAsset {
  id: string;
  kind: "attachment" | "drawing";
  name: string;
  content_type: string;
  data_base64: string;
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

export interface ContactLensEyeEntry {
  eye: "right" | "left";
  sphere: string;
  cylinder: string;
  axis: string;
  base_curve: string;
  diameter: string;
  add_power: string;
  visual_acuity: string;
  over_refraction: string;
  fit_notes: string;
}

export interface ContactLensPayload {
  wearing_goal: string;
  current_lens_brand: string;
  current_wear_schedule: string;
  replacement_frequency: string;
  comfort_issues: string;
  dryness_symptoms: string;
  handling_issues: string;
  care_solution: string;
  allergy_history: string;
  assessment_notes: string;
  lens_type: string;
  manufacturer: string;
  brand: string;
  wear_modality: string;
  trial_lens_used: string;
  vendor_name: string;
  quantity: string;
  special_instructions: string;
  eyes: ContactLensEyeEntry[];
}

export interface BinocularVisionPayload {
  symptom_notes: string;
  asthenopia: boolean;
  headache: boolean;
  diplopia: boolean;
  blur_near: boolean;
  blur_distance: boolean;
  reading_difficulty: boolean;
  poor_concentration: boolean;
  distance_cover_test: string;
  near_cover_test: string;
  distance_deviation_pd: string;
  near_deviation_pd: string;
  binocular_visual_acuity_distance: string;
  binocular_visual_acuity_near: string;
  motility: string;
  pursuits: string;
  saccades: string;
  npc_break_cm: string;
  npc_recovery_cm: string;
  convergence_notes: string;
  bo_distance: string;
  bo_near: string;
  bi_distance: string;
  bi_near: string;
  vergence_notes: string;
  stereo_test_name: string;
  stereo_result_arcsec: string;
  worth_four_dot_distance: string;
  worth_four_dot_near: string;
  sensory_notes: string;
  amplitude_right: string;
  amplitude_left: string;
  facility_cpm: string;
  facility_lens: string;
  accommodation_notes: string;
  working_diagnosis: string;
  management_plan: string;
  follow_up_interval: string;
}

export interface LowVisionPayload {
  primary_complaint: string;
  goals: string;
  reading_difficulty: boolean;
  distance_difficulty: boolean;
  mobility_difficulty: boolean;
  face_recognition_difficulty: boolean;
  glare_complaints: boolean;
  lighting_difficulty: boolean;
  distance_visual_acuity: string;
  near_visual_acuity: string;
  habitual_correction: string;
  best_correction: string;
  contrast_sensitivity: string;
  glare_function: string;
  central_vision: string;
  visual_field: string;
  functional_reading: string;
  sustained_near_task: string;
  tv_phone_mobility_notes: string;
  illumination_response: string;
  posture_working_distance: string;
  magnifier_type: string;
  magnification: string;
  near_add: string;
  electronic_aid: string;
  tint_filter: string;
  task_performance_with_device: string;
  device_recommended: string;
  lighting_advice: string;
  non_optical_aids: string;
  rehab_referral: string;
  support_referral: string;
  training_required: string;
  follow_up_plan: string;
  cause_of_low_vision: string;
  prognosis: string;
  emotional_support_notes: string;
  charles_bonnet_screening: string;
  final_plan: string;
}

export interface MyopiaMeasurementPayload {
  measured_at: string;
  age_years: number;
  axial_length_right_mm: number;
  axial_length_left_mm: number;
  treatment_type: string;
  treatment_notes: string;
  visit_notes: string;
  refraction_right: string;
  refraction_left: string;
}

export interface MyopiaMeasurementRecord {
  measured_at: string;
  age_years: number;
  axial_length_right_mm: number;
  axial_length_left_mm: number;
  treatment_type: string;
  treatment_notes: string;
  visit_notes: string;
  refraction_right: string;
  refraction_left: string;
  id: string;
  org_id: string;
  patient_id: string;
  created_at: string;
}

export interface MyopiaDelta {
  right_mm: number;
  left_mm: number;
}

export interface MyopiaHistory {
  patient_id: string;
  records: MyopiaMeasurementRecord[];
  baseline_delta: MyopiaDelta | null;
  last_delta: MyopiaDelta | null;
  annualized_growth: MyopiaDelta | null;
  overlay_version: string;
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
  contact_lens?: ContactLensPayload | null;
  binocular_vision?: BinocularVisionPayload | null;
  low_vision?: LowVisionPayload | null;
  myopia_measurement?: MyopiaMeasurementPayload | null;
  assets?: NoteAsset[];
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

export interface GeneratePdfPayload {
  patient_id: string;
  content: string;
  assets?: NoteAsset[];
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
  reminder_sent_at: string | null;
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
  patient_name?: string | null;
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
  clinic_specialty: ClinicSpecialty | null;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: number;
  doctor_name: string;
  sender_name: string;
  sender_email: string;
  email_configured: boolean;
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

export interface UserRoleUpdatePayload {
  role: UserRole;
}

export interface AuthUser {
  id: string;
  org_id: string;
  name: string;
  identifier: string;
  role: UserRole;
  doctor_dob?: string | null;
  doctor_address?: string;
  doctor_signature_name?: string | null;
  doctor_signature_url?: string | null;
  doctor_signature_content_type?: string | null;
  created_at: string;
}

export interface SuperuserOrgSummary {
  org_id: string;
  clinic_name: string;
  created_at: string;
  user_count: number;
  patient_count: number;
  note_count: number;
  invoice_count: number;
  follow_up_count: number;
  total_tokens: number;
  last_activity_at: string | null;
}

export interface SuperuserOrgUser {
  id: string;
  org_id: string;
  identifier: string;
  name: string;
  role: "admin" | "staff";
  created_at: string;
}

export interface PlatformError {
  id: string;
  org_id: string | null;
  user_id: string | null;
  identifier: string;
  path: string;
  method: string;
  status_code: number | null;
  error_type: string;
  message: string;
  details: string;
  context: Record<string, unknown>;
  created_at: string;
}

export interface SuperuserUsageSummary {
  total_tokens: number;
  total_requests: number;
  by_feature: Record<string, number>;
}

export interface SuperuserOrgDetail {
  summary: SuperuserOrgSummary;
  users: SuperuserOrgUser[];
  recent_errors: PlatformError[];
  usage: SuperuserUsageSummary;
  recent_audit_events: AuditEvent[];
}

export interface AccountUpdatePayload {
  name: string;
  doctor_dob?: string | null;
  doctor_address: string;
}

export interface PasswordUpdatePayload {
  current_password: string;
  new_password: string;
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
  recipient_email: string;
}

export interface AppointmentCreatePayload {
  name: string;
  phone: string;
  email: string;
  address: string;
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
  email: string;
  address: string;
  reason: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
}

export interface PatientUpdatePayload {
  status?: PatientStatus;
  billed?: boolean;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  reason?: string;
  age?: number | null;
  weight?: number | null;
  height?: number | null;
  temperature?: number | null;
}

export interface FinalizeNotePayload {
  note_id: string;
}

export interface GenerateLetterPdfPayload {
  content: string;
}

export interface SendLetterPayload {
  recipient_email: string;
  subject: string;
  content: string;
}

export interface SendNotePayload {
  note_id: string;
  patient_id: string;
  recipient_email: string;
}

export interface ClinicSettingsUpdatePayload {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  clinic_specialty: ClinicSpecialty | null;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: number;
  doctor_name: string;
  sender_name: string;
  sender_email: string;
  sender_email_app_password?: string;
  email_configured: boolean;
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
