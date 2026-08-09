-- Keep new client campaigns continuous with any adaptive dispute rounds that
-- predate the command center. The original campaign migration also contains
-- this definition for clean installs; this follow-up applies it to databases
-- where that migration was already deployed.
create or replace function public.set_client_campaign_round_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_max integer;
  v_dispute_max integer;
begin
  if new.stage = 'legacy' then return new; end if;
  select coalesce(max(round_number), 0) into v_campaign_max
  from public.client_campaigns
  where user_id = new.user_id and client_id = new.client_id and stage <> 'legacy';
  select coalesce(max(round_number), 0) into v_dispute_max
  from public.dispute_rounds
  where user_id = new.user_id and client_id = new.client_id;
  new.round_number := greatest(v_campaign_max, v_dispute_max) + 1;
  return new;
end;
$$;

drop trigger if exists set_client_campaign_round_number on public.client_campaigns;
create trigger set_client_campaign_round_number
before insert on public.client_campaigns
for each row execute function public.set_client_campaign_round_number();
