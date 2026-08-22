import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { getReturnReceiptUrl } from '../../utils/api';
import {
  clientCampaignDetail,
  clientCampaignLabel,
  isCccDisputeCampaign,
} from '../../utils/clientCampaignCopy';
import {
  buildPortalCampaignJourneys,
  clientTrackStatusLabel,
  hasClientVisibleDelivery,
  isPortalMailTerminal,
  isPortalBureauDispute,
  isPortalFileUpdate,
  portalMailPresentation,
  portalReviewStartDate,
  visiblePortalTracks,
} from '../../utils/portalCampaigns';

const RESPONSE_WINDOW_DAYS = 30;
const BUREAU_RESPONSE_WINDOW_DAYS = 45;
function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysBetween(aIso, bIso) {
  const a = new Date(aIso + 'T00:00:00Z');
  const b = new Date(bIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
function responseCountdown(l) {
  if (l.response_outcome === 'deleted' || l.response_outcome === 'received' || l.response_outcome === 'no_response') return null;
  const isFileUpdate = isPortalFileUpdate(l);
  const isPhase3 = isPortalBureauDispute(l);
  const isCccDispute = isCccDisputeCampaign(l.phase);
  const windowDays = isPhase3 && !isCccDispute ? BUREAU_RESPONSE_WINDOW_DAYS : RESPONSE_WINDOW_DAYS;
  const mail = portalMailPresentation(l);
  if (!l.mailed_date) return null;
  if (isPortalMailTerminal(l)) {
    return { label: 'Mailing issue recorded — the review clock has not started', tone: 'text-red-700 bg-red-50 border-red-200' };
  }
  const clockStart = portalReviewStartDate(l);
  if (!clockStart) {
    return {
      label: mail.legacyCertified
        ? 'Mailed certified — delivery confirmation pending'
        : mail.currentFirstClass
          ? 'Mailed First Class — review schedule pending'
          : 'Mailed — review schedule pending',
      tone: 'text-gray-600 bg-gray-50 border-gray-200',
    };
  }
  const elapsed = daysBetween(clockStart, todayISO());
  const remaining = mail.legacyCertified && l.response_due_at
    ? daysBetween(todayISO(), String(l.response_due_at).slice(0, 10))
    : windowDays - elapsed;

  if (mail.currentFirstClass && elapsed < 0) {
    return { label: 'USPS First Class — review scheduled for ' + new Date(clockStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'text-gray-600 bg-gray-50 border-gray-200' };
  }
  
  if (remaining > 0) {
    if (isCccDispute) {
      return { label: `Case review: day ${elapsed} of ${windowDays}${mail.currentFirstClass ? ' (expected-delivery basis)' : ''}`, tone: remaining <= 7 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-600 bg-gray-50 border-gray-200' };
    }
    if (isPhase3) {
      return { label: 'Day ' + elapsed + ' of ' + windowDays + ' — Bureau investigation in progress', tone: remaining <= 7 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-600 bg-gray-50 border-gray-200' };
    }
    if (isFileUpdate) {
      return { label: 'Day ' + elapsed + ' of ' + windowDays + ' — File update in progress', tone: remaining <= 7 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-600 bg-gray-50 border-gray-200' };
    }
    return { label: 'Day ' + elapsed + ' of ' + windowDays + ' — ' + remaining + ' day' + (remaining === 1 ? '' : 's') + ' remaining', tone: remaining <= 7 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-600 bg-gray-50 border-gray-200' };
  }
  
  if (isCccDispute) {
    return { label: 'Case review due — staff is checking the documented result', tone: 'text-red-700 bg-red-50 border-red-200' };
  }
  if (isPhase3) {
    return { label: 'Bureau investigation window closed — final review pending', tone: 'text-red-700 bg-red-50 border-red-200' };
  }
  if (isFileUpdate) {
    return { label: 'File update window closed — staff review pending', tone: 'text-red-700 bg-red-50 border-red-200' };
  }
  return { label: 'Response window closed — staff review pending', tone: 'text-red-700 bg-red-50 border-red-200' };
}

function responseBadge(l) {
  const isFileUpdate = isPortalFileUpdate(l);
  const isBureau = isPortalBureauDispute(l);
  const isCccDispute = isCccDisputeCampaign(l.phase);
  const mail = portalMailPresentation(l);
  if (l.response_outcome === 'deleted') return { label: '🏆 Deleted', tone: 'bg-green-50 text-green-700 border-green-200' };
  if (l.round_review_status === 'resolved') return { label: 'Review Complete', tone: 'bg-green-50 text-green-700 border-green-200' };
  if (l.round_review_status === 'follow_up') return { label: 'Next Round Approved', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (l.round_review_status === 'needs_documents') return { label: 'Documents Requested', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (l.round_review_status === 'escalated') return { label: 'Escalation Review Approved', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (l.response_outcome === 'no_response') {
    const closedLabel = isCccDispute ? 'Case ready for review' : isBureau ? 'Bureau review pending' : isFileUpdate ? 'File update review pending' : 'Staff review pending';
    return { label: closedLabel, tone: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (l.response_outcome === 'received' && isBureau) {
    if (l.bureau_response_status === 'analyzing') return { label: 'Bureau Response Under Review', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (l.bureau_response_status === 'review_ready') return { label: 'Bureau Review Ready', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (l.bureau_response_status === 'reviewed') return { label: 'Next Step Recorded', tone: 'bg-green-50 text-green-700 border-green-200' };
    return { label: 'Bureau Response Received', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (l.response_outcome === 'received') return { label: 'Response Received', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (isPortalMailTerminal(l)) return { label: 'Mailing Issue', tone: 'bg-red-50 text-red-700 border-red-200' };
  if (isCccDispute && l.mailed_date && mail.currentFirstClass) return { label: 'Mailed First Class', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (hasClientVisibleDelivery(l)) return { label: 'Delivered', tone: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (mail.legacyCertified && l.tracking_status === 'Out for Delivery') return { label: 'Out for Delivery', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (mail.legacyCertified && l.tracking_status === 'In Transit') return { label: 'In Transit', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (l.mailed_date) return { label: 'Mailed', tone: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Pending', tone: 'bg-gray-50 text-gray-500 border-gray-200' };
}

function CampaignJourneyCards({ campaigns, letters, rounds }) {
  const journeys = buildPortalCampaignJourneys(campaigns, letters, rounds);
  if (!journeys.length) return null;
  return (
    <div className="space-y-3">
      {journeys.map((journey) => (
        <div key={journey.campaign_id} className="rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Campaign history · Round {journey.round_number}</div>
          <div className="mt-3 space-y-3">
            {[
              { number: 1, label: 'Report preparation', detail: journey.cleanup.status, counts: journey.cleanup },
              { number: 2, label: `Round ${journey.round_number} account casework`, detail: journey.account.status, counts: journey.account },
            ].map((step, index) => (
              <div key={step.number} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-amber-400">{step.number}</div>
                  {index === 0 && <div className="mt-1 h-full min-h-4 w-px bg-slate-200" />}
                </div>
                <div className="min-w-0 pb-1">
                  <div className="text-xs font-bold text-slate-900">{step.label}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-slate-600">{step.detail}</div>
                  {step.counts.letterCount > 0 && (
                    <div className="mt-0.5 text-[10px] text-slate-400">{step.counts.mailedCount}/{step.counts.letterCount} mailed · {step.counts.reviewStartedCount}/{step.counts.letterCount} review clocks active</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const BUREAU_LABELS = { EQ: 'Equifax', EXP: 'Experian', TU: 'TransUnion' };

function CccCaseworkSummary({ projection }) {
  const tracks = visiblePortalTracks(projection?.tracks || []);
  if (!tracks.length) return null;
  const resultByTrack = new Map();
  for (const result of projection?.results || []) {
    if (!resultByTrack.has(result.track_id)) resultByTrack.set(result.track_id, result);
  }
  return (
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-700">Your active case map</div>
      <h3 className="mt-1 text-base font-bold text-slate-900">Every account is tracked independently.</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">You see the account, bureau, and current case status here. Internal legal strategy and staff notes stay private.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {tracks.map((track) => {
          const result = resultByTrack.get(track.track_id);
          const channel = track.channel === 'direct_account'
            ? 'Direct account review'
            : BUREAU_LABELS[track.bureau_code] || 'Credit bureau review';
          return (
            <div key={track.track_id} className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-900">{track.account_label || 'Account'}{track.masked_account ? ` · ${track.masked_account}` : ''}</div>
                  <div className="mt-0.5 text-[10px] font-medium text-slate-500">{channel}{track.case_step ? ` · Step ${track.case_step}` : ''}</div>
                </div>
                <span className="shrink-0 rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-blue-700">{clientTrackStatusLabel(track.status)}</span>
              </div>
              {result?.outcome_label && <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-600">Latest result: {result.outcome_label}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PacketCoverageSummary({ rows }) {
  if (!rows?.length) return null;
  const progress = {
    resolved: 'Resolved', documents_requested: 'Documents requested',
    next_step_being_prepared: 'Next step being prepared',
  };
  return <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{rows.length} account{rows.length === 1 ? '' : 's'} in this packet</div>
    <div className="mt-2 space-y-2">{rows.map((row) => <div key={row.coverage_id} className="text-[11px]"><div className="flex items-center justify-between gap-3"><span className="truncate font-medium text-slate-700">{row.account_label}{row.masked_account ? ` · ${row.masked_account}` : ''}</span><span className="shrink-0 text-slate-500">{progress[row.client_progress] || (row.response_status === 'not_received' ? 'Awaiting response' : 'Under review')}</span></div>{row.documents_requested && row.document_request && <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-relaxed text-amber-900">Requested: {row.document_request}</div>}</div>)}</div>
  </div>;
}

function ReturnReceiptButton({ lobId, returnReceiptUrl }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    if (returnReceiptUrl) {
      window.open(returnReceiptUrl, '_blank');
      return;
    }

    setLoading(true);
    try {
      const url = await getReturnReceiptUrl(lobId);
      if (url) {
        window.open(url, '_blank');
      } else {
        toast('USPS has not uploaded the signed receipt yet. This typically takes 24-48 hours after delivery. Please check back later.', { icon: '📬' });
      }
    } catch (e) {
      toast.error(e.message || 'Failed to fetch return receipt');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleDownload} disabled={loading}
      className="ml-2 text-slate-900 font-semibold hover:text-blue-600 transition-colors disabled:opacity-50">
      {loading ? 'Fetching...' : 'Signed Receipt ↓'}
    </button>
  );
}

export default function DisputesTab({
  letters,
  rounds = [],
  campaigns = [],
  packetCoverage = [],
  manualUploadUnlocked,
  setManualUploadUnlocked,
  uploadSuccess,
  stagedFiles,
  handleRemoveStaged,
  uploadingLetter,
  stageError,
  submitError,
  handleStageFiles,
  handleSubmitResponse,
  RESPONSE_ACCEPT,
  cccProjection = null,
}) {
  const coverageByLetter = new Map();
  for (const row of packetCoverage) coverageByLetter.set(row.letter_id, [...(coverageByLetter.get(row.letter_id) || []), row]);
  const authoritativeDirect = visiblePortalTracks(cccProjection?.tracks || [])
    .some((track) => track.channel === 'direct_account');
  const standaloneRounds = rounds.filter((round) => (
    !round.campaign_id
    && round.status !== 'cancelled'
    && (round.target_type === 'bureau' || authoritativeDirect)
  ));
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <h2 className="text-xl font-bold text-slate-900 mb-2">Your Casework</h2>
      <CccCaseworkSummary projection={cccProjection} />
      <CampaignJourneyCards campaigns={campaigns} letters={letters} rounds={rounds} />
      {standaloneRounds.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {standaloneRounds.map((round) => {
            const target = round.target_type === 'bureau' ? 'Credit bureau case' : 'Direct account review';
            const status = round.status === 'open'
              ? (round.reviewed_count > 0 ? 'Staff review in progress' : round.mailed_count === round.letter_count ? 'Response window in progress' : 'Preparation and mailing in progress')
              : round.final_disposition === 'resolved'
                ? 'Review complete · account campaign resolved'
                : round.final_disposition === 'escalate'
                  ? 'Ready for escalation review · no filing has been submitted'
                  : 'Review complete · another round may be prepared';
            return (
              <div key={round.round_id} className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Round {round.round_number} · {target}</div>
                <div className="mt-1 text-xs font-semibold text-slate-800">{status}</div>
                <div className="mt-1 text-[10px] text-slate-400">{round.mailed_count}/{round.letter_count} mailed · {round.reviewed_count}/{round.letter_count} reviewed</div>
              </div>
            );
          })}
        </div>
      )}
      {letters.length === 0 ? (
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-10 text-center shadow-sm">
          <p className="text-sm text-gray-400">No casework letters yet. Your first case step will appear after staff preparation.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {letters.map(l => (
            <div key={l.id} className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              {(() => {
                const badge = responseBadge(l);
                const isFileUpdate = isPortalFileUpdate(l);
                const campaignRound = l.campaign_id
                  ? campaigns.find((campaign) => campaign.campaign_id === l.campaign_id)?.round_number
                  : null;
                const displayRound = Number(l.packet_version || 1) === 2 ? (campaignRound || l.round_number) : l.round_number;
                const structuredLabel = isFileUpdate
                  ? 'Report preparation'
                  : displayRound
                  ? `Round ${displayRound} · ${l.target_type === 'bureau' ? 'Credit bureau case' : 'Direct account correspondence'}`
                  : null;
                const mail = portalMailPresentation(l);
                const title = isFileUpdate
                  ? `Report preparation — ${l.furnisher}`
                  : isPortalBureauDispute(l)
                    ? `Credit bureau case (re: ${l.furnisher})`
                    : l.furnisher;
                return <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {title}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {structuredLabel || (isCccDisputeCampaign(l.phase)
                      ? 'Credit bureau case · Evidence-backed account review'
                      : `${clientCampaignLabel(l.phase)} · ${clientCampaignDetail(l.phase)}`)}{l.target_bureau ? ` · ${l.target_bureau.charAt(0).toUpperCase() + l.target_bureau.slice(1)}` : ''}{l.type ? ' · Letter type ' + l.type : ''}
                  </div>
                </div>
                <span className={`text-[10px] px-2.5 py-1 rounded-md whitespace-nowrap uppercase tracking-[0.05em] font-semibold border ${badge.tone}`}>
                  {badge.label}
                </span>
              </div>
              
              {l.summary && (
                <div className="text-xs text-gray-600 mt-4 pt-3 border-t border-gray-50 leading-relaxed">
                  {l.summary}
                </div>
              )}
              <PacketCoverageSummary rows={coverageByLetter.get(l.id)} />
              
              {(() => {
                const cd = responseCountdown(l);
                if (!cd) return null;
                return (
                  <div className={`flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-3 py-2 mt-3 border ${cd.tone}`}>
                    <Calendar size={14} strokeWidth={2} />
                    {cd.label}
                  </div>
                );
              })()}
              
              {l.mailed_date && (
                <div className="text-[11px] text-gray-400 mt-3 font-medium">
                  Mailed {mail.label} · {new Date(l.mailed_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {l.tracking_number && mail.legacyCertified && (
                    <a href={'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + l.tracking_number} target="_blank" rel="noopener noreferrer"
                      className="ml-2 text-slate-900 font-semibold hover:text-blue-600 transition-colors">Track →</a>
                  )}
                  {l.tracking_status === 'Delivered' && l.lob_id && mail.legacyCertified && (
                    <ReturnReceiptButton lobId={l.lob_id} returnReceiptUrl={l.return_receipt_url} />
                  )}
                  {mail.currentFirstClass && portalReviewStartDate(l) && (
                    <span className="ml-2">Review start {new Date(`${portalReviewStartDate(l)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  )}
                </div>
              )}
              
              {l.mailed_date && !hasClientVisibleDelivery(l) && !l.response_outcome && !manualUploadUnlocked[l.id] && (
                <div className="mt-4 pt-3 border-t border-gray-50">
                  <button onClick={() => setManualUploadUnlocked(prev => ({ ...prev, [l.id]: true }))}
                    className="text-[11px] text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors font-medium">
                    I received a response
                  </button>
                </div>
              )}
              
              {(hasClientVisibleDelivery(l) || manualUploadUnlocked[l.id]) && !l.response_outcome && (
                <div className="mt-4 pt-4 border-t border-gray-50">
                  {uploadSuccess === l.id ? (
                    <div className="text-xs text-green-700 font-bold flex items-center gap-1.5 bg-green-50 p-3 rounded-lg border border-green-200">
                      <span>✓</span> Response received — your specialist will log each account — Credit Comeback Club has been notified.
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                        Did you receive a response from <span className="font-semibold text-slate-800">{l.furnisher}</span> in the mail? Upload it here and we'll take it from there.
                        If it's more than one page, add every page — we'll review it as one document.
                      </p>
                      
                      {(stagedFiles[l.id] || []).length > 0 && (
                        <div className="mb-3 space-y-1.5">
                          {stagedFiles[l.id].map((f, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-gray-700 bg-gray-50 p-2 rounded border border-gray-100">
                              <span className="font-medium">Page {i + 1}:</span> <span className="truncate">{f.name}</span>
                              <button onClick={() => handleRemoveStaged(l.id, i)} disabled={uploadingLetter === l.id}
                                className="ml-auto text-[10px] text-red-400 hover:text-red-600 uppercase tracking-wider font-bold transition-colors disabled:opacity-50">
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {stageError[l.id] && (
                        <div className="text-[11px] text-red-600 mb-3 bg-red-50 p-2 rounded">{stageError[l.id]}</div>
                      )}
                      {submitError[l.id] && (
                        <div className="text-[11px] text-red-600 mb-3 bg-red-50 p-2 rounded">{submitError[l.id]}</div>
                      )}
                      
                      <div className="flex gap-2 flex-wrap">
                        <label className={`inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-semibold transition-all cursor-pointer ${(stagedFiles[l.id] || []).length ? 'bg-white text-slate-900 border border-slate-900 hover:bg-slate-50' : 'bg-slate-900 text-amber-400 border border-transparent hover:bg-slate-800'} ${uploadingLetter === l.id ? 'opacity-50 pointer-events-none' : ''}`}>
                          {(stagedFiles[l.id] || []).length ? '+ Add Another Page' : '📎 Upload Response'}
                          <input type="file" accept={RESPONSE_ACCEPT + ',image/*'} multiple className="hidden"
                            onChange={e => { handleStageFiles(l, e.target.files); e.target.value = ''; }}
                            disabled={uploadingLetter === l.id} />
                        </label>
                        
                        {(stagedFiles[l.id] || []).length > 0 && (
                          <button onClick={() => handleSubmitResponse(l)} disabled={uploadingLetter === l.id}
                            className={`inline-flex items-center gap-1.5 text-xs px-4 py-2 bg-amber-400 text-slate-900 rounded-lg font-bold transition-all hover:bg-amber-300 ${uploadingLetter === l.id ? 'opacity-50 pointer-events-none' : ''}`}>
                            {uploadingLetter === l.id ? 'Uploading…' : `Submit Response (${stagedFiles[l.id].length} page${stagedFiles[l.id].length > 1 ? 's' : ''})`}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              </>;
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
