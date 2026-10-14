-- 0016: let an applicant see the files they uploaded (and lets upsert work, which needs SELECT).
-- Path convention is unchanged: <user id>/<application id>/<file>.
create policy "workshop docs: applicant reads own files"
  on storage.objects for select to authenticated
  using (bucket_id = 'workshop-docs' and (storage.foldername(name))[1] = auth.uid()::text);
