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
  onAddPatient?: () => void;
  canAdvance?: (patient: Patient) => boolean;
  canDrag?: (patient: Patient) => boolean;
}

export function PatientColumn({
  status,
  title,
  patients,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onAddPatient,
  canAdvance,
  canDrag,
}: PatientColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    data: {
      type: "column",
      status,
    },
  });

  return (
    <section
      aria-label={`${title} queue`}
      className={`flex min-h-0 flex-col rounded-[18px] border bg-white/95 p-4 shadow-[0_14px_38px_rgba(64,131,181,0.09)] transition ${
        isOver ? "border-[#2f8fd3] ring-2 ring-[#d8ebf7]" : "border-[#bfd7e8]"
      }`}
    >
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <p className="text-sm text-slate-500">{patients.length} patients</p>
        </div>
        {onAddPatient ? (
          <button
            type="button"
            onClick={onAddPatient}
            aria-label="Add patient"
            title="Add patient"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#edf5fa] text-[#2a6fa8] transition hover:bg-[#dbeaf4]"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div ref={setNodeRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <SortableContext items={patients.map((patient) => patient.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {patients.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-[#bfd7e8] bg-[#f5f9fc] px-4 py-8 text-center">
                <p className="text-sm font-medium text-slate-600">No patients in this stage.</p>
                <p className="mt-1 text-xs text-slate-500">New arrivals and transitions will appear here.</p>
              </div>
            ) : (
              patients.map((patient) => (
                <SortablePatientCard
                  key={patient.id}
                  patient={patient}
                  onOpen={onOpen}
                  onAdvance={onAdvance}
                  onRemoveFromQueue={onRemoveFromQueue}
                  canAdvance={canAdvance ? canAdvance(patient) : true}
                  canDrag={canDrag ? canDrag(patient) : true}
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
  canAdvance,
  canDrag,
}: {
  patient: Patient;
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  canAdvance: boolean;
  canDrag: boolean;
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
        canAdvance={canAdvance}
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
