-- Legacy campaign rows are internal references created per historical
-- dispute-round record. Their synthetic sequence can overlap the client's
-- actual next round number and must not block a new command-center campaign.
-- Real (non-legacy) campaign rounds remain unique.
alter table public.client_campaigns
  drop constraint if exists client_campaigns_user_id_client_id_round_number_key;

create unique index if not exists client_campaigns_round_uidx
  on public.client_campaigns (user_id, client_id, round_number)
  where stage <> 'legacy';
