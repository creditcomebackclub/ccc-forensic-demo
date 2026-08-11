import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Circle, FileText, Loader2, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  approveCampaignLetter, createCampaignFromAudit, getCampaignWorkspace, getReviewedPriorSources,
  replaceConfiguredRoutes, updateCampaign, updateCampaignItemStates,
} from '../../utils/campaigns.js';
import { generateCampaignAccountRoute, generateCampaignCleanupRoute, generateInterimLetter } from '../../utils/api.js';
import { buildCleanupRouteGroups, getCampaignItemBureaus } from '../../utils/campaignItems.js';
import { isCampaignSelectionLocked } from '../../utils/campaignSelection.js';
import { canMailLetter } from '../../utils/letterGeneration.js';
import { campaignReadyForTracking, isCancelledMail, isMailedMail } from '../../utils/campaignMailing.js';

const T = { navy: '#1B2A4A', gold: '#C9A84C', border: '#E7EAF0', grid: '#EEF0F4', ink: '#111827', muted: '#6B7280', faint: '#9CA3AF' };
const BUREAUS = ['equifax', 'experian', 'transunion'];
const BUREAU_LABEL = { equifax: 'Equifax', experian: 'Experian', transunion: 'TransUnion' };
const STAGES = [
  ['audit', 'Audit'], ['select_disputes', 'Disputes'], ['configure_letters', 'Build'],
  ['letter_review', 'Review'], ['mailing', 'Mail'], ['awaiting_responses', 'Track'],
];

function normalizedStage(stage) {
  if (stage === 'response_review' || stage === 'closed') return 'awaiting_responses';
  return STAGES.some(([key]) => key === stage) ? stage : 'select_disputes';
}

function stageIndex(stage) {
  return STAGES.findIndex(([key]) => key === normalizedStage(stage));
}

function activeBureaus(item) {
  const matched = getCampaignItemBureaus(item);
  return matched.length ? matched : (item.kind === 'personal_info' ? BUREAUS : []);
}

function itemTone(kind) {
  return kind === 'account' ? ['Account', '#EEF1F7', '#294576'] : kind === 'inquiry' ? ['Inquiry', '#FFF7ED', '#9A5B13'] : ['Personal info', '#F5F3FF', '#6D4DB1'];
}

function toUiLetter(letter) {
  if (!letter) return null;
  return {
    ...letter,
    clientId: letter.clientId || letter.client_id || null,
    clientName: letter.clientName || letter.client_name || null,
    accountId: letter.accountId || letter.account_id || '',
    clientAccountId: letter.clientAccountId || letter.client_account_id || null,
    targetType: letter.targetType || letter.target_type || null,
    targetBureau: letter.targetBureau || letter.target_bureau || null,
    mailedDate: letter.mailedDate || letter.mailed_date || null,
    trackingNumber: letter.trackingNumber || letter.tracking_number || null,
    trackingStatus: letter.trackingStatus || letter.tracking_status || null,
    responseOutcome: letter.responseOutcome || letter.response_outcome || null,
    responseDate: letter.responseDate || letter.response_date || null,
  };
}

function CampaignRail({ lifecycleStage, viewStage, canNavigate, onNavigate }) {
  const progressIndex = stageIndex(lifecycleStage);
  return (
    <div className="bg-white rounded-2xl px-4 py-4 overflow-x-auto" style={{ border: `1px solid ${T.border}` }}>
      <div className="flex items-center min-w-[650px]">
        {STAGES.map(([key, label], index) => {
          const done = index < progressIndex;
          const current = key === viewStage;
          const enabled = canNavigate(key);
          return <React.Fragment key={key}>
            {index > 0 && <div className="h-px flex-1" style={{ background: index <= progressIndex ? T.gold : '#DDE1E8' }} />}
            <button
              type="button"
              disabled={!enabled}
              onClick={() => onNavigate(key)}
              aria-current={current ? 'step' : undefined}
              title={enabled ? `Open ${label}` : `${label} unlocks when the prior campaign work is complete`}
              className="flex flex-col items-center gap-1.5 min-w-[72px] rounded-xl py-1.5 transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: current ? '#FBF7EA' : 'transparent', boxShadow: current ? `0 0 0 1px ${T.gold}` : 'none' }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: done ? T.navy : index === progressIndex ? T.gold : '#F3F4F6', color: done ? T.gold : index === progressIndex ? T.navy : T.faint, border: `1px solid ${index <= progressIndex ? T.gold : '#DDE1E8'}` }}>
                {done ? <Check size={13} strokeWidth={2.5} /> : <span className="text-[10px] font-semibold">{index + 1}</span>}
              </div>
              <span className="text-[9px] uppercase tracking-[0.1em] font-semibold" style={{ color: current ? T.navy : T.muted }}>{label}</span>
            </button>
          </React.Fragment>;
        })}
      </div>
      <p className="text-[9px] text-center mt-2 min-w-[650px]" style={{ color: T.faint }}>Click an available step to revisit its workspace. Future steps unlock only when their required work is complete.</p>
    </div>
  );
}

function EmptyCampaign({ client, latestAudit, onStart, busy, onOpenAudit }) {
  return (
    <div className="bg-white rounded-2xl p-8 text-center" style={{ border: `1px solid ${T.border}` }}>
      <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: '#FBF7EA', color: T.gold }}><ShieldCheck size={23} /></div>
      <h2 className="ccc-display text-[20px] font-semibold" style={{ color: T.navy }}>{latestAudit ? 'Start the next dispute campaign' : 'Run the forensic audit first'}</h2>
      <p className="text-[12px] max-w-lg mx-auto mt-2 mb-5 leading-relaxed" style={{ color: T.muted }}>
        {latestAudit ? `Use the frozen findings from the ${latestAudit.reportDate || 'latest'} audit to select accounts, personal information, and inquiries for one coordinated round.` : 'The command center begins with a completed Claude forensic report analysis.'}
      </p>
      {latestAudit ? (
        <button onClick={onStart} disabled={busy || client.engagementStatus !== 'active'} className="px-5 py-2.5 rounded-lg text-[11px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>
          {busy ? 'Preparing…' : 'Start campaign from latest audit'}
        </button>
      ) : <button onClick={() => onOpenAudit?.(client)} className="px-5 py-2.5 rounded-lg text-[11px] uppercase tracking-wider font-semibold" style={{ background: T.navy, color: T.gold }}>Run Audit</button>}
      {client.engagementStatus !== 'active' && latestAudit && <p className="text-[11px] text-amber-700 mt-3">New dispute work requires an Active engagement. Existing obligations remain available.</p>}
    </div>
  );
}

