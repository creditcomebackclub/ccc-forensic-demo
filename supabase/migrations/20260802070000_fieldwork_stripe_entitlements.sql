-- Stripe entitlement hardening for Fieldwork.
-- 1) Adds subscription metadata fields.
-- 2) Prevents authenticated clients from directly mutating plan/credit/stripe columns.

ALTER TABLE public.fieldwork_subscribers
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_status text,
  ADD COLUMN IF NOT EXISTS stripe_current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_latest_invoice_id text,
  ADD COLUMN IF NOT EXISTS stripe_latest_event_id text,
  ADD COLUMN IF NOT EXISTS credits_reset_at timestamptz DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS fieldwork_subscribers_stripe_customer_uidx
  ON public.fieldwork_subscribers (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fieldwork_subscribers_stripe_subscription_uidx
  ON public.fieldwork_subscribers (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fieldwork_guard_subscriber_entitlements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- Service role/webhook/admin writes are allowed.
  IF jwt_role IS NULL OR jwt_role = '' OR jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Authenticated clients can update identity/profile fields only.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id
      OR NEW.mail_credits IS DISTINCT FROM OLD.mail_credits
      OR NEW.audit_credits IS DISTINCT FROM OLD.audit_credits
      OR NEW.expert_chat_credits IS DISTINCT FROM OLD.expert_chat_credits
      OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
      OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
      OR NEW.stripe_price_id IS DISTINCT FROM OLD.stripe_price_id
      OR NEW.stripe_subscription_status IS DISTINCT FROM OLD.stripe_subscription_status
      OR NEW.stripe_current_period_end IS DISTINCT FROM OLD.stripe_current_period_end
      OR NEW.stripe_latest_invoice_id IS DISTINCT FROM OLD.stripe_latest_invoice_id
      OR NEW.stripe_latest_event_id IS DISTINCT FROM OLD.stripe_latest_event_id
      OR NEW.credits_reset_at IS DISTINCT FROM OLD.credits_reset_at
    THEN
      RAISE EXCEPTION 'Plan, credit, and Stripe entitlement fields are server-managed only.';
    END IF;
  END IF;

  -- Client inserts must start on default demo/pro allocation.
  IF TG_OP = 'INSERT' THEN
    IF NEW.plan_id IS DISTINCT FROM 'pro'
      OR NEW.mail_credits IS DISTINCT FROM 5
      OR NEW.audit_credits IS DISTINCT FROM 4
      OR NEW.expert_chat_credits IS DISTINCT FROM 0
      OR NEW.stripe_customer_id IS NOT NULL
      OR NEW.stripe_subscription_id IS NOT NULL
      OR NEW.stripe_price_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'Subscriber insert must use default server-managed entitlement values.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fieldwork_guard_subscriber_entitlements
  ON public.fieldwork_subscribers;

CREATE TRIGGER trg_fieldwork_guard_subscriber_entitlements
BEFORE INSERT OR UPDATE ON public.fieldwork_subscribers
FOR EACH ROW
EXECUTE FUNCTION public.fieldwork_guard_subscriber_entitlements();
