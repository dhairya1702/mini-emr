import type {
  BillingSuggestionsResponse,
  CatalogItem,
  CatalogItemType,
  ConsultationNote,
  Patient,
} from "@/lib/types";

export type DraftInvoiceItem = {
  id: string;
  catalog_item_id?: string | null;
  item_type: CatalogItemType;
  label: string;
  quantity: number;
  unit_price: number;
};

export function createDraftInvoiceItemId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function extractMedicineSuggestions(note: ConsultationNote | null, medicineItems: CatalogItem[]) {
  if (!note) {
    return [];
  }

  const noteText = `${note.snapshot_content || note.content || ""}`.trim();
  if (!noteText) {
    return [];
  }

  const normalizedText = noteText.toLowerCase();
  return medicineItems.filter((item) => normalizedText.includes(item.name.toLowerCase()));
}

export function extractStructuredPrescriptionItems(
  note: ConsultationNote | null,
  medicineItems: CatalogItem[],
  createId: () => string = createDraftInvoiceItemId,
): DraftInvoiceItem[] {
  if (!note) {
    return [];
  }

  const sourceText = `${note.snapshot_content || note.content || ""}`;
  const lines = sourceText.split("\n");
  const headerIndex = lines.findIndex((line) =>
    line.trim().toLowerCase() === "medicine | quantity | schedule | duration | notes",
  );
  if (headerIndex === -1) {
    return [];
  }

  const itemsByName = new Map(medicineItems.map((item) => [item.name.trim().toLowerCase(), item]));
  const structuredItems: DraftInvoiceItem[] = [];

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const rawLine = lines[index].trim();
    if (!rawLine || !rawLine.includes("|")) {
      break;
    }

    const columns = rawLine.split("|").map((column) => column.trim());
    if (columns.length < 2) {
      continue;
    }

    const label = columns[0];
    const quantityText = columns[1] || "1";
    const matchedMedicine = itemsByName.get(label.toLowerCase());
    if (!matchedMedicine) {
      continue;
    }

    const quantityMatch = quantityText.match(/(\d+(?:\.\d+)?)/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    structuredItems.push({
      id: createId(),
      catalog_item_id: matchedMedicine.id,
      item_type: matchedMedicine.item_type,
      label: matchedMedicine.name,
      quantity,
      unit_price: matchedMedicine.default_price,
    });
  }

  return structuredItems;
}

export function buildAutoDraftInvoiceItems(
  patient: Patient | null,
  note: ConsultationNote | null,
  serviceItems: CatalogItem[],
  medicineItems: CatalogItem[],
  suggestions: BillingSuggestionsResponse | null,
  createId: () => string = createDraftInvoiceItemId,
): DraftInvoiceItem[] {
  if (!patient) {
    return [];
  }

  if (suggestions) {
    return suggestions.suggestions
      .filter((suggestion) => suggestion.status === "auto_add")
      .map((suggestion) => suggestion.catalog_match
        ? {
            id: createId(),
            catalog_item_id: suggestion.catalog_match.catalog_item_id,
            item_type: suggestion.catalog_match.item_type,
            label: suggestion.catalog_match.label,
            quantity: suggestion.catalog_match.quantity,
            unit_price: suggestion.catalog_match.unit_price,
          }
        : {
            id: createId(),
            catalog_item_id: null,
            item_type: "service" as const,
            label: "Consultation",
            quantity: 1,
            unit_price: 0,
          });
  }

  const items: DraftInvoiceItem[] = [];
  const structuredMedicineItems = extractStructuredPrescriptionItems(note, medicineItems, createId);
  const consultationService = serviceItems.find((item) => /\bconsult/i.test(item.name)) ?? null;

  items.push(
    consultationService
      ? {
          id: createId(),
          catalog_item_id: consultationService.id,
          item_type: consultationService.item_type,
          label: consultationService.name,
          quantity: 1,
          unit_price: consultationService.default_price,
        }
      : {
          id: createId(),
          catalog_item_id: null,
          item_type: "service",
          label: "Consultation",
          quantity: 1,
          unit_price: 0,
        },
  );

  const medicinesToBill = structuredMedicineItems.length
    ? structuredMedicineItems
    : extractMedicineSuggestions(note, medicineItems).map((medicine) => ({
        id: createId(),
        catalog_item_id: medicine.id,
        item_type: medicine.item_type,
        label: medicine.name,
        quantity: 1,
        unit_price: medicine.default_price,
      }));

  for (const medicine of medicinesToBill) {
    items.push({ ...medicine });
  }

  return items;
}