function DisputePicker({ workspace, onState, onBulkState, onContinue, busy, readOnly = false, hasDraftRoutes = false }) {
  const groups = [
    ['account', 'Accounts'], ['personal_info', 'Personal Information'], ['inquiry', 'Hard Inquiries'],
  ];
  const selected = workspace.items.filter((item) => item.selectionState === 'selected').length;
  const later = workspace.items.filter((item) => item.selectionState === 'later').length;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl px-5 py-4 flex items-center justify-between gap-4" style={{ border: `1px solid ${T.border}` }}>
        <div><div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.gold }}>Round {workspace.campaign.roundNumber}</div><h2 className="ccc-display text-[19px] font-semibold mt-0.5" style={{ color: T.navy }}>{readOnly ? 'Review this round’s saved disputes' : 'Choose this round’s disputes'}</h2><p className="text-[11px] mt-1" style={{ color: T.muted }}>{readOnly ? 'This selection is locked because a downstream letter already exists. Existing generated or mailed packets will not be silently changed.' : hasDraftRoutes ? 'You can still edit this round. The first change clears its saved, ungenerated routes so Build can be configured from the revised selection.' : 'Selected items move to letter strategy. “Later round” stays in the carry-forward queue.'}</p></div>
        <div className="text-right shrink-0"><div className="text-[20px] font-semibold" style={{ color: T.navy }}>{selected}</div><div className="text-[9px] uppercase tracking-wider" style={{ color: T.faint }}>selected · {later} later</div></div>
      </div>
      {groups.map(([kind, title]) => {
        const rows = workspace.items.filter((item) => item.kind === kind);
        if (!rows.length) return null;
        const supportsBulkSelection = kind === 'personal_info' || kind === 'inquiry';
        const allSelected = rows.every((item) => item.selectionState === 'selected');
        return <div key={kind} className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
          <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${T.grid}` }}>
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold" style={{ color: T.navy }}>{title} <span style={{ color: T.faint }}>({rows.length})</span></div>
            {supportsBulkSelection && <div className="flex items-center gap-1.5">
              <button onClick={() => onBulkState(rows, 'selected')} disabled={busy || readOnly || allSelected} className="px-2.5 py-1.5 rounded-md text-[9px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: allSelected ? '#ECFDF3' : T.navy, color: allSelected ? '#166534' : T.gold, border: `1px solid ${allSelected ? '#BBF7D0' : T.navy}` }}>{allSelected ? 'All selected ✓' : 'Select all'}</button>
              <button onClick={() => onBulkState(rows, 'candidate')} disabled={busy || readOnly || rows.every((item) => item.selectionState === 'candidate')} className="px-2.5 py-1.5 rounded-md text-[9px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: '#F7F8FA', color: T.muted, border: `1px solid ${T.border}` }}>Clear</button>
            </div>}
          </div>
          {rows.map((item) => {
            const [tag, bg, color] = itemTone(item.kind);
            return <div key={item.id} className="px-5 py-3 flex items-center gap-3" style={{ borderTop: `1px solid ${T.grid}` }}>
              <span className="text-[9px] uppercase tracking-wider px-2 py-1 rounded-md shrink-0" style={{ background: bg, color }}>{tag}</span>
              <div className="flex-1 min-w-0"><div className="text-[12px] font-medium truncate" style={{ color: T.ink }}>{item.label}</div>{item.kind === 'account' && <div className="text-[10px] mt-0.5 truncate" style={{ color: T.muted }}>{(item.snapshot.violations || []).length} supported finding{(item.snapshot.violations || []).length === 1 ? '' : 's'} · {(item.snapshot.bureaus || []).join('/') || 'bureau reporting unavailable'}</div>}</div>
              <div className="flex gap-1.5 shrink-0">
                {[['selected', 'This round'], ['later', 'Later round'], ['candidate', 'Skip round']].map(([state, label]) => <button key={state} onClick={() => onState(item, state)} disabled={busy || readOnly || item.selectionState === state} className="px-2.5 py-1.5 rounded-md text-[10px] font-medium disabled:cursor-not-allowed" style={{ background: item.selectionState === state ? T.navy : '#F7F8FA', color: item.selectionState === state ? '#fff' : T.muted, border: `1px solid ${item.selectionState === state ? T.navy : T.border}` }}>{label}</button>)}
              </div>
            </div>;
          })}
        </div>;
      })}
      {!readOnly && <div className="rounded-xl px-4 py-3 text-[10px] leading-relaxed" style={{ color: T.muted, background: '#FBF9F2', border: `1px solid ${T.border}` }}><span className="font-semibold" style={{ color: T.navy }}>Later round</span> carries the item into the next campaign when the same deterministic finding still exists in that round’s audit. <span className="font-semibold" style={{ color: T.navy }}>Skip round</span> excludes it from the carry-forward queue; a future audit can still surface it again as a new candidate.</div>}
      <div className="flex justify-end"><button onClick={onContinue} disabled={!selected || busy} className="px-5 py-2.5 rounded-lg text-[11px] uppercase tracking-wider font-semibold disabled:opacity-40 flex items-center gap-2" style={{ background: T.navy, color: T.gold }}>{readOnly ? 'Open Build' : 'Choose letter builder'} <ChevronRight size={13} /></button></div>
    </div>
  );
}

function BuilderChoice({ onChoose, onStandalone }) {
  const cards = [
    { key: 'guided', icon: <Sparkles size={22} />, title: 'Guided Round', subtitle: 'CCC forensic recommendations', body: 'Start with recipient and strategy defaults based on the selected audit items. Review every route before generation.', action: 'Build guided round' },
    { key: 'custom', icon: <FileText size={22} />, title: 'Custom Round', subtitle: 'Different strategy per item', body: 'Choose bureau, furnisher, both, and a deliberate letter style for each selected dispute item.', action: 'Configure routes' },
  ];
  return <div className="space-y-4"><div className="text-center py-2"><div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.gold }}>Letter Builder</div><h2 className="ccc-display text-[23px] font-semibold mt-1" style={{ color: T.navy }}>What type of letters do you want to build?</h2></div><div className="grid md:grid-cols-3 gap-4">{cards.map((card) => <button key={card.key} onClick={() => onChoose(card.key)} className="bg-white rounded-2xl p-5 text-left hover:-translate-y-0.5 transition-transform" style={{ border: `1px solid ${T.border}`, boxShadow: '0 4px 18px rgba(16,24,40,.05)' }}><div className="w-10 h-10 rounded-full flex items-center justify-center mb-4" style={{ background: '#FBF7EA', color: T.gold }}>{card.icon}</div><div className="text-[10px] uppercase tracking-wider" style={{ color: T.gold }}>{card.subtitle}</div><h3 className="ccc-display text-[18px] font-semibold mt-1" style={{ color: T.navy }}>{card.title}</h3><p className="text-[11px] leading-relaxed mt-2 min-h-[48px]" style={{ color: T.muted }}>{card.body}</p><div className="mt-4 text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1" style={{ color: T.navy }}>{card.action} <ChevronRight size={12} /></div></button>)}<button onClick={onStandalone} className="bg-white rounded-2xl p-5 text-left hover:-translate-y-0.5 transition-transform" style={{ border: `1px solid ${T.border}`, boxShadow: '0 4px 18px rgba(16,24,40,.05)' }}><div className="w-10 h-10 rounded-full flex items-center justify-center mb-4" style={{ background: '#F5F3FF', color: '#6D4DB1' }}><Mail size={22} /></div><div className="text-[10px] uppercase tracking-wider" style={{ color: '#6D4DB1' }}>Outside the active round</div><h3 className="ccc-display text-[18px] font-semibold mt-1" style={{ color: T.navy }}>Interim Letter</h3><p className="text-[11px] leading-relaxed mt-2 min-h-[48px]" style={{ color: T.muted }}>Open the existing standalone-letter workspace without changing this campaign’s round or deadlines.</p><div className="mt-4 text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1" style={{ color: T.navy }}>Open standalone letters <ChevronRight size={12} /></div></button></div></div>;
}

function RouteConfigurator({ workspace, mode, onSave, busy }) {
  const selected = workspace.items.filter((item) => item.selectionState === 'selected');
  const accounts = selected.filter((item) => item.kind === 'account');
  const cleanupGroups = buildCleanupRouteGroups(selected);
  const [cleanupBureaus, setCleanupBureaus] = useState(() => cleanupGroups.map((group) => group.targetBureau));
  const [config, setConfig] = useState(() => Object.fromEntries(accounts.map((item) => [item.id, {
    direct: true, bureaus: [], style: 'forensic',
    instructions: '',
  }])));
  const toggleBureau = (itemId, bureau) => setConfig((current) => ({ ...current, [itemId]: { ...current[itemId], bureaus: current[itemId].bureaus.includes(bureau) ? current[itemId].bureaus.filter((b) => b !== bureau) : [...current[itemId].bureaus, bureau] } }));
  const accountRoutes = accounts.flatMap((item) => {
    const value = config[item.id];
    return [
      ...(value.direct ? [{ itemId: item.id, itemIds: [item.id], targetType: 'furnisher', letterStyle: value.style, customInstructions: value.instructions }] : []),
      ...value.bureaus.map((bureau) => ({ itemId: item.id, targetType: 'bureau', targetBureau: bureau, letterStyle: value.style, customInstructions: value.instructions })),
    ];
  });
  const cleanupRoutes = cleanupGroups
    .filter((group) => cleanupBureaus.includes(group.targetBureau))
    .map((group) => ({
      itemId: group.itemIds[0], itemIds: group.itemIds, targetType: 'bureau',
      targetBureau: group.targetBureau, letterStyle: 'forensic', customInstructions: '',
    }));
  const routes = [...cleanupRoutes, ...accountRoutes];
  const invalidAccount = accounts.some((item) => {
    const value = config[item.id];
    return (!value.direct && !value.bureaus.length) || (value.style === 'custom' && !value.instructions.trim());
  });
  return <div className="space-y-4">
    <div className="bg-white rounded-2xl px-5 py-4" style={{ border: `1px solid ${T.border}` }}>
      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.gold }}>{mode === 'guided' ? 'Guided Round' : 'Custom Round'}</div>
      <h2 className="ccc-display text-[19px] font-semibold mt-0.5" style={{ color: T.navy }}>Configure recipients and letter strategy</h2>
      <p className="text-[11px] mt-1" style={{ color: T.muted }}>Cleanup findings are consolidated into one matching letter per bureau. Account disputes remain individually routed.</p>
    </div>
    {cleanupGroups.length > 0 && <div className="bg-white rounded-2xl p-4" style={{ border: `1px solid ${T.border}` }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#F5F3FF', color: '#6D4DB1' }}><FileText size={17} /></div>
        <div><div className="text-[12px] font-semibold" style={{ color: T.ink }}>Personal information & inquiry cleanup</div><div className="text-[10px] mt-1" style={{ color: T.muted }}>Each bureau receives only the selected items shown on its report—never one letter per inquiry.</div></div>
      </div>
      <div className="grid sm:grid-cols-3 gap-2 mt-4">{cleanupGroups.map((group) => {
        const enabled = cleanupBureaus.includes(group.targetBureau);
        return <button key={group.targetBureau} onClick={() => setCleanupBureaus((current) => enabled ? current.filter((bureau) => bureau !== group.targetBureau) : [...current, group.targetBureau])} className="p-3 rounded-xl text-left" style={{ background: enabled ? '#EEF6FF' : '#F7F8FA', border: `1px solid ${enabled ? '#91B9E6' : T.border}` }}>
          <div className="text-[11px] font-semibold" style={{ color: enabled ? '#235C9F' : T.muted }}>{BUREAU_LABEL[group.targetBureau]} {enabled ? '✓' : ''}</div>
          <div className="text-[9px] mt-1" style={{ color: T.muted }}>{group.personalInfoCount} personal info · {group.inquiryCount} inquir{group.inquiryCount === 1 ? 'y' : 'ies'} · 1 letter</div>
        </button>;
      })}</div>
    </div>}
    {accounts.map((item) => { const value = config[item.id]; const allowed = activeBureaus(item); return <div key={item.id} className="bg-white rounded-2xl p-4" style={{ border: `1px solid ${T.border}` }}>
      <div className="flex items-start gap-3"><div className="flex-1"><div className="text-[12px] font-semibold" style={{ color: T.ink }}>{item.label}</div><div className="text-[10px] mt-0.5 uppercase tracking-wider" style={{ color: T.faint }}>account</div></div><select value={value.style} onChange={(e) => setConfig((current) => ({ ...current, [item.id]: { ...current[item.id], style: e.target.value } }))} className="text-[11px] border rounded-lg px-2.5 py-2" style={{ borderColor: T.border, color: T.navy }}><option value="forensic">Forensic recommended</option><option value="metro2_accuracy">Metro 2 accuracy</option><option value="direct_furnisher">Direct furnisher</option><option value="custom">Custom strategy</option></select></div>
      <div className="flex flex-wrap gap-2 mt-4"><button onClick={() => setConfig((current) => ({ ...current, [item.id]: { ...current[item.id], direct: !current[item.id].direct } }))} className="px-3 py-2 rounded-lg text-[10px] font-semibold" style={{ background: value.direct ? T.navy : '#F7F8FA', color: value.direct ? T.gold : T.muted, border: `1px solid ${value.direct ? T.navy : T.border}` }}>Direct furnisher</button>{allowed.map((bureau) => <button key={bureau} onClick={() => toggleBureau(item.id, bureau)} className="px-3 py-2 rounded-lg text-[10px] font-semibold" style={{ background: value.bureaus.includes(bureau) ? '#EEF6FF' : '#F7F8FA', color: value.bureaus.includes(bureau) ? '#235C9F' : T.muted, border: `1px solid ${value.bureaus.includes(bureau) ? '#91B9E6' : T.border}` }}>{BUREAU_LABEL[bureau]}</button>)}</div>
      {value.style === 'custom' && <textarea value={value.instructions} onChange={(e) => setConfig((current) => ({ ...current, [item.id]: { ...current[item.id], instructions: e.target.value } }))} rows={3} className="w-full mt-3 border rounded-lg px-3 py-2 text-[11px] resize-none" style={{ borderColor: T.border }} placeholder="Give Claude supported strategic direction for this item. Frozen audit facts and citation checks still control the draft." />}
    </div>;})}
    <div className="flex justify-end"><button onClick={() => onSave(routes)} disabled={!routes.length || busy || invalidAccount} className="px-5 py-2.5 rounded-lg text-[11px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>{busy ? 'Saving…' : `Save ${routes.length} letter route${routes.length === 1 ? '' : 's'}`}</button></div>
  </div>;
}

function routeItems(route, itemById) {
  return (route.itemIds?.length ? route.itemIds : [route.itemId]).map((id) => itemById.get(id)).filter(Boolean);
}

function isCleanupRoute(route, itemById) {
  const items = routeItems(route, itemById);
  return items.length > 0 && items.every((item) => ['personal_info', 'inquiry'].includes(item.kind));
}

function routeDisplayName(route, itemById) {
  const items = routeItems(route, itemById);
  if (isCleanupRoute(route, itemById)) return `${BUREAU_LABEL[route.targetBureau] || 'Bureau'} cleanup letter`;
  const item = items[0];
  const target = route.targetType === 'bureau' ? BUREAU_LABEL[route.targetBureau] : 'direct furnisher';
  return `${item?.label || 'Account dispute'} → ${target}`;
}

function BuildQueue({ workspace, busy, generationProgress, onGenerate, onReview }) {
  const itemById = new Map(workspace.items.map((item) => [item.id, item]));
  const pending = workspace.routes.filter((route) => route.status !== 'generated');
  const cleanup = pending.filter((route) => isCleanupRoute(route, itemById));
  const accounts = pending.filter((route) => !isCleanupRoute(route, itemById));
  const runnable = pending.filter((route) => ['configured', 'failed'].includes(route.status));
  const cleanupRunnable = runnable.filter((route) => isCleanupRoute(route, itemById));
  const accountRunnable = runnable.filter((route) => !isCleanupRoute(route, itemById));
  const cleanupFailed = cleanup.filter((route) => route.status === 'failed');
  const accountFailed = accounts.filter((route) => route.status === 'failed');
  const running = pending.filter((route) => route.status === 'generating');
  const generated = workspace.routes.filter((route) => route.status === 'generated');
  const progressLabel = generationProgress ? `Generating ${generationProgress.completed + 1} of ${generationProgress.total}` : null;
  const cleanupButtonLabel = generationProgress?.kind === 'cleanup'
    ? `${progressLabel}…`
    : cleanupFailed.length && cleanupFailed.length === cleanupRunnable.length
      ? `Retry ${cleanupFailed.length} failed cleanup letter${cleanupFailed.length === 1 ? '' : 's'}`
      : 'Generate cleanup letters';
  const accountButtonLabel = generationProgress?.kind === 'accounts'
    ? `${progressLabel}…`
    : accountFailed.length && accountFailed.length === accountRunnable.length
      ? `Retry ${accountFailed.length} failed account route${accountFailed.length === 1 ? '' : 's'}`
      : 'Generate account letters';
  return <div className="space-y-4">
    <div className="bg-white rounded-2xl px-5 py-4" style={{ border: `1px solid ${T.border}` }}>
      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.gold }}>Generation queue</div>
      <h2 className="ccc-display text-[20px] font-semibold mt-0.5" style={{ color: T.navy }}>Choose what to generate first</h2>
      <p className="text-[11px] mt-1" style={{ color: T.muted }}>Cleanup letters can be reviewed and mailed before the account disputes. Every route still uses the existing Claude forensic letter pipeline.</p>
    </div>
    {generationProgress && <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ color: T.navy, background: '#EEF6FF', border: '1px solid #BFDBFE' }}>
      <Loader2 size={16} className="animate-spin shrink-0" />
      <div><div className="text-[11px] font-semibold">{progressLabel} · {generationProgress.current}</div><div className="text-[10px] mt-0.5" style={{ color: T.muted }}>Each route can take about 45–90 seconds. Completed siblings are preserved if another route fails.</div></div>
    </div>}
    {!generationProgress && running.length > 0 && <div className="rounded-xl px-4 py-3 text-[10px]" style={{ color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A' }}>
      {running.length} route{running.length === 1 ? ' is' : 's are'} still marked generating. Refresh shortly; mailing stays blocked until a final draft is saved.
    </div>}
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${T.border}` }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ background: '#F5F3FF', color: '#6D4DB1' }}><FileText size={20} /></div>
        <h3 className="ccc-display text-[17px] font-semibold" style={{ color: T.navy }}>File cleanup letters</h3>
        <p className="text-[11px] mt-1 min-h-[34px]" style={{ color: T.muted }}>{cleanup.length ? `${cleanup.length} bureau letter${cleanup.length === 1 ? '' : 's'}—one per bureau with its matching selected PI and inquiries.` : 'No ungenerated cleanup letters remain.'}</p>
        {cleanupFailed.length > 0 && <div className="text-[10px] mt-2 text-red-700">{cleanupFailed.length} failed route{cleanupFailed.length === 1 ? '' : 's'} ready to retry. Successful bureau letters will not be duplicated.</div>}
        <button disabled={busy || !cleanupRunnable.length} onClick={() => onGenerate(cleanupRunnable, 'cleanup')} className="mt-4 px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: '#6D4DB1', color: '#fff' }}>{cleanupButtonLabel}</button>
      </div>
      <div className="bg-white rounded-2xl p-5" style={{ border: `1px solid ${T.border}` }}>
        <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ background: '#FBF7EA', color: T.gold }}><Sparkles size={20} /></div>
        <h3 className="ccc-display text-[17px] font-semibold" style={{ color: T.navy }}>Account dispute letters</h3>
        <p className="text-[11px] mt-1 min-h-[34px]" style={{ color: T.muted }}>{accounts.length ? `${accounts.length} recipient route${accounts.length === 1 ? '' : 's'} for the selected account disputes.` : 'No ungenerated account-dispute letters remain.'}</p>
        {accountFailed.length > 0 && <div className="text-[10px] mt-2 text-red-700">{accountFailed.length} failed route{accountFailed.length === 1 ? '' : 's'} ready to retry.</div>}
        <button disabled={busy || !accountRunnable.length} onClick={() => onGenerate(accountRunnable, 'accounts')} className="mt-4 px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>{accountButtonLabel}</button>
      </div>
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      {generated.length > 0 && <button onClick={onReview} disabled={busy} className="px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.navy, border: `1px solid ${T.border}`, background: '#fff' }}>Review {generated.length} generated route{generated.length === 1 ? '' : 's'}</button>}
      <button disabled={busy || !runnable.length} onClick={() => onGenerate(runnable, 'all')} className="px-5 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>{generationProgress?.kind === 'all' ? `${progressLabel}…` : `Generate all ${runnable.length} remaining`}</button>
    </div>
  </div>;
}

