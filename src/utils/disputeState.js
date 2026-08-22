export const CCC_METHOD_VERSION = 'ccc_skool_2026_v1';

export const CCC_ACCOUNT_TRACK_STATUSES = Object.freeze([
  'pending',
  'active',
  'review_required',
  'deleted',
  'resolved',
]);

export const CCC_ACCOUNT_PATH_ROLES = Object.freeze([
  'standard',
  'repo_primary',
  'repo_companion',
]);

export const CCC_ACCOUNT_TRANSITION_OUTCOMES = Object.freeze([
  'remains',
  'deleted',
  'resolved',
  'combo_side_deleted',
]);

export const COMBO_SPLIT_RULE_PROVENANCE = 'owner_confirmed_next_unused_native_v1_2026_08_20';

// Each Combo round records the native laws actually used. A split advances the
// surviving side to its first unused native law instead of copying the Combo
// number and accidentally skipping side-specific laws.
export const COMBO_NATIVE_LAW_COVERAGE = Object.freeze({
  1: Object.freeze({ accuracy: 1, collection: 1 }),
  2: Object.freeze({ accuracy: 2, collection: 2 }),
  3: Object.freeze({ accuracy: 3, collection: 3 }),
  4: Object.freeze({ accuracy: 4, collection: 4 }),
  5: Object.freeze({ accuracy: 5 }),
  6: Object.freeze({ accuracy: 6 }),
  7: Object.freeze({ accuracy: 7 }),
  8: Object.freeze({ accuracy: 8, collection: 5 }),
  9: Object.freeze({ accuracy: 9, collection: 6 }),
  10: Object.freeze({ accuracy: 10, collection: 7 }),
  11: Object.freeze({ accuracy: 11, collection: 8 }),
  12: Object.freeze({ accuracy: 12 }),
});

export const CONCRETE_TEMPLATE_ALIASES = Object.freeze({
  'combo:5': Object.freeze({ flow: 'accuracy', round: 5 }),
  'combo:6': Object.freeze({ flow: 'accuracy', round: 6 }),
  'combo:7': Object.freeze({ flow: 'accuracy', round: 7 }),
  'late_pay:2': Object.freeze({ flow: 'consent', round: 2 }),
  'repo:1': Object.freeze({ flow: 'collection', round: 1 }),
  'repo:2': Object.freeze({ flow: 'collection', round: 2 }),
  'repo:3': Object.freeze({ flow: 'collection', round: 6 }),
});

const FLOW_MAX_ROUND = Object.freeze({
  accuracy: 12,
  collection: 10,
  combo: 12,
  consent: 3,
  late_pay: 2,
  repo: 3,
  accuracy_solo: 1,
  direct: 2,
});

const KIND_ALIASES = Object.freeze({
  chargeoff: 'charge_off',
  charged_off: 'charge_off',
  collection_account: 'collection',
  debt_collection: 'collection',
  late: 'late_payment',
  repo: 'repossession',
});

function normalizedKind(value) {
  const key = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return KIND_ALIASES[key] || key;
}

function normalizedTrack(track) {
  const {
    account_kind: _accountKind,
    native_flow: _nativeFlow,
    current_flow: _currentFlow,
    current_round: _currentRound,
    path_role: _pathRole,
    method_version: _methodVersion,
    used_native_rounds: _usedNativeRounds,
    ...rest
  } = track || {};
  return {
    ...rest,
    methodVersion: track?.methodVersion ?? track?.method_version,
    accountKind: normalizedKind(track?.accountKind ?? track?.account_kind),
    nativeFlow: track?.nativeFlow ?? track?.native_flow,
    currentFlow: track?.currentFlow ?? track?.current_flow,
    currentRound: Number(track?.currentRound ?? track?.current_round),
    pathRole: track?.pathRole ?? track?.path_role ?? 'standard',
    status: track?.status ?? 'active',
    cycle: Number(track?.cycle ?? 1),
    revision: Number(track?.revision ?? 0),
    usedNativeRounds: Object.fromEntries(Object.entries(
      track?.usedNativeRounds ?? track?.used_native_rounds ?? {},
    ).map(([flow, rounds]) => [flow, [...new Set((Array.isArray(rounds) ? rounds : []).map(Number))].sort((a, b) => a - b)])),
  };
}

function validateTrack(track) {
  if (!FLOW_MAX_ROUND[track.currentFlow]) throw new Error(`Unknown CCC logical flow: ${track.currentFlow}`);
  if (!Number.isInteger(track.currentRound) || track.currentRound < 1 || track.currentRound > FLOW_MAX_ROUND[track.currentFlow]) {
    throw new Error(`Invalid ${track.currentFlow} logical round: ${track.currentRound}`);
  }
  if (!CCC_ACCOUNT_PATH_ROLES.includes(track.pathRole)) throw new Error(`Unknown CCC path role: ${track.pathRole}`);
  if (!CCC_ACCOUNT_TRACK_STATUSES.includes(track.status)) throw new Error(`Unknown CCC track status: ${track.status}`);
  if (!Number.isInteger(track.cycle) || track.cycle < 1) throw new Error('CCC track cycle must be a positive integer.');
  if (!Number.isInteger(track.revision) || track.revision < 0) throw new Error('CCC track revision must be a non-negative integer.');
}

