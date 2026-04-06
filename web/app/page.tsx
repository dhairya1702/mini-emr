"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AddPatientModal } from "@/components/add-patient-modal";
import { AppHeader } from "@/components/app-header";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PatientColumn } from "@/components/patient-column";
import { SettingsDrawer } from "@/components/settings-drawer";
import { authStorage } from "@/lib/auth";
import { api } from "@/lib/api";
import { AuthUser, CatalogItem, ClinicSettings, Invoice, Patient, PatientStatus, PatientTimelineEvent } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];

export default function HomePage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "consultation" | null>(null);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [isRedirectingToLogin, setIsRedirectingToLogin] = useState(false);
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    let active = true;

    async function loadApp() {
      const token = authStorage.getToken();
      if (!token) {
        if (active) {
          setIsRedirectingToLogin(true);
          setIsAuthReady(true);
        }
        router.replace("/login");
        return;
      }

      try {
        const [user, userList, catalog, data, settings] = await Promise.all([
          api.getCurrentUser(),
          api.listUsers(),
          api.listCatalogItems(),
          api.listPatients(),
          api.getClinicSettings(),
        ]);
        if (active) {
          setCurrentUser(user);
          setUsers(userList);
          setCatalogItems(catalog);
          setPatients(data);
          setClinicSettings(settings);
          setIsAuthReady(true);
        }
      } catch (loadError) {
        if (active) {
          authStorage.clear();
          setError(loadError instanceof Error ? loadError.message : "Session expired.");
          setIsRedirectingToLogin(true);
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
        accumulator[status] = patients.filter(
          (patient) => patient.status === status && !(status === "done" && patient.billed),
        );
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
      billed: false,
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

  async function handleCreateCatalogItem(payload: {
    name: string;
    item_type: "service" | "medicine";
    default_price: number;
    track_inventory: boolean;
    stock_quantity: number;
    low_stock_threshold: number;
    unit: string;
  }) {
    const created = await api.createCatalogItem(payload);
    setCatalogItems((current) =>
      [...current, created].sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  async function handleAdjustCatalogStock(itemId: string, delta: number) {
    const updated = await api.updateCatalogStock(itemId, { delta });
    setCatalogItems((current) =>
      current.map((item) => (item.id === itemId ? updated : item)),
    );
  }

  async function handleDeleteCatalogItem(itemId: string) {
    await api.deleteCatalogItem(itemId);
    setCatalogItems((current) => current.filter((item) => item.id !== itemId));
  }

  async function handleCreateInvoice(payload: {
    patient_id: string;
    items: Array<{
      catalog_item_id?: string | null;
      item_type: "service" | "medicine";
      label: string;
      quantity: number;
      unit_price: number;
    }>;
    payment_status: "paid";
  }): Promise<Invoice> {
    return api.createInvoice(payload);
  }

  async function handleLoadPatientTimeline(patientId: string): Promise<PatientTimelineEvent[]> {
    return api.getPatientTimeline(patientId);
  }

  function handleLogout() {
    authStorage.clear();
    setIsRedirectingToLogin(true);
    router.replace("/login");
  }

  if (isRedirectingToLogin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">
          Redirecting to login...
        </div>
      </main>
    );
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
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="queue"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onAddPatient={() => setIsModalOpen(true)}
          onLogout={handleLogout}
        />

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
            title="Billing"
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
        patients={groupedPatients.done}
        catalogItems={catalogItems}
        onClose={() => setIsSettingsOpen(false)}
        onSaveClinic={handleSaveClinicSettings}
        onAddUser={handleAddStaffUser}
        onCreateCatalogItem={handleCreateCatalogItem}
        onAdjustCatalogStock={handleAdjustCatalogStock}
        onDeleteCatalogItem={handleDeleteCatalogItem}
        onGenerateLetter={async (payload) => {
          const response = await api.generateLetter(payload);
          return response.content;
        }}
        onGenerateLetterPdf={(payload) => api.generateLetterPdf(payload)}
        onSendLetter={async (payload) => {
          const response = await api.sendLetter(payload);
          return response.message;
        }}
        onCreateInvoice={handleCreateInvoice}
        onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
        onSendInvoice={async (payload) => {
          const response = await api.sendInvoice(payload);
          return response.message;
        }}
        onBillingComplete={(patientId) => {
          setPatients((current) =>
            current.map((patient) =>
              patient.id === patientId ? { ...patient, billed: true } : patient,
            ),
          );
          setIsSettingsOpen(false);
        }}
      />

      <PatientDetailsDrawer
        patient={drawerMode === "details" ? selectedPatient : null}
        onLoadTimeline={handleLoadPatientTimeline}
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
