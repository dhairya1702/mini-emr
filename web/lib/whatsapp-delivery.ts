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
) {
  if (!delivery) {
    return;
  }
  onUpdate(deliveryMessage(label, delivery), delivery);
  if (TERMINAL_STATUSES.has(delivery.status)) {
    return;
  }

  let attempts = 0;
  const poll = async () => {
    attempts += 1;
    try {
      const latest = await api.getWhatsAppDocumentDelivery(delivery.document_type, delivery.document_id);
      onUpdate(deliveryMessage(label, latest), latest);
      if (TERMINAL_STATUSES.has(latest.status) || attempts >= 20) {
        return;
      }
    } catch {
      if (attempts >= 20) {
        return;
      }
    }
    window.setTimeout(() => void poll(), 3000);
  };
  window.setTimeout(() => void poll(), 3000);
}