export function concreteTemplateStep(flowOrState, maybeRound) {
  const flow = typeof flowOrState === 'object'
    ? flowOrState?.currentFlow ?? flowOrState?.current_flow ?? flowOrState?.flow
    : flowOrState;
  const round = Number(typeof flowOrState === 'object'
    ? flowOrState?.currentRound ?? flowOrState?.current_round ?? flowOrState?.round
    : maybeRound);
  return CONCRETE_TEMPLATE_ALIASES[`${flow}:${round}`] || { flow, round };
}

function withUsedRound(history, flow, round) {
  if (!flow || !Number.isInteger(Number(round))) return history;
  const current = Array.isArray(history?.[flow]) ? history[flow] : [];
  return {
    ...history,
    [flow]: [...new Set([...current, Number(round)])].sort((a, b) => a - b),
  };
}

export function recordCurrentNativeLawCoverage(track) {
  const state = normalizedTrack(track);
  let history = state.usedNativeRounds;
  if (state.currentFlow === 'combo') {
    const coverage = COMBO_NATIVE_LAW_COVERAGE[state.currentRound] || {};
    for (const [flow, round] of Object.entries(coverage)) history = withUsedRound(history, flow, round);
  } else if (state.currentFlow === 'repo') {
    history = withUsedRound(history, 'collection', CONCRETE_TEMPLATE_ALIASES[`repo:${state.currentRound}`]?.round);
  } else {
    history = withUsedRound(history, state.currentFlow, state.currentRound);
  }
  return history;
}

export function comboSideDeletionTransition(track, deletedSide) {
  const state = normalizedTrack(track);
  const side = normalizedKind(deletedSide);
  const survivingFlow = side === 'accuracy' ? 'collection' : side === 'collection' ? 'accuracy' : null;
  if (!survivingFlow) return null;
  const usedNativeRounds = recordCurrentNativeLawCoverage(state);
  const used = new Set(usedNativeRounds[survivingFlow] || []);
  const nextRound = Array.from(
    { length: FLOW_MAX_ROUND[survivingFlow] },
    (_, index) => index + 1,
  ).find((round) => !used.has(round));
  if (!nextRound) return null;
  return {
    flow: survivingFlow,
    round: nextRound,
    incrementCycle: 0,
    usedNativeRounds,
    provenance: COMBO_SPLIT_RULE_PROVENANCE,
  };
}

function nextResult(state, patch, transitionCode) {
  const next = {
    ...state,
    ...patch,
    revision: state.revision + 1,
    transitionCode,
  };
  next.template = concreteTemplateStep(next);
  return next;
}

function reviewRequired(state, reason, reviewCode) {
  return nextResult(state, {
    status: 'review_required',
    reviewCode,
    reason,
  }, 'review_required');
}

/**
 * Compute the next server-authoritative state without mutating the input.
 * The database RPC mirrors this function and owns persistence/revision checks.
 */
