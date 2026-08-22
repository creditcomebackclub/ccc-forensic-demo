import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, ImagePlus, Loader2, Save, Sparkles, X } from 'lucide-react';
import { readClientSensitiveData, writeClientSensitiveData } from '../utils/clientSensitiveData.js';
import { DISPUTE_BUREAUS, FLOW_LABELS } from '../utils/disputeFlow.js';
import { concreteTemplateStep } from '../utils/disputeState.js';
import { normalizeCccAccountTrackSnapshots } from '../utils/cccLetterTrackSnapshots.js';
import {
  cccLetterIdentityAutomaticValues,
  cccLetterIdentityDocumentIssues,
  sameCccLetterIdentity,
} from '../utils/cccLetterIdentity.js';
import {
  loadCccIdentityDocuments,
  loadCccLetterIdentity,
  saveCccLetterIdentity,
} from '../utils/cccLetterIdentityApi.js';
import {
  accountsMissingConfirmedDisputeFacts,
  buildAutomaticTemplateValues,
  extractTemplateTokens,
  maskAccountNumber,
  renderDisputeTemplate,
  screenshotsHtml,
  templateAudienceForFlow,
  templateFieldGroupsForFlow,
  unknownTemplateTokens,
  validateTemplateTokenContract,
  wrapDisputeLetterHtml,
} from '../utils/disputeTemplateEngine.js';
import { listDisputeTemplates } from '../utils/disputeTemplates.js';
import { requestDisputeRewrite } from '../utils/disputeRewriteApi.js';
import { replaceDisputeSelection } from '../utils/disputeRewriteRules.js';
import {
  DISPUTE_SCREENSHOT_BUCKET,
  DISPUTE_SCREENSHOT_TYPES,
  buildDisputeScreenshotPolicySnapshot,
  buildDisputeScreenshotManifest,
  disputeScreenshotStoragePath,
  missingScreenshotAccounts,
  screenshotAccountLabel,
  validateDisputeScreenshotManifest,
} from '../utils/disputeScreenshots.js';
import { disputeAccountKey } from '../utils/disputeTrackingRules.js';
import { saveLetter } from '../utils/storage.js';
import { supabase } from '../utils/supabase.js';

const HUMAN_FIELDS = [
  { key: 'damages', label: 'Damages / client story', rows: 5, help: 'Client-supplied facts only. Write a different opening for each bureau.' },
  { key: 'personalization', label: 'Facts / exact inaccuracies', rows: 6, help: 'Account-specific fields and bureau values. Do not change the template’s fixed legal facts.' },
  { key: 'penalty', label: 'Penalty / deadline', rows: 3, help: 'The round-specific consequence paragraph written for this bureau.' },
  { key: 'consumer_statement', label: 'Consumer Statement (required)', rows: 4, help: 'Brief, editable summary of this letter’s confirmed damages, facts, and requested outcome.' },
  { key: 'optional_strengthener', label: 'Optional strengthener', rows: 2, help: 'Optional. Use only when the supporting client fact is confirmed.' },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUREAU_ORDER = new Map(DISPUTE_BUREAUS.map((bureau, index) => [bureau.code, index]));
const blankSections = () => Object.fromEntries(HUMAN_FIELDS.map((field) => [field.key, '']));
const blankIdentityDraft = () => ({
  firstName: '', lastName: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '',
});

function identityDraftFromSnapshot(snapshot) {
  if (!snapshot) return blankIdentityDraft();
  return Object.fromEntries(Object.keys(blankIdentityDraft()).map((key) => [key, snapshot[key] || '']));
}

function trackField(track, camel, snake) {
  return track?.[camel] ?? track?.[snake] ?? null;
}

function exactUuid(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw new Error(`${label} is missing its canonical UUID.`);
  return normalized;
}

function integer(value, label, minimum = 0) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum) throw new Error(`${label} is invalid.`);
  return normalized;
}

function logicalFlowLabel(flow) {
  return flow === 'repo' ? 'Repossession' : (FLOW_LABELS[flow] || flow);
}

function trackSnapshot(track) {
  const logicalFlow = trackField(track, 'currentFlow', 'current_flow');
  const logicalRound = integer(trackField(track, 'currentRound', 'current_round'), 'CCC logical round', 1);
  const concrete = concreteTemplateStep(logicalFlow, logicalRound);
  return {
    trackId: exactUuid(track?.id, 'CCC account track'),
    revision: integer(track?.revision, 'CCC track revision'),
    methodVersion: String(trackField(track, 'methodVersion', 'method_version') || '').trim(),
    trackScope: trackField(track, 'trackScope', 'track_scope'),
    clientAccountId: exactUuid(trackField(track, 'clientAccountId', 'client_account_id'), 'CCC client account'),
    bureauCode: trackField(track, 'bureauCode', 'bureau_code'),
    accountKind: trackField(track, 'accountKind', 'account_kind'),
    nativeFlow: trackField(track, 'nativeFlow', 'native_flow'),
    logicalFlow,
    logicalRound,
    concreteFlow: concrete.flow,
    concreteRound: concrete.round,
    cycle: integer(track?.cycle, 'CCC track cycle', 1),
    pathRole: trackField(track, 'pathRole', 'path_role') || 'standard',
  };
}

function stableSnapshots(snapshots) {
  return [...snapshots].sort((left, right) => left.trackId.localeCompare(right.trackId));
}

function sameSnapshots(left, right) {
  return JSON.stringify(stableSnapshots(left)) === JSON.stringify(stableSnapshots(right));
}

/**
 * Turn only server-created active CRA tracks into physical letter work items.
 * No report classification, primary route, deferred route, or client-side
 * round selector participates in this boundary.
 */
