-- Freeze the owner-confirmed Standard, VIP, and Paid In Full service scope in
-- every new v3 agreement snapshot before the template can receive approval.
--
-- Compatibility contract:
--   * Signed v1/v2 evidence is untouched.
--   * V3 remains counsel_review; this migration never approves or sends it.
--   * The immutable JSON plan snapshot carries the client-specific scope.
--   * This template copy only explains that the selected scope is part of the
--     agreement and controls over generic service language.

do $$
declare
  v_template public.service_agreement_templates%rowtype;
  v_old text := '<p>The Client''s selected plan appears in the versioned summary immediately before these terms. That summary identifies only this Client''s saved plan name, service term, monthly or flat service price, and exact fee terms. The summary is part of this Agreement and cannot be changed after the packet is prepared; later billing changes require a new agreement packet.</p>';
  v_new text := '<p>The Client''s selected plan appears in the versioned summary immediately before these terms. That summary identifies this Client''s saved plan name, service term, monthly or flat service price, exact fee terms, plan-specific included services, and correspondence limit. The summary is part of this Agreement and cannot be changed after the packet is prepared; later plan, scope, or billing changes require a new agreement packet.</p><p>Any correspondence quantity shown in the selected-plan summary is a maximum, not a guaranteed quantity. The reviewed file controls what work is appropriate. Priority handling, when included, applies only to Credit Comeback Club''s internal workflow and does not shorten any third-party response time. Funding-partner access or referral, when included, is subject to independent eligibility and underwriting and does not guarantee approval, amount, rate, terms, or timing.</p>';
  v_body text;
begin
  select * into v_template
  from public.service_agreement_templates
  where version = 'ccc-service-agreement-v3-no-first-work';

  if not found then
    raise exception 'The v3 service agreement is required before aligning selected-plan scope.';
  end if;
  if v_template.legal_status <> 'counsel_review' then
    raise exception 'The v3 service agreement must remain in counsel review while selected-plan scope is aligned.';
  end if;

  -- Production may already contain the reviewed replacement from a partial
  -- rollout even when this migration version is absent from the ledger. Treat
  -- that exact state as an idempotent success, but do not accept mixed copy.
  if position(v_new in v_template.body_html) > 0 then
    if position(v_old in v_template.body_html) > 0 then
      raise exception 'The v3 selected-plan section contains both legacy and aligned scope language.';
    end if;
    return;
  end if;

  v_body := replace(v_template.body_html, v_old, v_new);
  if v_body is not distinct from v_template.body_html then
    raise exception 'The v3 selected-plan paragraph no longer matches the reviewed scope-alignment contract.';
  end if;

  update public.service_agreement_templates
  set body_html = v_body,
      updated_at = current_timestamp
  where id = v_template.id
    and legal_status = 'counsel_review';

  if not found then
    raise exception 'The v3 service agreement changed before scope alignment completed.';
  end if;
end;
$$;

comment on table public.service_agreement_templates is
  'Versioned legal templates. V3 approval must occur only after its selected-plan summary and service-scope language receive counsel review.';
