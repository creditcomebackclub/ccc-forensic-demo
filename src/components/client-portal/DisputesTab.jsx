import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { getReturnReceiptUrl } from '../../utils/api';

const RESPONSE_WINDOW_DAYS = 30;
function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysBetween(aIso, bIso) {
  const a = new Date(aIso + 'T00:00:00');
  const b = new Date(bIso + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function responseCountdown(l) {
  if (l.response_outcome === 'deleted' || l.response_outcome === 'received') return null;
  const clockStart = l.delivered_at ? l.delivered_at.slice(0, 10) : l.mailed_date;
  if (!clockStart) return null;
  const elapsed = daysBetween(clockStart, todayISO());
  const remaining = RESPONSE_WINDOW_DAYS - elapsed;
  const isPhase3 = l.phase && l.phase.startsWith('Phase 3');
  
  if (remaining > 0) {
    if (isPhase3) {
      return { label: 'Day ' + elapsed + ' of 30 — Bureau investigation in progress', tone: remaining <= 7 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-600 bg-gray-50 border-gray-200' };
    }
    return { label: 'Day ' + elapsed + ' of 30 — ' + remaining + ' day' + (remaining === 1 ? '' : 's') + ' remaining', tone: remaining <= 7 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-600 bg-gray-50 border-gray-200' };
  }
  
  if (isPhase3) {
    return { label: 'Bureau investigation window closed — final review pending', tone: 'text-red-700 bg-red-50 border-red-200' };
  }
  return { label: 'Response window closed — ready for escalation', tone: 'text-red-700 bg-red-50 border-red-200' };
}

function ReturnReceiptButton({ lobId }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
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
  RESPONSE_ACCEPT
}) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <h2 className="text-xl font-bold text-slate-900 mb-2">Your Dispute Letters</h2>
      {letters.length === 0 ? (
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-10 text-center shadow-sm">
          <p className="text-sm text-gray-400">No dispute letters yet. Your campaign will begin shortly.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {letters.map(l => (
            <div key={l.id} className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {l.phase && l.phase.startsWith('Phase 3') ? `${l.phase.split('—')[1]?.trim() || l.phase} (re: ${l.furnisher})` : l.furnisher}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {l.phase && l.phase.startsWith('Phase 3') ? 'Phase 3 Escalation' : l.phase}{l.type ? ' · Type ' + l.type : ''}
                  </div>
                </div>
                <span className={`text-[10px] px-2.5 py-1 rounded-md whitespace-nowrap uppercase tracking-[0.05em] font-semibold border ${
                  l.response_outcome === 'deleted' ? 'bg-green-50 text-green-700 border-green-200'
                  : l.tracking_status === 'Delivered' ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : l.mailed_date ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200'
                }`}>
                  {l.response_outcome === 'deleted' ? '🏆 Deleted' : l.response_outcome === 'received' ? 'Response Received' : l.tracking_status === 'Delivered' ? 'Delivered' : l.mailed_date ? 'In Transit' : 'Pending'}
                </span>
              </div>
              
              {l.summary && (
                <div className="text-xs text-gray-600 mt-4 pt-3 border-t border-gray-50 leading-relaxed">
                  {l.summary}
                </div>
              )}
              
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
                  Mailed {new Date(l.mailed_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {l.tracking_number && (
                    <a href={'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + l.tracking_number} target="_blank" rel="noopener noreferrer"
                      className="ml-2 text-slate-900 font-semibold hover:text-blue-600 transition-colors">Track →</a>
                  )}
                  {l.tracking_status === 'Delivered' && l.lob_id && (
                    <ReturnReceiptButton lobId={l.lob_id} />
                  )}
                </div>
              )}
              
              {l.mailed_date && l.tracking_status !== 'Delivered' && !l.response_outcome && !manualUploadUnlocked[l.id] && (
                <div className="mt-4 pt-3 border-t border-gray-50">
                  <button onClick={() => setManualUploadUnlocked(prev => ({ ...prev, [l.id]: true }))}
                    className="text-[11px] text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors font-medium">
                    I received a response
                  </button>
                </div>
              )}
              
              {(l.tracking_status === 'Delivered' || manualUploadUnlocked[l.id]) && !l.response_outcome && (
                <div className="mt-4 pt-4 border-t border-gray-50">
                  {uploadSuccess === l.id ? (
                    <div className="text-xs text-green-700 font-bold flex items-center gap-1.5 bg-green-50 p-3 rounded-lg border border-green-200">
                      <span>✓</span> Response uploaded — Credit Comeback Club has been notified.
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
