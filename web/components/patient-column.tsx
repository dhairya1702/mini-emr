"use client";

import { CSSProperties } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";

import { PatientCard } from "@/components/patient-card";
import { Patient, PatientStatus } from "@/lib/types";

interface PatientColumnProps {
  status: PatientStatus;
  title: string;
  patients: Patient[];
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  onTogglePriority: (patient: Patient) => void;
  onOpenBilling: (patient: Patient) => void;
  onAddPatient?: () => void;
  canAdvance?: (patient: Patient) => boolean;
  canDrag?: (patient: Patient) => boolean;
  now: number;
}

const columnStyles: Record<PatientStatus, {
  dot: string;
  ring: string;
  header: string;
  count: string;
  add: string;
  emptyTitle: string;
  emptyDescription: string;
}> = {
  waiting: {
    dot: "bg-[#f59e0b]",
    ring: "ring-4 ring-amber-100",
    header: "bg-[#fffaf0]",
    count: "border-[#fbe2b5] bg-[#fff7ea] text-amber-700",
    add: "border-[#fbe2b5] bg-[#fff7ea] text-amber-700 hover:bg-amber-100",
    emptyTitle: "No patients waiting",
    emptyDescription: "New arrivals will appear here.",
  },
  consultation: {
    dot: "bg-[#2f8fd3]",
    ring: "ring-4 ring-[#d8ebf7]",
    header: "bg-[#f3faff]",
    count: "border-[#bfe0f5] bg-[#ecf6fd] text-[#2a6fa8]",
    add: "border-[#bfe0f5] bg-[#ecf6fd] text-[#2a6fa8] hover:bg-[#d8ebf7]",
    emptyTitle: "No active consultations",
    emptyDescription: "Move the next waiting patient here.",
  },
  done: {
    dot: "bg-[#16a34a]",
    ring: "ring-4 ring-emerald-100",
    header: "bg-[#f1fbf5]",
    count: "border-[#bce8cd] bg-[#ecfaf1] text-emerald-700",
    add: "border-[#bce8cd] bg-[#ecfaf1] text-emerald-700 hover:bg-emerald-100",
    emptyTitle: "No patients ready to bill",
    emptyDescription: "Completed consultations will appear here.",
  },
};

export function PatientColumn({
  status,
  title,
  patients,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onTogglePriority,
  onOpenBilling,
  onAddPatient,
  canAdvance,
  canDrag,
  now,
}: PatientColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    data: {
      type: "column",
      status,
    },
  });
  const styles = columnStyles[status];

  return (
    <section
      aria-label={`${title} queue`}
      className={`flex min-h-0 flex-col overflow-hidden rounded-[20px] border bg-white/80 shadow-[0_14px_38px_rgba(64,131,181,0.10)] transition ${
        isOver ? "border-[#2f8fd3] ring-2 ring-[#d8ebf7]" : "border-[#bfd7e8]"
      }`}
    >
      <div className={`flex shrink-0 items-center gap-3 border-b border-[#dbe7ef] px-[18px] py-3.5 ${styles.header}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${styles.dot} ${styles.ring}`} />
        <h2 className="text-[15px] font-bold text-[#1f2b3d]">{title}</h2>
        <span className={`ml-auto inline-flex min-w-7 items-center justify-center rounded-full border px-2 py-1 text-xs font-bold ${styles.count}`}>
          {patients.length}
        </span>
        {onAddPatient ? (
          <button
            type="button"
            onClick={onAddPatient}
            aria-label="Add patient"
            title="Add patient"
            className={`inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-[9px] border px-2.5 text-xs font-semibold transition active:scale-95 ${styles.add}`}
          >
            <Plus className="h-4 w-4" />
            <span>Add patient</span>
          </button>
        ) : null}
      </div>

      <div ref={setNodeRef} className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <SortableContext items={patients.map((patient) => patient.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {patients.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-[#bfd7e8] bg-[#f3f8fb] px-4 py-9 text-center">
                <p className="text-sm font-semibold text-[#5b6b80]">{styles.emptyTitle}</p>
                <p className="mt-1 text-xs text-[#8595a8]">{styles.emptyDescription}</p>
              </div>
            ) : (
              patients.map((patient) => (
                <SortablePatientCard
                  key={patient.id}
                  patient={patient}
                  onOpen={onOpen}
                  onAdvance={onAdvance}
                  onRemoveFromQueue={onRemoveFromQueue}
                  onTogglePriority={onTogglePriority}
                  onOpenBilling={onOpenBilling}
                  canAdvance={canAdvance ? canAdvance(patient) : true}
                  canDrag={canDrag ? canDrag(patient) : true}
                  now={now}
                />
              ))
            )}
          </div>
        </SortableContext>
      </div>
    </section>
  );
}

function SortablePatientCard({
  patient,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onTogglePriority,
  onOpenBilling,
  canAdvance,
  canDrag,
  now,
}: {
  patient: Patient;
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  onTogglePriority: (patient: Patient) => void;
  onOpenBilling: (patient: Patient) => void;
  canAdvance: boolean;
  canDrag: boolean;
  now: number;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: patient.id,
    disabled: !canDrag,
    data: {
      type: "patient",
      patientId: patient.id,
      status: patient.status,
    },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "opacity-60" : ""}
    >
      <PatientCard
        patient={patient}
        onOpen={onOpen}
        onAdvance={onAdvance}
        onRemoveFromQueue={onRemoveFromQueue}
        onTogglePriority={onTogglePriority}
        onOpenBilling={onOpenBilling}
        canAdvance={canAdvance}
        now={now}
        dragHandleProps={{
          attributes,
          listeners,
          setActivatorNodeRef,
          disabled: !canDrag,
        }}
      />
    </div>
  );
}
