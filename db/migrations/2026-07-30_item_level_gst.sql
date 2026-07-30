begin;

alter table public.clinic_settings
  add column if not exists gstin text not null default '';

alter table public.catalog_items
  add column if not exists hsn_sac_code text not null default '';

alter table public.catalog_items
  add column if not exists gst_rate numeric(5,2);

alter table public.catalog_items
  drop constraint if exists catalog_items_gst_pair_check;

alter table public.catalog_items
  add constraint catalog_items_gst_pair_check check (
    (btrim(hsn_sac_code) = '' and gst_rate is null)
    or (btrim(hsn_sac_code) <> '' and gst_rate > 0 and gst_rate <= 100)
  );

alter table public.invoices
  add column if not exists tax_total numeric(14,2) not null default 0;

alter table public.invoices
  add column if not exists cgst_total numeric(14,2) not null default 0;

alter table public.invoices
  add column if not exists sgst_total numeric(14,2) not null default 0;

alter table public.invoices
  add column if not exists supplier_gstin text not null default '';

alter table public.invoice_items
  add column if not exists hsn_sac_code text not null default '';

alter table public.invoice_items
  add column if not exists gst_rate numeric(5,2);

alter table public.invoice_items
  add column if not exists taxable_value numeric(14,2) not null default 0;

alter table public.invoice_items
  add column if not exists tax_amount numeric(14,2) not null default 0;

alter table public.invoice_items
  add column if not exists cgst_amount numeric(14,2) not null default 0;

alter table public.invoice_items
  add column if not exists sgst_amount numeric(14,2) not null default 0;

commit;
