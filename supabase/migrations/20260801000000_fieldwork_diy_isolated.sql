-- Fieldwork DIY SaaS — ISOLATED schema.
-- Creates ONLY new fieldwork_* objects. Does not ALTER, DROP, or policy-touch
-- any existing CCC agency tables (clients, audits, letters, profiles, etc.).
-- Safe to apply alongside the Forensic Suite; Fieldwork data never joins CCC CRM.

-- ---------------------------------------------------------------------------
-- Subscribers (DIY users). Linked to auth.users when a Fieldwork Supabase
-- project (or shared project) is used. Agency `profiles` / `client_profiles`
-- are intentionally NOT referenced.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fieldwork_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  address_line1 text NOT NULL DEFAULT '',
  address_city text NOT NULL DEFAULT '',
  address_state text NOT NULL DEFAULT '',
  address_zip text NOT NULL DEFAULT '',
  plan_id text NOT NULL DEFAULT 'pro'
    CHECK (plan_id IN ('starter', 'pro', 'unlimited')),
  mail_credits integer NOT NULL DEFAULT 5 CHECK (mail_credits >= 0),
  audit_credits integer NOT NULL DEFAULT 10 CHECK (audit_credits >= 0),
  expert_chat_credits integer NOT NULL DEFAULT 0 CHECK (expert_chat_credits >= 0),
  stripe_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fieldwork_subscribers_email_idx
  ON public.fieldwork_subscribers (email);

-- ---------------------------------------------------------------------------
-- Campaigns / audits / letters — Fieldwork-owned copies of the funnel.
-- JSON payloads mirror the DIY demo shapes; production AI writes here only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fieldwork_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.fieldwork_subscribers (id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Furnisher wave',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'auditing', 'ready', 'mailing', 'in_flight', 'closed')),
  audit_json jsonb,
  selected_account_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fieldwork_campaigns_subscriber_idx
  ON public.fieldwork_campaigns (subscriber_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.fieldwork_audit_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.fieldwork_subscribers (id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.fieldwork_campaigns (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'error')),
  progress text,
  error text,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fieldwork_audit_jobs_subscriber_idx
  ON public.fieldwork_audit_jobs (subscriber_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.fieldwork_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.fieldwork_subscribers (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.fieldwork_campaigns (id) ON DELETE CASCADE,
  furnisher text NOT NULL,
  account_ref text,
  body_text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'accepted', 'in_transit', 'delivered', 'failed')),
  lob_id text,
  tracking_number text,
  mailed_at timestamptz,
  credit_charged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fieldwork_letters_campaign_idx
  ON public.fieldwork_letters (campaign_id);

CREATE TABLE IF NOT EXISTS public.fieldwork_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.fieldwork_subscribers (id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Live-expert queue: AI brief (account + concerns) forwarded for human pickup.
CREATE TABLE IF NOT EXISTS public.fieldwork_expert_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.fieldwork_subscribers (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'replied', 'closed')),
  concern text NOT NULL DEFAULT '',
  account_focus text NOT NULL DEFAULT '',
  subscriber_summary text NOT NULL DEFAULT '',
  ai_brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  transcript_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_reply text,
  claimed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fieldwork_expert_requests_queue_idx
  ON public.fieldwork_expert_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS fieldwork_expert_requests_subscriber_idx
  ON public.fieldwork_expert_requests (subscriber_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.fieldwork_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL REFERENCES public.fieldwork_subscribers (id) ON DELETE CASCADE,
  label text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'demo',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Isolated storage bucket for DIY uploads (not `documents` / `client-docs`).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('fieldwork-docs', 'fieldwork-docs', false, 15728640)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS — subscribers only see their own Fieldwork rows. CCC staff roles are
-- NOT granted access here (agency suite stays separate).
-- ---------------------------------------------------------------------------
ALTER TABLE public.fieldwork_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fieldwork_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fieldwork_audit_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fieldwork_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fieldwork_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fieldwork_billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fieldwork_expert_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY fieldwork_subscribers_select_own ON public.fieldwork_subscribers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY fieldwork_subscribers_update_own ON public.fieldwork_subscribers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY fieldwork_subscribers_insert_own ON public.fieldwork_subscribers
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY fieldwork_campaigns_own ON public.fieldwork_campaigns
  FOR ALL TO authenticated
  USING (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()))
  WITH CHECK (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

CREATE POLICY fieldwork_audit_jobs_own ON public.fieldwork_audit_jobs
  FOR ALL TO authenticated
  USING (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()))
  WITH CHECK (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

CREATE POLICY fieldwork_letters_own ON public.fieldwork_letters
  FOR ALL TO authenticated
  USING (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()))
  WITH CHECK (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

CREATE POLICY fieldwork_documents_own ON public.fieldwork_documents
  FOR ALL TO authenticated
  USING (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()))
  WITH CHECK (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

CREATE POLICY fieldwork_billing_own ON public.fieldwork_billing_events
  FOR SELECT TO authenticated
  USING (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

CREATE POLICY fieldwork_expert_requests_select_own ON public.fieldwork_expert_requests
  FOR SELECT TO authenticated
  USING (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

CREATE POLICY fieldwork_expert_requests_insert_own ON public.fieldwork_expert_requests
  FOR INSERT TO authenticated
  WITH CHECK (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

-- Storage: only under fieldwork-docs/{auth.uid()}/...
CREATE POLICY fieldwork_docs_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'fieldwork-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY fieldwork_docs_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fieldwork-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY fieldwork_docs_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'fieldwork-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
