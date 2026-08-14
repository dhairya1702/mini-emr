"use client";

import { ArrowRight, Check, Clock3, Flag, GripVertical, ReceiptIndianRupee, Stethoscope, Trash2 } from "lucide-react";
import type { HTMLAttributes } from "react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { Patient, PatientStatus } from "@/lib/types";

const stageStyles: Record<PatientStatus, {
  rail: string;
  elapsed: string;
  action: string;
  label: string;
}> = {
  waiting: {
    rail: "border-l-[#f59e0b]",
    elapsed: "border-amber-200 bg-[#fff7ea] text-amber-700",
    action: "bg-[#2f8fd3] text-white hover:bg-[#287fc0]",
    label: "Waiting",
  },
  consultation: {
    rail: "border-l-[#2f8fd3]",
    elapsed: "border-[#bfe0f5] bg-[#ecf6fd] text-[#2a6fa8]",
    action: "border border-[#bce8cd] bg-[#ecfaf1] text-[#16a34a] hover:bg-[#ddf6e7]",
    label: "In consultation",
  },
  done: {
    rail: "border-l-[#16a34a]",
    elapsed: "border-[#bce8cd] bg-[#ecfaf1] text-[#15803d]",
    action: "border border-[#bce8cd] bg-[#ecfaf1] text-[#16a34a] hover:bg-[#ddf6e7]",
    label: "Ready to bill",
  },
};

const avatarPalettes = [
  "from-amber-500 to-amber-300",
  "from-[#2f8fd3] to-[#57b0e6]",
  "from-violet-500 to-violet-400",
  "from-emerald-600 to-emerald-400",
  "from-rose-600 to-rose-400",
  "from-cyan-600 to-cyan-400",
];

function initialsForPatient(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
}

