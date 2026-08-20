import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, ImagePlus, Loader2, Save, Sparkles, X } from 'lucide-react';
import { readClientSensitiveData, writeClientSensitiveData } from '../utils/clientSensitiveData.js';
import { buildR1CampaignPlan, FLOW_LABELS, flowRoundLabel } from '../utils/disputeFlow.js';
import {
  buildAutomaticTemplateValues,
  extractTemplateTokens,
  renderDisputeTemplate,
  unknownTemplateTokens,
  wrapDisputeLetterHtml,
} from '../utils/disputeTemplateEngine.js';
import { listDisputeTemplates, templatesForRecommendation } from '../utils/disputeTemplates.js';
import { requestDisputeRewrite } from '../utils/disputeRewriteApi.js';
import { replaceDisputeSelection } from '../utils/disputeRewriteRules.js';
import { saveLetter } from '../utils/storage.js';
import { supabase } from '../utils/supabase.js';

const HUMAN_FIELDS = [
  { key: 'damages', label: 'Damages / client story', rows: 5, help: 'Client-supplied facts only. Write a different opening for each bureau.' },
  { key: 'personalization', label: 'Facts / exact inaccuracies', rows: 6, help: 'Account-specific fields and bureau values. Do not change the template’s fixed legal facts.' },
  { key: 'penalty', label: 'Penalty / deadline', rows: 3, help: 'The R1 consequence paragraph written for this bureau.' },
  { key: 'consumer_statement', label: 'Consumer statement', rows: 4, help: 'What the reporting is doing, why this flow applies, and the requested deadline.' },
  { key: 'optional_strengthener', label: 'Optional strengthener', rows: 2, help: 'Use only when the template calls for it and the supporting client fact is confirmed.' },
];

const blankSections = () => Object.fromEntries(HUMAN_FIELDS.map((field) => [field.key, '']));

async function loadClientIdentity(audit) {
  const clientId = audit?.client?.id;
  let rows;
  if (clientId) {
    const { data, error } = await supabase.from('clients').select('id,name,address,date_of_birth').eq('id', clientId).limit(1);
    if (error) throw error;
    rows = data || [];
  } else {
    const { data, error } = await supabase.from('clients').select('id,name,address,date_of_birth').eq('name', audit?.client?.name || '').limit(2);
    if (error) throw error;
    rows = data || [];
    if (rows.length > 1) throw new Error('More than one client has this name. Open the audit from the client record so CCC can use the correct identity.');
  }
  const client = rows[0];
  if (!client) throw new Error('Client profile not found. Save the audit to a client before building a campaign.');
  const sensitive = await readClientSensitiveData(client.name, client.id, ['ssnLast4', 'disputeStoryNotes']);
  return {
    id: client.id,
    name: client.name,
    address: client.address || audit?.client?.address || '',
    dateOfBirth: client.date_of_birth || audit?.personalInfo?.dateOfBirth || '',
    ssnLast4: sensitive?.ssnLast4 || '',
    disputeStoryNotes: sensitive?.disputeStoryNotes || '',
    disputeStoryNotesVersion: sensitive?.disputeStoryNotesVersion || '',
  };
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, size: file.size, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

const SAFE_SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function FlowPill({ recommendation }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Recommended R1</div>
      <div className="mt-0.5 text-[12px] font-semibold text-navy">{flowRoundLabel(recommendation.flow, 1)}</div>
      <div className="mt-1 text-[10px] text-gray-500">{recommendation.accounts.length} account{recommendation.accounts.length === 1 ? '' : 's'} in this letter</div>
    </div>
  );
}

