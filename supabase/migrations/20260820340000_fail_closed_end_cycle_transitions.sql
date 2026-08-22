-- Fail closed at flow boundaries whose restart/switch rules are not yet
-- confirmed by the Skool source material or an explicit CCC owner decision.
-- Existing track rows and transition history are preserved. This replaces
-- only the pure state planner used by future outcome recordings.
-- Rollback, if an owner-confirmed rule supersedes these holds: replace this
-- function with a later migration. No row rollback or data rewrite is needed.

create or replace function public.ccc_compute_next_account_state(
  p_track public.ccc_account_tracks,
  p_outcome text,
  p_context jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_history jsonb := coalesce(p_track.used_native_rounds, '{}'::jsonb);
  v_next jsonb;
  v_join_round integer;
  v_deleted_side text;
begin
  if p_track.status in ('deleted', 'resolved') then
    raise exception 'Terminal CCC track cannot transition from %', p_track.status;
  end if;
  if p_outcome is null or p_outcome not in ('remains', 'deleted', 'resolved', 'combo_side_deleted') then
    raise exception 'Unsupported CCC transition outcome';
  end if;
  if p_track.status = 'pending' then
    return jsonb_build_object(
      'status', 'review_required', 'current_flow', p_track.current_flow,
      'current_round', p_track.current_round, 'cycle', p_track.cycle,
      'used_native_rounds', v_history, 'transition_code', 'review_required',
      'review_code', 'activation_required',
      'review_reason', 'This independent track has not reached its recorded activation condition.'
    );
  end if;
  v_history := public.ccc_record_current_law_coverage(p_track);
  if p_outcome in ('deleted', 'resolved') then
    return jsonb_build_object(
      'status', p_outcome, 'current_flow', p_track.current_flow,
      'current_round', p_track.current_round, 'cycle', p_track.cycle,
      'used_native_rounds', v_history, 'transition_code', p_outcome
    );
  end if;
  if p_outcome = 'combo_side_deleted' then
    if p_track.current_flow <> 'combo' then
      return jsonb_build_object(
        'status', 'review_required', 'current_flow', p_track.current_flow,
        'current_round', p_track.current_round, 'cycle', p_track.cycle,
        'used_native_rounds', v_history, 'transition_code', 'review_required',
        'review_code', 'invalid_combo_side_outcome',
        'review_reason', 'Combo-side deletion was reported for a non-Combo track.'
      );
    end if;
    v_deleted_side := lower(nullif(p_context->>'deleted_side', ''));
    v_next := public.ccc_resolve_combo_side_transition(p_track.method_version, v_history, v_deleted_side);
    if v_next is null then
      return jsonb_build_object(
        'status', 'review_required', 'current_flow', p_track.current_flow,
        'current_round', p_track.current_round, 'cycle', p_track.cycle,
        'used_native_rounds', v_history, 'transition_code', 'review_required',
        'review_code', 'combo_native_history_exhausted_or_invalid',
        'review_reason', 'The next unused native law could not be resolved from the immutable Combo history.'
      );
    end if;
    return jsonb_build_object(
      'status', 'active', 'current_flow', v_next->>'flow',
      'current_round', (v_next->>'round')::integer, 'cycle', p_track.cycle,
      'used_native_rounds', v_history, 'transition_code', 'combo_side_switch',
      'rule_provenance', v_next->>'rule_provenance'
    );
  end if;
  if p_track.current_flow = 'repo' then
    if p_track.current_round < 3 then
      return jsonb_build_object('status','active','current_flow','repo','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    if p_track.path_role = 'repo_companion' then
      return jsonb_build_object('status','active','current_flow','collection','current_round',4,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','repo_companion_to_collection');
    end if;
    if p_track.path_role = 'repo_primary' then
      v_join_round := coalesce(nullif(p_context->>'verified_accuracy_join_round','')::integer, 1);
      if v_join_round not between 1 and 12 then
        return jsonb_build_object('status','review_required','current_flow','repo','current_round',3,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','invalid_accuracy_join_round','review_reason','The verified Accuracy join round is invalid.');
      end if;
      return jsonb_build_object('status','active','current_flow','accuracy','current_round',v_join_round,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code',case when v_join_round=1 then 'repo_to_accuracy_r1' else 'repo_join_accuracy' end);
    end if;
    return jsonb_build_object('status','review_required','current_flow','repo','current_round',3,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','invalid_repo_path_role','review_reason','Repo flow is missing its primary or companion role.');
  end if;
  if p_track.current_flow = 'collection' then
    if p_track.current_round < 10 then
      return jsonb_build_object('status','active','current_flow','collection','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','review_required','current_flow','collection','current_round',10,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','collection_end_cycle_unconfirmed','review_reason','Collection R10 is complete. The course/owner restart rule is not confirmed.');
  end if;
  if p_track.current_flow = 'combo' then
    if p_track.current_round < 12 then
      return jsonb_build_object('status','active','current_flow','combo','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','review_required','current_flow','combo','current_round',12,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','combo_end_cycle_unconfirmed','review_reason','Combo R12 is complete. The course/owner restart rule is not confirmed.');
  end if;
  if p_track.current_flow = 'accuracy' then
    if p_track.current_round < 12 then
      return jsonb_build_object('status','active','current_flow','accuracy','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','review_required','current_flow','accuracy','current_round',12,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','accuracy_end_cycle_unconfirmed','review_reason','Accuracy R12 is complete. No owner-confirmed automatic restart or flow switch exists.');
  end if;
  if p_track.current_flow = 'late_pay' then
    if p_track.current_round = 1 then
      return jsonb_build_object('status','active','current_flow','late_pay','current_round',2,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','active','current_flow','accuracy','current_round',1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','late_pay_to_accuracy');
  end if;
  if p_track.current_flow = 'consent' then
    if p_track.current_round < 3 then
      return jsonb_build_object('status','active','current_flow','consent','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    if p_track.account_kind = 'collection' then
      return jsonb_build_object('status','active','current_flow','collection','current_round',1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','consent_to_collection');
    end if;
    if p_track.account_kind in ('charge_off','late_payment') then
      return jsonb_build_object('status','active','current_flow','accuracy','current_round',1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','consent_to_accuracy');
    end if;
    return jsonb_build_object('status','review_required','current_flow','consent','current_round',3,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','consent_account_kind_unconfirmed','review_reason','Consent R3 has no owner-confirmed switch for this account kind.');
  end if;
  if p_track.current_flow = 'accuracy_solo' then
    return jsonb_build_object('status','review_required','current_flow','accuracy_solo','current_round',p_track.current_round,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','accuracy_solo_extension_unconfirmed','review_reason','Accuracy Solo has no owner-confirmed automatic next step.');
  end if;
  if p_track.current_flow = 'direct' then
    return jsonb_build_object('status','review_required','current_flow','direct','current_round',p_track.current_round,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','direct_extension_unconfirmed','review_reason','Direct R1 is independent; automatic advancement is not confirmed by the supplied course material.','rule_provenance','direct_extension_pending_owner_confirmation');
  end if;
  return jsonb_build_object('status','review_required','current_flow',p_track.current_flow,'current_round',p_track.current_round,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','flow_transition_unconfirmed','review_reason','No confirmed transition exists for this flow.');
end;
$$;
