begin;

alter table public.catalog_items
  alter column default_price type numeric(14,2) using round(default_price::numeric, 2),
  alter column stock_quantity type numeric(14,3) using round(stock_quantity::numeric, 3),
  alter column low_stock_threshold type numeric(14,3) using round(low_stock_threshold::numeric, 3);

alter table public.invoices
  alter column subtotal type numeric(14,2) using round(subtotal::numeric, 2),
  alter column total type numeric(14,2) using round(total::numeric, 2),
  alter column amount_paid type numeric(14,2) using round(amount_paid::numeric, 2);

alter table public.invoice_items
  alter column quantity type numeric(14,3) using round(quantity::numeric, 3),
  alter column unit_price type numeric(14,2) using round(unit_price::numeric, 2),
  alter column line_total type numeric(14,2) using round(line_total::numeric, 2);

commit;
