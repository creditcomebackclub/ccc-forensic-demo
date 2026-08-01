-- Align existing Campaign (unlimited) subscribers with current included credits.
-- Old rows may still have mail_credits=10 and expert_chat_credits=0 (column default).

UPDATE public.fieldwork_subscribers
SET
  mail_credits = 8,
  audit_credits = 25,
  expert_chat_credits = 8,
  updated_at = now()
WHERE plan_id = 'unlimited';
