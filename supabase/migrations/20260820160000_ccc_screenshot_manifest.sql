alter table public.letters
  add column if not exists dispute_screenshot_manifest jsonb not null default '[]'::jsonb;

alter table public.letters
  drop constraint if exists letters_dispute_screenshot_manifest_array;

alter table public.letters
  add constraint letters_dispute_screenshot_manifest_array
  check (jsonb_typeof(dispute_screenshot_manifest) = 'array');

comment on column public.letters.dispute_screenshot_manifest is
  'Immutable private-storage manifest for staff-reviewed credit-report screenshots assigned to the exact accounts covered by this saved CCC letter.';
