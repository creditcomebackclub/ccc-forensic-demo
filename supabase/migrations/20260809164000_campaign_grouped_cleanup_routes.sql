-- Cleanup routes can cover many selected personal-information and inquiry
-- findings while still producing one recipient-specific letter per bureau.
alter table public.campaign_letter_routes
  add column if not exists item_ids uuid[] not null default '{}';

update public.campaign_letter_routes
set item_ids = array[item_id]
where coalesce(cardinality(item_ids), 0) = 0;
