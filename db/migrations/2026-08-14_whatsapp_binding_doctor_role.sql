alter table public.whatsapp_owner_bindings
  drop constraint if exists whatsapp_owner_bindings_role_check;

alter table public.whatsapp_owner_bindings
  add constraint whatsapp_owner_bindings_role_check
  check (role in ('admin', 'owner', 'doctor', 'staff'));