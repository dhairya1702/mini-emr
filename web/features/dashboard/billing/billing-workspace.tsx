"use client";

import { SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import {
  useBillingWorkflow,
  type BillingWorkflowGateway,
} from "@/features/dashboard/billing/use-billing-workflow";
import type { CatalogItem, Patient } from "@/lib/types";

type BillingWorkspaceProps = {
  patient: Patient;
  catalogItems: CatalogItem[];
  isCatalogLoaded: boolean;
  isCatalogLoading: boolean;
  loadCatalogItems: () => Promise<CatalogItem[]>;
  gateway: BillingWorkflowGateway;
  onCompleted: (patientId: string, options?: { refreshDashboard?: boolean }) => void | Promise<void>;
  onClose: () => void;
};

export function BillingWorkspace({
  patient,
  catalogItems,
  isCatalogLoaded,
  isCatalogLoading,
  loadCatalogItems,
  gateway,
  onCompleted,
  onClose,
}: BillingWorkspaceProps) {
  const workflow = useBillingWorkflow({
    patient,
    catalogItems,
    isCatalogLoaded,
    isCatalogLoading,
    loadCatalogItems,
    gateway,
    onCompleted,
  });

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/35 p-3 backdrop-blur-sm sm:p-5">
      <div className="mx-auto flex h-full max-h-[96vh] w-full max-w-[min(96vw,1560px)] flex-col overflow-hidden rounded-[20px] border border-[#dbe7ef] bg-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]">
        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
          <SettingsDrawerBillingPanel
            patients={[patient]}
            selectedBillingPatientId={patient.id}
            selectedBillingPatient={patient}
            showPatientSelector={false}
            serviceItems={workflow.serviceItems}
            medicineItems={workflow.medicineItems}
            invoiceItems={workflow.invoiceItems}
            invoiceSubtotal={workflow.invoiceTaxTotals.subtotal}
            invoiceTaxTotal={workflow.invoiceTaxTotals.taxTotal}
            invoiceCgstTotal={workflow.invoiceTaxTotals.cgstTotal}
            invoiceSgstTotal={workflow.invoiceTaxTotals.sgstTotal}
            invoiceTotal={workflow.invoiceTotal}
            amountPaid={workflow.normalizedAmountPaid}
            amountPaidInput={workflow.amountPaidInput}
            balanceDue={workflow.balanceDue}
            paymentStatus={workflow.paymentStatus}
            billingError={workflow.billingError}
            billingStatus={workflow.billingStatus}
            isSavingInvoice={workflow.isSavingInvoice}
            isFinalizingInvoice={workflow.isFinalizingInvoice}
            isPreparingInvoicePdf={workflow.isPreparingInvoicePdf}
            isSendingInvoice={workflow.isSendingInvoice}
            isSendingInvoiceWhatsApp={workflow.isSendingInvoiceWhatsApp}
            savedInvoice={workflow.savedInvoice}
            customItemLabel={workflow.customItemLabel}
            customItemQuantity={workflow.customItemQuantity}
            customItemUnitPrice={workflow.customItemUnitPrice}
            recipientEmail={workflow.recipientEmail}
            onSelectPatient={() => undefined}
            onAddCatalogItem={workflow.addCatalogItem}
            onCustomItemLabelChange={workflow.setCustomItemLabel}
            onCustomItemQuantityChange={workflow.setCustomItemQuantity}
            onCustomItemUnitPriceChange={workflow.setCustomItemUnitPrice}
            onRecipientEmailChange={workflow.updateRecipientEmail}
            onAddCustomItem={workflow.addCustomInvoiceItem}
            onUpdateInvoiceItem={workflow.updateInvoiceItem}
            onRemoveInvoiceItem={workflow.removeInvoiceItem}
            onCreateBill={workflow.createBill}
            onPaymentStatusChange={workflow.updatePaymentStatus}
            onAmountPaidChange={workflow.updateAmountPaid}
            onPreviewPdf={workflow.prepareInvoicePdf}
            onPrintInvoice={() => workflow.prepareInvoicePdf("print")}
            onFinalizeInvoice={workflow.finalizeInvoice}
            onSendInvoice={workflow.shareInvoice}
            onSendInvoiceWhatsApp={workflow.shareInvoiceWhatsApp}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
