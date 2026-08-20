-- Repair only unmailed campaign placeholders that hit the retired client-wide
-- numbering defect. The exact failure text and absence of any other round for
-- the account make this idempotent and prevent changes to established evidence.
create temp table campaign_first_round_repairs on commit drop as
select r.id
from public.dispute_rounds r
where r.campaign_id is not null
  and r.status = 'open'
  and r.round_number > 1
  and not exists (
    select 1
    from public.dispute_rounds prior
    where prior.user_id = r.user_id
      and prior.client_account_id = r.client_account_id
      and prior.id <> r.id
  )
  and exists (
    select 1
    from public.letters failed
    where failed.round_id = r.id
      and failed.campaign_route_id is not null
      and failed.mailed_date is null
      and failed.lob_id is null
      and failed.html = 'ERROR: A later-round letter requires reviewed prior-letter evidence.'
  )
  and not exists (
    select 1
    from public.letters unsafe
    where unsafe.round_id = r.id
      and (
        unsafe.mailed_date is not null
        or unsafe.lob_id is not null
        or unsafe.html is distinct from 'ERROR: A later-round letter requires reviewed prior-letter evidence.'
      )
  );

update public.letters letter
set round_number = 1,
    phase = 'Round 1 — ' || case
      when letter.target_type = 'bureau' then initcap(letter.target_bureau)
      else 'Furnisher'
    end
from campaign_first_round_repairs repair
where letter.round_id = repair.id;

update public.dispute_rounds round_record
set round_number = 1
from campaign_first_round_repairs repair
where round_record.id = repair.id;
