-- 0014: private storage buckets. Supabase only (storage schema).
--
-- workshop-docs : applicant uploads (ID, shop photos). Applicants write into their own folder,
--                 only admins read.
-- invoices      : PDFs written by the billing worker (service role), read by the customer and
--                 the workshop named on the invoice.
-- models        : ML artifacts, service role only.

insert into storage.buckets (id, name, public) values
  ('workshop-docs', 'workshop-docs', false),
  ('invoices', 'invoices', false),
  ('models', 'models', false)
on conflict (id) do nothing;

-- path convention: <user id>/<application id>/<file>
create policy "workshop docs: applicant writes own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'workshop-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "workshop docs: applicant updates own files"
  on storage.objects for update to authenticated
  using (bucket_id = 'workshop-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "workshop docs: admin reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'workshop-docs' and public.is_admin());

-- path convention: <customer id>/<invoice no>.pdf
create policy "invoices: customer reads own"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "invoices: admin reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.is_admin());
