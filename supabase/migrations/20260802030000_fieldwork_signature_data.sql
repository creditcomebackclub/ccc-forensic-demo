-- Fieldwork: persist drawn letter signature on the subscriber row.
-- Same pattern as CCC client_profiles.signature_data (PNG data URL).

ALTER TABLE public.fieldwork_subscribers
  ADD COLUMN IF NOT EXISTS signature_data text;

COMMENT ON COLUMN public.fieldwork_subscribers.signature_data IS
  'Drawn signature as PNG data URL for dispute letters.';
