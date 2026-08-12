"use client";

import { Search, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import type {
  AuthUser,
  CareProgramOffering,
  Patient,
  PatientInput,
  PaymentStatus,
  ProgramEnrollment,
  SexAtBirth,
} from "@/lib/types";

const emptyPatient: PatientInput = {
  name: "",
  phone: "",
  email: "",
  address: "",
  reason: "Care program enrollment",
  date_of_birth: null,
  sex_at_birth: null,
  gender_identity: "",
  age: null,
  weight: null,
  height: null,
  temperature: null,
};

export function CareProgramEnrollmentModal({
  offerings,
  currentUser,
  onClose,
  onComplete,
}: {
  offerings: CareProgramOffering[];
  currentUser: AuthUser;
  onClose: () => void;
  onComplete: (enrollment: ProgramEnrollment, message: string) => void | Promise<void>;
}) {
  const { users: clinicUsers, loadUsers } = useClinicShell();
  const users = clinicUsers.filter((user) => user.role === "admin");
  const activeOfferings = offerings.filter((offering) => offering.is_active && offering.catalog_item_id);
  const initialOffering = activeOfferings[0] || null;
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [programKey, setProgramKey] = useState<string>(initialOffering?.program_key || "");
  const [patientQuery, setPatientQuery] = useState("");
  const [patientMatches, setPatientMatches] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [newPatient, setNewPatient] = useState<PatientInput>(emptyPatient);
  const [doctorId, setDoctorId] = useState(currentUser.id);
  const [price, setPrice] = useState(initialOffering?.default_price ? String(initialOffering.default_price) : "");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [amountPaid, setAmountPaid] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedOffering = activeOfferings.find((offering) => offering.program_key === programKey) || null;

  useEffect(() => {
    void loadUsers()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load doctors."));
  }, [loadUsers]);

  async function searchPatients() {
    const query = patientQuery.trim();
    if (!query) return;
    setIsSearching(true);
    setError("");
    try {
      setPatientMatches((await api.listPatients({ q: query, limit: 20 })).items);
      setSelectedPatientId("");
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Failed to search patients.");
    } finally {
      setIsSearching(false);
    }
  }

  function updateNewPatient<K extends keyof PatientInput>(key: K, value: PatientInput[K]) {
    setNewPatient((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!selectedOffering?.catalog_item_id) {
      setError("Select an active care program.");
      return;
    }
    const numericPrice = Number(price);
    const numericAmountPaid = Number(amountPaid);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError("Enter a valid program price.");
      return;
    }
    if (mode === "existing" && !selectedPatientId) {
      setError("Select an existing patient.");
      return;
    }
    if (mode === "new" && (!newPatient.name.trim() || !newPatient.phone.trim() || !newPatient.reason.trim())) {
      setError("Patient name, phone and reason are required.");
      return;
    }
    if (
      paymentStatus === "partial"
      && (!Number.isFinite(numericAmountPaid) || numericAmountPaid <= 0 || numericAmountPaid >= numericPrice)
    ) {
      setError("Partial payment must be greater than zero and less than the program price.");
      return;
    }
    setIsSaving(true);
    try {
      const patientId = mode === "existing"
        ? selectedPatientId
        : (await api.createPatient({
            ...newPatient,
            name: newPatient.name.trim(),
            phone: newPatient.phone.trim(),
            email: newPatient.email.trim().toLowerCase(),
            address: newPatient.address.trim(),
            reason: newPatient.reason.trim(),
          })).id;
      const invoice = await api.createInvoice({
        patient_id: patientId,
        payment_status: paymentStatus,
        amount_paid: paymentStatus === "partial" ? numericAmountPaid : undefined,
        items: [{
          catalog_item_id: selectedOffering.catalog_item_id,
          item_type: "program",
          label: selectedOffering.name,
          quantity: 1,
          unit_price: numericPrice,
        }],
      });
      const result = await api.finalizeInvoice({ invoice_id: invoice.id });
      const enrollmentId = result.program_enrollments?.[0]?.id;
      if (!enrollmentId) throw new Error("No care program enrollment was returned.");
      let enrollment = await api.getCareProgramEnrollment(enrollmentId);
      if (doctorId) {
        enrollment = await api.assignCareProgramEnrollment(enrollmentId, doctorId);
      }
      await onComplete(enrollment, result.message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to enroll patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/35 px-4 py-6">
      <button type="button" aria-label="Close enrollment dialog" className="fixed inset-0" onClick={onClose} />
      <form onSubmit={submit} className="relative mx-auto w-full max-w-2xl rounded-lg border border-[#dbe7ef] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.25)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Enroll patient</h2>
            <p className="mt-1 text-sm text-slate-500">Start a clinic care program.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#dbe7ef] p-2 text-slate-500" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Program
            <select
              value={programKey}
              onChange={(event) => {
                const next = activeOfferings.find((offering) => offering.program_key === event.target.value);
                setProgramKey(event.target.value);
                setPrice(next?.default_price ? String(next.default_price) : "");
              }}
              className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] bg-white px-3 py-2.5"
            >
              {activeOfferings.map((offering) => <option key={offering.program_key} value={offering.program_key}>{offering.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Responsible doctor
            <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] bg-white px-3 py-2.5">
              <option value="">Assign later</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name || user.identifier}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-5 inline-flex rounded-lg border border-[#bfd7e8] bg-[#f3f8fb] p-1">
          {(["existing", "new"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => { setMode(value); setError(""); }}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${mode === value ? "bg-white text-[#2a6fa8] shadow-sm" : "text-slate-600"}`}
            >
              {value === "existing" ? "Existing patient" : "New patient"}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <div className="mt-4">
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder="Search by patient name or phone" className="h-11 w-full rounded-lg border border-[#bfd7e8] pl-10 pr-3" />
              </label>
              <button type="button" onClick={() => void searchPatients()} disabled={isSearching} className="rounded-lg border border-[#bfd7e8] px-4 text-sm font-semibold text-[#2a6fa8]">
                {isSearching ? "Searching..." : "Search"}
              </button>
            </div>
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
              {patientMatches.map((patient) => (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => setSelectedPatientId(patient.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left ${
                    selectedPatientId === patient.id ? "border-[#6daed8] bg-sky-50" : "border-[#dbe7ef]"
                  }`}
                >
                  <span className="font-medium text-slate-900">{patient.name}</span>
                  <span className="text-sm text-slate-500">{patient.phone}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Name<input value={newPatient.name} onChange={(event) => updateNewPatient("name", event.target.value)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700">Phone<input value={newPatient.phone} onChange={(event) => updateNewPatient("phone", event.target.value)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700">Email<input type="email" value={newPatient.email} onChange={(event) => updateNewPatient("email", event.target.value)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700">Date of birth<input type="date" value={newPatient.date_of_birth || ""} onChange={(event) => updateNewPatient("date_of_birth", event.target.value || null)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700">Sex<select value={newPatient.sex_at_birth || ""} onChange={(event) => updateNewPatient("sex_at_birth", (event.target.value || null) as SexAtBirth | null)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] bg-white px-3 py-2.5"><option value="">Not recorded</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
            <label className="text-sm font-medium text-slate-700">Age<input type="number" min="0" max="130" value={newPatient.age ?? ""} onChange={(event) => updateNewPatient("age", event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Gender identity<input value={newPatient.gender_identity || ""} onChange={(event) => updateNewPatient("gender_identity", event.target.value)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Address<input value={newPatient.address} onChange={(event) => updateNewPatient("address", event.target.value)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">Reason<input value={newPatient.reason} onChange={(event) => updateNewPatient("reason", event.target.value)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700">Weight<input type="number" min="1" value={newPatient.weight ?? ""} onChange={(event) => updateNewPatient("weight", event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700">Height<input type="number" min="1" value={newPatient.height ?? ""} onChange={(event) => updateNewPatient("height", event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
            <label className="text-sm font-medium text-slate-700">Temperature<input type="number" min="90" max="110" step="0.1" value={newPatient.temperature ?? ""} onChange={(event) => updateNewPatient("temperature", event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Program price<input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label>
          <label className="text-sm font-medium text-slate-700">Payment<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] bg-white px-3 py-2.5"><option value="paid">Paid</option><option value="partial">Partially paid</option><option value="unpaid">Unpaid</option></select></label>
          {paymentStatus === "partial" ? <label className="text-sm font-medium text-slate-700">Amount paid<input type="number" min="1" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" /></label> : null}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#bfd7e8] px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSaving || !activeOfferings.length} className="rounded-lg bg-[#2f8fd3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {isSaving ? "Enrolling..." : "Complete enrollment"}
          </button>
        </div>
      </form>
    </div>
  );
}
