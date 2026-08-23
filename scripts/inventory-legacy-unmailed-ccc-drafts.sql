-- Read-only release inventory for the reason-selection cutover.
-- Every returned draft remains readable, but must be rebuilt in Campaign
-- Studio before the hardened Lob function will allow physical mail.
with legacy_unmailed_ccc_drafts as (
  select
    letter.id,
    letter.user_id,
    letter.client_id,
    letter.client_name,
    letter.phase,
    letter.dispute_flow_code,
    letter.dispute_round_number,
    letter.dispute_bureau_code,
    letter.saved_at
  from public.letters letter
  where pg_catalog.coalesce(letter.phase, '') like 'CCC Dispute —%'
    and letter.lob_id is null
    and letter.mailed_date is null
    and (
      pg_catalog.coalesce(pg_catalog.jsonb_typeof(letter.dispute_account_snapshot), 'null') <> 'array'
      or pg_catalog.jsonb_array_length(
        case when pg_catalog.jsonb_typeof(letter.dispute_account_snapshot) = 'array'
          then letter.dispute_account_snapshot else '[]'::jsonb end
      ) = 0
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(letter.dispute_account_snapshot) = 'array'
            then letter.dispute_account_snapshot else '[]'::jsonb end
        ) snapshot(value)
        where snapshot.value->>'reasonSelectionVersion' is distinct from '1'
      )
    )
)
select
  pg_catalog.count(*) over () as total_legacy_unmailed_drafts,
  legacy_unmailed_ccc_drafts.*
from legacy_unmailed_ccc_drafts
order by saved_at, id;