export function buildStateDrivenCraWorkItems(audit, initialTracks) {
  const clientId = exactUuid(audit?.client?.id, 'Client');
  const auditId = String(audit?.id || audit?.auditId || '').trim();
  if (!auditId) throw new Error('Campaign Studio requires the exact saved audit record.');
  if (!Array.isArray(initialTracks) || !initialTracks.length) {
    throw new Error('Campaign Studio requires active server-owned CRA account tracks. Close it and initialize the reviewed audit again.');
  }
  if (initialTracks.length > 150) throw new Error('This campaign returned too many account tracks for one reviewed workspace.');

  const accounts = Array.isArray(audit?.accounts) ? audit.accounts : [];
  const accountById = new Map();
  for (const account of accounts) {
    if (!account?.clientAccountId) continue;
    const accountId = exactUuid(account.clientAccountId, 'Audit account');
    if (accountById.has(accountId)) throw new Error(`The saved audit repeats canonical account ${accountId}. Reconcile it before composing letters.`);
    accountById.set(accountId, account);
  }

  const seenTrackIds = new Set();
  const seenCoverage = new Set();
  const groups = new Map();
  for (const track of initialTracks) {
    if (trackField(track, 'trackScope', 'track_scope') !== 'cra') {
      throw new Error('CRA Campaign Studio received a non-CRA account track and stayed closed.');
    }
    if (String(track?.status || '') !== 'active') {
      throw new Error('CRA Campaign Studio received an account track that is not active. Resolve its state before composing.');
    }
    if (String(trackField(track, 'clientId', 'client_id') || '').toLowerCase() !== clientId) {
      throw new Error('A CRA account track belongs to a different client. Campaign Studio stayed closed.');
    }
    const sourceAuditId = String(trackField(track, 'sourceAuditId', 'source_audit_id') || '').trim();
    if (sourceAuditId && sourceAuditId !== auditId) {
      throw new Error('A CRA account track was initialized from a different audit. Campaign Studio stayed closed.');
    }

    const snapshot = normalizeCccAccountTrackSnapshots([trackSnapshot(track)])[0];
    if (seenTrackIds.has(snapshot.trackId)) throw new Error(`CCC track ${snapshot.trackId} was returned more than once.`);
    seenTrackIds.add(snapshot.trackId);
    const coverageKey = `${snapshot.clientAccountId}:${snapshot.bureauCode}`;
    if (seenCoverage.has(coverageKey)) throw new Error(`CCC returned more than one CRA track for account ${snapshot.clientAccountId} at ${snapshot.bureauCode}.`);
    seenCoverage.add(coverageKey);

    const account = accountById.get(snapshot.clientAccountId);
    if (!account) throw new Error(`CCC track ${snapshot.trackId} has no exact canonical account in this saved audit.`);
    if (!Array.isArray(account.bureaus) || !account.bureaus.includes(snapshot.bureauCode)) {
      throw new Error(`CCC track ${snapshot.trackId} does not match the account’s frozen bureau coverage.`);
    }
    const bureau = DISPUTE_BUREAUS.find((item) => item.code === snapshot.bureauCode);
    if (!bureau) throw new Error(`CCC track ${snapshot.trackId} has an unsupported bureau.`);

    const key = [
      snapshot.bureauCode,
      `${snapshot.logicalFlow}:R${snapshot.logicalRound}`,
      `${snapshot.concreteFlow}:R${snapshot.concreteRound}`,
    ].join('|');
    const group = groups.get(key) || {
      key,
      bureau,
      logicalFlow: snapshot.logicalFlow,
      logicalRound: snapshot.logicalRound,
      concreteFlow: snapshot.concreteFlow,
      concreteRound: snapshot.concreteRound,
      tracks: [],
      accounts: [],
    };
    group.tracks.push(track);
    group.accounts.push(account);
    groups.set(key, group);
  }

  const workItems = [...groups.values()].map((group) => {
    const paired = group.tracks.map((track, index) => ({
      track,
      snapshot: trackSnapshot(track),
      account: group.accounts[index],
    })).sort((left, right) => left.snapshot.clientAccountId.localeCompare(right.snapshot.clientAccountId));
    const snapshots = normalizeCccAccountTrackSnapshots(paired.map((item) => item.snapshot));
    if (snapshots.length !== paired.length) throw new Error('CCC could not prove exact account coverage for a letter work item.');
    return {
      ...group,
      tracks: paired.map((item) => item.track),
      accounts: paired.map((item) => item.account),
      snapshots,
    };
  }).sort((left, right) => (
    (BUREAU_ORDER.get(left.bureau.code) ?? 99) - (BUREAU_ORDER.get(right.bureau.code) ?? 99)
    || left.logicalFlow.localeCompare(right.logicalFlow)
    || left.logicalRound - right.logicalRound
  ));
  if (!workItems.length) throw new Error('No active CRA letter work items were returned.');
  return workItems;
}

function boundedText(value, label, limit = 8000) {
  const result = String(value ?? '').trim();
  if (result.length > limit) throw new Error(`${label} exceeds the ${limit.toLocaleString()} character evidence limit.`);
  return result;
}

function buildAccountIssueSnapshots(accounts) {
  if (!Array.isArray(accounts) || !accounts.length || accounts.length > 50) {
    throw new Error('A CRA letter must cover between 1 and 50 exact canonical accounts.');
  }
  const snapshots = accounts.map((account) => {
    const clientAccountId = exactUuid(account?.clientAccountId, 'Covered client account');
    const violations = Array.isArray(account?.violations) ? account.violations : [];
    if (violations.length > 50) throw new Error(`${account?.furnisher || 'An account'} has more than 50 issue findings; review it before saving.`);
    return {
      accountKey: `client-account:${clientAccountId}`,
      clientAccountId,
      furnisher: boundedText(account?.furnisher || 'Unknown furnisher', 'Furnisher', 500),
      accountNumberMasked: maskAccountNumber(account?.accountNumberMasked || account?.accountNumber) || null,
      primaryViolation: boundedText(account?.primaryViolation, 'Primary violation'),
      violations: violations.map((violation, index) => ({
        field: boundedText(violation?.field, `Finding ${index + 1} field`, 500),
        issue: boundedText(violation?.issue, `Finding ${index + 1} issue`),
        reason: boundedText(violation?.reason, `Finding ${index + 1} reason`),
        currentlyReports: boundedText(violation?.currentlyReports, `Finding ${index + 1} current value`),
        shouldReport: boundedText(violation?.shouldReport, `Finding ${index + 1} expected value`),
        statute: boundedText(violation?.statute, `Finding ${index + 1} statute`, 500),
        severity: boundedText(violation?.severity, `Finding ${index + 1} severity`, 100),
      })),
    };
  });
  if (new TextEncoder().encode(JSON.stringify(snapshots)).byteLength > 512 * 1024) {
    throw new Error('The reviewed account issue evidence exceeds the 512 KB letter limit. Split the work into reviewed account groups.');
  }
  return snapshots;
}

function buildAutomaticValuesSnapshot(template, automaticValues) {
  const automaticTokens = new Set(templateFieldGroupsForFlow(template?.flow).automatic);
  const snapshot = {};
  for (const token of extractTemplateTokens(template?.body || '')) {
    if (!automaticTokens.has(token)) continue;
    snapshot[token] = token === 'screenshots' ? '' : String(automaticValues?.[token] ?? '');
  }
  return snapshot;
}

async function loadClientIdentity(audit) {
  const clientId = audit?.client?.id;
  if (!clientId) throw new Error('Client identity is missing. Open the saved audit from the client record.');
  const { data, error } = await supabase.from('clients').select('id,name,address,date_of_birth').eq('id', clientId).limit(1);
  if (error) throw error;
  const client = data?.[0];
  if (!client) throw new Error('Client profile not found. Save the audit to a client before building a campaign.');
  const [sensitive, letterIdentity, identityDocuments] = await Promise.all([
    readClientSensitiveData(client.name, client.id, ['ssnLast4', 'disputeStoryNotes']),
    loadCccLetterIdentity(client.id),
    loadCccIdentityDocuments(client.id),
  ]);
  return {
    id: client.id,
    clientName: client.name,
    crmAddress: client.address || audit?.client?.address || '',
    dateOfBirth: client.date_of_birth || audit?.personalInfo?.dateOfBirth || '',
    ssnLast4: sensitive?.ssnLast4 || '',
    disputeStoryNotes: sensitive?.disputeStoryNotes || '',
    disputeStoryNotesVersion: sensitive?.disputeStoryNotesVersion || '',
    letterIdentity,
    identityDocuments,
  };
}

async function readImage(file, account) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    id: crypto.randomUUID(),
    accountKey: disputeAccountKey(account),
    clientAccountId: account.clientAccountId,
    accountId: account.id || null,
    furnisher: account.furnisher || 'Unknown furnisher',
    accountNumberMasked: maskAccountNumber(account.accountNumberMasked || account.accountNumber) || null,
    fileName: file.name,
    mediaType: file.type,
    size: file.size,
    sha256,
    file,
    dataUrl,
  };
}

