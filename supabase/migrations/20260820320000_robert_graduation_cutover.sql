-- Owner-approved one-client cutover: Robert Kerstner's campaign is complete.
-- Preserve every historical audit, letter, deletion, payment, and portal record;
-- only stop new service work and mark the existing billing lifecycle graduated.

update public.clients
set engagement_status = 'graduated',
    engagement_status_changed_at = now(),
    billing_status = 'Graduated',
    exit_reason = 'graduated',
    status_changed_at = now()
where id = 'ea41862f-c22a-4acc-9455-8550556f907d'::uuid
  and lower(trim(name)) = 'robert kerstner';
