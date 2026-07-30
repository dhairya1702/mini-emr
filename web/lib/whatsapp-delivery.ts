import { api } from "@/lib/api";
import type { WhatsAppDelivery } from "@/lib/types";

const TERMINAL_STATUSES = new Set(["delivered", "read", "failed"]);

function deliveryMessage(label: string, delivery: WhatsAppDelivery) {
  if (delivery.status === "failed") {
    return delivery.error || `${label} delivery failed. Retry when ready.`;
  }
  const status = delivery.status === "accepted" ? "accepted by WhatsApp" : delivery.status;
  return `${label} ${status} for ${delivery.recipient}.`;
}

export function trackWhatsAppDelivery(
  delivery: WhatsAppDelivery | null | undefined,
  label: string,
  onUpdate: (message: string, delivery: WhatsAppDelivery) => void,
): () => void {
  let cancelled = false;
  let timeoutId: number | null = null;
  const cancel = () => {
    cancelled = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  if (!delivery) {
    return cancel;
  }
  onUpdate(deliveryMessage(label, delivery), delivery);
  if (TERMINAL_STATUSES.has(delivery.status)) {
    return cancel;
  }

  let attempts = 0;
  const schedulePoll = () => {
    if (cancelled) {
      return;
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      void poll();
    }, 3000);
  };
  const poll = async () => {
    if (cancelled) {
      return;
    }
    attempts += 1;
    try {
      const latest = await api.getWhatsAppDocumentDelivery(delivery.document_type, delivery.document_id);
      if (cancelled) {
        return;
      }
      onUpdate(deliveryMessage(label, latest), latest);
      if (TERMINAL_STATUSES.has(latest.status) || attempts >= 20) {
        return;
      }
    } catch {
      if (cancelled || attempts >= 20) {
        return;
      }
    }
    schedulePoll();
  };
  schedulePoll();
  return cancel;
}