async function recheckExactServerState(workItem, selectedTemplate, audit) {
  const trackIds = workItem.snapshots.map((snapshot) => snapshot.trackId);
  const [{ data: rows, error: trackError }, { data: templateRow, error: templateError }] = await Promise.all([
    supabase.from('ccc_account_tracks').select('*').in('id', trackIds),
    supabase.from('dispute_templates').select('*').eq('id', selectedTemplate.id).maybeSingle(),
  ]);
  if (trackError) throw new Error(`CCC could not recheck the account state: ${trackError.message}`);
  if (templateError) throw new Error(`CCC could not recheck the selected template: ${templateError.message}`);
  if (!Array.isArray(rows) || rows.length !== trackIds.length || rows.some((row) => row.status !== 'active')) {
    throw new Error('One or more account tracks are no longer active. Close Campaign Studio and reopen the current state.');
  }
  if (rows.some((row) => String(row.client_id).toLowerCase() !== String(audit?.client?.id).toLowerCase())) {
    throw new Error('A reloaded account track no longer belongs to this exact client.');
  }
  const currentSnapshots = normalizeCccAccountTrackSnapshots(rows.map(trackSnapshot));
  if (!sameSnapshots(currentSnapshots, workItem.snapshots)) {
    throw new Error('The account flow, round, classification, cycle, or revision changed. Close Campaign Studio and rebuild from current server state.');
  }

  const templateContractError = templateRow && validateTemplateTokenContract({
    flow: templateRow.flow_code,
    body: templateRow.body_text,
    active: templateRow.is_active,
  });
  const exactTemplate = templateRow
    && templateRow.is_active === true
    && templateRow.flow_code === workItem.concreteFlow
    && Number(templateRow.round_number) === workItem.concreteRound
    && (templateRow.bureau_code === workItem.bureau.code || templateRow.bureau_code === 'ALL')
    && templateRow.name === selectedTemplate.name
    && templateRow.version_label === selectedTemplate.version
    && templateRow.body_text === selectedTemplate.body
    && (templateRow.template_family_key || `${templateRow.flow_code.toUpperCase()}:R${templateRow.round_number}:${templateRow.bureau_code}`) === selectedTemplate.familyKey
    && (templateRow.screenshot_policy_code || 'none') === selectedTemplate.screenshotPolicyCode
    && (templateRow.screenshot_staff_instructions || '') === selectedTemplate.screenshotStaffInstructions
    && String(templateRow.updated_at || '') === String(selectedTemplate.updatedAt || '');
  if (!exactTemplate || templateContractError) {
    throw new Error(templateContractError || 'The selected template changed, was retired, or no longer matches this exact physical step. Reload Campaign Studio before saving.');
  }
  if (templateAudienceForFlow(templateRow.flow_code) !== 'cra') {
    throw new Error('The selected physical template is not a bureau/CRA template.');
  }
  return currentSnapshots;
}

function WorkItemPill({ item, selected, onClick }) {
  const aliased = item.logicalFlow !== item.concreteFlow || item.logicalRound !== item.concreteRound;
  return (
    <button onClick={onClick} className={`block w-full rounded-lg border px-3 py-2 text-left ${selected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200'}`}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-blue-700">{item.bureau.name} · server-owned state</div>
      <div className="mt-0.5 text-[12px] font-semibold text-navy">{logicalFlowLabel(item.logicalFlow)} R{item.logicalRound}</div>
      {aliased && <div className="mt-0.5 text-[9px] text-gray-500">Uses {FLOW_LABELS[item.concreteFlow] || item.concreteFlow} R{item.concreteRound}</div>}
      <div className="mt-1 text-[10px] text-gray-500">{item.accounts.length} exact account{item.accounts.length === 1 ? '' : 's'} in this letter</div>
    </button>
  );
}

