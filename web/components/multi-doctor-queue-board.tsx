"use client";

import { CSSProperties } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, SensorDescriptor, SensorOptions, closestCorners } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { Plus, UserRound } from "lucide-react";

import { PatientCard } from "@/components/patient-card";
import { Patient, PatientStatus, QueueProvider } from "@/lib/types";

interface MultiDoctorQueueBoardProps {
  patients: Patient[];
  providers: QueueProvider[];
  draggedPatient: Patient | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  sensors: SensorDescriptor<SensorOptions>[];
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  onTogglePriority: (patient: Patient) => void;
  onOpenBilling: (patient: Patient) => void;
  onAssignDoctor: (patient: Patient) => void;
  onAddPatient: () => void;
  canAdvance: (patient: Patient) => boolean;
  canAssignDoctor: boolean;
  now: number;
}

const statusRank: Record<PatientStatus, number> = {
  waiting: 0,
  consultation: 1,
  done: 2,
};

function providerKey(providerId: string | null) {
  return `provider:${providerId || "unassigned"}`;
}

function providerForPatient(patient: Patient) {
  return patient.assigned_doctor_id || "";
}

function sortedPatients(patients: Patient[]) {
  return [...patients].sort((left, right) => {
    const statusDifference = statusRank[left.status] - statusRank[right.status];
    const priorityDifference = (left.queue_priority === "urgent" ? 0 : 1) - (right.queue_priority === "urgent" ? 0 : 1);
    return statusDifference || priorityDifference || left.queue_position - right.queue_position;
  });
}

export function MultiDoctorQueueBoard({
  patients,
  providers,
  draggedPatient,
  onDragStart,
  onDragEnd,
  onDragCancel,
  sensors,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onTogglePriority,
  onOpenBilling,
  onAssignDoctor,
  onAddPatient,
  canAdvance,
  canAssignDoctor,
  now,
}: MultiDoctorQueueBoardProps) {
  const sections = [
    { id: "", name: "Unassigned", role: "staff", active: true },
    ...providers,
  ];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto xl:grid-cols-3 2xl:grid-cols-4">
        {sections.map((provider, index) => {
          const providerPatients = sortedPatients(
            patients.filter((patient) => !patient.billed && providerForPatient(patient) === provider.id),
          );
          return (
            <ProviderSection
              key={provider.id || "unassigned"}
              providerId={provider.id}
              title={provider.name}
              subtitle={provider.id ? provider.role : "Needs doctor"}
              patients={providerPatients}
              onOpen={onOpen}
              onAdvance={onAdvance}
              onRemoveFromQueue={onRemoveFromQueue}
              onTogglePriority={onTogglePriority}
              onOpenBilling={onOpenBilling}
              onAssignDoctor={onAssignDoctor}
              onAddPatient={index === 0 ? onAddPatient : undefined}
              canAdvance={canAdvance}
              canAssignDoctor={canAssignDoctor}
              now={now}
            />
          );
        })}
      </div>
      <DragOverlay>
        {draggedPatient ? (
          <div className="w-[min(320px,80vw)]">
            <PatientCard
              patient={draggedPatient}
              onOpen={() => undefined}
              onAdvance={() => undefined}
              onRemoveFromQueue={() => undefined}
              onTogglePriority={() => undefined}
              onOpenBilling={() => undefined}
              canAdvance={false}
              now={now}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ProviderSection({
  providerId,
  title,
  subtitle,
  patients,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onTogglePriority,
  onOpenBilling,
  onAssignDoctor,
  onAddPatient,
  canAdvance,
  canAssignDoctor,
  now,
}: {
  providerId: string;
  title: string;
  subtitle: string;
  patients: Patient[];
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  onTogglePriority: (patient: Patient) => void;
  onOpenBilling: (patient: Patient) => void;
  onAssignDoctor: (patient: Patient) => void;
  onAddPatient?: () => void;
  canAdvance: (patient: Patient) => boolean;
  canAssignDoctor: boolean;
  now: number;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: providerKey(providerId),
    data: { type: "provider", providerId },
  });

  return (
    <section className={`flex min-h-[360px] flex-col overflow-hidden rounded-[20px] border bg-white/80 shadow-[0_14px_38px_rgba(64,131,181,0.10)] transition ${
      isOver ? "border-[#2f8fd3] ring-2 ring-[#d8ebf7]" : "border-[#bfd7e8]"
    }`}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[#dbe7ef] bg-[#f7fbfe] px-[18px] py-3.5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf5fa] text-[#2f8fd3]">
          <UserRound className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-bold text-[#1f2b3d]">{title}</h2>
          <p className="truncate text-xs font-medium capitalize text-[#6c7d91]">{subtitle}</p>
        </div>
        <span className="ml-auto inline-flex min-w-7 items-center justify-center rounded-full border border-[#dbe7ef] bg-white px-2 py-1 text-xs font-bold text-[#2a6fa8]">
          {patients.length}
        </span>
        {onAddPatient ? (
          <button
            type="button"
            onClick={onAddPatient}
            aria-label="Add patient"
            title="Add patient"
            className="inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-[9px] border border-[#bfe0f5] bg-[#ecf6fd] px-2.5 text-xs font-semibold text-[#2a6fa8] transition hover:bg-[#d8ebf7] active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>Add</span>
          </button>
        ) : null}
      </div>
      <div ref={setNodeRef} className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <SortableContext items={patients.map((patient) => patient.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {patients.length ? patients.map((patient) => (
              <SortablePatientCard
                key={patient.id}
                patient={patient}
                providerId={providerId}
                onOpen={onOpen}
                onAdvance={onAdvance}
                onRemoveFromQueue={onRemoveFromQueue}
                onTogglePriority={onTogglePriority}
                onOpenBilling={onOpenBilling}
                onAssignDoctor={onAssignDoctor}
                canAdvance={canAdvance(patient)}
                canAssignDoctor={canAssignDoctor}
                now={now}
              />
            )) : (
              <div className="rounded-[16px] border border-dashed border-[#bfd7e8] bg-[#f3f8fb] px-4 py-9 text-center">
                <p className="text-sm font-semibold text-[#5b6b80]">No patients here</p>
                <p className="mt-1 text-xs text-[#8595a8]">Move or assign patients to this queue.</p>
              </div>
            )}
          </div>
        </SortableContext>
      </div>
    </section>
  );
}

function SortablePatientCard({
  patient,
  providerId,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onTogglePriority,
  onOpenBilling,
  onAssignDoctor,
  canAdvance,
  canAssignDoctor,
  now,
}: {
  patient: Patient;
  providerId: string;
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  onTogglePriority: (patient: Patient) => void;
  onOpenBilling: (patient: Patient) => void;
  onAssignDoctor: (patient: Patient) => void;
  canAdvance: boolean;
  canAssignDoctor: boolean;
  now: number;
}) {
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform, transition } = useSortable({
    id: patient.id,
    data: {
      type: "patient",
      patientId: patient.id,
      providerId,
    },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-60" : ""}>
      <PatientCard
        patient={patient}
        onOpen={onOpen}
        onAdvance={onAdvance}
        onRemoveFromQueue={onRemoveFromQueue}
        onTogglePriority={onTogglePriority}
        onOpenBilling={onOpenBilling}
        onAssignDoctor={onAssignDoctor}
        canAdvance={canAdvance}
        canAssignDoctor={canAssignDoctor}
        now={now}
        dragHandleProps={{
          attributes,
          listeners,
          setActivatorNodeRef,
        }}
      />
    </div>
  );
}