function LetterReview({ workspace, clientLetters, selectedLetterId, setSelectedLetterId, onApprove, onReady, onBuildRemaining, busy }) {
  const routeByLetter = new Map(workspace.routes.flatMap((route) => route.letterIds.map((id) => [id, route])));
  const itemById = new Map(workspace.items.map((item) => [item.id, item]));
  const letters = workspace.routes.filter((route) => route.status === 'generated').flatMap((route) => route.letterIds.map((id) => toUiLetter(clientLetters.find((letter) => letter.id === id) || workspace.letters.find((letter) => letter.id === id)))).filter((letter) => letter && canMailLetter(letter));
  const selected = letters.find((letter) => letter.id === selectedLetterId) || letters[0];
  const allGenerated = workspace.routes.length > 0 && workspace.routes.every((route) => route.status === 'generated');
  const allApproved = letters.length > 0 && letters.every((letter) => routeByLetter.get(letter.id)?.approvedLetterIds.includes(letter.id));
  const approvedCleanupLetters = letters.filter((letter) => {
    const route = routeByLetter.get(letter.id);
    return route && isCleanupRoute(route, itemById) && route.approvedLetterIds.includes(letter.id) && !(letter.mailedDate || letter.mailed_date);
  });
  useEffect(() => { if (!selectedLetterId && letters[0]) setSelectedLetterId(letters[0].id); }, [selectedLetterId, letters, setSelectedLetterId]);
  return <div className="grid lg:grid-cols-[300px_1fr] gap-4 min-h-[620px]">
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${T.grid}` }}>
        <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.navy }}>Letters to review</div>
        <div className="text-[10px] mt-1" style={{ color: T.muted }}>{letters.filter((letter) => routeByLetter.get(letter.id)?.approvedLetterIds.includes(letter.id)).length} of {letters.length} approved</div>
      </div>
      {workspace.routes.some((route) => route.status === 'failed') && <div className="m-3 p-3 rounded-lg text-[11px] text-red-700 bg-red-50"><AlertTriangle size={13} className="inline mr-1" />One or more routes failed. Return to Build to retry them.</div>}
      {letters.map((letter) => {
        const route = routeByLetter.get(letter.id);
        const items = routeItems(route, itemById);
        const cleanup = isCleanupRoute(route, itemById);
        const approved = route?.approvedLetterIds.includes(letter.id);
        const label = cleanup ? `${BUREAU_LABEL[route.targetBureau]} file cleanup` : items[0]?.label || letter.furnisher;
        const detail = cleanup ? `${items.length} selected PI/inquiry item${items.length === 1 ? '' : 's'} · 1 letter` : route?.targetType === 'bureau' ? BUREAU_LABEL[route.targetBureau] : letter.dispute_basis === 'FDCPA' ? 'Debt validation' : 'Direct furnisher';
        return <button key={letter.id} onClick={() => setSelectedLetterId(letter.id)} className="w-full text-left px-4 py-3 flex gap-3" style={{ background: selected?.id === letter.id ? '#FBF9F2' : '#fff', borderTop: `1px solid ${T.grid}` }}>
          <div className="mt-0.5">{approved ? <div className="w-5 h-5 rounded-full flex items-center justify-center bg-green-100 text-green-700"><Check size={11} /></div> : <Circle size={18} style={{ color: T.faint }} />}</div>
          <div className="min-w-0"><div className="text-[11px] font-semibold truncate" style={{ color: T.ink }}>{label}</div><div className="text-[10px] mt-0.5" style={{ color: T.muted }}>{detail}</div></div>
        </button>;
      })}
    </div>
    <div className="bg-white rounded-2xl overflow-hidden flex flex-col" style={{ border: `1px solid ${T.border}` }}>
      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: `1px solid ${T.grid}` }}>
        <div><div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.gold }}>Letter Preview</div><div className="text-[12px] font-semibold mt-0.5" style={{ color: T.navy }}>{selected?.furnisher || 'Generate letters to begin review'}</div></div>
        {selected && (() => { const route = routeByLetter.get(selected.id); const approved = route?.approvedLetterIds.includes(selected.id); return <button onClick={() => onApprove(route, selected.id, !approved)} disabled={busy} className="px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ background: approved ? '#ECFDF3' : T.navy, color: approved ? '#166534' : T.gold, border: approved ? '1px solid #BBF7D0' : 'none' }}>{approved ? 'Approved ✓' : 'Approve letter'}</button>; })()}
      </div>
      <div className="flex-1 bg-gray-100 p-3">{selected?.html && selected.html !== 'GENERATING...' ? <iframe title="Letter preview" sandbox="" srcDoc={selected.html} className="w-full h-full min-h-[520px] bg-white rounded border-0" /> : <div className="h-full min-h-[520px] flex items-center justify-center text-[12px]" style={{ color: T.muted }}>Select a generated letter.</div>}</div>
      <div className="px-4 py-3 flex flex-wrap justify-end gap-2" style={{ borderTop: `1px solid ${T.grid}` }}>
        {!allGenerated && <button onClick={onBuildRemaining} disabled={busy} className="px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ color: T.navy, background: '#fff', border: `1px solid ${T.border}` }}>Back to build remaining letters</button>}
        {!allGenerated && approvedCleanupLetters.length > 0 && <button onClick={onReady} disabled={busy} className="px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ background: '#6D4DB1', color: '#fff' }}>Continue approved cleanup to Mail ({approvedCleanupLetters.length})</button>}
        {allGenerated && <button onClick={onReady} disabled={!allApproved || busy} className="px-5 py-2.5 rounded-lg text-[11px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>Move approved batch to mailing</button>}
      </div>
    </div>
  </div>;
}

function MailingAndTracking({ workspace, viewStage, clientLetters, clientRounds, onMail, onAnalyze, onAnalyzeBureau, onOpenLetters, onCloseCampaign, onBuildRemaining, onBackReview, busy }) {
  const ids = workspace.routes.flatMap((route) => route.letterIds);
  const letters = ids.map((id) => toUiLetter(clientLetters.find((letter) => letter.id === id) || workspace.letters.find((letter) => letter.id === id))).filter(Boolean);
  const routeByLetter = new Map(workspace.routes.flatMap((route) => route.letterIds.map((id) => [id, route])));
  const awaiting = viewStage === 'awaiting_responses';
  const remainingBuildRoutes = workspace.routes.filter((route) => route.status !== 'generated').length;
  const ready = letters.filter((letter) => routeByLetter.get(letter.id)?.approvedLetterIds.includes(letter.id) && !isMailedMail(letter) && !isCancelledMail(letter));
  const mailed = letters.filter(isMailedMail);
  const cancelled = letters.filter(isCancelledMail);
  const roundIds = [...new Set(workspace.routes.map((route) => route.disputeRoundId).filter(Boolean))];
  const roundsClosed = roundIds.every((id) => (clientRounds || []).some((round) => round.round_id === id && round.status === 'closed'));
  const standaloneResolved = letters.filter((letter) => !(letter.roundId || letter.round_id)).every((letter) => !!letter.responseOutcome);
  const mayClose = workspace.campaign.stage === 'response_review' && roundsClosed && standaloneResolved;
  return <div className="space-y-4">
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.border}` }}>
      <div className="px-5 py-4 flex items-start justify-between gap-4" style={{ borderBottom: `1px solid ${T.grid}` }}>
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.gold }}>{awaiting ? 'Response tracking' : 'Mailing section'}</div>
          <h2 className="ccc-display text-[19px] font-semibold mt-0.5" style={{ color: T.navy }}>{awaiting ? `Round ${workspace.campaign.roundNumber} is awaiting responses` : 'Review enclosures and mail each approved letter'}</h2>
          <p className="text-[11px] mt-1" style={{ color: T.muted }}>{awaiting ? 'Existing deadlines, deliveries, and response protections remain active until staff reviews and explicitly closes the round.' : 'Lob opens from this queue. After each successful send, you return here with the remaining letters and their durable status.'}</p>
        </div>
        {awaiting && <div className="flex gap-2"><button onClick={onOpenLetters} className="px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold shrink-0" style={{ background: '#EEF1F7', color: T.navy }}>Full response workboard</button>{mayClose && <button onClick={onCloseCampaign} disabled={busy} className="px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold shrink-0 disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>Close reviewed round</button>}</div>}
      </div>
      {!awaiting && <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-4" style={{ background: '#FAFBFC' }}>
        {[[ready.length, 'Ready to mail', T.navy], [mailed.length, 'Successfully mailed', '#15803D'], [cancelled.length, 'Canceled in Lob', '#B45309'], [remainingBuildRoutes, 'Routes left to build', '#6D4DB1']].map(([count, label, color]) => <div key={label} className="bg-white rounded-xl px-3 py-3" style={{ border: `1px solid ${T.border}` }}><div className="text-[20px] font-semibold" style={{ color }}>{count}</div><div className="text-[9px] uppercase tracking-wider mt-1" style={{ color: T.muted }}>{label}</div></div>)}
      </div>}
      {cancelled.length > 0 && !awaiting && <div className="mx-4 mb-3 p-3 rounded-xl text-[11px]" style={{ color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A' }}><AlertTriangle size={14} className="inline mr-1.5" />Canceled mailpieces were removed from Lob production and do not count as mailed. Replace any incorrect document, then explicitly re-mail from its row.</div>}
      {letters.map((letter) => {
        const route = routeByLetter.get(letter.id);
        const approved = route?.approvedLetterIds.includes(letter.id);
        const wasMailed = isMailedMail(letter);
        const wasCancelled = isCancelledMail(letter);
        const response = letter.responseOutcome || letter.response_outcome;
        const analyze = letter.targetType === 'bureau' ? onAnalyzeBureau : onAnalyze;
        const subtitle = response ? `Response: ${response}`
          : wasCancelled ? 'Canceled in Lob before production · replace incorrect documents before re-mailing'
            : wasMailed ? `Mailed ${letter.mailedDate || letter.mailed_date}${letter.trackingNumber ? ` · ${letter.trackingNumber}` : ''}`
              : approved ? 'Approved · ready to verify enclosures and mail' : 'Needs review and approval';
        return <div key={letter.id} className="px-5 py-4 flex items-center gap-3" style={{ borderTop: `1px solid ${T.grid}` }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: wasCancelled ? '#FFF7ED' : wasMailed ? '#ECFDF3' : '#FBF7EA', color: wasCancelled ? '#B45309' : wasMailed ? '#15803D' : T.gold }}>{wasCancelled ? <AlertTriangle size={15} /> : wasMailed ? <Check size={15} /> : <Mail size={15} />}</div>
          <div className="flex-1 min-w-0"><div className="text-[12px] font-semibold truncate" style={{ color: T.ink }}>{letter.furnisher}</div><div className="text-[10px] mt-0.5" style={{ color: wasCancelled ? '#B45309' : T.muted }}>{subtitle}</div></div>
          {!awaiting && approved && !wasMailed && <button onClick={() => {
            if (wasCancelled && !window.confirm('Confirm the incorrect document has been replaced and this letter is ready to be submitted to Lob again.')) return;
            onMail([letter]);
          }} className="px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ background: wasCancelled ? '#B45309' : T.navy, color: wasCancelled ? '#fff' : T.gold }}>{wasCancelled ? 'Re-mail after correction' : 'Open mailer'}</button>}
          {!awaiting && !approved && <button onClick={onBackReview} className="px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ background: '#EEF1F7', color: T.navy }}>Return to review</button>}
          {awaiting && response === 'received' ? <button onClick={() => analyze(letter)} className="px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ background: '#EEF1F7', color: T.navy }}>Analyze response</button> : awaiting && wasMailed ? <span className="text-[9px] uppercase tracking-wider font-semibold text-green-700">{response || 'Tracking'}</span> : null}
        </div>;
      })}
      {!awaiting && <div className="px-5 py-4 flex flex-wrap justify-between gap-2" style={{ borderTop: `1px solid ${T.grid}` }}>
        <button onClick={onBackReview} disabled={busy} className="px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ color: T.navy, background: '#fff', border: `1px solid ${T.border}` }}>Back to Review</button>
        {remainingBuildRoutes > 0 && <button onClick={onBuildRemaining} disabled={busy} className="px-4 py-2.5 rounded-lg text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: '#6D4DB1', color: '#fff' }}>Build remaining {remainingBuildRoutes} route{remainingBuildRoutes === 1 ? '' : 's'}</button>}
      </div>}
    </div>
  </div>;
}

function InterimLetterBuilder({ client, audit, onClose, onMail, onOpenLetters }) {
  const accounts = (audit?.audit?.accounts || []).filter((account) => account.clientAccountId);
  const [accountId, setAccountId] = useState(accounts[0]?.clientAccountId || '');
  const account = accounts.find((item) => item.clientAccountId === accountId) || null;
  const allowedBureaus = account ? activeBureaus({ snapshot: account, kind: 'account' }) : [];
  const [targetType, setTargetType] = useState('furnisher');
  const [targetBureau, setTargetBureau] = useState(allowedBureaus[0] || '');
  const [style, setStyle] = useState('procedural_request');
  const [instructions, setInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { if (targetType === 'bureau' && !allowedBureaus.includes(targetBureau)) setTargetBureau(allowedBureaus[0] || ''); }, [accountId, targetType]);
  const generate = async () => {
    setGenerating(true); setError(null);
    try {
      const result = await generateInterimLetter({ account, client, targetType, targetBureau: targetType === 'bureau' ? targetBureau : null, style, customInstructions: instructions });
      setGenerated({ ...result, clientId: client.id, clientName: client.name, accountId: account.accountNumberMasked || account.id || '', clientAccountId: account.clientAccountId });
    } catch (e) { setError(e.message || String(e)); } finally { setGenerating(false); }
  };
  return <div className="fixed inset-0 z-[70] bg-black/50 p-4 flex items-center justify-center"><div className="bg-white rounded-2xl w-full max-w-5xl max-h-[94vh] overflow-hidden flex flex-col"><div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${T.border}` }}><div><div className="text-[10px] uppercase tracking-[0.14em] font-semibold" style={{ color: '#6D4DB1' }}>Standalone workflow</div><h2 className="ccc-display text-[19px] font-semibold" style={{ color: T.navy }}>Interim Letter Builder</h2></div><button onClick={onClose} className="text-[12px] px-3 py-2 rounded-lg" style={{ color: T.muted, background: '#F7F8FA' }}>Close</button></div><div className="grid lg:grid-cols-[330px_1fr] overflow-auto flex-1"><div className="p-5 space-y-4" style={{ borderRight: `1px solid ${T.border}` }}><div><label className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: T.faint }}>Audited account</label><select value={accountId} onChange={(e) => { setAccountId(e.target.value); setGenerated(null); }} className="w-full mt-1.5 border rounded-lg px-3 py-2.5 text-[11px]" style={{ borderColor: T.border }}>{accounts.map((item) => <option key={item.clientAccountId} value={item.clientAccountId}>{item.furnisher} · {item.accountNumberMasked || 'linked account'}</option>)}</select></div><div><label className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: T.faint }}>Recipient</label><div className="flex gap-2 mt-1.5"><button onClick={() => setTargetType('furnisher')} className="flex-1 px-3 py-2 rounded-lg text-[10px] font-semibold" style={{ background: targetType === 'furnisher' ? T.navy : '#F7F8FA', color: targetType === 'furnisher' ? T.gold : T.muted, border: `1px solid ${targetType === 'furnisher' ? T.navy : T.border}` }}>Furnisher</button><button onClick={() => setTargetType('bureau')} className="flex-1 px-3 py-2 rounded-lg text-[10px] font-semibold" style={{ background: targetType === 'bureau' ? T.navy : '#F7F8FA', color: targetType === 'bureau' ? T.gold : T.muted, border: `1px solid ${targetType === 'bureau' ? T.navy : T.border}` }}>Bureau</button></div>{targetType === 'bureau' && <select value={targetBureau} onChange={(e) => setTargetBureau(e.target.value)} className="w-full mt-2 border rounded-lg px-3 py-2.5 text-[11px]" style={{ borderColor: T.border }}><option value="">Choose active bureau</option>{allowedBureaus.map((bureau) => <option key={bureau} value={bureau}>{BUREAU_LABEL[bureau]}</option>)}</select>}</div><div><label className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: T.faint }}>Letter style</label><select value={style} onChange={(e) => setStyle(e.target.value)} className="w-full mt-1.5 border rounded-lg px-3 py-2.5 text-[11px]" style={{ borderColor: T.border }}><option value="procedural_request">Procedural request</option><option value="metro2_accuracy">Metro 2 accuracy correction</option><option value="direct_furnisher">Direct furnisher update</option><option value="custom">Custom supported strategy</option></select></div><div><label className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: T.faint }}>Staff instructions (optional)</label><textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} className="w-full mt-1.5 border rounded-lg px-3 py-2.5 text-[11px] resize-none" style={{ borderColor: T.border }} placeholder="Add strategic direction. Claude still uses only supported audit facts." /></div>{error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-[11px]">{error}</div>}<button onClick={generate} disabled={!account || generating || (targetType === 'bureau' && !targetBureau)} className="w-full px-4 py-2.5 rounded-lg text-[11px] uppercase tracking-wider font-semibold disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>{generating ? 'Claude is drafting…' : 'Generate interim letter'}</button><p className="text-[10px] leading-relaxed" style={{ color: T.faint }}>Interim letters are saved as standalone file updates. They do not create a dispute round or change an existing deadline.</p></div><div className="bg-gray-100 p-4 min-h-[650px]">{generated?.html ? <div className="h-full flex flex-col gap-3"><iframe title="Interim letter preview" sandbox="" srcDoc={generated.html} className="w-full flex-1 min-h-[560px] bg-white rounded-xl border-0" /><div className="flex justify-end gap-2"><button onClick={onOpenLetters} className="px-4 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold bg-white" style={{ color: T.navy, border: `1px solid ${T.border}` }}>Open Letters</button><button onClick={() => onMail([generated])} className="px-4 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold" style={{ background: T.navy, color: T.gold }}>Mail this letter</button></div></div> : <div className="h-full min-h-[620px] flex flex-col items-center justify-center text-center"><FileText size={30} style={{ color: '#C7CBD3' }} /><p className="text-[12px] mt-3" style={{ color: T.muted }}>Your generated letter preview will appear here.</p></div>}</div></div></div></div>;
}

export default function ClientCampaignWorkspace({ client, onOpenAudit, onOpenLetters, onMail, onAnalyze, onAnalyzeBureau }) {
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(null);
  const [error, setError] = useState(null);
  const [selectedLetterId, setSelectedLetterId] = useState(null);
  const [showInterim, setShowInterim] = useState(false);
  const [viewStage, setViewStage] = useState(null);
  const latestAudit = [...(client.audits || [])].sort((a, b) => String(b.savedAt || b.reportDate || '').localeCompare(String(a.savedAt || a.reportDate || '')))[0];
  const letterActivityKey = (client.letters || []).map((letter) => `${letter.id}:${letter.mailedDate || ''}:${letter.trackingStatus || ''}:${letter.responseOutcome || ''}:${letter.roundReviewStatus || ''}`).join('|');
  const load = async () => { setLoading(true); try { setWorkspace(await getCampaignWorkspace(client.id)); setError(null); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { setViewStage(null); }, [client.id]);
  useEffect(() => { load(); }, [client.id, letterActivityKey]);
  useEffect(() => {
    if (!workspace?.campaign || workspace.campaign.stage !== 'mailing') return;
    if (campaignReadyForTracking(workspace, client.letters || [])) {
      updateCampaign(workspace.campaign.id, { stage: 'awaiting_responses' }).then(() => { setViewStage('awaiting_responses'); return load(); }).catch((e) => setError(e.message));
    }
  }, [workspace, client.letters]);
  useEffect(() => {
    if (!workspace?.campaign || workspace.campaign.stage !== 'awaiting_responses') return;
    const ids = new Set(workspace.routes.flatMap((route) => route.letterIds));
    if ((client.letters || []).some((letter) => ids.has(letter.id) && letter.responseOutcome)) {
      updateCampaign(workspace.campaign.id, { stage: 'response_review' }).then(load).catch((e) => setError(e.message));
    }
  }, [workspace, client.letters]);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      const message = e.message || String(e);
      await load().catch(() => {});
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <div className="py-20 text-center text-[12px]" style={{ color: T.muted }}><Loader2 size={22} className="animate-spin mx-auto mb-3" />Loading campaign command center…</div>;
  if (error && !workspace) return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-[12px] text-red-700">{error}</div>;
  if (!workspace?.campaign) return <EmptyCampaign client={client} latestAudit={latestAudit} busy={busy} onOpenAudit={onOpenAudit} onStart={() => run(() => createCampaignFromAudit(client, latestAudit))} />;
  const lifecycleStage = workspace.campaign.stage;
  const stage = viewStage || normalizedStage(lifecycleStage);
  const progressIndex = stageIndex(lifecycleStage);
  const hasGeneratedLetters = workspace.routes.some((route) => route.status === 'generated' && route.letterIds.length > 0);
  const hasApprovedLetters = workspace.routes.some((route) => route.approvedLetterIds.length > 0);
  const selectionLocked = isCampaignSelectionLocked(workspace);
  const hasDraftRoutes = !selectionLocked && workspace.routes.length > 0;
  const canNavigate = (target) => {
    if (target === 'audit' || target === 'select_disputes') return true;
    if (target === 'configure_letters') return progressIndex >= stageIndex('configure_letters');
    if (target === 'letter_review') return hasGeneratedLetters;
    if (target === 'mailing') return hasApprovedLetters || progressIndex >= stageIndex('mailing');
    if (target === 'awaiting_responses') return ['awaiting_responses', 'response_review', 'closed'].includes(lifecycleStage);
    return false;
  };
  const navigateTo = (target) => {
    if (!canNavigate(target)) return;
    if (target === 'audit') { onOpenAudit?.(client); return; }
    setViewStage(target);
  };
  const runAndView = (target, fn) => run(async () => { await fn(); setViewStage(target); });
  const reviseSelection = (items, selectionState) => {
    const ids = items.map((item) => item.id);
    if (hasDraftRoutes && !window.confirm('Changing this round’s dispute targets will clear its saved, ungenerated letter routes. Continue?')) return;
    run(() => updateCampaignItemStates(workspace.campaign.id, ids, selectionState));
  };
  const generateRoutes = async (routes, kind = 'all') => {
    const itemById = new Map(workspace.items.map((item) => [item.id, item]));
    const failures = [];
    try {
      for (let index = 0; index < routes.length; index++) {
        const route = routes[index];
        const items = routeItems(route, itemById);
        const account = items.find((item) => item.kind === 'account');
        setGenerationProgress({ kind, completed: index, total: routes.length, current: routeDisplayName(route, itemById) });
        try {
          if (account) {
            const priorSources = await getReviewedPriorSources(account.clientAccountId);
            await generateCampaignAccountRoute({ route, item: account, campaign: workspace.campaign, client, priorSources });
          } else {
            await generateCampaignCleanupRoute({ route, items, campaign: workspace.campaign, client });
          }
        } catch (routeError) {
          failures.push({ route: routeDisplayName(route, itemById), message: routeError.message || String(routeError) });
        }
      }
      if (failures.length) {
        const succeeded = routes.length - failures.length;
        throw new Error(`${succeeded} route${succeeded === 1 ? '' : 's'} completed; ${failures.length} failed. ${failures.map((failure) => `${failure.route}: ${failure.message}`).join(' | ')}`);
      }
      if (progressIndex < stageIndex('letter_review')) await updateCampaign(workspace.campaign.id, { stage: 'letter_review' });
      setViewStage('letter_review');
    } finally {
      setGenerationProgress(null);
    }
  };
  return <div className="space-y-4">
    <CampaignRail lifecycleStage={lifecycleStage} viewStage={stage} canNavigate={canNavigate} onNavigate={navigateTo} />
    {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[11px] text-red-700">{error}</div>}
    {stage === 'select_disputes' && <DisputePicker workspace={workspace} busy={busy} readOnly={selectionLocked} hasDraftRoutes={hasDraftRoutes} onState={(item, state) => reviseSelection([item], state)} onBulkState={reviseSelection} onContinue={lifecycleStage === 'select_disputes' ? () => runAndView('configure_letters', () => updateCampaign(workspace.campaign.id, { stage: 'configure_letters' })) : () => setViewStage('configure_letters')} />}
    {stage === 'configure_letters' && !workspace.campaign.builderMode && <BuilderChoice onChoose={(mode) => run(() => updateCampaign(workspace.campaign.id, { builderMode: mode }))} onStandalone={() => setShowInterim(true)} />}
    {stage === 'configure_letters' && workspace.campaign.builderMode && !workspace.routes.length && <RouteConfigurator workspace={workspace} mode={workspace.campaign.builderMode} busy={busy} onSave={(routes) => run(() => replaceConfiguredRoutes(workspace.campaign, workspace.items, routes))} />}
    {stage === 'configure_letters' && workspace.routes.length > 0 && <BuildQueue workspace={workspace} busy={busy} generationProgress={generationProgress} onGenerate={(routes, kind) => run(() => generateRoutes(routes, kind))} onReview={progressIndex < stageIndex('letter_review') ? () => runAndView('letter_review', () => updateCampaign(workspace.campaign.id, { stage: 'letter_review' })) : () => setViewStage('letter_review')} />}
    {stage === 'letter_review' && <LetterReview workspace={workspace} clientLetters={client.letters || []} selectedLetterId={selectedLetterId} setSelectedLetterId={setSelectedLetterId} busy={busy} onApprove={(route, id, approved) => run(() => approveCampaignLetter(route, id, approved))} onReady={progressIndex < stageIndex('mailing') ? () => runAndView('mailing', () => updateCampaign(workspace.campaign.id, { stage: 'mailing' })) : () => setViewStage('mailing')} onBuildRemaining={() => setViewStage('configure_letters')} />}
    {['mailing', 'awaiting_responses'].includes(stage) && <MailingAndTracking workspace={workspace} viewStage={stage} clientLetters={client.letters || []} clientRounds={client.rounds || []} onMail={onMail} onAnalyze={onAnalyze} onAnalyzeBureau={onAnalyzeBureau} onOpenLetters={onOpenLetters} busy={busy} onBackReview={() => setViewStage('letter_review')} onBuildRemaining={() => setViewStage('configure_letters')} onCloseCampaign={() => run(() => updateCampaign(workspace.campaign.id, { stage: 'closed', closedAt: new Date().toISOString() }))} />}
    {showInterim && <InterimLetterBuilder client={client} audit={latestAudit} onClose={() => setShowInterim(false)} onMail={onMail} onOpenLetters={() => { setShowInterim(false); onOpenLetters?.(); }} />}
  </div>;
}