export default function DisputeCampaignStudio({ audit, initialTracks, onClose, onSaved }) {
  const routing = useMemo(() => {
    try {
      return { workItems: buildStateDrivenCraWorkItems(audit, initialTracks), error: null };
    } catch (error) {
      return { workItems: [], error: error?.message || 'CCC could not verify the server-owned campaign state.' };
    }
  }, [audit, initialTracks]);
  const trackStateKey = useMemo(() => (initialTracks || []).map((track) => `${track?.id}:${track?.revision}`).join('|'), [initialTracks]);
  const firstWorkKey = routing.workItems[0]?.key || '';
  const [workKey, setWorkKey] = useState(firstWorkKey);
  const [templates, setTemplates] = useState([]);
  const [templateIdsByKey, setTemplateIdsByKey] = useState({});
  const [identity, setIdentity] = useState(null);
  const [letterIdentity, setLetterIdentity] = useState(null);
  const [identityDocuments, setIdentityDocuments] = useState([]);
  const [identityDraft, setIdentityDraft] = useState(blankIdentityDraft);
  const [identityAttested, setIdentityAttested] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [sectionsByKey, setSectionsByKey] = useState({});
  const [screenshotsByKey, setScreenshotsByKey] = useState({});
  const [storyNotes, setStoryNotes] = useState('');
  const [storyNotesVersion, setStoryNotesVersion] = useState('');
  const [storyNotesDirty, setStoryNotesDirty] = useState(false);
  const [savingStoryNotes, setSavingStoryNotes] = useState(false);
  const [storyNotesSaved, setStoryNotesSaved] = useState(false);
  const [storyNotesApprovedForAi, setStoryNotesApprovedForAi] = useState(false);
  const [selectionsByKey, setSelectionsByKey] = useState({});
  const [rewritingKey, setRewritingKey] = useState(null);
  const [rewriteProposal, setRewriteProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const storyNotesRevisionRef = useRef(0);
  const rewriteRequestIdRef = useRef(0);
  const clientGenerationRef = useRef(0);
  const auditClientKey = audit?.client?.id || '';

  useEffect(() => {
    let active = true;
    clientGenerationRef.current += 1;
    rewriteRequestIdRef.current += 1;
    storyNotesRevisionRef.current += 1;
    setLoading(true);
    setError(routing.error);
    setIdentity(null);
    setLetterIdentity(null);
    setIdentityDocuments([]);
    setIdentityDraft(blankIdentityDraft());
    setIdentityAttested(false);
    setSavingIdentity(false);
    setWorkKey(firstWorkKey);
    setTemplateIdsByKey({});
    setSectionsByKey({});
    setScreenshotsByKey({});
    setSelectionsByKey({});
    setStoryNotes('');
    setStoryNotesVersion('');
    setStoryNotesDirty(false);
    setStoryNotesSaved(false);
    setStoryNotesApprovedForAi(false);
    setRewriteProposal(null);
    setRewritingKey(null);
    setSavingStoryNotes(false);
    setSaving(false);
    setSavedId(null);
    if (routing.error) {
      setLoading(false);
      return () => { active = false; };
    }
    Promise.all([listDisputeTemplates({ activeOnly: true }), loadClientIdentity(audit)])
      .then(([templateRows, clientIdentity]) => {
        if (!active) return;
        setTemplates(templateRows);
        setIdentity(clientIdentity);
        setLetterIdentity(clientIdentity.letterIdentity);
        setIdentityDocuments(clientIdentity.identityDocuments || []);
        setIdentityDraft(identityDraftFromSnapshot(clientIdentity.letterIdentity));
        setStoryNotes(clientIdentity.disputeStoryNotes || '');
        setStoryNotesVersion(clientIdentity.disputeStoryNotesVersion || '');
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not prepare the campaign.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [auditClientKey, trackStateKey, routing.error, firstWorkKey]);

  const workItem = routing.workItems.find((item) => item.key === workKey) || routing.workItems[0] || null;
  const sections = sectionsByKey[workItem?.key] || blankSections();
  const screenshots = screenshotsByKey[workItem?.key] || [];
  const matches = useMemo(() => {
    if (!workItem) return [];
    return templates.filter((template) => template.active
      && template.flow === workItem.concreteFlow
      && Number(template.round) === workItem.concreteRound
      && (template.bureau === workItem.bureau.code || template.bureau === 'ALL'))
      .sort((left, right) => (
        Number(right.bureau === workItem.bureau.code) - Number(left.bureau === workItem.bureau.code)
        || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
      ));
  }, [templates, workItem]);

  useEffect(() => {
    if (!workItem) return;
    const currentId = templateIdsByKey[workItem.key];
    if (!matches.some((template) => template.id === currentId)) {
      setTemplateIdsByKey((current) => ({ ...current, [workItem.key]: matches[0]?.id || '' }));
    }
  }, [workItem?.key, matches]);

  const selectedTemplate = matches.find((template) => template.id === templateIdsByKey[workItem?.key]) || matches[0] || null;
  const templateAudience = templateAudienceForFlow(selectedTemplate?.flow);
  const isCraTemplate = templateAudience === 'cra';
  const currentIdDocument = identityDocuments.find((document) => document.doc_type === 'id') || null;
  const currentAddressDocument = identityDocuments.find((document) => document.doc_type === 'address') || null;
  const currentIdentityDocumentsHaveIntegrity = [currentIdDocument, currentAddressDocument].every((document) => (
    document
    && /^[0-9a-f]{64}$/.test(String(document.sha256 || ''))
    && Number(document.byte_size || 0) > 0
    && String(document.storage_path || '').includes(`-${String(document.sha256).slice(0, 16)}.`)
  ));
  const identityDocumentIssues = letterIdentity
    ? cccLetterIdentityDocumentIssues(letterIdentity, identityDocuments)
    : ['Confirm the exact legal name, current address, government ID, and proof of address before composing.'];
  const identityReady = Boolean(letterIdentity && identityDocumentIssues.length === 0);
  const mergeIdentity = identityReady
    ? { ...identity, ...cccLetterIdentityAutomaticValues(letterIdentity) }
    : { ...identity, firstName: '', lastName: '', name: '', address: '' };
  const autoValues = buildAutomaticTemplateValues({
    identity: mergeIdentity,
    audit,
    bureau: workItem?.bureau || {},
    accounts: workItem?.accounts || [],
    screenshots,
    strictIdentity: true,
  });
  const values = { ...autoValues, ...sections };
  const templateTokens = extractTemplateTokens(selectedTemplate?.body || '');
  const templateGroups = templateFieldGroupsForFlow(selectedTemplate?.flow);
  const automaticTokenSet = new Set(templateGroups.automatic);
  const unknown = selectedTemplate ? unknownTemplateTokens(selectedTemplate.body, values) : [];
  const templateContractError = selectedTemplate ? validateTemplateTokenContract({
    flow: selectedTemplate.flow,
    body: selectedTemplate.body,
    active: selectedTemplate.active,
  }) : null;
  const requiredMissing = templateTokens.filter((token) => Object.prototype.hasOwnProperty.call(values, token)
    && !String(values[token] || '').trim()
    && token !== 'screenshots'
    && token !== 'optional_strengthener');
  const missingAutomatic = requiredMissing.filter((token) => automaticTokenSet.has(token));
  const missingFactAccounts = workItem ? accountsMissingConfirmedDisputeFacts(workItem.accounts) : [];
  const screenshotPolicy = buildDisputeScreenshotPolicySnapshot(selectedTemplate || {});
  const screenshotsRequired = Boolean(workItem && screenshotPolicy.required);
  const missingScreenshotCoverage = screenshotsRequired
    ? missingScreenshotAccounts(workItem?.accounts || [], screenshots)
    : [];
  const previewReady = Boolean(identityReady && selectedTemplate && isCraTemplate && !templateContractError && !unknown.length
    && !missingAutomatic.length && !missingFactAccounts.length);
  const bodyHtml = previewReady
    ? renderDisputeTemplate(selectedTemplate.body, { ...values, screenshots: '' }, ['screenshots'])
    : '';
  const previewExhibits = previewReady ? screenshotsHtml(screenshots) : '';
  const letterTitle = workItem
    ? `${workItem.bureau.name} ${logicalFlowLabel(workItem.logicalFlow)} R${workItem.logicalRound}`
    : 'CCC CRA dispute letter';
  const letterHtml = previewReady ? wrapDisputeLetterHtml(`${bodyHtml}${previewExhibits}`, letterTitle) : '';

  const setSection = (key, value) => {
    if (!workItem) return;
    setSectionsByKey((current) => ({ ...current, [workItem.key]: { ...(current[workItem.key] || blankSections()), [key]: value } }));
    setSavedId(null);
  };

  const selectionKey = (fieldKey) => `${workItem?.key || 'none'}:${fieldKey}`;

  const captureSelection = (fieldKey, event) => {
    const value = event.currentTarget.value;
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    setSelectionsByKey((current) => ({
      ...current,
      [selectionKey(fieldKey)]: { start, end, selectedText: value.slice(start, end) },
    }));
  };

  const updateIdentityDraft = (key, value) => {
    setIdentityDraft((current) => ({ ...current, [key]: value }));
    setIdentityAttested(false);
    setSavedId(null);
  };

  const confirmLetterIdentity = async () => {
    if (!identity?.id || !currentIdDocument || !currentAddressDocument) {
      setError('Upload both the government ID and proof of current address in Documents before confirming letter identity.');
      return;
    }
    if (!currentIdentityDocumentsHaveIntegrity) {
      setError('Re-upload both identity documents through Documents so CCC can bind their exact SHA-256 evidence.');
      return;
    }
    if (!identityAttested) {
      setError('Review both documents and confirm that the typed legal name and current address match them exactly.');
      return;
    }
    setSavingIdentity(true);
    setError(null);
    try {
      const saved = await saveCccLetterIdentity({
        clientId: identity.id,
        expectedRevision: letterIdentity?.revision ?? null,
        ...identityDraft,
        identityDocumentId: currentIdDocument.id,
        addressDocumentId: currentAddressDocument.id,
      });
      setLetterIdentity(saved);
      setIdentityDraft(identityDraftFromSnapshot(saved));
      setIdentityAttested(false);
      setSavedId(null);
    } catch (identityError) {
      setError(identityError.message || 'Could not confirm the CCC letter identity. Reload and review the current documents.');
    } finally {
      setSavingIdentity(false);
    }
  };

  const saveStoryNotes = async () => {
    if (!identity?.id) return false;
    const submittedGeneration = clientGenerationRef.current;
    const submittedRevision = storyNotesRevisionRef.current;
    const submittedNotes = storyNotes.trim();
    setSavingStoryNotes(true);
    setError(null);
    try {
      const result = await writeClientSensitiveData(identity.clientName, {
        disputeStoryNotes: submittedNotes,
        disputeStoryNotesVersion: storyNotesVersion || null,
      }, identity.id);
      const isCurrent = clientGenerationRef.current === submittedGeneration
        && storyNotesRevisionRef.current === submittedRevision;
      if (!isCurrent) return '';
      setStoryNotesDirty(false);
      setStoryNotesSaved(true);
      setStoryNotesVersion(result.disputeStoryNotesVersion || '');
      setTimeout(() => {
        if (clientGenerationRef.current === submittedGeneration
            && storyNotesRevisionRef.current === submittedRevision) setStoryNotesSaved(false);
      }, 2500);
      return result.disputeStoryNotesVersion || '';
    } catch (saveError) {
      if (clientGenerationRef.current === submittedGeneration) {
        setError(saveError.message || 'Could not save the encrypted personalization notes.');
      }
      return '';
    } finally {
      if (clientGenerationRef.current === submittedGeneration) setSavingStoryNotes(false);
    }
  };

  const rewriteSelectedDamages = async () => {
    if (!workItem) return;
    const fieldKey = 'damages';
    const key = selectionKey(fieldKey);
    const selection = selectionsByKey[key];
    const currentText = sections[fieldKey] || '';
    if (!selection || selection.start === selection.end || currentText.slice(selection.start, selection.end) !== selection.selectedText) {
      setError('Highlight the exact sentence or paragraph you want Claude to rewrite in the Damages box.');
      return;
    }
    if (!storyNotes.trim()) {
      setError('Add the confirmed client story notes before asking Claude to personalize the damages paragraph.');
      return;
    }
    if (!storyNotesApprovedForAi) {
      setError('Confirm that the personalization notes are safe to send to Claude before requesting a rewrite.');
      return;
    }

    const requestId = rewriteRequestIdRef.current + 1;
    rewriteRequestIdRef.current = requestId;
    setRewritingKey(key);
    setRewriteProposal(null);
    setError(null);
    try {
      let approvedStoryNotesVersion = storyNotesVersion;
      if (storyNotesDirty) {
        approvedStoryNotesVersion = await saveStoryNotes();
        if (!approvedStoryNotesVersion) return;
      }
      if (rewriteRequestIdRef.current !== requestId) return;
      if (!approvedStoryNotesVersion) {
        setError('Save and approve the current client story notes before requesting a rewrite.');
        return;
      }
      const result = await requestDisputeRewrite({
        clientId: identity.id,
        sectionKey: fieldKey,
        selectedText: selection.selectedText,
        flow: workItem.logicalFlow,
        round: workItem.logicalRound,
        bureau: workItem.bureau.code,
        storyNotesVersion: approvedStoryNotesVersion,
      });
      if (rewriteRequestIdRef.current !== requestId) return;
      setRewriteProposal({
        key,
        fieldKey,
        start: selection.start,
        end: selection.end,
        selectedText: selection.selectedText,
        replacement: result.replacement,
        warning: result.warning,
      });
    } catch (rewriteError) {
      if (rewriteRequestIdRef.current === requestId) setError(rewriteError.message || 'Claude could not rewrite that selection.');
    } finally {
      if (rewriteRequestIdRef.current === requestId) setRewritingKey(null);
    }
  };

  const acceptRewrite = () => {
    if (!rewriteProposal || rewriteProposal.key !== selectionKey(rewriteProposal.fieldKey)) return;
    try {
      const currentText = sections[rewriteProposal.fieldKey] || '';
      const nextText = replaceDisputeSelection(currentText, rewriteProposal, rewriteProposal.replacement);
      setSection(rewriteProposal.fieldKey, nextText);
      setRewriteProposal(null);
    } catch (rewriteError) {
      setError(rewriteError.message || 'The paragraph changed after the suggestion was created. Select it again.');
    }
  };

  const selectWorkItem = (nextWorkKey) => {
    rewriteRequestIdRef.current += 1;
    setWorkKey(nextWorkKey);
    setSavedId(null);
    setError(null);
    setRewriteProposal(null);
    setRewritingKey(null);
  };

  const uploadScreenshots = async (event, account) => {
    if (!workItem) return;
    const uploadGeneration = clientGenerationRef.current;
    const selectedFiles = [...(event.target.files || [])];
    const files = selectedFiles.filter((file) => DISPUTE_SCREENSHOT_TYPES.has(file.type));
    if (!files.length) return;
    setError(null);
    try {
      if (screenshots.length + files.length > 10) throw new Error('Use no more than 10 screenshots in one letter.');
      if (files.length !== selectedFiles.length) throw new Error('Screenshots must be PNG, JPEG, or WebP files.');
      if (files.some((file) => file.size > 8 * 1024 * 1024)) throw new Error('Each screenshot must be 8 MB or smaller.');
      const existingBytes = screenshots.reduce((total, item) => total + Number(item.size || 0), 0);
      const addedBytes = files.reduce((total, file) => total + file.size, 0);
      if (existingBytes + addedBytes > 24 * 1024 * 1024) throw new Error('Keep the combined screenshots under 24 MB.');
      const added = await Promise.all(files.map((file) => readImage(file, account)));
      if (clientGenerationRef.current !== uploadGeneration) return;
      setScreenshotsByKey((current) => ({ ...current, [workItem.key]: [...(current[workItem.key] || []), ...added] }));
      setSavedId(null);
    } catch (uploadError) {
      if (clientGenerationRef.current === uploadGeneration) setError(uploadError.message || 'Could not add screenshots.');
    } finally {
      event.target.value = '';
    }
  };

  const persistScreenshots = async (items) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.id) throw authError || new Error('Your staff session expired. Sign in again before saving screenshots.');
    const batchId = `${Date.now()}-${crypto.randomUUID()}`;
    const uploadedPaths = [];
    const persisted = [];
    try {
      for (const item of items) {
        if (item.storagePath) {
          persisted.push(item);
          continue;
        }
        if (!item.file) throw new Error(`${item.fileName || 'A screenshot'} is no longer available. Upload it again.`);
        const storagePath = disputeScreenshotStoragePath({
          userId: user.id,
          clientId: identity.id,
          batchId,
          account: item,
          id: item.id,
          mediaType: item.mediaType,
        });
        const { error: uploadError } = await supabase.storage
          .from(DISPUTE_SCREENSHOT_BUCKET)
          .upload(storagePath, item.file, { upsert: false, contentType: item.mediaType });
        if (uploadError) throw uploadError;
        uploadedPaths.push(storagePath);
        persisted.push({ ...item, file: undefined, storagePath, uploadedAt: new Date().toISOString() });
      }
      return { persisted, uploadedPaths, userId: user.id };
    } catch (persistError) {
      if (uploadedPaths.length) await supabase.storage.from(DISPUTE_SCREENSHOT_BUCKET).remove(uploadedPaths);
      throw persistError;
    }
  };

  const saveCampaignLetter = async () => {
    if (!identity?.id || !workItem || !selectedTemplate) return;
    const saveGeneration = clientGenerationRef.current;
    if (!identityReady) { setError(identityDocumentIssues.join(' ')); return; }
    if (!isCraTemplate) { setError('The selected physical template is not a bureau/CRA template.'); return; }
    if (templateContractError) { setError(templateContractError); return; }
    if (unknown.length) { setError(`Template has unsupported curlys: ${unknown.map((token) => `{${token}}`).join(', ')}`); return; }
    if (missingFactAccounts.length) {
      setError(`Confirm at least one exact issue for every covered account before composing. Missing: ${missingFactAccounts.map((account) => account.furnisher || account.clientAccountId).join('; ')}`);
      return;
    }
    if (requiredMissing.length) {
      const profileTokens = requiredMissing.filter((token) => automaticTokenSet.has(token));
      setError(profileTokens.length
        ? `Correct the client profile/report data required by this template: ${profileTokens.map((token) => `{${token}}`).join(', ')}.`
        : `Complete these required letter fields: ${requiredMissing.map((token) => `{${token}}`).join(', ')}.`);
      return;
    }
    if (screenshotsRequired && missingScreenshotCoverage.length) {
      setError(`Assign at least one reviewed screenshot to every account before saving. Missing: ${missingScreenshotCoverage.map(screenshotAccountLabel).join('; ')}`);
      return;
    }
    if (storyNotesDirty && !(await saveStoryNotes())) return;
    if (clientGenerationRef.current !== saveGeneration) return;
    setSaving(true);
    setError(null);
    let uploadedPaths = [];
    try {
      const freshIdentity = await loadClientIdentity(audit);
      if (!sameCccLetterIdentity(letterIdentity, freshIdentity.letterIdentity)) {
        throw new Error('The confirmed legal name/address changed in another session. Reload Campaign Studio and review it again.');
      }
      const freshIdentityDocumentIssues = cccLetterIdentityDocumentIssues(
        freshIdentity.letterIdentity,
        freshIdentity.identityDocuments,
      );
      if (freshIdentityDocumentIssues.length) throw new Error(freshIdentityDocumentIssues.join(' '));
      const currentLetterIdentitySnapshot = freshIdentity.letterIdentity;
      const currentMergeIdentity = {
        ...freshIdentity,
        ...cccLetterIdentityAutomaticValues(currentLetterIdentitySnapshot),
      };
      const accountSnapshots = buildAccountIssueSnapshots(workItem.accounts);
      const screenshotUpload = await persistScreenshots(screenshots);
      uploadedPaths = screenshotUpload.uploadedPaths;
      const persistedScreenshots = screenshotUpload.persisted;
      const screenshotManifest = buildDisputeScreenshotManifest(persistedScreenshots);
      const screenshotIssues = validateDisputeScreenshotManifest({
        accounts: workItem.accounts,
        manifest: screenshotManifest,
        policy: screenshotPolicy,
        userId: screenshotUpload.userId,
        clientId: identity.id,
      });
      if (screenshotIssues.length) throw new Error(screenshotIssues.join(' '));

      const storedAutoValues = buildAutomaticTemplateValues({
        identity: currentMergeIdentity,
        audit,
        bureau: workItem.bureau,
        accounts: workItem.accounts,
        screenshots: [],
        strictIdentity: true,
      });
      const automaticValuesSnapshot = buildAutomaticValuesSnapshot(selectedTemplate, storedAutoValues);
      const currentTrackSnapshots = await recheckExactServerState(workItem, selectedTemplate, audit);
      const storedBodyHtml = renderDisputeTemplate(selectedTemplate.body, { ...storedAutoValues, ...sections }, ['screenshots']);
      const storedLetterHtml = wrapDisputeLetterHtml(storedBodyHtml, letterTitle);
      const physicalLabel = FLOW_LABELS[workItem.concreteFlow] || workItem.concreteFlow;
      const logicalLabel = logicalFlowLabel(workItem.logicalFlow);
      const syntheticAccount = {
        id: `ccc-${workItem.logicalFlow}-r${workItem.logicalRound}-${workItem.bureau.code.toLowerCase()}`,
        furnisher: workItem.bureau.name,
        type: null,
      };
      const id = await saveLetter(
        syntheticAccount,
        { ...audit.client, id: identity.id, name: freshIdentity.clientName, address: storedAutoValues.client_address },
        storedLetterHtml,
        `${logicalLabel} R${workItem.logicalRound} prepared for ${workItem.bureau.name} using ${physicalLabel} R${workItem.concreteRound}.`,
        `CCC Dispute — ${physicalLabel} R${workItem.concreteRound} — ${workItem.bureau.name}`,
        '',
        {
          letterKind: 'dispute',
          targetType: templateAudience === 'cra' ? 'bureau' : null,
          targetBureau: templateAudience === 'cra' ? workItem.bureau.slug : null,
          coveredFurnishers: workItem.accounts.map((account) => account.furnisher).filter(Boolean),
          disputeTemplateId: selectedTemplate.id,
          disputeTemplateName: `${selectedTemplate.name} ${selectedTemplate.version}`.trim(),
          disputeTemplateVersionLabel: selectedTemplate.version,
          disputeTemplateFamilyKey: selectedTemplate.familyKey,
          disputeFlowCode: workItem.concreteFlow,
          disputeRoundNumber: workItem.concreteRound,
          disputeBureauCode: workItem.bureau.code,
          disputeTemplateSnapshot: selectedTemplate.body,
          disputeEditableSections: sections,
          disputeAccountSnapshot: accountSnapshots,
          cccAccountTrackSnapshots: currentTrackSnapshots,
          cccLetterIdentitySnapshot: currentLetterIdentitySnapshot,
          disputeAutomaticValuesSnapshot: automaticValuesSnapshot,
          disputeScreenshotPolicySnapshot: screenshotPolicy,
          disputeScreenshotManifest: screenshotManifest,
        },
      );
      if (clientGenerationRef.current !== saveGeneration) return;
      setScreenshotsByKey((current) => ({ ...current, [workItem.key]: persistedScreenshots }));
      setSavedId(id);
      onSaved?.(id);
    } catch (saveError) {
      if (uploadedPaths.length) await supabase.storage.from(DISPUTE_SCREENSHOT_BUCKET).remove(uploadedPaths);
      if (clientGenerationRef.current === saveGeneration) setError(saveError.message || 'Could not save the campaign letter.');
    } finally {
      if (clientGenerationRef.current === saveGeneration) setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-[#F7F4ED] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between bg-[#121F38] px-6 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#C9A84C]">CCC State-Driven CRA Campaign</div>
            <div className="text-lg font-semibold text-white">{workItem ? `${logicalFlowLabel(workItem.logicalFlow)} R${workItem.logicalRound} Template Builder` : 'Campaign unavailable'} · {audit?.client?.name}</div>
          </div>
          <button onClick={onClose} className="p-1 text-white/60 hover:text-white"><X size={19} /></button>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500"><Loader2 size={18} className="animate-spin" /> Loading exact account state, client fields, and template library…</div>
        ) : routing.error ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-xl rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
              <AlertCircle size={28} className="mx-auto text-red-600" />
              <div className="mt-3 text-sm font-semibold text-navy">Campaign Studio stayed closed</div>
              <p className="mt-2 text-xs leading-relaxed text-red-700">{routing.error}</p>
              <button onClick={onClose} className="mt-4 rounded-lg bg-navy px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white">Return to audit</button>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[430px_1fr]">
            <aside className="overflow-y-auto border-r border-gray-200 bg-white p-5">
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-[10px] leading-relaxed text-green-900">
                <strong>Server-owned campaign:</strong> each item below comes from exact active CRA account tracks. Flow and round cannot be changed in this composer.
              </div>

              <div className={`mb-4 rounded-lg border p-3 ${identityReady ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-navy">Exact letter identity</div>
                    <p className="mt-1 text-[9px] leading-relaxed text-gray-600">These reviewed fields—not a guessed split of the CRM name or report address—populate the client-name and address curlys.</p>
                  </div>
                  {letterIdentity && <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-green-700">Verified rev {letterIdentity.revision}</span>}
                </div>
                <div className="mt-2 rounded bg-white/70 p-2 text-[9px] leading-relaxed text-gray-500">
                  CRM reference only: <strong>{identity?.clientName || 'No name'}</strong>{identity?.crmAddress ? ` · ${identity.crmAddress}` : ' · no CRM address'}. Review the actual ID and proof document before typing below.
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    ['firstName', 'Legal first name'], ['lastName', 'Legal last name'],
                    ['addressLine1', 'Address line 1'], ['addressLine2', 'Address line 2 (optional)'],
                    ['city', 'City'], ['state', 'State'], ['zip', 'ZIP'],
                  ].map(([key, label]) => (
                    <label key={key} className={key === 'addressLine1' || key === 'addressLine2' ? 'col-span-2' : ''}>
                      <span className="mb-1 block text-[8px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
                      <input
                        value={identityDraft[key] || ''}
                        onChange={(event) => updateIdentityDraft(key, key === 'state' ? event.target.value.toUpperCase().slice(0, 2) : event.target.value)}
                        maxLength={key === 'lastName' ? 150 : key.startsWith('address') ? 200 : key === 'state' ? 2 : 100}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[10px]"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 space-y-1 text-[9px]">
                  <div className={currentIdDocument && /^[0-9a-f]{64}$/.test(String(currentIdDocument.sha256 || '')) ? 'text-green-700' : 'text-red-700'}>
                    Government ID: {currentIdDocument?.file_name || 'missing'}{currentIdDocument && !currentIdDocument.sha256 ? ' · re-upload required for integrity evidence' : ''}
                  </div>
                  <div className={currentAddressDocument && /^[0-9a-f]{64}$/.test(String(currentAddressDocument.sha256 || '')) ? 'text-green-700' : 'text-red-700'}>
                    Proof of address: {currentAddressDocument?.file_name || 'missing'}{currentAddressDocument && !currentAddressDocument.sha256 ? ' · re-upload required for integrity evidence' : ''}
                  </div>
                </div>
                <label className="mt-3 flex items-start gap-2 text-[9px] leading-relaxed text-navy">
                  <input type="checkbox" checked={identityAttested} onChange={(event) => setIdentityAttested(event.target.checked)} className="mt-0.5" />
                  <span>I opened both current documents and confirm the typed legal name and mailing address match the client’s evidence exactly.</span>
                </label>
                <button
                  onClick={confirmLetterIdentity}
                  disabled={savingIdentity || !identityAttested || !currentIdentityDocumentsHaveIntegrity}
                  className="mt-3 w-full rounded-md bg-navy px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white disabled:opacity-40"
                >{savingIdentity ? 'Confirming…' : letterIdentity ? 'Save a new verified revision' : 'Confirm merge identity'}</button>
                {!!identityDocumentIssues.length && <div className="mt-2 text-[9px] font-medium leading-relaxed text-amber-800">{identityDocumentIssues.join(' ')}</div>}
              </div>

              <div className="space-y-2">
                {routing.workItems.map((item) => (
                  <WorkItemPill key={item.key} item={item} selected={item.key === workItem?.key} onClick={() => selectWorkItem(item.key)} />
                ))}
              </div>

              {workItem && (
                <div className="mt-4 rounded-lg border border-border bg-gray-50 p-3">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Locked route</div>
                  <div className="mt-1 text-[11px] font-semibold text-navy">{logicalFlowLabel(workItem.logicalFlow)} R{workItem.logicalRound} · {workItem.bureau.name}</div>
                  <div className="mt-1 text-[10px] text-gray-500">Physical template: {FLOW_LABELS[workItem.concreteFlow] || workItem.concreteFlow} R{workItem.concreteRound}</div>
                  <div className="mt-1 text-[9px] text-gray-400">{workItem.snapshots.map((snapshot) => `${snapshot.clientAccountId.slice(0, 8)}… rev ${snapshot.revision}`).join(' · ')}</div>
                </div>
              )}

              {workItem && (
                <div className="mt-4">
                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Exact active template</label>
                  {matches.length ? (
                    <select
                      value={selectedTemplate?.id || ''}
                      onChange={(event) => {
                        setTemplateIdsByKey((current) => ({ ...current, [workItem.key]: event.target.value }));
                        setSavedId(null);
                      }}
                      className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-[11px]"
                    >
                      {matches.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.version} · {template.bureau}</option>)}
                    </select>
                  ) : (
                    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">No active {FLOW_LABELS[workItem.concreteFlow] || workItem.concreteFlow} R{workItem.concreteRound} template matches {workItem.bureau.name}. Add the exact physical step under Settings → Templates.</div>
                  )}
                </div>
              )}

              {!!missingFactAccounts.length && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[10px] leading-relaxed text-red-700">
                  <strong>Confirmed issue facts required:</strong> {missingFactAccounts.map((account) => account.furnisher || account.clientAccountId).join('; ')}. The letter preview and save are blocked.
                </div>
              )}
              {!!missingAutomatic.length && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[10px] leading-relaxed text-red-700">
                  <strong>Correct the client profile/report:</strong> {missingAutomatic.map((token) => `{${token}}`).join(', ')} must be populated for this exact template. The preview and save are blocked.
                </div>
              )}
              {templateContractError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[10px] leading-relaxed text-red-700"><strong>Template contract blocked:</strong> {templateContractError}</div>}

              {selectedTemplate && templateTokens.includes('damages') && (
                <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-800"><Sparkles size={12} /> Encrypted AI personalization notes</div>
                    <button onClick={saveStoryNotes} disabled={savingStoryNotes || !storyNotesDirty} className="rounded-md bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-violet-800 shadow-sm disabled:opacity-40">
                      {savingStoryNotes ? 'Saving…' : storyNotesSaved ? 'Saved' : 'Save notes'}
                    </button>
                  </div>
                  <textarea
                    value={storyNotes}
                    onChange={(event) => {
                      storyNotesRevisionRef.current += 1;
                      rewriteRequestIdRef.current += 1;
                      setRewritingKey(null);
                      setRewriteProposal(null);
                      setStoryNotes(event.target.value);
                      setStoryNotesDirty(true);
                      setStoryNotesSaved(false);
                      setStoryNotesApprovedForAi(false);
                    }}
                    disabled={savingStoryNotes}
                    maxLength={8000}
                    rows={5}
                    className="mt-2 w-full rounded-md border border-violet-200 bg-white px-2.5 py-2 text-[11px] leading-relaxed"
                    placeholder="Confirmed personal facts: what happened, practical consequences, emotional impact the client actually described, and why correction matters to them."
                  />
                  <p className="mt-1 text-[9px] leading-relaxed text-violet-700">Stored encrypted and hidden from the client portal. Claude receives only these reviewed notes, the highlighted damages text, and the locked flow/bureau context. Do not include SSNs, birth dates, account/ID numbers, contact details, addresses, passwords, or health information.</p>
                  <label className="mt-2 flex items-start gap-2 text-[9px] leading-relaxed text-violet-900">
                    <input type="checkbox" checked={storyNotesApprovedForAi} onChange={(event) => setStoryNotesApprovedForAi(event.target.checked)} disabled={savingStoryNotes || !storyNotes.trim()} className="mt-0.5 accent-violet-700" />
                    <span>I reviewed this AI-safe excerpt. It contains only confirmed story facts approved for Claude and none of the prohibited personal data above.</span>
                  </label>
                </div>
              )}

              {selectedTemplate && HUMAN_FIELDS.filter((field) => templateTokens.includes(field.key)).map((field) => (
                <div key={field.key} className="mt-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-navy">{field.label}</label>
                    {field.key === 'damages' && (
                      <button
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={rewriteSelectedDamages}
                        disabled={!!rewritingKey || savingStoryNotes}
                        className="flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-violet-800 disabled:opacity-40"
                        title="Highlight text in the Damages box first; Claude will suggest a replacement without changing the fixed template language"
                      >
                        {rewritingKey === selectionKey(field.key) ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Rewrite selected
                      </button>
                    )}
                  </div>
                  <textarea
                    value={sections[field.key] || ''}
                    onChange={(event) => {
                      if (field.key === 'damages') {
                        rewriteRequestIdRef.current += 1;
                        setRewritingKey(null);
                      }
                      setSection(field.key, event.target.value);
                      if (rewriteProposal?.fieldKey === field.key) setRewriteProposal(null);
                    }}
                    onSelect={(event) => captureSelection(field.key, event)}
                    rows={field.rows}
                    className="w-full rounded-md border border-border px-2.5 py-2 text-[11px] leading-relaxed"
                  />
                  <div className="mt-1 text-[9px] leading-relaxed text-gray-400">{field.help}</div>
                  {field.key === 'damages' && <div className="mt-1 text-[9px] text-violet-600">Highlight only the passage you want changed. Claude cannot edit the fixed course template or apply a suggestion automatically.</div>}
                  {rewriteProposal?.key === selectionKey(field.key) && (
                    <div className="mt-2 rounded-lg border border-violet-200 bg-white p-3 shadow-sm">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-violet-800">Claude suggestion — review before applying</div>
                      {rewriteProposal.warning && <div className="mt-2 rounded bg-amber-50 p-2 text-[9px] leading-relaxed text-amber-800">{rewriteProposal.warning}</div>}
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div><div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-gray-400">Original</div><div className="rounded bg-gray-50 p-2 text-[10px] leading-relaxed text-gray-600">{rewriteProposal.selectedText}</div></div>
                        <div><div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-violet-500">Suggested replacement</div><div className="rounded bg-violet-50 p-2 text-[10px] leading-relaxed text-violet-900">{rewriteProposal.replacement}</div></div>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button onClick={acceptRewrite} className="rounded-md bg-violet-700 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white">Use rewrite</button>
                        <button onClick={() => setRewriteProposal(null)} className="rounded-md border border-gray-200 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">Keep original</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {screenshotsRequired && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">{screenshotPolicy.label} required</div>
                  <p className="mt-1 text-[10px] font-medium leading-relaxed text-amber-800">{screenshotPolicy.staffInstructions}</p>
                  <p className="mt-1 text-[9px] leading-relaxed text-amber-700">Your team reviews and crops each image, then assigns it to the exact account below. CCC appends the approved exhibits to the Lob packet; Claude does not choose the crop.</p>
                  <div className="mt-3 space-y-2">
                    {(workItem?.accounts || []).map((account) => {
                      const accountKey = disputeAccountKey(account);
                      const accountScreenshots = screenshots.filter((item) => disputeAccountKey(item) === accountKey);
                      return (
                        <div key={accountKey} className={`rounded-md border p-2.5 ${accountScreenshots.length ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-white'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[10px] font-semibold text-navy">{account.furnisher || 'Unknown furnisher'}</div>
                              <div className="mt-0.5 text-[9px] text-gray-500">{maskAccountNumber(account.accountNumberMasked || account.accountNumber) || 'Account number not shown'} · {accountScreenshots.length ? `${accountScreenshots.length} attached` : 'Screenshot missing'}</div>
                            </div>
                            <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md bg-navy px-2 py-1 text-[9px] font-semibold text-white">
                              <ImagePlus size={10} /> Add
                              <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => uploadScreenshots(event, account)} />
                            </label>
                          </div>
                          {!!accountScreenshots.length && (
                            <div className="mt-2 space-y-1">
                              {accountScreenshots.map((item) => (
                                <div key={item.id} className="flex items-center justify-between gap-2 rounded bg-white/80 px-2 py-1 text-[9px] text-gray-600">
                                  <span className="truncate">{item.fileName}</span>
                                  <button
                                    onClick={() => {
                                      setScreenshotsByKey((current) => ({ ...current, [workItem.key]: (current[workItem.key] || []).filter((candidate) => candidate.id !== item.id) }));
                                      setSavedId(null);
                                    }}
                                    className="text-red-600"
                                  >Remove</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!!missingScreenshotCoverage.length && <div className="mt-2 text-[9px] font-semibold text-amber-800">Save blocked until every listed account has at least one screenshot.</div>}
                </div>
              )}

              {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">{error}</div>}
              {savedId && <div className="mt-4 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-[11px] text-green-700"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /> Saved with the exact template, automatic merge inputs, account evidence, and server track revisions.</div>}

              <button
                onClick={saveCampaignLetter}
                disabled={saving || savingIdentity || savingStoryNotes || !!rewritingKey || !identityReady || !selectedTemplate || !workItem || !isCraTemplate
                  || !!templateContractError || unknown.length > 0 || missingFactAccounts.length > 0
                  || missingAutomatic.length > 0 || missingScreenshotCoverage.length > 0}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A84C] py-3 text-[10px] font-bold uppercase tracking-wider text-[#121F38] disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save locked {workItem ? `R${workItem.logicalRound}` : ''} CRA letter
              </button>
              {!!unknown.length && <div className="mt-2 text-[9px] text-red-600">Unsupported curlys: {unknown.map((token) => `{${token}}`).join(', ')}</div>}
            </aside>

            <section className="min-h-0 bg-slate-200/70 p-5">
              {letterHtml ? (
                <iframe title="Merged campaign letter preview" srcDoc={letterHtml} sandbox="allow-same-origin" className="h-full w-full rounded-lg bg-white shadow-lg" />
              ) : (
                <div className="flex h-full items-center justify-center text-center text-gray-500">
                  <div><FileText size={38} className="mx-auto mb-3 text-gray-400" /><div className="text-sm font-semibold">Letter preview blocked</div><div className="mt-1 max-w-md text-xs">CCC needs an exact active physical template, complete automatic profile fields, and confirmed issue facts for every covered account.</div></div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
