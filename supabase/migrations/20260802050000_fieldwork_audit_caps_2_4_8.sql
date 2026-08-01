-- Tighten forensic audit caps to real DIY usage: Starter 2 / Pro 4 / Campaign 8.

ALTER TABLE public.fieldwork_subscribers
  ALTER COLUMN audit_credits SET DEFAULT 4;

UPDATE public.fieldwork_subscribers
SET audit_credits = 2, updated_at = now()
WHERE plan_id = 'starter';

UPDATE public.fieldwork_subscribers
SET audit_credits = 4, updated_at = now()
WHERE plan_id = 'pro';

UPDATE public.fieldwork_subscribers
SET audit_credits = 8, updated_at = now()
WHERE plan_id = 'unlimited';
