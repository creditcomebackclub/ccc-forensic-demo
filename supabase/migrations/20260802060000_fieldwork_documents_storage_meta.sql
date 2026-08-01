-- Fieldwork evidence vault: size/type metadata + storage UPDATE for replace-in-place.
-- Bucket + base RLS already exist in 20260801000000_fieldwork_diy_isolated.sql.

ALTER TABLE public.fieldwork_documents
  ADD COLUMN IF NOT EXISTS byte_size bigint,
  ADD COLUMN IF NOT EXISTS content_type text;

-- Upsert / replace of Photo ID & proof of address needs UPDATE on storage.objects.
DROP POLICY IF EXISTS fieldwork_docs_update_own ON storage.objects;
CREATE POLICY fieldwork_docs_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fieldwork-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'fieldwork-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