export function transitionDisputeState(track, transition = {}) {
  const state = normalizedTrack(track);
  validateTrack(state);
  if (state.status === 'deleted' || state.status === 'resolved') {
    throw new Error(`Terminal CCC track cannot transition from ${state.status}.`);
  }
  if (state.status === 'pending') {
    return reviewRequired(
      state,
      'This independent track has not reached its recorded activation condition.',
      'activation_required',
    );
  }
  state.usedNativeRounds = recordCurrentNativeLawCoverage(state);

  const outcome = String(transition.outcome || 'remains').toLowerCase();
  if (!CCC_ACCOUNT_TRANSITION_OUTCOMES.includes(outcome)) {
    throw new Error(`Unknown CCC transition outcome: ${outcome}`);
  }
  if (outcome === 'deleted' || outcome === 'resolved') {
    return nextResult(state, { status: outcome }, outcome);
  }

  if (state.currentFlow === 'combo' && outcome === 'combo_side_deleted') {
    const mapping = comboSideDeletionTransition(state, transition.deletedSide);
    if (!mapping) {
      return reviewRequired(
        state,
        'The next unused native law could not be resolved from the immutable Combo history. No next letter may be selected automatically.',
        'combo_native_history_exhausted_or_invalid',
      );
    }
    return nextResult(state, {
      status: 'active',
      currentFlow: mapping.flow,
      currentRound: mapping.round,
      cycle: state.cycle + Number(mapping.incrementCycle || 0),
      usedNativeRounds: mapping.usedNativeRounds,
      ruleProvenance: mapping.provenance,
      reviewCode: null,
      reason: null,
    }, 'combo_side_switch');
  }
  if (outcome === 'combo_side_deleted') {
    return reviewRequired(state, 'Combo-side deletion was reported for a non-Combo track.', 'invalid_combo_side_outcome');
  }

  if (state.currentFlow === 'repo') {
    if (state.currentRound < 3) {
      return nextResult(state, {
        status: 'active',
        currentRound: state.currentRound + 1,
        reviewCode: null,
        reason: null,
      }, 'advance');
    }
    if (state.pathRole === 'repo_companion') {
      return nextResult(state, {
        status: 'active',
        currentFlow: 'collection',
        currentRound: 4,
        reviewCode: null,
        reason: null,
      }, 'repo_companion_to_collection');
    }
    if (state.pathRole === 'repo_primary') {
      const requestedJoin = transition.accuracyJoinRound;
      const joinRound = requestedJoin === null || requestedJoin === undefined || requestedJoin === ''
        ? 1
        : Number(requestedJoin);
      if (!Number.isInteger(joinRound) || joinRound < 1 || joinRound > FLOW_MAX_ROUND.accuracy) {
        return reviewRequired(state, 'The supplied Accuracy join round is invalid.', 'invalid_accuracy_join_round');
      }
      return nextResult(state, {
        status: 'active',
        currentFlow: 'accuracy',
        currentRound: joinRound,
        reviewCode: null,
        reason: null,
      }, joinRound === 1 ? 'repo_to_accuracy_r1' : 'repo_join_accuracy');
    }
    return reviewRequired(state, 'Repo flow is missing its primary or companion role.', 'invalid_repo_path_role');
  }

  if (state.currentFlow === 'collection') {
    if (state.currentRound < FLOW_MAX_ROUND.collection) {
      return nextResult(state, {
        status: 'active',
        currentRound: state.currentRound + 1,
        reviewCode: null,
        reason: null,
      }, 'advance');
    }
    return reviewRequired(
      state,
      'Collection R10 is complete. The course/owner restart rule is not confirmed, so CCC will not select another letter automatically.',
      'collection_end_cycle_unconfirmed',
    );
  }

  if (state.currentFlow === 'combo') {
    if (state.currentRound < FLOW_MAX_ROUND.combo) {
      return nextResult(state, {
        status: 'active',
        currentRound: state.currentRound + 1,
        reviewCode: null,
        reason: null,
      }, 'advance');
    }
    return reviewRequired(
      state,
      'Combo R12 is complete. The course/owner restart rule is not confirmed, so CCC will not select another letter automatically.',
      'combo_end_cycle_unconfirmed',
    );
  }

  if (state.currentFlow === 'accuracy') {
    if (state.currentRound < FLOW_MAX_ROUND.accuracy) {
      return nextResult(state, {
        status: 'active',
        currentRound: state.currentRound + 1,
        reviewCode: null,
        reason: null,
      }, 'advance');
    }
    return reviewRequired(
      state,
      'Accuracy R12 is complete. No owner-confirmed automatic restart or flow switch exists, so CCC will not select another letter automatically.',
      'accuracy_end_cycle_unconfirmed',
    );
  }

  if (state.currentFlow === 'late_pay') {
    if (state.currentRound === 1) {
      return nextResult(state, {
        status: 'active',
        currentRound: 2,
        reviewCode: null,
        reason: null,
      }, 'advance');
    }
    return nextResult(state, {
      status: 'active',
      currentFlow: 'accuracy',
      currentRound: 1,
      reviewCode: null,
      reason: null,
    }, 'late_pay_to_accuracy');
  }

  if (state.currentFlow === 'consent') {
    if (state.currentRound < FLOW_MAX_ROUND.consent) {
      return nextResult(state, {
        status: 'active',
        currentRound: state.currentRound + 1,
        reviewCode: null,
        reason: null,
      }, 'advance');
    }
    if (state.accountKind === 'collection') {
      return nextResult(state, {
        status: 'active',
        currentFlow: 'collection',
        currentRound: 1,
        reviewCode: null,
        reason: null,
      }, 'consent_to_collection');
    }
    if (state.accountKind === 'charge_off' || state.accountKind === 'late_payment') {
      return nextResult(state, {
        status: 'active',
        currentFlow: 'accuracy',
        currentRound: 1,
        reviewCode: null,
        reason: null,
      }, 'consent_to_accuracy');
    }
    return reviewRequired(
      state,
      `Consent R3 has no confirmed switch for account kind ${state.accountKind || 'unknown'}.`,
      'consent_account_kind_unconfirmed',
    );
  }

  if (state.currentFlow === 'direct') {
    return reviewRequired(
      state,
      'Direct R1 is independently tracked, but the supplied course material does not confirm an automatic next-step rule.',
      'direct_extension_unconfirmed',
    );
  }

  if (state.currentFlow === 'accuracy_solo') {
    return reviewRequired(
      state,
      'Accuracy Solo has no owner-confirmed automatic next step. CCC will hold this track for course clarification.',
      'accuracy_solo_extension_unconfirmed',
    );
  }

  return reviewRequired(state, `No confirmed transition exists for ${state.currentFlow}.`, 'flow_transition_unconfirmed');
}
