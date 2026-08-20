import React, { useEffect, useMemo, useState } from 'react';
import { Archive, FilePlus2, Loader2, Save, Sparkles } from 'lucide-react';
import { FLOW_LABELS, FLOW_LETTER_ROUNDS, FLOW_SEQUENCES, flowRoundLabel } from '../utils/disputeFlow.js';
import {
  TEMPLATE_FIELD_GROUPS,
  extractTemplateTokens,
  normalizeCourseStyleTemplate,
} from '../utils/disputeTemplateEngine.js';
import {
  listDisputeTemplates,
  retireDisputeTemplate,
  saveDisputeTemplate,
} from '../utils/disputeTemplates.js';

const blankTemplate = () => ({
  id: null,
  name: '',
  flow: 'accuracy',
  round: 1,
  bureau: 'ALL',
  version: 'v1',
  body: '',
  notes: '',
  active: true,
});

function TemplateRow({ template, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${selected ? 'border-navy bg-blue-50/60' : 'border-border bg-white hover:border-gray-400'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12px] font-semibold text-navy leading-snug">{template.name}</div>
        {!template.active && <span className="text-[9px] uppercase tracking-wider text-gray-400">Retired</span>}
      </div>
      <div className="mt-1 text-[10px] text-gray-500">
        {flowRoundLabel(template.flow, template.round)} · {template.bureau} · {template.version}
      </div>
    </button>
  );
}

