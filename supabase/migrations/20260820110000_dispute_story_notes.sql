-- Private staff-authored facts used to personalize a client's damages
-- paragraph. Values are AES-256-GCM ciphertext written only through the
-- server function; plaintext must never be selected directly in the app.
alter table public.client_sensitive_data
  add column if not exists dispute_story_notes text,
  add column if not exists dispute_story_notes_version text;

comment on column public.client_sensitive_data.dispute_story_notes is
  'Server-encrypted staff-only notes for personalized dispute damages rewrites.';

comment on column public.client_sensitive_data.dispute_story_notes_version is
  'Server-keyed note version used for atomic staff edit conflict detection.';
