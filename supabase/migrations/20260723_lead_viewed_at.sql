-- Leads sidebar badge fix. getNewLeadsCount() previously counted clients
-- with status = 'lead' created in the last 48 hours — a rolling time
-- window, not a read/unread tracker, so opening a lead card had no way to
-- clear it. Adds a real "viewed" timestamp so the badge behaves like an
-- actual notification: it clears the moment staff open the lead, regardless
-- of the 48h window, and stays cleared until a genuinely new lead arrives.
alter table public.clients add column if not exists lead_viewed_at timestamptz;
