-- Fieldwork Campaign: capped expert chat messages per billing period.
-- Starter/Pro = 0, Campaign (unlimited) = 8.

ALTER TABLE public.fieldwork_subscribers
  ADD COLUMN IF NOT EXISTS expert_chat_credits integer NOT NULL DEFAULT 0
    CHECK (expert_chat_credits >= 0);

COMMENT ON COLUMN public.fieldwork_subscribers.expert_chat_credits IS
  'Remaining Campaign expert-chat user messages this billing period.';
