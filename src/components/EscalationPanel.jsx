import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Copy, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { createEscalation, updateEscalation, getAgDirectoryForState, listEscalationsForClient } from '../utils/escalations';
import { runPhase4Job } from '../utils/phase4Jobs';

// Best-effort extraction from a free-text "123 Main St, City, ST 12345"
// address — clients has no structured state column. Good enough to
// pre-select the right ag_directory row; staff can always override.
function guessState(address) {
  if (!address) return null;
  const m = address.match(/,\s*([A-Z]{2})\s*\d{5}/);
  return m ? m[1] : null;
}

function Section({ title, children, tone }) {
  return (
    <div style={{ border: '1px solid #E7EAF0', borderRadius: 8, padding: 14, marginBottom: 12, background: tone === 'warn' ? '#FFFBEB' : '#fff' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: tone === 'warn' ? '#D97706' : '#6B7280', fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-[11px] uppercase tracking-wider text-navy hover:text-gold flex items-center gap-1"
    >
      {copied ? <CheckCircle size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function EscalationPanel({ letter, client, onClose, onSaved }) {
  const [existing, setExisting] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);   // 'furnisher' | 'bureau' — setup step
  const [channel, setChannel] = useState('cfpb');
  const [state, setState] = useState(guessState(client?.address));
  const [agRows, setAgRows] = useState([]);
  const [escalation, setEscalation] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [progressTokens, setProgressTokens] = useState(0);
  const [error, setError] = useState(null);
  const [narrative, setNarrative] = useState('');
  const [agNarrative, setAgNarrative] = useState('');
  const [saving, setSaving] = useState(false);

  const furnisherOptions = (letter.coveredFurnishers && letter.coveredFurnishers.length > 0)
    ? letter.coveredFurnishers
    : [letter.furnisher];

  useEffect(() => {
    listEscalationsForClient(client.id).then((rows) => {
      setExisting(rows.filter((r) => r.phase3_letter_id === letter.id));
      setLoading(false);
    }).catch((e) => { setError(e.message); setLoading(false); });
  }, [client.id, letter.id]);

  useEffect(() => {
    if (state) getAgDirectoryForState(state).then(setAgRows).catch(() => setAgRows([]));
  }, [state]);

  useEffect(() => {
    if (escalation) {
      setNarrative(escalation.narrative || '');
      setAgNarrative(escalation.ag_narrative || '');
    }
  }, [escalation]);

  const startNew = async (trackChoice, furnisherName) => {
    setError(null);
    try {
      const created = await createEscalation({
        clientId: client.id,
        clientAccountId: letter.clientAccountId || null,
        phase3LetterId: letter.id,
        track: trackChoice,
        channel,
        state: channel === 'state_ag' ? state : null,
        furnisherName: trackChoice === 'bureau' ? letter.furnisher : furnisherName,
      });
      setEscalation(created);
      setGenerating(true);
      setProgressTokens(0);
      const result = await runPhase4Job({ escalationId: created.id }, setProgressTokens);
      const { data: refreshed } = await supabase.from('escalations').select('*').eq('id', created.id).single();
      setEscalation(refreshed || created);
      setGenerating(false);
    } catch (e) {
      setError(e.message || 'Generation failed');
      setGenerating(false);
    }
  };

  const saveNarratives = async () => {
    if (!escalation) return;
    setSaving(true);
    try {
      const updated = await updateEscalation(escalation.id, { narrative, agNarrative });
      setEscalation(updated);
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  const setStatus = async (status) => {
    if (!escalation) return;
    try {
      const patch = { status };
      if (status === 'filed') patch.filedAt = new Date().toISOString();
      if (status === 'responded') patch.responseAt = new Date().toISOString();
      const updated = await updateEscalation(escalation.id, patch);
      setEscalation(updated);
      onSaved && onSaved();
    } catch (e) { setError(e.message); }
  };

  const viewLetterHtml = (html) => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const openLpoa = () => {
    const url = client?.lpoaSignatureData?.lpoaUrl;
    if (url) window.open(url, '_blank');
    else setError('No signed LPOA on file for this client yet.');
  };

  const active = escalation || existing[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[16px] font-semibold text-ink">CFPB / State AG Escalation</div>
            <div className="text-[12px] text-ink-muted">{client.name} · {letter.furnisher}</div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={18} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {loading && <div className="text-[13px] text-ink-muted">Loading…</div>}

        {!loading && !active && (
          <div>
            <Section title="Step 1 — Who is this complaint about?">
              <div className="text-[11px] text-ink-faint mb-2">One complaint per company — this creates a separate filing for each target you pick. Every company is its own escalation, never one covering the whole file.</div>
              <div className="flex flex-col gap-2">
                {furnisherOptions.map((f) => (
                  <button key={f} onClick={() => setTarget({ track: 'furnisher', furnisherName: f })}
                    className="text-left text-[12px] border rounded-md px-3 py-2 hover:border-navy"
                    style={{ borderColor: target?.furnisherName === f ? '#1B2A4A' : '#E7EAF0', background: target?.furnisherName === f ? '#F5F7FB' : '#fff' }}>
                    Furnisher: <strong>{f}</strong> — using the Phase 1 + Phase 3 failure as evidence (§1681s-2(b))
                  </button>
                ))}
                <button onClick={() => setTarget({ track: 'bureau' })}
                  className="text-left text-[12px] border rounded-md px-3 py-2 hover:border-navy"
                  style={{ borderColor: target?.track === 'bureau' ? '#1B2A4A' : '#E7EAF0', background: target?.track === 'bureau' ? '#F5F7FB' : '#fff' }}>
                  Bureau: <strong>{letter.furnisher}</strong> — the CRA's own reinvestigation failure (§1681i)
                </button>
              </div>
            </Section>

            {target && (
              <Section title="Step 2 — Channel">
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setChannel('cfpb')} className="text-[12px] px-3 py-1.5 rounded-md border" style={{ borderColor: channel === 'cfpb' ? '#1B2A4A' : '#E7EAF0', background: channel === 'cfpb' ? '#1B2A4A' : '#fff', color: channel === 'cfpb' ? '#C9A84C' : '#111827' }}>CFPB</button>
                  <button onClick={() => setChannel('state_ag')} className="text-[12px] px-3 py-1.5 rounded-md border" style={{ borderColor: channel === 'state_ag' ? '#1B2A4A' : '#E7EAF0', background: channel === 'state_ag' ? '#1B2A4A' : '#fff', color: channel === 'state_ag' ? '#C9A84C' : '#111827' }}>State AG / Consumer Protection</button>
                </div>
                {channel === 'state_ag' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-muted">State:</span>
                    <input value={state || ''} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} placeholder="e.g. CA" className="text-[12px] border rounded-md px-2 py-1 w-16" style={{ borderColor: '#E7EAF0' }} />
                    {agRows.length === 0 && state && <span className="text-[11px] text-amber-700">No researched channel on file for {state} yet — you'll need to look this one up.</span>}
                    {agRows.length > 0 && !agRows[0].fcra_scope_confirmed && (
                      <span className="text-[11px] text-amber-700">⚠ Unconfirmed whether this office works FCRA complaints — call first.</span>
                    )}
                  </div>
                )}
                <button
                  onClick={() => startNew(target.track, target.furnisherName)}
                  disabled={generating || (channel === 'state_ag' && !state)}
                  className="mt-3 text-[12px] uppercase tracking-wider px-3 py-2 rounded-md text-white disabled:opacity-40"
                  style={{ background: '#1B2A4A' }}
                >
                  {generating ? <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Generating… {progressTokens > 0 ? `(~${progressTokens.toLocaleString()} tokens)` : ''}</span> : 'Generate Narrative'}
                </button>
              </Section>
            )}
          </div>
        )}

        {!loading && active && (
          <div>
            <Section title={`Target · ${active.track === 'bureau' ? 'Bureau' : 'Furnisher'} · ${active.channel === 'cfpb' ? 'CFPB' : 'State AG'}`}>
              <div className="text-[13px] text-ink font-medium mb-1">{active.furnisher_name}</div>
              <div className="flex items-center gap-2">
                <select value={active.status} onChange={(e) => setStatus(e.target.value)} className="text-[11px] border rounded-md px-2 py-1" style={{ borderColor: '#E7EAF0' }}>
                  <option value="draft">Draft</option>
                  <option value="ready">Ready to file</option>
                  <option value="filed">Filed</option>
                  <option value="responded">Response received</option>
                  <option value="closed">Closed</option>
                </select>
                {active.filed_at && <span className="text-[11px] text-ink-faint">Filed {new Date(active.filed_at).toLocaleDateString()}</span>}
              </div>
            </Section>

            {active.channel === 'cfpb' && active.cfpb_category && (
              <Section title="CFPB Form — Exact Fields To Select">
                <div className="text-[12px] text-ink mb-1"><strong>Product:</strong> Credit reporting or other personal consumer reports</div>
                <div className="text-[12px] text-ink mb-1"><strong>Sub-product:</strong> Credit reporting</div>
                <div className="text-[12px] text-ink mb-1"><strong>Issue:</strong> {active.cfpb_category}</div>
                <div className="text-[12px] text-ink mb-2"><strong>Sub-issue:</strong> {active.cfpb_sub_issue}</div>
                <a href="https://www.consumerfinance.gov/complaint/" target="_blank" rel="noreferrer" className="text-[11px] uppercase tracking-wider text-navy hover:text-gold flex items-center gap-1 w-fit">
                  Open CFPB Complaint Form <ExternalLink size={11} />
                </a>
              </Section>
            )}

            {active.channel === 'state_ag' && agRows.length > 0 && (
              <Section title={agRows[0].agency_name}>
                {!agRows[0].fcra_scope_confirmed && (
                  <div className="text-[11px] text-amber-700 mb-2">⚠ Unconfirmed whether this office works FCRA/credit-reporting complaints — call first: {agRows[0].source_notes}</div>
                )}
                {agRows[0].portal_url && (
                  <a href={agRows[0].portal_url} target="_blank" rel="noreferrer" className="text-[11px] uppercase tracking-wider text-navy hover:text-gold flex items-center gap-1 w-fit mb-1">
                    Open Portal <ExternalLink size={11} />
                  </a>
                )}
                {agRows[0].mail_address && <div className="text-[11px] text-ink-muted">Mail fallback: {agRows[0].mail_address}</div>}
                {agRows[0].attachment_notes && <div className="text-[11px] text-ink-faint mt-1">Attachment limits: {agRows[0].attachment_notes}</div>}
              </Section>
            )}

            {(narrative || agNarrative) && (
              <>
                <Section title="CFPB Narrative (paste into the complaint description box)">
                  <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={6} className="w-full text-[12px] border rounded-md p-2 mb-2" style={{ borderColor: '#E7EAF0' }} />
                  <CopyButton text={narrative} />
                </Section>
                <Section title="State AG / General Narrative (paste into any state's intake form)">
                  <textarea value={agNarrative} onChange={(e) => setAgNarrative(e.target.value)} rows={6} className="w-full text-[12px] border rounded-md p-2 mb-2" style={{ borderColor: '#E7EAF0' }} />
                  <CopyButton text={agNarrative} />
                </Section>
                <button onClick={saveNarratives} disabled={saving} className="text-[12px] uppercase tracking-wider px-3 py-2 rounded-md text-white mb-3" style={{ background: '#1B2A4A' }}>
                  {saving ? 'Saving…' : 'Save Edits'}
                </button>
              </>
            )}

            {active.key_facts && active.key_facts.length > 0 && (
              <Section title="Key Facts This Complaint Rests On">
                <ul className="text-[12px] text-ink list-disc pl-4 space-y-1">
                  {active.key_facts.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </Section>
            )}

            <Section title="Attachments — view/download, then upload to the form yourself">
              <div className="flex flex-col gap-2">
                <button onClick={() => viewLetterHtml(letter.html)} className="text-[12px] text-left text-navy hover:text-gold">→ View this Phase 3 letter</button>
                <button onClick={openLpoa} className="text-[12px] text-left text-navy hover:text-gold">→ Open signed LPOA</button>
                <div className="text-[11px] text-ink-faint">Audit PDF: open this client's audit and use Download PDF.</div>
                <div className="text-[11px] text-ink-faint">Furnisher/bureau response images (if any): Letters tab → this letter's history → the analyzed response.</div>
              </div>
              {active.recommended_attachments && active.recommended_attachments.length > 0 && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: '#E7EAF0' }}>
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">AI-recommended, based on this complaint's facts</div>
                  <ul className="text-[12px] text-ink-muted list-disc pl-4 space-y-1">
                    {active.recommended_attachments.map((a, i) => <li key={i}><strong>{a.docType}:</strong> {a.reason}</li>)}
                  </ul>
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