export default function DisputeTemplateLibrary({ canEdit = false }) {
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(blankTemplate);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState('');
  const [flowFilter, setFlowFilter] = useState('all');

  const reload = async (selectId = null) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listDisputeTemplates();
      setTemplates(rows);
      const next = rows.find((item) => item.id === selectId) || rows[0];
      if (next) setDraft({ ...next });
    } catch (err) {
      setError(err.message || 'Could not load templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const tokens = useMemo(() => extractTemplateTokens(draft.body), [draft.body]);
  const visibleTemplates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((template) => (
      (flowFilter === 'all' || template.flow === flowFilter)
      && (!needle || [template.name, FLOW_LABELS[template.flow], `R${template.round}`, template.version]
        .some((value) => String(value || '').toLowerCase().includes(needle)))
    ));
  }, [flowFilter, query, templates]);
  const roundMax = FLOW_LETTER_ROUNDS[draft.flow] || 12;

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveDisputeTemplate(draft);
      await reload(saved.id);
      setNotice('Template saved. Existing letters keep their original snapshot.');
    } catch (err) {
      setError(err.message || 'Could not save template.');
    } finally {
      setSaving(false);
    }
  };

  const retire = async () => {
    if (!draft.id) return;
    setSaving(true);
    setError(null);
    try {
      const retired = await retireDisputeTemplate(draft.id);
      await reload(retired.id);
      setNotice('Template retired. It remains attached to prior letters.');
    } catch (err) {
      setError(err.message || 'Could not retire template.');
    } finally {
      setSaving(false);
    }
  };

  const appendToken = (token) => {
    setDraft((current) => ({
      ...current,
      body: `${current.body}${current.body.endsWith('\n') || !current.body ? '' : '\n'}{${token}}`,
    }));
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_1fr] gap-4">
      <aside className="min-h-0 overflow-y-auto pr-1">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-navy">Letter library</div>
            <div className="text-[10px] text-gray-400">{templates.length} template{templates.length === 1 ? '' : 's'}</div>
          </div>
          {canEdit && (
            <button onClick={() => setDraft(blankTemplate())} className="rounded-md bg-navy p-2 text-gold" title="New template">
              <FilePlus2 size={14} />
            </button>
          )}
        </div>
        <div className="mb-3 space-y-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-[11px]"
            placeholder="Search name, law, or round"
            aria-label="Search letter templates"
          />
          <select
            value={flowFilter}
            onChange={(event) => setFlowFilter(event.target.value)}
            className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-[11px]"
            aria-label="Filter letter templates by flow"
          >
            <option value="all">All flows</option>
            {Object.entries(FLOW_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[11px] text-gray-400"><Loader2 size={13} className="animate-spin" /> Loading…</div>
        ) : visibleTemplates.length ? (
          <div className="space-y-2">
            {visibleTemplates.map((template) => (
              <TemplateRow key={template.id} template={template} selected={draft.id === template.id} onClick={() => setDraft({ ...template })} />
            ))}
          </div>
        ) : templates.length ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-4 text-[11px] leading-relaxed text-gray-500">
            No templates match this search.
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 p-4 text-[11px] leading-relaxed text-gray-500">
            No templates yet. Add the current CCC wording here before building a campaign letter.
          </div>
        )}
      </aside>

      <section className="min-h-0 overflow-y-auto rounded-xl border border-border bg-white p-4">
        <div className="grid grid-cols-5 gap-2">
          <div className="col-span-3">
            <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Template name</label>
            <input disabled={!canEdit} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="w-full rounded-md border border-border px-2.5 py-2 text-[12px] disabled:bg-gray-50" placeholder="ACC — R1 — Factual Dispute" />
          </div>
          <div>
            <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Version</label>
            <input disabled={!canEdit} value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} className="w-full rounded-md border border-border px-2.5 py-2 text-[12px] disabled:bg-gray-50" />
          </div>
          <div>
            <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Bureau</label>
            <select disabled={!canEdit} value={draft.bureau} onChange={(event) => setDraft({ ...draft, bureau: event.target.value })} className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-[12px] disabled:bg-gray-50">
              <option value="ALL">All</option><option value="EQ">Equifax</option><option value="EXP">Experian</option><option value="TU">TransUnion</option>
            </select>
          </div>
          <div className="col-span-3">
            <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Flow</label>
            <select disabled={!canEdit} value={draft.flow} onChange={(event) => setDraft({ ...draft, flow: event.target.value, round: 1 })} className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-[12px] disabled:bg-gray-50">
              {Object.entries(FLOW_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Round</label>
            <select disabled={!canEdit} value={draft.round} onChange={(event) => setDraft({ ...draft, round: Number(event.target.value) })} className="w-full rounded-md border border-border bg-white px-2.5 py-2 text-[12px] disabled:bg-gray-50">
              {Array.from({ length: roundMax }, (_, index) => index + 1).map((round) => <option key={round} value={round}>R{round} — {FLOW_SEQUENCES[draft.flow][round - 1]}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <label className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Template text</label>
          {canEdit && (
            <button onClick={() => setDraft({ ...draft, body: normalizeCourseStyleTemplate(draft.body) })} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-navy hover:border-navy" title="Replace CCC authoring instruction blocks with editable merge fields while preserving fixed law/facts text">
              <Sparkles size={10} /> Convert authoring blocks
            </button>
          )}
        </div>
        <textarea disabled={!canEdit} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} rows={17} className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-[11px] leading-relaxed disabled:bg-gray-50" placeholder="Paste the CCC template text here. The fixed language stays exactly as entered." />

        <div className="mt-3 grid grid-cols-2 gap-3">
          {Object.entries(TEMPLATE_FIELD_GROUPS).map(([group, fields]) => (
            <div key={group} className="rounded-lg bg-gray-50 p-3">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-gray-400">{group === 'automatic' ? 'Auto-populated curlys' : 'Team-written curlys'}</div>
              <div className="flex flex-wrap gap-1">
                {fields.map((field) => (
                  <button key={field} disabled={!canEdit} onClick={() => appendToken(field)} className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${tokens.includes(field) ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'} disabled:cursor-default`}>
                    {'{' + field + '}'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <label className="mt-3 mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">Internal notes</label>
        <input disabled={!canEdit} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="w-full rounded-md border border-border px-2.5 py-2 text-[11px] disabled:bg-gray-50" placeholder="Retire date, source, or handling notes" />

        {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">{error}</div>}
        {notice && <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-2 text-[11px] text-green-700">{notice}</div>}
        {canEdit && (
          <div className="mt-4 flex items-center gap-2">
            <button onClick={save} disabled={saving || !draft.name.trim() || !draft.body.trim()} className="flex items-center gap-1.5 rounded-md bg-navy px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-gold disabled:opacity-40">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save template
            </button>
            {draft.id && draft.active && (
              <button onClick={retire} disabled={saving} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                <Archive size={12} /> Retire
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