export default function DisputeCampaignStudio({ audit, onClose, onSaved }) {
  const plan = useMemo(() => buildR1CampaignPlan(audit), [audit]);
  const firstBureau = plan.bureaus.find((item) => item.recommendations.length)?.bureau.code || 'EQ';
  const [bureauCode, setBureauCode] = useState(firstBureau);
  const [flow, setFlow] = useState(() => plan.bureaus.find((item) => item.bureau.code === firstBureau)?.primary?.flow || 'accuracy');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [identity, setIdentity] = useState(null);
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
  const auditClientKey = audit?.client?.id || audit?.client?.name || '';

  useEffect(() => {
    let active = true;
    clientGenerationRef.current += 1;
    rewriteRequestIdRef.current += 1;
    storyNotesRevisionRef.current += 1;
    setLoading(true);
    setError(null);
    setIdentity(null);
    setBureauCode(firstBureau);
    setFlow(plan.bureaus.find((item) => item.bureau.code === firstBureau)?.primary?.flow || 'accuracy');
    setTemplateId('');
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
    Promise.all([listDisputeTemplates({ activeOnly: true }), loadClientIdentity(audit)])
      .then(([templateRows, clientIdentity]) => {
        if (!active) return;
        setTemplates(templateRows);
        setIdentity(clientIdentity);
        setStoryNotes(clientIdentity.disputeStoryNotes || '');
        setStoryNotesVersion(clientIdentity.disputeStoryNotesVersion || '');
      })
      .catch((err) => { if (active) setError(err.message || 'Could not prepare the campaign.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [auditClientKey]);

  const bureauPlan = plan.bureaus.find((item) => item.bureau.code === bureauCode) || plan.bureaus[0];
  const recommendation = bureauPlan.recommendations.find((item) => item.flow === flow) || bureauPlan.primary;
  const workKey = `${bureauCode}:${recommendation?.flow || flow}`;
  const sections = sectionsByKey[workKey] || blankSections();
  const screenshots = screenshotsByKey[workKey] || [];
  const matches = recommendation ? templatesForRecommendation(templates, recommendation, bureauCode) : [];

  useEffect(() => {
    if (!recommendation) return;
    if (!matches.some((template) => template.id === templateId)) setTemplateId(matches[0]?.id || '');
  }, [bureauCode, recommendation?.flow, templates.length]);

  const selectedTemplate = matches.find((template) => template.id === templateId) || matches[0] || null;
  const autoValues = buildAutomaticTemplateValues({
    identity,
    audit,
    bureau: bureauPlan.bureau,
    accounts: recommendation?.accounts || [],
    screenshots,
  });
  const values = { ...autoValues, ...sections };
  const templateTokens = extractTemplateTokens(selectedTemplate?.body || '');
  const unknown = selectedTemplate ? unknownTemplateTokens(selectedTemplate.body, values) : [];
  const requiredMissing = templateTokens.filter((token) => Object.prototype.hasOwnProperty.call(values, token) && !String(values[token] || '').trim() && token !== 'screenshots');
  const screenshotsRequired = recommendation && (recommendation.flow === 'accuracy' || recommendation.flow === 'combo');
  const bodyHtml = selectedTemplate ? renderDisputeTemplate(selectedTemplate.body, values, ['screenshots']) : '';
  const letterHtml = selectedTemplate ? wrapDisputeLetterHtml(bodyHtml, `${bureauPlan.bureau.name} ${FLOW_LABELS[recommendation?.flow]} R1`) : '';

  const setSection = (key, value) => {
    setSectionsByKey((current) => ({ ...current, [workKey]: { ...(current[workKey] || blankSections()), [key]: value } }));
    setSavedId(null);
  };

  const selectionKey = (fieldKey) => `${workKey}:${fieldKey}`;

  const captureSelection = (fieldKey, event) => {
    const value = event.currentTarget.value;
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    setSelectionsByKey((current) => ({
      ...current,
      [selectionKey(fieldKey)]: { start, end, selectedText: value.slice(start, end) },
    }));
  };

  const saveStoryNotes = async () => {
    if (!identity?.id) return false;
    const submittedGeneration = clientGenerationRef.current;
    const submittedRevision = storyNotesRevisionRef.current;
    const submittedNotes = storyNotes.trim();
    setSavingStoryNotes(true);
    setError(null);
    try {
      const result = await writeClientSensitiveData(identity.name, {
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
    } catch (err) {
      if (clientGenerationRef.current === submittedGeneration) {
        setError(err.message || 'Could not save the encrypted personalization notes.');
      }
      return '';
    } finally {
      if (clientGenerationRef.current === submittedGeneration) setSavingStoryNotes(false);
    }
  };

  const rewriteSelectedDamages = async () => {
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
        flow: recommendation.flow,
        round: 1,
        bureau: bureauCode,
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
    } catch (err) {
      if (rewriteRequestIdRef.current === requestId) setError(err.message || 'Claude could not rewrite that selection.');
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
    } catch (err) {
      setError(err.message || 'The paragraph changed after the suggestion was created. Select it again.');
    }
  };

  const selectBureau = (code) => {
    rewriteRequestIdRef.current += 1;
    setBureauCode(code);
    const next = plan.bureaus.find((item) => item.bureau.code === code)?.primary;
    if (next) setFlow(next.flow);
    setSavedId(null);
    setRewriteProposal(null);
    setRewritingKey(null);
  };

  const selectFlow = (nextFlow) => {
    rewriteRequestIdRef.current += 1;
    setFlow(nextFlow);
    setSavedId(null);
    setRewriteProposal(null);
    setRewritingKey(null);
  };

  const uploadScreenshots = async (event) => {
    const uploadGeneration = clientGenerationRef.current;
    const selectedFiles = [...(event.target.files || [])];
    const files = selectedFiles.filter((file) => SAFE_SCREENSHOT_TYPES.has(file.type));
    if (!files.length) return;
    setError(null);
    try {
      if (screenshots.length + files.length > 10) throw new Error('Use no more than 10 screenshots in one letter.');
      if (files.length !== selectedFiles.length) throw new Error('Screenshots must be PNG, JPEG, or WebP files.');
      if (files.some((file) => file.size > 8 * 1024 * 1024)) throw new Error('Each screenshot must be 8 MB or smaller.');
      const existingBytes = screenshots.reduce((total, item) => total + Number(item.size || 0), 0);
      const addedBytes = files.reduce((total, file) => total + file.size, 0);
      if (existingBytes + addedBytes > 24 * 1024 * 1024) throw new Error('Keep the combined screenshots under 24 MB.');
      const added = await Promise.all(files.map(readImage));
      if (clientGenerationRef.current !== uploadGeneration) return;
      setScreenshotsByKey((current) => ({ ...current, [workKey]: [...(current[workKey] || []), ...added] }));
    } catch (err) {
      if (clientGenerationRef.current === uploadGeneration) setError(err.message || 'Could not add screenshots.');
    } finally {
      event.target.value = '';
    }
  };

  const saveCampaignLetter = async () => {
    if (!identity?.id || !recommendation || !selectedTemplate) return;
    const saveGeneration = clientGenerationRef.current;
    if (unknown.length) { setError(`Template has unsupported curlys: ${unknown.map((token) => `{${token}}`).join(', ')}`); return; }
    if (requiredMissing.length) { setError(`Complete these fields before saving: ${requiredMissing.map((token) => `{${token}}`).join(', ')}`); return; }
    if (screenshotsRequired && !templateTokens.includes('screenshots')) {
      setError('Accuracy and Combo R1 templates must contain {screenshots}. Add the curly in Settings → Templates before using this template.');
      return;
    }
    if (screenshotsRequired && !screenshots.length) {
      setError('This flow requires report screenshots. Upload them before saving the letter.');
      return;
    }
    if (storyNotesDirty && !(await saveStoryNotes())) return;
    if (clientGenerationRef.current !== saveGeneration) return;
    setSaving(true);
    setError(null);
    try {
      const syntheticAccount = {
        id: `ccc-${recommendation.flow}-r1-${bureauCode.toLowerCase()}`,
        furnisher: bureauPlan.bureau.name,
        type: null,
      };
      const id = await saveLetter(
        syntheticAccount,
        { ...audit.client, id: identity.id, name: identity.name, address: identity.address },
        letterHtml,
        `${FLOW_LABELS[recommendation.flow]} R1 prepared for ${bureauPlan.bureau.name}.`,
        `Phase 1 — ${FLOW_LABELS[recommendation.flow]} R1 — ${bureauPlan.bureau.name}`,
        '',
        {
          coveredFurnishers: recommendation.accounts.map((account) => account.furnisher).filter(Boolean),
          disputeTemplateId: selectedTemplate.id,
          disputeTemplateName: `${selectedTemplate.name} ${selectedTemplate.version}`.trim(),
          disputeFlowCode: recommendation.flow,
          disputeRoundNumber: 1,
          disputeBureauCode: bureauCode,
          disputeTemplateSnapshot: selectedTemplate.body,
          disputeEditableSections: sections,
        },
      );
      if (clientGenerationRef.current !== saveGeneration) return;
      setSavedId(id);
      onSaved?.(id);
    } catch (err) {
      if (clientGenerationRef.current === saveGeneration) setError(err.message || 'Could not save the campaign letter.');
    } finally {
      if (clientGenerationRef.current === saveGeneration) setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-[#F7F4ED] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between bg-[#121F38] px-6 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#C9A84C]">CCC Dispute Campaign</div>
            <div className="text-lg font-semibold text-white">R1 Template Builder · {audit?.client?.name}</div>
          </div>
          <button onClick={onClose} className="p-1 text-white/60 hover:text-white"><X size={19} /></button>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500"><Loader2 size={18} className="animate-spin" /> Loading client fields and template library…</div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[430px_1fr]">
            <aside className="overflow-y-auto border-r border-gray-200 bg-white p-5">
              <div className="grid grid-cols-3 gap-2">
                {plan.bureaus.map((item) => (
                  <button key={item.bureau.code} onClick={() => selectBureau(item.bureau.code)} className={`rounded-lg border px-2 py-2 text-[10px] font-bold uppercase tracking-wider ${bureauCode === item.bureau.code ? 'border-navy bg-navy text-gold' : 'border-border text-gray-500'}`}>
                    {item.bureau.name}
                  </button>
                ))}
              </div>

              {bureauPlan.recommendations.length ? (
                <div className="mt-4 space-y-2">
                  {bureauPlan.recommendations.map((item) => (
                    <button key={item.flow} onClick={() => selectFlow(item.flow)} className="block w-full text-left">
                      <FlowPill recommendation={item} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">No deterministic R1 recommendation is available for this bureau. Review the account classifications below.</div>
              )}

              {recommendation && (
                <div className="mt-4">
                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Template</label>
                  {matches.length ? (
                    <select value={selectedTemplate?.id || ''} onChange={(event) => setTemplateId(event.target.value)} className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-[11px]">
                      {matches.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.version} · {template.bureau}</option>)}
                    </select>
                  ) : (
                    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">No active {FLOW_LABELS[recommendation.flow]} R1 template. Add one under Settings → Templates.</div>
                  )}
                </div>
              )}

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
                  <p className="mt-1 text-[9px] leading-relaxed text-violet-700">Stored encrypted and hidden from the client portal. When you request a rewrite, CCC sends Claude only these notes, the highlighted damages text, and the flow/bureau context. Never put names beyond what the passage needs, SSNs, dates of birth, account/ID numbers, contact details, passwords, addresses, or medical/health information here.</p>
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
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Screenshots required by this flow</div>
                  <p className="mt-1 text-[10px] leading-relaxed text-amber-700">Upload the reviewed account screenshots here. Automatic report-page cropping is the next build; this release does not guess the crop.</p>
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-[10px] font-semibold text-navy shadow-sm">
                    <ImagePlus size={12} /> Add screenshots
                    <input type="file" accept="image/*" multiple className="hidden" onChange={uploadScreenshots} />
                  </label>
                  {!!screenshots.length && (
                    <div className="mt-2 space-y-1 text-[9px] text-gray-500">
                      {screenshots.map((item, index) => (
                        <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-2">
                          <span className="truncate">{item.name}</span>
                          <button onClick={() => setScreenshotsByKey((current) => ({ ...current, [workKey]: (current[workKey] || []).filter((_, i) => i !== index) }))} className="text-red-600">Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!!bureauPlan.needsReview.length && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-700"><AlertCircle size={12} /> Classification review</div>
                  {bureauPlan.needsReview.map((item, index) => <div key={index} className="mt-1 text-[10px] text-red-700">{item.account.furnisher}: {item.reason}</div>)}
                </div>
              )}
              {!!bureauPlan.deferred.length && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Not in this opening letter</div>
                  <p className="mt-1 text-[9px] leading-relaxed text-gray-500">CCC recommends one R1 letter per bureau. These separately classified accounts stay visible for the next staff decision.</p>
                  {bureauPlan.deferred.map((item, index) => <div key={index} className="mt-1 text-[10px] text-gray-600">{item.account.furnisher}: {FLOW_LABELS[item.flow]} R1</div>)}
                </div>
              )}

              {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-700">{error}</div>}
              {savedId && <div className="mt-4 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-[11px] text-green-700"><CheckCircle2 size={14} className="mt-0.5 shrink-0" /> Saved to the client’s Letters campaign with the template snapshot and team-written sections.</div>}

              <button onClick={saveCampaignLetter} disabled={saving || savingStoryNotes || !!rewritingKey || !selectedTemplate || !recommendation || unknown.length > 0} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#C9A84C] py-3 text-[10px] font-bold uppercase tracking-wider text-[#121F38] disabled:opacity-40">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save R1 campaign letter
              </button>
              {!!unknown.length && <div className="mt-2 text-[9px] text-red-600">Unsupported curlys: {unknown.map((token) => `{${token}}`).join(', ')}</div>}
            </aside>

            <section className="min-h-0 bg-slate-200/70 p-5">
              {letterHtml ? (
                <iframe title="Merged campaign letter preview" srcDoc={letterHtml} sandbox="allow-same-origin" className="h-full w-full rounded-lg bg-white shadow-lg" />
              ) : (
                <div className="flex h-full items-center justify-center text-center text-gray-500">
                  <div><FileText size={38} className="mx-auto mb-3 text-gray-400" /><div className="text-sm font-semibold">Select a routed template</div><div className="mt-1 text-xs">The exact stored language will appear here with the curlys merged.</div></div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
