"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu, Plus, Stethoscope } from "lucide-react";

import { AddPatientModal } from "@/components/add-patient-modal";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PatientColumn } from "@/components/patient-column";
import { SettingsDrawer } from "@/components/settings-drawer";
import { authStorage } from "@/lib/auth";
import { api } from "@/lib/api";
import { AuthUser, ClinicSettings, Patient, PatientStatus } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];

export default function HomePage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "consultation" | null>(null);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState("");
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    let active = true;

    async function loadApp() {
      const token = authStorage.getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      try {
        const [user, userList, data, settings] = await Promise.all([
          api.getCurrentUser(),
          api.listUsers(),
          api.listPatients(),
          api.getClinicSettings(),
        ]);
        if (active) {
          setCurrentUser(user);
          setUsers(userList);
          setPatients(data);
          setClinicSettings(settings);
          setIsAuthReady(true);
        }
      } catch (loadError) {
        if (active) {
          authStorage.clear();
          setError(loadError instanceof Error ? loadError.message : "Session expired.");
          setIsAuthReady(true);
          router.replace("/login");
        }
      }
    }

    loadApp();
    return () => {
      active = false;
    };
  }, [router]);

  const groupedPatients = useMemo(() => {
    return statusOrder.reduce<Record<PatientStatus, Patient[]>>(
      (accumulator, status) => {
        accumulator[status] = patients.filter((patient) => patient.status === status);
        return accumulator;
      },
      {
        waiting: [],
        consultation: [],
        done: [],
      },
    );
  }, [patients]);

  async function handleCreatePatient(payload: {
    name: string;
    phone: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) {
    const optimisticPatient: Patient = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "waiting",
      ...payload,
    };

    setPatients((current) => [optimisticPatient, ...current]);
    try {
      const created = await api.createPatient(payload);
      setPatients((current) =>
        current.map((patient) => (patient.id === optimisticPatient.id ? created : patient)),
      );
      setError("");
    } catch (createError) {
      setPatients((current) => current.filter((patient) => patient.id !== optimisticPatient.id));
      setError(createError instanceof Error ? createError.message : "Failed to add patient.");
      throw createError;
    }
  }

  async function handleAdvancePatient(patient: Patient, nextStatus: PatientStatus) {
    const previousStatus = patient.status;
    setPatients((current) =>
      current.map((entry) =>
        entry.id === patient.id ? { ...entry, status: nextStatus } : entry,
      ),
    );
    if (selectedPatient?.id === patient.id) {
      setSelectedPatient({ ...patient, status: nextStatus });
    }

    try {
      await api.updatePatientStatus(patient.id, nextStatus);
      setError("");
    } catch (updateError) {
      setPatients((current) =>
        current.map((entry) =>
          entry.id === patient.id ? { ...entry, status: previousStatus } : entry,
        ),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient({ ...patient, status: previousStatus });
      }
      setError(updateError instanceof Error ? updateError.message : "Failed to update status.");
    }
  }

  async function handleUpdatePatient(
    patientId: string,
    payload: {
      name: string;
      phone: string;
      reason: string;
      age: number;
      weight: number;
      height: number | null;
      temperature: number;
    },
  ) {
    const previousPatients = patients;
    const updatedPatient = patients.find((patient) => patient.id === patientId);
    if (!updatedPatient) {
      return;
    }

    const optimistic = { ...updatedPatient, ...payload };
    setPatients((current) =>
      current.map((patient) => (patient.id === patientId ? optimistic : patient)),
    );
    if (selectedPatient?.id === patientId) {
      setSelectedPatient(optimistic);
    }

    try {
      const saved = await api.updatePatient(patientId, payload);
      setPatients((current) =>
        current.map((patient) => (patient.id === patientId ? saved : patient)),
      );
      if (selectedPatient?.id === patientId) {
        setSelectedPatient(saved);
      }
      setError("");
    } catch (updateError) {
      setPatients(previousPatients);
      if (selectedPatient?.id === patientId) {
        setSelectedPatient(updatedPatient);
      }
      throw updateError;
    }
  }

  function handleOpenPatient(patient: Patient) {
    setSelectedPatient(patient);
    setDrawerMode(patient.status === "consultation" ? "consultation" : "details");
  }

  async function handleSaveClinicSettings(
    payload: Omit<ClinicSettings, "id" | "org_id" | "updated_at">,
  ) {
    const saved = await api.updateClinicSettings(payload);
    setClinicSettings(saved);
  }

  async function handleAddStaffUser(payload: { identifier: string; password: string }) {
    const created = await api.createStaffUser(payload);
    setUsers((current) => [...current, created]);
  }

  function handleLogout() {
    authStorage.clear();
    router.replace("/login");
  }

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">
          Loading ClinicOS...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex flex-col gap-4 rounded-[32px] border border-sky-100 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.22)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 transition hover:bg-sky-50"
            >
              <Menu className="h-4 w-4" />
              Menu
            </button>

            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs tracking-[0.22em] text-sky-700">
                <Stethoscope className="h-3.5 w-3.5" />
                ClinicOS
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-slate-800 sm:text-4xl">
                {clinicName}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {currentUser ? (
              <div className="rounded-full border border-sky-200 bg-sky-50/80 px-4 py-2 text-sm font-medium text-sky-700">
                {currentUser.role === "admin" ? "Admin" : "Staff"}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-600"
            >
              <Plus className="h-4 w-4" />
              Add Patient
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-3">
          <PatientColumn
            title="Waiting"
            status="waiting"
            patients={groupedPatients.waiting}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
          />
          <PatientColumn
            title="In Consultation"
            status="consultation"
            patients={groupedPatients.consultation}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
          />
          <PatientColumn
            title="Done"
            status="done"
            patients={groupedPatients.done}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
          />
        </div>
      </div>

      <AddPatientModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreatePatient}
      />

      <SettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={currentUser}
        users={users}
        onClose={() => setIsSettingsOpen(false)}
        onSaveClinic={handleSaveClinicSettings}
        onAddUser={handleAddStaffUser}
        onGenerateLetter={async (payload) => {
          const response = await api.generateLetter(payload);
          return response.content;
        }}
        onGenerateLetterPdf={(payload) => api.generateLetterPdf(payload)}
        onSendLetter={async (payload) => {
          const response = await api.sendLetter(payload);
          return response.message;
        }}
      />

      <PatientDetailsDrawer
        patient={drawerMode === "details" ? selectedPatient : null}
        onSave={handleUpdatePatient}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
        }}
      />

      <ConsultationDrawer
        patient={drawerMode === "consultation" ? selectedPatient : null}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
        }}
        onDone={async (patient) => {
          await handleAdvancePatient(patient, "done");
        }}
        onGenerate={async (payload) => {
          const response = await api.generateNote(payload);
          return response.content;
        }}
        onGeneratePdf={(payload) => api.generateNotePdf(payload)}
        onSend={async (payload) => {
          const response = await api.sendNote(payload);
          return response.message;
        }}
      />
    </main>
  );
}
