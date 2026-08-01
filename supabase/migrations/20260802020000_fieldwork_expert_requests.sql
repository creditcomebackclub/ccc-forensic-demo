-- Fieldwork Campaign: live-expert queue with AI-prepared briefs.
-- Subscriber asks in chat → AI brief (account + concerns) → live agent picks up.

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

ALTER TABLE public.fieldwork_expert_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY fieldwork_expert_requests_select_own ON public.fieldwork_expert_requests
  FOR SELECT
  USING (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));

CREATE POLICY fieldwork_expert_requests_insert_own ON public.fieldwork_expert_requests
  FOR INSERT
  WITH CHECK (subscriber_id IN (SELECT id FROM public.fieldwork_subscribers WHERE user_id = auth.uid()));
