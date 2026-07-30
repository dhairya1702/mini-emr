import type { ClinicSpecialty } from "@/lib/clinic-specialty";

export type PatientStatus = "waiting" | "consultation" | "done";
export type QueuePriority = "normal" | "urgent";
export type SexAtBirth = "female" | "male" | "other";
export type VisitKind = "new" | "follow_up";
export type WorkspaceMode = "solo" | "team";
export type EmailSenderMode = "clinicos" | "clinic";

export interface CurrentVisitSummary {
  id: string;
  kind: VisitKind;
  source: "queue" | "appointment";
  scheduled_for: string | null;
}

export interface QueueBillingSummary {
  invoice_id: string;
  total: number;
  payment_status: PaymentStatus;
  balance_due: number;
  item_count: number;
  medicine_count: number;
  completed_at: string | null;
  sent_at: string | null;
}

export interface QueueBillingEstimate {
  total: number;
  item_count: number;
  medicine_count: number;
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  reason: string;
  date_of_birth?: string | null;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  status: PatientStatus;
  billed: boolean;
  queue_priority: QueuePriority;
  stage_entered_at: string;
  queue_position: number;
  current_visit?: CurrentVisitSummary | null;
  billing_summary?: QueueBillingSummary | null;
  billing_estimate?: QueueBillingEstimate | null;
  profile_photo_url?: string | null;
  profile_photo_content_type?: string | null;
  profile_photo_updated_at?: string | null;
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
  date_of_birth?: string | null;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  status: PatientStatus;
  billed: boolean;
  profile_photo_url?: string | null;
  profile_photo_content_type?: string | null;
  profile_photo_updated_at?: string | null;
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
  date_of_birth?: string | null;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
  source: string;
  appointment_id: string | null;
  visit_kind: VisitKind;
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
  date_of_birth?: string | null;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
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
  | "tbi_evaluation"
  | "binocular_vision"
  | "growth_measurement"
  | "well_child_visit"
  | "invoice_created"
  | "bill_sent"
  | "follow_up_scheduled"
  | "follow_up_completed"
  | "care_program_enrolled"
  | "care_program_review"
  | "care_program_completed";

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

export interface PatientChartVisit {
  id: string;
  patient_id: string;
  reason: string;
  created_at: string;
}

export interface PatientSummary {
  summary: string;
  updated_at: string | null;
  stale: boolean;
  used_fallback: boolean;
}

export type TbiEvaluationPayload = Record<string, unknown>;
export type BinocularVisionPayload = Record<string, unknown>;

export interface TbiEvaluationRecord {
  id: string;
  org_id: string;
  patient_id: string;
  measured_at: string;
  payload: TbiEvaluationPayload;
  summary_fields: Record<string, unknown>;
  created_at: string;
}

export interface TbiEvaluationCreatePayload {
  measured_at: string;
  payload: TbiEvaluationPayload;
}

export interface BinocularVisionEvaluationRecord {
  id: string;
  org_id: string;
  patient_id: string;
  measured_at: string;
  payload: BinocularVisionPayload;
  summary_fields: Record<string, unknown>;
  created_at: string;
}

export interface BinocularVisionEvaluationCreatePayload {
  measured_at: string;
  payload: BinocularVisionPayload;
}

export interface PatientVisitAttachmentRow {
  id: string;
  label: string;
  timestamp: string;
  source_type: "note_attachment" | "patient_attachment";
  content_type: string;
  attachment_id: string | null;
  data_base64: string | null;
}

export interface PatientVisitNoteDetail {
  status: string;
  content: string;
}

export interface PatientVisitDetail {
  visit_id: string;
  reason: string;
  timestamp: string;
  consultation_note: PatientVisitNoteDetail | null;
  attachments: PatientVisitAttachmentRow[];
  timeline: PatientTimelineEvent[];
}

export interface ConsultationNote {
  id: string;
  patient_id: string;
  visit_id: string | null;
  content: string;
  status: "draft" | "final" | "sent";
  version_number: number;
  root_note_id: string | null;
  amended_from_note_id: string | null;
  snapshot_content: string | null;
  asset_payload?: NoteAsset[];
  snapshot_asset_payload?: NoteAsset[];
  structured_modules?: StructuredModule[];
  clinical_extractions?: ClinicalExtractions;
  snapshot_clinical_extractions?: ClinicalExtractions | null;
  finalized_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_by_name?: string | null;
  sent_to: string | null;
  created_at: string;
}

export interface ServicePerformedExtraction {
  name: string;
  quantity: number;
  evidence?: string;
}

export interface MedicationPrescribedExtraction {
  catalog_item_id?: string | null;
  name: string;
  strength?: string;
  dose?: string;
  route?: string;
  schedule?: string;
  duration?: string;
  quantity?: string;
  instructions?: string;
  evidence?: string;
}

export interface ClinicalExtractions {
  services_performed: ServicePerformedExtraction[];
  medications_prescribed: MedicationPrescribedExtraction[];
}

export interface PrescriptionInput {
  catalog_item_id?: string | null;
  name: string;
  strength?: string;
  dose?: string;
  route?: string;
  schedule?: string;
  duration?: string;
  quantity?: string;
  instructions?: string;
}

export interface NoteAsset {
  id: string;
  kind: "attachment" | "drawing";
  name: string;
  content_type: string;
  data_base64?: string;
  attachment_id?: string;
}

export interface PatientAttachment {
  id: string;
  org_id: string;
  patient_id: string;
  visit_id?: string | null;
  uploaded_by: string | null;
  file_name: string;
  content_type: string;
  file_size: number;
  storage_path: string;
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

export interface StructuredModule {
  module_type: string;
  payload: Record<string, unknown>;
}

export interface LongitudinalTrackRecord {
  id: string;
  track_type: string;
  patient_id: string;
  org_id: string;
  measured_at: string;
  summary_fields: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  derived_metrics: Record<string, unknown>;
  created_at: string;
}

export interface LongitudinalTrackCreatePayload {
  track_type: string;
  measured_at: string;
  summary_fields?: Record<string, unknown>;
  raw_payload?: Record<string, unknown>;
  derived_metrics?: Record<string, unknown>;
}

export interface PediatricGrowthMeasurementPayload {
  measured_at: string;
  height_cm: number;
  weight_kg: number;
  head_circumference_cm?: number | null;
  visit_notes: string;
}

export interface PediatricGrowthMeasurementRecord {
  measured_at: string;
  age_months: number | null;
  height_cm: number;
  weight_kg: number;
  bmi: number;
  head_circumference_cm: number | null;
  visit_notes: string;
  track_id: string;
  created_at: string;
}

export interface PediatricGrowthDelta {
  height_cm: number | null;
  weight_kg: number | null;
  bmi: number | null;
}

export interface PediatricGrowthSummary {
  patient_id: string;
  latest_measurement: PediatricGrowthMeasurementRecord | null;
  previous_measurement: PediatricGrowthMeasurementRecord | null;
  interval_change: PediatricGrowthDelta | null;
  trend_summary: string;
  flags: string[];
  records: PediatricGrowthMeasurementRecord[];
}

export interface WellChildVisitPayload {
  visit_band: string;
  nutrition_summary: string;
  sleep_summary: string;
  elimination_summary: string;
  school_behavior_summary: string;
  parent_concerns: string;
  assessment_summary: string;
}

export interface ParentHandoutRequestPayload {
  template_key: string;
  instructions: string;
}

export interface PediatricFollowUpPlanPayload {
  preset_key: string;
  suggested_interval: string;
  notes: string;
}

export type CaseStudyTemplateKey =
  | "conference_presentation"
  | "teaching_rounds"
  | "hospital_case_discussion";

export type CaseStudyStatus = "draft" | "final";

export interface PatientCaseStudySource {
  patient: Patient;
  visits: PatientVisit[];
  timeline: PatientTimelineEvent[];
  notes: ConsultationNote[];
  myopia_history: MyopiaHistory | null;
  pediatric_growth_history: PediatricGrowthSummary | null;
}

export interface GenerateCaseStudyPayload {
  patient_id: string;
  title: string;
  template_key: CaseStudyTemplateKey;
  anonymized: boolean;
  author_instructions: string;
}

export interface GenerateCaseStudyResponse {
  title: string;
  content: string;
  source: PatientCaseStudySource;
}

export interface CaseStudy {
  id: string;
  org_id: string;
  patient_id: string;
  patient_name: string | null;
  title: string;
  status: CaseStudyStatus;
  template_key: CaseStudyTemplateKey;
  anonymized: boolean;
  author_instructions: string;
  generated_content: string;
  source_snapshot: Record<string, unknown>;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseStudySavePayload {
  patient_id: string;
  title: string;
  status: CaseStudyStatus;
  template_key: CaseStudyTemplateKey;
  anonymized: boolean;
  author_instructions: string;
  generated_content: string;
  source_snapshot: Record<string, unknown>;
}

export interface GenerateNotePayload {
  note_id?: string;
  patient_id: string;
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
  structured_modules?: StructuredModule[];
  assets?: NoteAsset[];
  prescriptions?: PrescriptionInput[];
}

export interface GenerateNoteResponse {
  note_id?: string | null;
  status?: "draft" | "final" | "sent" | null;
  content: string;
  used_fallback?: boolean;
  warning?: string | null;
  extractions: ClinicalExtractions;
}

export type ClinicalQuestionType =
  | "yes_no"
  | "single_choice"
  | "multi_choice"
  | "short_text"
  | "number"
  | "duration"
  | "module_request";

export type ClinicalQuestionPriority = "high" | "medium" | "low";

export type ClinicalAssistantModule =
  | "eye_exam"
  | "contact_lens"
  | "binocular_vision"
  | "low_vision"
  | "myopia_management"
  | "pediatric_growth_measurement"
  | "well_child_visit"
  | "parent_handout_request"
  | "pediatric_follow_up_plan"
  | "attachments"
  | "medicines"
  | "vitals";

export type ClinicalAssistantSpecialty = "optometry" | "pediatrics" | "general_physician" | "dentistry";

export interface ClinicalAssistantQuestion {
  id: string;
  group: string;
  label: string;
  type: ClinicalQuestionType;
  priority: ClinicalQuestionPriority;
  options: string[];
  rationale: string;
}

export interface ClinicalAssistantModuleSuggestion {
  module: ClinicalAssistantModule;
  reason: string;
}

export interface ClinicalQuestionsPayload {
  patient_id: string;
  consultation: GenerateNotePayload;
}

export interface ClinicalQuestionsResponse {
  assistant_specialty: ClinicalAssistantSpecialty;
  complaint_category: string;
  detected_factors: string[];
  questions: ClinicalAssistantQuestion[];
  module_suggestions: ClinicalAssistantModuleSuggestion[];
  safety_notice: string;
  used_fallback?: boolean;
  warning?: string | null;
}

export interface ClinicalAssistantAnswer {
  question_id: string;
  label: string;
  answer: string;
}

export interface ClinicalAnalysisPayload {
  patient_id: string;
  consultation: GenerateNotePayload;
  answers: ClinicalAssistantAnswer[];
}

export interface ClinicalPossibility {
  label: string;
  likelihood: "likely" | "consider" | "rule_out" | "contextual";
  why: string;
  what_to_check: string;
}

export interface ClinicalRedFlag {
  label: string;
  severity: "routine" | "caution" | "urgent";
  present: boolean | null;
}

export interface ClinicalAnalysisResponse {
  assistant_specialty: ClinicalAssistantSpecialty;
  possibilities: ClinicalPossibility[];
  red_flags: ClinicalRedFlag[];
  suggested_tests: string[];
  documentation_gaps: string[];
  module_suggestions: ClinicalAssistantModule[];
  note_additions: string;
  safety_notice: string;
  used_fallback?: boolean;
  warning?: string | null;
}

export interface MobileFinalizeConsultationResponse {
  note: ConsultationNote;
  patient: Patient;
}

export interface GenerateLetterPayload {
  to: string;
  subject: string;
  content: string;
}

export interface GenerateParentHandoutPayload {
  patient_id: string;
  template_key: string;
  instructions: string;
  well_child_visit?: WellChildVisitPayload | null;
}

export interface GenerateParentHandoutResponse {
  title: string;
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

export type CatalogItemType = "service" | "medicine" | "program";
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
  aliases: string[];
  description?: string;
  program_key?: string | null;
  program_definition?: MyopiaProgramDefinition | null;
  is_active?: boolean;
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
  visit_id?: string | null;
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
  timezone: string;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: number;
  doctor_name: string;
  sender_name: string;
  sender_email: string;
  email_sender_mode: EmailSenderMode;
  email_configured: boolean;
  clinic_email_configured: boolean;
  clinicos_email_available: boolean;
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
  document_template_signature_x: number;
  document_template_signature_y: number;
  document_template_signature_width: number;
  document_template_signature_height: number;
  document_template_doctor_name_x: number;
  document_template_doctor_name_y: number;
  document_template_doctor_name_width: number;
  document_template_doctor_name_height: number;
  document_template_note_layout: Record<string, { x: number; y: number; width: number; height: number }>;
  onboarding_required: boolean;
  onboarding_completed_at: string | null;
  users_allowed: number;
  workspace_mode: WorkspaceMode;
  public_check_in_enabled: boolean;
  public_check_in_token: string;
  updated_at: string | null;
}

export interface CheckInConfig {
  enabled: boolean;
  public_url: string;
  token: string;
}

export interface PublicCheckInContext {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
}

export interface PublicAppointmentSlots {
  clinic_name: string;
  timezone: string;
  suggested_slots: string[];
}

export interface PublicAppointmentBooking {
  appointment_id: string;
  patient_name: string;
  clinic_name: string;
  timezone: string;
  scheduled_for: string;
  status: "scheduled" | "checked_in" | "cancelled";
  booking_token: string;
  suggested_slots: string[];
}

export interface CheckInCandidate {
  id: string;
  name: string;
  phone: string;
  date_of_birth: string | null;
  last_visit_at: string;
  status: PatientStatus;
  match_reasons: string[];
  confidence: "strong" | "likely" | "possible";
}

export interface CheckInRequest {
  id: string;
  submitted_name: string;
  submitted_phone: string;
  submitted_email: string;
  submitted_date_of_birth: string;
  submitted_sex_at_birth: SexAtBirth | null;
  submitted_reason: string;
  status: "pending" | "approved" | "rejected" | "expired";
  approved_patient_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  expires_at: string;
  candidates: CheckInCandidate[];
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
  media_storage_bytes: number;
  recent_error_count: number;
  last_activity_at: string | null;
  workspace_mode: WorkspaceMode;
  users_allowed: number;
  clinic_specialty: ClinicSpecialty | null;
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
  settings: ClinicSettings | null;
  users: SuperuserOrgUser[];
  recent_errors: PlatformError[];
  usage: SuperuserUsageSummary;
  recent_audit_events: AuditEvent[];
}

export interface SuperdashboardMetricPoint {
  date: string;
  value: number;
}

export interface SuperdashboardDashboard {
  org_count: number;
  active_org_count: number;
  user_count: number;
  patient_count: number;
  note_count: number;
  invoice_count: number;
  follow_up_count: number;
  ai_tokens_7d: number;
  ai_requests_7d: number;
  media_storage_bytes: number;
  error_count_7d: number;
  error_rate_7d: number;
  top_error_context: string;
}

export interface SuperdashboardTrends {
  requests: SuperdashboardMetricPoint[];
  tokens: SuperdashboardMetricPoint[];
  storage: SuperdashboardMetricPoint[];
  errors: SuperdashboardMetricPoint[];
}

export interface SuperdashboardOrgUsageRow {
  org_id: string;
  clinic_name: string;
  total_tokens: number;
  media_storage_bytes: number;
}

export interface SuperdashboardUsageByOrg {
  ai_usage: SuperdashboardOrgUsageRow[];
  media_storage: SuperdashboardOrgUsageRow[];
}

export interface CustomerOnboarding {
  id: string;
  customer_id: string;
  customer_name: string;
  phone: string;
  users_allowed: number;
  workspace_mode: WorkspaceMode;
  users_used: number;
  status: "pending" | "claimed" | "disabled";
  claimed_org_id: string | null;
  claimed_org_name: string | null;
  claimed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerOnboardingCreatePayload {
  customer_name: string;
  phone: string;
  users_allowed: number;
  workspace_mode: WorkspaceMode;
}

export interface CustomerOnboardingUpdatePayload {
  customer_name?: string;
  phone?: string;
  users_allowed?: number;
  workspace_mode?: WorkspaceMode;
  status?: "pending" | "claimed" | "disabled";
}

export interface SuperdashboardOnboarding {
  summary: {
    pending_count: number;
    claimed_count: number;
    disabled_count: number;
    default_users_allowed: number;
  };
  customers: CustomerOnboarding[];
}

export interface PlatformEmailSettings {
  sender_name: string;
  sender_email: string;
  is_enabled: boolean;
  is_configured: boolean;
  last_tested_at: string | null;
  last_test_succeeded: boolean;
  last_error: string;
  updated_at: string | null;
}

export interface PlatformEmailSettingsUpdatePayload {
  sender_name: string;
  sender_email: string;
  sender_email_app_password?: string;
  is_enabled: boolean;
}

export type ControlRoomStatusValue = "healthy" | "warning" | "failing" | "unknown";

export interface ControlRoomCheck {
  key: string;
  label: string;
  status: ControlRoomStatusValue;
  evidence: string;
  next_action: string;
  checked_at: string;
}

export interface ControlRoomStatus {
  checked_at: string;
  overall_status: ControlRoomStatusValue;
  checks: ControlRoomCheck[];
}

export interface ControlRoomMigration {
  name: string;
  checksum_sha256: string;
  applied_at: string | null;
}

export interface ControlRoomTableStat {
  table_name: string;
  estimated_rows: number;
}

export interface ControlRoomIntegrityCheck {
  key: string;
  label: string;
  status: ControlRoomStatusValue;
  invalid_count: number;
  evidence: string;
}

export interface ControlRoomDatabase {
  checked_at: string;
  reachable: boolean;
  migration_status: ControlRoomStatusValue;
  pending_migrations: string[];
  database_only_migrations: string[];
  applied_migrations: ControlRoomMigration[];
  table_stats: ControlRoomTableStat[];
  integrity_checks: ControlRoomIntegrityCheck[];
}

export interface ControlRoomIncidentSample {
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

export interface ControlRoomIncident {
  fingerprint: string;
  severity: "critical" | "high" | "medium" | "low";
  method: string;
  path: string;
  status_code: number | null;
  error_type: string;
  message: string;
  count: number;
  affected_org_count: number;
  affected_user_count: number;
  first_seen_at: string;
  last_seen_at: string;
  latest_sample: ControlRoomIncidentSample;
}

export interface ControlRoomIncidents {
  checked_at: string;
  window_hours: number;
  incidents: ControlRoomIncident[];
}

export interface ControlRoomRunbookStep {
  label: string;
  command: string;
  note: string;
  dangerous: boolean;
}

export interface ControlRoomRunbook {
  key: string;
  title: string;
  summary: string;
  steps: ControlRoomRunbookStep[];
}

export interface ControlRoomRunbooks {
  runbooks: ControlRoomRunbook[];
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
  customer_id?: string;
  admin_name: string;
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  doctor_name: string;
}

export interface RegistrationConfig {
  customer_id_required: boolean;
  default_workspace_mode: WorkspaceMode;
  default_users_allowed: number;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface OperationResult {
  success: boolean;
  message: string;
  delivery?: WhatsAppDelivery | null;
}

export type WhatsAppDeliveryStatus = "queued" | "accepted" | "sent" | "delivered" | "read" | "failed";

export interface WhatsAppDelivery {
  event_id: string;
  document_type: string;
  document_id: string;
  recipient: string;
  provider_message_id: string;
  status: WhatsAppDeliveryStatus;
  error: string;
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
  aliases?: string[];
  description?: string;
  program_key?: string | null;
  program_definition?: MyopiaProgramDefinition | null;
  is_active?: boolean;
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
  invoice_id?: string | null;
  patient_id: string;
  items: InvoiceItemInput[];
  payment_status: PaymentStatus;
  amount_paid?: number | null;
}

export interface FinalizeInvoicePayload {
  invoice_id: string;
}

export interface SendInvoicePayload {
  invoice_id: string;
  recipient_email: string;
}

export interface SendInvoiceWhatsAppPayload {
  invoice_id: string;
  recipient_phone?: string | null;
  idempotency_key?: string;
}

export interface InvoiceActionResult {
  success: boolean;
  message: string;
  invoice: Invoice;
  program_enrollments?: ProgramEnrollmentSummary[];
  delivery?: WhatsAppDelivery | null;
}

export type ProgramEnrollmentStatus = "pending" | "active" | "completed" | "cancelled";

export interface MyopiaReviewDefinition {
  key: "baseline" | "review_1" | "review_2" | "final_review";
  label: string;
  offset_days: number;
}

export interface MyopiaProgramDefinition {
  version: 1;
  program_type: "myopia_monitoring";
  duration_days: number;
  reviews: MyopiaReviewDefinition[];
}

export interface CareProgramOffering {
  program_key: "myopia_care";
  enabled: boolean;
  catalog_item_id: string | null;
  name: string;
  description: string;
  default_price: number | null;
  is_active: boolean;
  definition: MyopiaProgramDefinition;
}

export interface CareProgramEvent {
  id: string;
  org_id: string;
  enrollment_id: string;
  event_type: "review" | "progress_report";
  sequence: number | null;
  status: "scheduled" | "completed" | "cancelled";
  title: string;
  due_at: string | null;
  completed_at: string | null;
  source_event_id: string | null;
  linked_entity_type: string | null;
  linked_entity_id: string | null;
  payload: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramEnrollmentSummary {
  id: string;
  org_id: string;
  patient_id: string;
  patient_name?: string | null;
  patient_phone: string;
  catalog_item_id: string;
  program_name: string;
  originating_invoice_id: string;
  responsible_user_id: string | null;
  responsible_user_name?: string | null;
  status: ProgramEnrollmentStatus;
  agreed_price: number;
  started_at: string | null;
  ends_at: string | null;
  next_action_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string;
  total_reviews: number;
  completed_reviews: number;
  next_review_title: string | null;
  balance_due: number;
  created_at: string;
}

export interface ProgramEnrollment extends ProgramEnrollmentSummary {
  program_snapshot: Record<string, unknown>;
  events: CareProgramEvent[];
}

export interface ProgramReport {
  id: string;
  enrollment_id: string;
  source_review_event_id: string;
  version: number;
  generated_at: string;
}

export interface AppointmentCreatePayload {
  name: string;
  phone: string;
  email: string;
  address: string;
  reason: string;
  date_of_birth?: string | null;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
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
  date_of_birth?: string | null;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
  age: number | null;
  weight: number | null;
  height: number | null;
  temperature: number | null;
}

export interface PatientUpdatePayload {
  status?: PatientStatus;
  billed?: boolean;
  queue_priority?: QueuePriority;
  sex_at_birth?: SexAtBirth | null;
  gender_identity?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  reason?: string;
  date_of_birth?: string | null;
  age?: number | null;
  weight?: number | null;
  height?: number | null;
  temperature?: number | null;
}

export interface FinalizeNotePayload {
  note_id: string;
}

export interface UpdateNoteDraftPayload {
  content: string;
  extractions?: ClinicalExtractions;
}

export type BillingSuggestionStatus = "auto_add" | "possible_match" | "unmatched" | "unavailable";

export interface BillingSuggestion {
  source: "default_consultation" | "extracted_service" | "prescribed_medicine";
  extraction_name: string;
  status: BillingSuggestionStatus;
  catalog_match: null | {
    catalog_item_id: string;
    label: string;
    item_type: CatalogItemType;
    quantity: number;
    unit_price: number;
    match_type: "exact" | "alias" | "fuzzy";
    confidence: number;
    available: boolean;
  };
}

export interface BillingSuggestionsResponse {
  note_id: string;
  visit_id: string | null;
  suggestions: BillingSuggestion[];
}

export interface MobileFinalizeConsultationPayload {
  patient_id: string;
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

export interface SendLetterWhatsAppPayload {
  recipient_phone: string;
  recipient_name: string;
  subject: string;
  content: string;
  patient_id?: string | null;
  idempotency_key?: string;
}

export interface SendNotePayload {
  note_id: string;
  patient_id: string;
  recipient_email: string;
}

export interface SendNoteWhatsAppPayload {
  note_id: string;
  patient_id: string;
  recipient_phone: string;
  idempotency_key?: string;
}

export interface SendPatientAttachmentPayload {
  recipient_email: string;
  subject: string;
  message: string;
}

export interface ClinicSettingsUpdatePayload {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  clinic_specialty: ClinicSpecialty | null;
  timezone: string;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: number;
  doctor_name?: string;
  sender_name: string;
  sender_email: string;
  sender_email_app_password?: string;
  email_sender_mode?: EmailSenderMode;
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
  document_template_signature_x: number;
  document_template_signature_y: number;
  document_template_signature_width: number;
  document_template_signature_height: number;
  document_template_doctor_name_x: number;
  document_template_doctor_name_y: number;
  document_template_doctor_name_width: number;
  document_template_doctor_name_height: number;
  document_template_note_layout: Record<string, { x: number; y: number; width: number; height: number }>;
  onboarding_required?: boolean;
  onboarding_completed_at?: string | null;
  users_allowed?: number;
  workspace_mode?: WorkspaceMode;
}
