import type { PatientStatus } from "@/lib/types";

export type QueueOrder = Record<PatientStatus, string[]>;

export function createEmptyQueueOrder(): QueueOrder {
  return {
    waiting: [],
    consultation: [],
    done: [],
  };
}

export function uniquePatientIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function reorderQueueColumn(
  order: QueueOrder,
  status: PatientStatus,
  activeId: string,
  overId: string,
): QueueOrder {
  const currentIds = uniquePatientIds(order[status]);
  const activeIndex = currentIds.indexOf(activeId);
  const overIndex = currentIds.indexOf(overId);

  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return order;
  }

  const nextIds = [...currentIds];
  const [movedId] = nextIds.splice(activeIndex, 1);
  nextIds.splice(overIndex, 0, movedId);

  return {
    ...order,
    [status]: nextIds,
  };
}

export function movePatientBetweenQueueColumns(
  order: QueueOrder,
  fromStatus: PatientStatus,
  toStatus: PatientStatus,
  patientId: string,
  overId?: string,
): QueueOrder {
  if (fromStatus === toStatus) {
    return order;
  }

  const nextSource = uniquePatientIds(order[fromStatus]).filter((id) => id !== patientId);
  const nextTarget = uniquePatientIds(order[toStatus]).filter((id) => id !== patientId);
  const overIndex = overId ? nextTarget.indexOf(overId) : -1;
  const insertIndex = overIndex >= 0 ? overIndex : nextTarget.length;

  nextTarget.splice(insertIndex, 0, patientId);

  return {
    ...order,
    [fromStatus]: nextSource,
    [toStatus]: nextTarget,
  };
}

export function canMovePatientStatus(
  role: "admin" | "staff" | undefined,
  fromStatus: PatientStatus,
  toStatus: PatientStatus,
): boolean {
  if (fromStatus === toStatus) {
    return true;
  }
  if (role !== "admin") {
    return false;
  }
  return (
    (fromStatus === "waiting" && toStatus === "consultation") ||
    (fromStatus === "consultation" && toStatus === "done")
  );
}
