import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FileSearch,
  Loader2,
  Mail,
  Sparkles,
  Upload,
} from 'lucide-react';
import { analyzeFieldworkResponse } from '../api';
import {
  CLASSIFICATION_LABELS,
  DEMO_RESPONSE_ANALYSIS,
  OUTCOME_LABELS,
} from '../adapters/demoResponseAnalysis';
import { buildFieldworkLetter } from '../adapters/buildFieldworkLetter';
import { isFieldworkLetterHtml } from '../adapters/fieldworkLetterCss';
import { useFieldwork } from '../state';

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function outcomeTone(outcome) {
  if (outcome === 'ADDRESSED') return 'text-emerald-800 bg-emerald-50';
  if (outcome === 'ADMITTED') return 'text-amber-900 bg-amber-50';
  if (outcome === 'PARTIALLY_ADDRESSED') return 'text-sky-900 bg-sky-50';
  return 'text-rose-900 bg-rose-50';
}

export default function Responses() {
  const navigate = useNavigate();
  const {
    user,
    plan,
    planId,
    audit,
    letters,
    campaigns,
    documents,
    uploadDocument,
    saveResponseAnalysis,
    beginFollowUpMail,
    responseAnalyses,
    isGuestDemo,
  } = useFieldwork();
  const guest = isGuestDemo || user?.guest;

  const inputRef = useRef(null);
  const mailedLetters = useMemo(() => {
    const fromCampaigns = (campaigns || []).flatMap((c) => c.letters || []);
    const all = [...(letters || []), ...fromCampaigns];
    const seen = new Set();
    return all.filter((l) => {
      if (!l?.id || seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
  }, [letters, campaigns]);

  const accountOptions = useMemo(() => {
    if (audit?.accounts?.length) return audit.accounts;
    return [];
  }, [audit]);

  const [letterId, setLetterId] = useState(mailedLetters[0]?.id || '');
  const [accountId, setAccountId] = useState(
    mailedLetters[0]?.accountId || accountOptions[0]?.id || '',
  );
  const [files, setFiles] = useState([]);
  const [useSampleReply, setUseSampleReply] = useState(true);
  const [nonResponse, setNonResponse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [followUpLetter, setFollowUpLetter] = useState(null);
  const [meta, setMeta] = useState(null);

  const selectedLetter = mailedLetters.find((l) => l.id === letterId) || null;
  const selectedAccount = useMemo(() => {
    const id = selectedLetter?.accountId || accountId;
    return accountOptions.find((a) => a.id === id)
      || (selectedLetter
        ? {
          id: selectedLetter.accountId,
          furnisher: selectedLetter.furnisher,
          accountMask: '••••',
          violations: [],
          originalCreditor: '—',
          typeLabel: 'Account',
          status: 'Disputed',
          balance: null,
          bureaus: [],
        }
        : null);
  }, [accountOptions, accountId, selectedLetter]);

  const canAutoDraft = planId === 'pro' || planId === 'unlimited';

  const onPickFiles = async (fileList) => {
    const list = Array.from(fileList || []).slice(0, 6);
    if (!list.length) return;
    const prepared = await Promise.all(
      list.map(async (file) => ({
        name: file.name,
        mediaType: file.type || 'application/pdf',
        base64: await readFileAsBase64(file),
        size: file.size,
        file,
      })),
    );
    setFiles(prepared);
    // Persist into the evidence vault (cloud when Fieldwork keys are set).
    for (const item of prepared) {
      try {
        await uploadDocument('Furnisher response', item.file);
      } catch (err) {
        console.warn('[fieldwork] vault upload from Responses', err);
      }
    }
  };

  const runAnalyze = async ({ draft }) => {
    if (!user || !selectedAccount) {
      setError('Pick the account (and prior letter if you have one) first.');
      return;
    }
    if (!nonResponse && !files.length && !(guest && useSampleReply) && !draft) {
      setError(
        guest
          ? 'Use the sample furnisher reply, or mark “no response received.”'
          : 'Upload the furnisher response, or mark “no response received.”',
      );
      return;
    }
    if (draft && !canAutoDraft) {
      setError('Auto-draft is on Pro and Campaign. Starter keeps talking points.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      let res;
      const useLocalSample = guest && (nonResponse || useSampleReply || !files.length);
      try {
        if (useLocalSample) {
          throw new Error('guest-sample');
        }
        res = await analyzeFieldworkResponse({
          user,
          account: selectedAccount,
          priorLetterHtml: selectedLetter?.body || null,
          files: nonResponse ? [] : files,
          nonResponse,
          draft,
          planId,
        });
      } catch (err) {
        // Offline / no netlify / guest sample — local demo path
        if (!draft || canAutoDraft) {
          const localAnalysis = nonResponse
            ? {
              ...DEMO_RESPONSE_ANALYSIS,
              classification: 'NON_RESPONSE',
              summary:
                'No furnisher response arrived within the 30-day window. Use the talking points to write (or auto-draft) your follow-up.',
            }
            : DEMO_RESPONSE_ANALYSIS;
          const localLetter = draft
            ? buildFieldworkLetter(user, selectedAccount, 'phase2', localAnalysis)
            : null;
          res = {
            mode: guest ? 'guest-demo' : 'demo',
            canDraft: canAutoDraft,
            analysis: localAnalysis,
            followUpLetter: localLetter,
            draftMode: draft ? 'local' : null,
          };
        } else {
          throw err;
        }
      }

      const record = {
        id: `resp_${Date.now()}`,
        accountId: selectedAccount.id,
        furnisher: selectedAccount.furnisher,
        createdAt: new Date().toISOString(),
        analysis: res.analysis,
        mode: res.mode,
        letterId: selectedLetter?.id || null,
      };
      setAnalysis(res.analysis);
      setFollowUpLetter(res.followUpLetter || null);
      setMeta({ mode: res.mode, draftMode: res.draftMode, canDraft: res.canDraft });
      saveResponseAnalysis(record);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Analysis failed');
    } finally {
      setBusy(false);
    }
  };

  const mailDraft = () => {
    if (!followUpLetter || !selectedAccount) return;
    if (!audit) {
      setError('Keep your audit in this workspace (don’t reset the campaign) so mail can attach the account findings. Re-run a sample or live audit, then draft again.');
      return;
    }
    beginFollowUpMail({
      accountId: selectedAccount.id,
      letterHtml: followUpLetter,
      analysis: {
        id: `resp_mail_${Date.now()}`,
        accountId: selectedAccount.id,
        furnisher: selectedAccount.furnisher,
        createdAt: new Date().toISOString(),
        analysis,
      },
    });
    navigate('/app/campaign/new');
  };

  return (
    <div className="mx-auto max-w-3xl">
      <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Responses</p>
      <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">What they claimed</h1>
      <p className="mt-3 text-lg text-[var(--fw-muted)]">
        {guest
          ? 'Walk a canned furnisher reply (or mark non-response). No file upload in the guest tour.'
          : (
            <>
              Upload the furnisher’s reply. Fieldwork maps it against your demands —
              {canAutoDraft
                ? ' then drafts the follow-up packet letter for you.'
                : ' Starter gives talking points; Pro auto-drafts the next letter.'}
            </>
          )}
      </p>

      {!audit && mailedLetters.length === 0 && (
        <div className="mt-6 rounded-lg border border-[rgba(232,163,23,0.35)] bg-[rgba(232,163,23,0.1)] px-4 py-3 text-sm">
          No mailed letters yet.{' '}
          <Link to="/app/campaign/new" className="font-semibold text-[var(--fw-sea)] hover:underline">
            Run a campaign
          </Link>
          {' '}first (or try the sample audit), then come back when something answers.
        </div>
      )}

      <div className="mt-8 space-y-4 rounded-lg border border-[var(--fw-line)] bg-white p-5">
        {mailedLetters.length > 0 && (
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Prior mailed letter</span>
            <select
              value={letterId}
              onChange={(e) => {
                const next = mailedLetters.find((l) => l.id === e.target.value);
                setLetterId(e.target.value);
                if (next?.accountId) setAccountId(next.accountId);
              }}
              className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 text-sm outline-none ring-[var(--fw-sea)] focus:ring-1"
            >
              {mailedLetters.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.furnisher} · {l.phase === 'phase2' ? 'Follow-up' : 'Opening'} · {new Date(l.mailedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
        )}

        {accountOptions.length > 0 && (
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Account</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 text-sm outline-none ring-[var(--fw-sea)] focus:ring-1"
            >
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.furnisher} · {a.accountMask}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={nonResponse}
            onChange={(e) => setNonResponse(e.target.checked)}
            className="mt-1"
          />
          <span>No response received within 30 days (analyze as non-response)</span>
        </label>

        {!nonResponse && guest && (
          <label className="flex items-start gap-2 rounded-lg border border-[var(--fw-line)] bg-[rgba(20,80,95,0.04)] px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={useSampleReply}
              onChange={(e) => setUseSampleReply(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-semibold">Use sample furnisher reply</span>
              <span className="mt-0.5 block text-[var(--fw-muted)]">
                Midland-style dodge letter — maps claimed vs dodged without uploading a file.
              </span>
            </span>
          </label>
        )}

        {!nonResponse && !guest && (
          <div className="rounded-lg border-2 border-dashed border-[var(--fw-line)] px-4 py-8 text-center">
            <Upload className="mx-auto text-[var(--fw-sea)]" size={26} strokeWidth={1.5} />
            <p className="mt-2 font-semibold">Furnisher response PDF or images</p>
            <p className="mt-1 text-sm text-[var(--fw-muted)]">
              {files.length
                ? files.map((f) => f.name).join(', ')
                : 'Drop their letter / statement pages here'}
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="fw-btn-ink mt-4"
            >
              Choose files
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onPickFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {error && (
          <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => runAnalyze({ draft: false })}
            className="fw-btn-ink inline-flex items-center gap-2"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />}
            Analyze response
          </button>
          {canAutoDraft ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => runAnalyze({ draft: true })}
              className="inline-flex items-center gap-2 rounded bg-[var(--fw-sea)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Analyze + auto-draft follow-up
            </button>
          ) : (
            <Link
              to="/app/billing"
              className="inline-flex items-center gap-2 rounded border border-[var(--fw-line)] px-4 py-2.5 text-sm font-semibold text-[var(--fw-ink)] hover:bg-black/5"
            >
              Upgrade to Pro for auto-draft
            </Link>
          )}
        </div>
        <p className="text-xs text-[var(--fw-muted)]">
          On {plan.name}: {canAutoDraft
            ? 'full claimed-vs-dodged analysis and auto-drafted follow-up letters.'
            : 'response readout + talking points — you write the follow-up, or upgrade for drafts.'}
        </p>
      </div>

      {analysis && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-10 space-y-6"
        >
          <div className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
            <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-sea)]">
              Classification · {meta?.mode || 'demo'}
            </div>
            <h2 className="fw-display mt-2 text-2xl font-bold">
              {CLASSIFICATION_LABELS[analysis.classification] || analysis.classification}
            </h2>
            <p className="mt-3 text-[var(--fw-ink)]/90 leading-relaxed">{analysis.summary}</p>
            {analysis.followUpLeverage && (
              <p className="mt-4 rounded border border-[rgba(20,80,95,0.15)] bg-[rgba(20,80,95,0.04)] px-3 py-2 text-sm">
                <strong className="font-semibold">Strongest angle: </strong>
                {analysis.followUpLeverage}
              </p>
            )}
            {analysis.documentQuality && analysis.documentQuality.enclosureLegible === false && (
              <p className="mt-3 text-sm text-amber-900">
                Scan quality issue — don’t treat specific dates/amounts from the enclosure as certain.
                {(analysis.documentQuality.issues || []).join(' · ')}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
            <h3 className="fw-display text-xl font-bold">Claimed vs dodged</h3>
            <ul className="mt-4 divide-y divide-[var(--fw-line)]">
              {(analysis.demandAnalysis || []).map((row, i) => (
                <li key={i} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${outcomeTone(row.outcome)}`}>
                      {OUTCOME_LABELS[row.outcome] || row.outcome}
                    </span>
                    <span className="font-medium">{row.demand}</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--fw-muted)]">{row.notes}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
            <h3 className="fw-display text-xl font-bold">Talking points</h3>
            <p className="mt-1 text-sm text-[var(--fw-muted)]">
              {canAutoDraft
                ? 'Use these if you edit the draft — or mail the auto-draft as-is.'
                : 'Write your follow-up from these, or upgrade to Pro to auto-draft the letter.'}
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {(analysis.talkingPoints || []).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
            {(analysis.admissions || []).length > 0 && (
              <div className="mt-4">
                <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-sea)]">Admissions</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {analysis.admissions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {followUpLetter && (
            <div className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="fw-display text-xl font-bold">Follow-up letter draft</h3>
                  <p className="text-sm text-[var(--fw-muted)]">
                    Phase 2 packet · {meta?.draftMode || 'local'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={mailDraft}
                  className="fw-btn-ink inline-flex items-center gap-2"
                >
                  <Mail size={16} />
                  Review & mail
                </button>
              </div>
              {isFieldworkLetterHtml(followUpLetter) ? (
                <iframe
                  title="Follow-up letter preview"
                  className="mt-4 h-[480px] w-full rounded border border-[var(--fw-line)] bg-white"
                  sandbox=""
                  srcDoc={followUpLetter}
                />
              ) : (
                <pre className="mt-4 max-h-[480px] overflow-auto whitespace-pre-wrap rounded border border-[var(--fw-line)] bg-[var(--fw-paper)] p-4 text-xs">
                  {followUpLetter}
                </pre>
              )}
            </div>
          )}
        </motion.div>
      )}

      {responseAnalyses.length > 0 && !analysis && (
        <div className="mt-10">
          <h2 className="fw-display text-2xl font-bold">Recent analyses</h2>
          <ul className="mt-4 divide-y divide-[var(--fw-line)] overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white">
            {responseAnalyses.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="font-medium">{r.furnisher}</div>
                <div className="text-xs text-[var(--fw-muted)]">
                  {CLASSIFICATION_LABELS[r.analysis?.classification] || r.analysis?.classification}
                  {' · '}
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {documents.some((d) => d.kind === 'Furnisher response') && (
        <p className="mt-8 text-xs text-[var(--fw-muted)]">
          Response files also land in{' '}
          <Link to="/app/documents" className="text-[var(--fw-sea)] hover:underline">Documents</Link>
          {' '}for your follow-up packet enclosures.
        </p>
      )}
    </div>
  );
}
