-- Preserve the browser-confirmed booking history that predates the webhook
-- fields. The old marker proves the preparation email path ran; it does not
-- prove an appointment time, so leave the time and Calendly URIs null until a
-- future authoritative webhook supplies them.
update public.clients
set
  consultation_status = 'scheduled',
  tags = (
    select array_agg(distinct tag order by tag)
    from unnest(
      case
        when exists (
          select 1 from unnest(coalesce(clients.tags, '{}'::text[])) existing
          where existing in ('lead-stage:contacted', 'lead-stage:audit', 'lead-stage:ready')
        ) then coalesce(clients.tags, '{}'::text[]) || array['consultation:scheduled']::text[]
        else array_remove(coalesce(clients.tags, '{}'::text[]), 'lead-stage:new')
          || array['lead-stage:contacted', 'consultation:scheduled']::text[]
      end
    ) tag
  )
where status = 'lead'
  and consultation_status is null
  and coalesce(lead_drips_sent, '[]'::jsonb) ? 'consultation_booked_confirmation';