function avatarPaletteForPatient(patient: Patient) {
  const seed = [...patient.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return avatarPalettes[seed % avatarPalettes.length];
}

function formatRupees(value: number) {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatStageElapsed(stageEnteredAt: string, now: number) {
  const enteredAt = new Date(stageEnteredAt).getTime();
  if (!Number.isFinite(enteredAt)) return "Just now";
  const minutes = Math.max(0, Math.floor((now - enteredAt) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function patientChips(patient: Patient) {
  if (patient.status === "done") {
    const billing = patient.billing_summary;
    if (!billing) {
      return [patient.billing_estimate ? `Est. ${formatRupees(patient.billing_estimate.total)}` : "Estimate pending"];
    }
    const chips = [
      `${billing.item_count} item${billing.item_count === 1 ? "" : "s"}`,
      billing.medicine_count ? `${billing.medicine_count} medicine${billing.medicine_count === 1 ? "" : "s"}` : "Consultation",
      billing.payment_status.charAt(0).toUpperCase() + billing.payment_status.slice(1),
    ];
    return chips;
  }
  const chips = [patient.reason.trim()];
  if (patient.temperature !== null) chips.push(`${patient.temperature.toFixed(1)}°F`);
  if (patient.weight !== null) chips.push(`${patient.weight.toFixed(patient.weight % 1 ? 1 : 0)} kg`);
  if (patient.height !== null) chips.push(`${patient.height.toFixed(patient.height % 1 ? 1 : 0)} cm`);
  return chips.filter(Boolean).slice(0, 3);
}

const sexLabels = {
  female: "Female",
  male: "Male",
  other: "Other",
  intersex: "Other",
  prefer_not_to_say: "Other",
  unknown: "Other",
} as const satisfies Record<string, string>;

function patientMetadata(patient: Patient) {
  let resolvedAge = patient.age;
  if (resolvedAge === null && patient.date_of_birth) {
    const [year, month, day] = patient.date_of_birth.split("-").map(Number);
    if (year && month && day) {
      const today = new Date();
      resolvedAge = today.getFullYear() - year;
      if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) {
        resolvedAge -= 1;
      }
      resolvedAge = Math.max(resolvedAge, 0);
    }
  }
  const age = resolvedAge !== null ? `${resolvedAge}y` : "Age not recorded";
  return patient.sex_at_birth ? `${age} · ${sexLabels[patient.sex_at_birth]}` : age;
}

function visitContext(patient: Patient) {
  const visit = patient.current_visit;
  if (visit?.kind === "follow_up") {
    return "Follow-up";
  }
  if (visit?.source === "appointment" && visit.scheduled_for) {
    return `Appointment · ${new Date(visit.scheduled_for).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return "Walk-in";
}

function providerContext(patient: Patient) {
  return patient.assigned_doctor?.name ? `Dr: ${patient.assigned_doctor.name}` : "";
}

interface PatientCardProps {
  patient: Patient;
  onOpen: (patient: Patient) => void;
  onAdvance: (patient: Patient, next: PatientStatus) => void;
  onRemoveFromQueue: (patient: Patient) => void;
  onTogglePriority?: (patient: Patient) => void;
  onOpenBilling?: (patient: Patient) => void;
  onAssignDoctor?: (patient: Patient) => void;
  canAssignDoctor?: boolean;
  canAdvance?: boolean;
  now?: number;
  dragHandleProps?: {
    attributes?: HTMLAttributes<HTMLElement>;
    listeners?: HTMLAttributes<HTMLElement>;
    setActivatorNodeRef?: (node: HTMLElement | null) => void;
    disabled?: boolean;
  };
}

export function PatientCard({
  patient,
  onOpen,
  onAdvance,
  onRemoveFromQueue,
  onTogglePriority,
  onOpenBilling,
  onAssignDoctor,
  canAssignDoctor = false,
  canAdvance = true,
  now = Date.now(),
  dragHandleProps,
}: PatientCardProps) {
  const style = stageStyles[patient.status];
  const elapsed = formatStageElapsed(patient.stage_entered_at, now);
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(patient.stage_entered_at).getTime()) / 60000));
  const warningElapsed = patient.status === "waiting" && elapsedMinutes >= 30;
  const billing = patient.billing_summary;
  const badgeLabel = patient.status === "done"
    ? billing ? formatRupees(billing.total) : "Ready"
    : elapsed;
  const [profilePhotoObjectUrl, setProfilePhotoObjectUrl] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!patient.profile_photo_url) {
      setProfilePhotoObjectUrl("");
      return;
    }

    let active = true;
    let objectUrl = "";

    api.getPatientProfilePhoto(patient.id)
      .then((blob) => {
        if (!active) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setProfilePhotoObjectUrl(objectUrl);
      })
      .catch(() => {
        if (active) {
          setProfilePhotoObjectUrl("");
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [patient.id, patient.profile_photo_url, patient.profile_photo_updated_at]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    function closeMenu() {
      setContextMenu(null);
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [contextMenu]);

  return (
    <article
      ref={dragHandleProps?.setActivatorNodeRef}
      {...dragHandleProps?.attributes}
      {...dragHandleProps?.listeners}
      aria-label={`Drag ${patient.name}; open chart`}
      onClick={() => onOpen(patient)}
      onContextMenu={(event) => {
        if (!canAssignDoctor || !onAssignDoctor) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(patient);
        }
      }}
      className={`group relative w-full rounded-[16px] border border-l-4 border-[#dbe7ef] ${style.rail} bg-white px-3.5 py-3 text-left shadow-[0_6px_16px_rgba(64,131,181,0.07)] transition duration-200 hover:-translate-y-0.5 hover:border-[#9fc7e1] hover:shadow-[0_18px_36px_rgba(64,131,181,0.14)] ${
        patient.queue_priority === "urgent" ? "border-l-rose-600" : ""
      } ${dragHandleProps && !dragHandleProps.disabled ? "cursor-grab active:cursor-grabbing" : ""}`}
      tabIndex={0}
    >
      {contextMenu && canAssignDoctor && onAssignDoctor ? (
        <div
          className="fixed z-[120] w-52 rounded-xl border border-[#bfd7e8] bg-white p-1.5 shadow-[0_18px_44px_rgba(31,43,61,0.18)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setContextMenu(null);
              onAssignDoctor(patient);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-[#1f2b3d] transition hover:bg-[#edf5fa] hover:text-[#2a6fa8]"
          >
            <Stethoscope className="h-4 w-4" />
            Assign Doctor
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2.5">
        {dragHandleProps ? (
          <span className={`inline-flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-slate-400 transition ${
            dragHandleProps.disabled ? "opacity-35" : "group-hover:bg-[#edf5fa] group-hover:text-[#2a6fa8]"
          }`} aria-hidden="true">
            <GripVertical className="h-4 w-4" />
          </span>
        ) : null}
        {profilePhotoObjectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profilePhotoObjectUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${avatarPaletteForPatient(patient)} text-sm font-bold text-white`}>
            {initialsForPatient(patient.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold leading-5 tracking-[-0.01em] text-[#1f2b3d]">{patient.name}</h3>
          <p className="mt-0.5 truncate text-xs text-[#5b6b80]">
            {patientMetadata(patient)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {patient.queue_priority === "urgent" ? (
            <span className="rounded-md bg-rose-50 px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-rose-600">
              Urgent
            </span>
          ) : null}
          <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
            warningElapsed ? "border-amber-200 bg-[#fff7ea] text-amber-700" : style.elapsed
          }`}>
            {patient.status !== "done" ? <Clock3 className="h-3 w-3" /> : null} {badgeLabel}
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {providerContext(patient) ? (
          <span className="rounded-lg border border-[#c7d9e8] bg-[#f8fbfd] px-2 py-1 text-[11px] font-semibold text-[#45627c]">
            {providerContext(patient)}
          </span>
        ) : null}
        {patientChips(patient).map((chip, index) => (
          <span key={`${chip}-${index}`} className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
            patient.status === "done" && !patient.billing_summary && index === 0
              ? "border-[#bce8cd] bg-[#ecfaf1] text-[#15803d]"
              : patient.status === "done" && index === 2
              ? patient.billing_summary?.payment_status === "paid"
                ? "border-[#bce8cd] bg-[#ecfaf1] text-[#15803d]"
                : "border-amber-200 bg-[#fff7ea] text-amber-700"
              : index === 0 && patient.queue_priority === "urgent"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-[#dbe7ef] bg-[#f3f8fb] text-[#5b6b80]"
          }`}>
            {chip}
          </span>
        ))}
      </div>

      <footer className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-[#dbe7ef] pt-2.5">
        <span className="min-w-0 truncate text-xs text-[#5b6b80]">
          <b className="font-semibold text-[#1f2b3d]">
            {patient.status === "done" ? billing ? billing.payment_status === "paid" ? "Paid" : "Ready" : "Ready" : visitContext(patient)}
          </b>
          {patient.status === "done" ? (
            billing ? <span> · {billing.completed_at ? "invoice finalized" : "invoice drafted"}</span> : null
          ) : null}
        </span>
        <div className="flex shrink-0 gap-1.5">
          {onTogglePriority ? (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onTogglePriority(patient); }}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] border transition active:scale-95 ${
                patient.queue_priority === "urgent"
                  ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "border-[#dbe7ef] bg-[#f3f8fb] text-[#8595a8] hover:border-rose-200 hover:text-rose-600"
              }`}
              aria-label={`${patient.queue_priority === "urgent" ? "Remove urgent priority from" : "Mark urgent"} ${patient.name}`}
              title={patient.queue_priority === "urgent" ? "Remove urgent priority" : "Mark urgent"}
            >
              <Flag className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 active:scale-95"
            onClick={(event) => { event.stopPropagation(); onRemoveFromQueue(patient); }}
            aria-label={`Remove ${patient.name} from queue`}
            title="Remove from queue"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {patient.status === "consultation" && canAdvance ? (
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] transition active:scale-95 ${style.action}`}
              onClick={(event) => { event.stopPropagation(); onAdvance(patient, "done"); }}
              aria-label={`Send ${patient.name} to billing`}
              title="Send to billing"
            >
              <Check className="h-4 w-4" />
            </button>
          ) : null}
          {patient.status === "done" && onOpenBilling ? (
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] transition active:scale-95 ${style.action}`}
              onClick={(event) => { event.stopPropagation(); onOpenBilling(patient); }}
              aria-label={`Open billing for ${patient.name}`}
              title="Open billing"
            >
              <ReceiptIndianRupee className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] transition active:scale-95 ${style.action}`}
              onClick={(event) => { event.stopPropagation(); onOpen(patient); }}
              aria-label={`Open chart for ${patient.name}`}
              title="Open chart"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
