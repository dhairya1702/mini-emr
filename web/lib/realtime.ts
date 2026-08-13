import { resolveApiUrl } from "@/lib/api";

export interface DashboardRealtimeEvent {
  org_id: string;
  changed: string[];
  queue_revision: string;
  check_in_revision: string;
  billing_patients_revision: string;
  billing_invoices_revision: string;
}

interface DashboardRealtimeHandlers {
  onOpen?: () => void;
  onDashboard: (event: DashboardRealtimeEvent) => void;
}

export function connectDashboardEvents(handlers: DashboardRealtimeHandlers) {
  if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
    return null;
  }

  const source = new EventSource(resolveApiUrl("/dashboard/events"), {
    withCredentials: true,
  });

  source.addEventListener("open", () => {
    handlers.onOpen?.();
  });

  source.addEventListener("ready", () => {
    handlers.onOpen?.();
  });

  source.addEventListener("dashboard", (message) => {
    try {
      const payload = JSON.parse((message as MessageEvent).data) as DashboardRealtimeEvent;
      if (Array.isArray(payload.changed)) {
        handlers.onDashboard(payload);
      }
    } catch {
      // Ignore malformed realtime events; fallback polling will reconcile.
    }
  });

  return source;
}
