-- Fieldwork: monthly forensic audit caps per plan.
-- Starter 3 / Pro 10 / Campaign (unlimited) 25 — enforced at enqueue + client.

ALTER TABLE public.fieldwork_subscribers
  ADD COLUMN IF NOT EXISTS audit_credits integer NOT NULL DEFAULT 10
    CHECK (audit_credits >= 0);

-- Align mail default with Pro included credits (was a leftover 12).
ALTER TABLE public.fieldwork_subscribers
  ALTER COLUMN mail_credits SET DEFAULT 5;

COMMENT ON COLUMN public.fieldwork_subscribers.audit_credits IS
  'Remaining forensic audit runs this billing period (plan-capped).';
