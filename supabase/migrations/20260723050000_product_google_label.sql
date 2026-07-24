alter table public.products
  add column if not exists google_label text;

comment on column public.products.google_label is 'Google Label';
