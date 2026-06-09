import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { LogOut, FileText, Mail, CheckCircle, Clock, AlertCircle, Shield, TrendingUp, ExternalLink, ChevronRight, Star, Calendar } from 'lucide-react';

function ScoreBar({ label, start, current }) {
  const diff = (start && current) ? current - start : null;
  const pct = current ? Math.min(100, Math.max(0, ((current - 300) / 550) * 100)) : 0;
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[16px] font-bold" style={{ color: '#1B2A4A' }}>{current || '—'}</span>
          {diff !== null && (
            <span className="text-[11px] font-medium" style={{ color: diff > 0 ? '#15803D' : diff < 0 ? '#DC2626' : '#666' }}>
              {diff > 0 ? '+' : ''}{diff}
            </span>
          )}
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: pct + '%', background: 'linear-gradient(90deg, #1B2A4A, #C9A84C)' }} />
      </div>
      {start && <div className="text-[9px] text-ink-faint mt-0.5">Started at {start}</div>}
    </div>
  );
}

function TimelineEvent({ icon, title, subtitle, date, tone }) {
  const colors = {
    default: { bg: '#F9FAFB', border: '#E5E7EB' },
    green: { bg: '#F0FDF4', border: '#BBF7D0' },
    blue: { bg: '#EFF6FF', border: '#BFDBFE' },
    gold: { bg: '#FFFBEB', border: '#FDE68A' },
    red: { bg: '#FEF2F2', border: '#FECACA' },
  };
  const c = colors[tone] || colors.default;
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[13px]"
        style={{ backgroundColor: c.bg, border: '1px solid ' + c.border }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 pb-4 border-b border-border last:border-b-0">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {subtitle && <div className="text-[11px] text-ink-muted mt-0.5">{subtitle}</div>}
        {date && <div className="text-[10px] text-ink-faint mt-1">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
      </div>
    </div>
  );
}

export default function ClientPortal({ session, onSignOut }) {
  const [profile, setProfile] = useState(null);
  const [clientMeta, setClientMeta] = useState(null);
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => { loadData(); }, [session]);

  const loadData = async () => {
    try {
      const { data: cp } = await supabase.from('client_profiles').select('*').eq('user_id', session.user.id).single();
      setProfile(cp);
      if (cp) {
        const [lettersRes, metaRes] = await Promise.all([
          supabase.from('letters').select('*').eq('client_name', cp.full_name).order('saved_at', { ascending: true }),
          supabase.from('clients').select('*').eq('name', cp.full_name).limit(1),
        ]);
        setLetters(lettersRes.data || []);
        setClientMeta(metaRes.data && metaRes.data.length > 0 ? metaRes.data[0] : null);
      }
    } catch (e) { console.error('Portal load error:', e); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#F8F9FA' }}>
      <div className="text-[13px] text-gray-400">Loading your portal…</div>
    </div>
  );

  const mailed = letters.filter(l => l.mailed_date);
  const delivered = letters.filter(l => l.tracking_status === 'Delivered');
  const responded = letters.filter(l => l.response_outcome);
  const deletions = letters.filter(l => l.response_outcome === 'deleted');
  const isVip = clientMeta && clientMeta.is_vip;
  const firstName = (profile && profile.full_name || '').split(' ')[0] || 'there';

  const timeline = [];
  letters.forEach(l => {
    if (l.saved_at) timeline.push({ date: l.saved_at, icon: '📄', title: 'Dispute letter prepared — ' + l.furnisher, subtitle: l.phase, tone: 'blue' });
    if (l.mailed_date) timeline.push({ date: l.mailed_date, icon: '✉️', title: 'Letter mailed via certified mail — ' + l.furnisher, subtitle: l.tracking_number ? 'USPS #' + l.tracking_number.slice(-8) : null, tone: 'default' });
    if (l.tracking_status === 'Delivered') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '✅', title: 'Delivered — ' + l.furnisher, subtitle: '30-day response window started', tone: 'green' });
    if (l.response_outcome === 'received') timeline.push({ date: l.response_date, icon: '📬', title: 'Response received — ' + l.furnisher, tone: 'gold' });
    if (l.response_outcome === 'no_response') timeline.push({ date: l.response_date || l.mailed_date, icon: '⚠️', title: 'No response — Phase 3 escalation triggered', subtitle: l.furnisher, tone: 'red' });
    if (l.response_outcome === 'deleted') timeline.push({ date: l.response_date, icon: '🏆', title: 'DELETED — ' + l.furnisher, subtitle: 'Account removed from your credit report', tone: 'green' });
  });
  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tabs = ['overview', 'disputes', 'timeline', ...(isVip ? ['vip'] : [])];

  return (
    <div className="min-h-screen" style={{ background: '#F8F9FA' }}>
      <div style={{ background: '#1B2A4A' }} className="px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div style={{ background: '#C9A84C', borderRadius: 6, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#1B2A4A', fontWeight: 800, fontSize: 14 }}>CC</span>
            </div>
            <div>
              <div style={{ color: '#C9A84C', fontWeight: 700, fontSize: 14 }}>Credit Comeback Club</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Client Portal {isVip ? '· ⭐ VIP Member' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{profile && profile.full_name}</span>
            <button onClick={onSignOut} className="flex items-center gap-1 hover:opacity-100 transition-opacity"
              style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <LogOut size={12} strokeWidth={1.75} /> Sign Out
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB' }}>
        <div className="max-w-3xl mx-auto px-6 flex">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-[12px] uppercase tracking-wider transition-colors"
              style={{
                color: activeTab === tab ? '#1B2A4A' : '#9CA3AF',
                borderBottom: activeTab === tab ? '2px solid #C9A84C' : '2px solid transparent',
                fontWeight: activeTab === tab ? 600 : 400,
              }}>
              {tab === 'vip' ? '⭐ VIP' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

        {activeTab === 'overview' && (
          <>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B2A4A' }}>Welcome back, {firstName}.</h1>
              <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Here's your credit restoration campaign at a glance.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Letters Sent', value: mailed.length, icon: '✉️' },
                { label: 'Delivered', value: delivered.length, icon: '✅' },
                { label: 'Responses', value: responded.length, icon: '📬' },
                { label: 'Deletions', value: deletions.length, icon: '🏆' },
              ].map(({ label, value, icon }) => (
                <div key={label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1B2A4A' }}>{value}</div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9CA3AF', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {clientMeta && (clientMeta.score_eq_start || clientMeta.score_exp_start || clientMeta.score_tu_start) && (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp size={14} style={{ color: '#C9A84C' }} strokeWidth={2} />
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B2A4A' }}>Score Progress</span>
                </div>
                <div className="flex gap-6">
                  <ScoreBar label="Equifax" start={clientMeta.score_eq_start} current={clientMeta.score_eq_start} />
                  <ScoreBar label="Experian" start={clientMeta.score_exp_start} current={clientMeta.score_exp_start} />
                  <ScoreBar label="TransUnion" start={clientMeta.score_tu_start} current={clientMeta.score_tu_start} />
                </div>
                <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 10 }}>Scores update as deletions are confirmed. Pull your latest report to track progress.</p>
              </div>
            )}

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Shield size={15} style={{ color: '#15803D' }} strokeWidth={1.75} />
              <div className="flex-1">
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1B2A4A' }}>Authorization Active</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>Credit Comeback Club is authorized to dispute on your behalf{profile && profile.agreement_signed_at ? ' since ' + new Date(profile.agreement_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</div>
              </div>
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active</span>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
              <div className="flex items-center justify-between mb-3">
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B2A4A' }}>Credit Monitoring</span>
                {clientMeta && clientMeta.monitoring_enrolled
                  ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}>✓ Enrolled</span>
                  : <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }}>Action Required</span>
                }
              </div>
              {clientMeta && clientMeta.monitoring_enrolled ? (
                <a href={(clientMeta && clientMeta.monitoring_portal_url) || 'https://www.privacyguard.com'} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#1B2A4A' }}>
                  <ExternalLink size={12} strokeWidth={2} />
                  Access {(clientMeta && clientMeta.monitoring_service) || 'Privacy Guard'} →
                </a>
              ) : (
                <div>
                  <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>Credit monitoring is required to track your progress and score changes. Please sign up to continue.</p>
                  <a href="https://www.privacyguard.com" target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 16px', background: '#1B2A4A', color: '#C9A84C', borderRadius: 4, fontWeight: 600, textDecoration: 'none' }}>
                    Set Up Privacy Guard →
                  </a>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'disputes' && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B2A4A' }}>Your Dispute Letters</h2>
            {letters.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>No dispute letters yet. Your campaign will begin shortly.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {letters.map(l => (
                  <div key={l.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1B2A4A' }}>{l.furnisher}</div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{l.phase}{l.type ? ' · Type ' + l.type : ''}</div>
                      </div>
                      <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
                        ...(l.response_outcome === 'deleted' ? { background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }
                          : l.tracking_status === 'Delivered' ? { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }
                          : l.mailed_date ? { background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }
                          : { background: '#F9FAFB', color: '#9CA3AF', border: '1px solid #E5E7EB' })
                      }}>
                        {l.response_outcome === 'deleted' ? '🏆 Deleted' : l.response_outcome === 'received' ? 'Response Received' : l.tracking_status === 'Delivered' ? 'Delivered' : l.mailed_date ? 'In Transit' : 'Pending'}
                      </span>
                    </div>
                    {l.mailed_date && (
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>
                        Mailed {new Date(l.mailed_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {l.tracking_number && (
                          <a href={'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + l.tracking_number} target="_blank" rel="noopener noreferrer"
                            style={{ marginLeft: 8, color: '#1B2A4A', fontWeight: 500 }}>Track →</a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'timeline' && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B2A4A' }}>Dispute Journal</h2>
            <p style={{ fontSize: 12, color: '#6B7280', marginTop: -8 }}>A chronological record of every action in your campaign.</p>
            {timeline.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>Your timeline will populate as your campaign progresses.</p>
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
                {timeline.map((event, i) => <TimelineEvent key={i} {...event} />)}
              </div>
            )}
          </>
        )}

        {activeTab === 'vip' && isVip && (
          <>
            <div style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #2A3C5F 100%)', borderRadius: 12, padding: 24 }}>
              <div className="flex items-center gap-2 mb-2">
                <Star size={15} style={{ color: '#C9A84C' }} strokeWidth={2} />
                <span style={{ color: '#C9A84C', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>VIP Member</span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Your VIP Benefits</h2>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Priority service, monthly strategy calls, and exclusive business credit resources.</p>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={14} style={{ color: '#C9A84C' }} strokeWidth={2} />
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B2A4A' }}>Monthly Strategy Call</span>
              </div>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>Book your 15-minute strategy call with Christopher Holland. Review your campaign, discuss next steps, and map your path to business credit.</p>
              <a href="https://calendly.com" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 20px', background: '#1B2A4A', color: '#C9A84C', borderRadius: 4, fontWeight: 700, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <Calendar size={13} strokeWidth={2} />
                Book Your Call →
              </a>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} style={{ color: '#C9A84C' }} strokeWidth={2} />
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B2A4A' }}>Business Credit & Funding</span>
              </div>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>Once your personal credit is positioned, the next step is business credit and funding. Our partner Swiftedly specializes in business funding for entrepreneurs.</p>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>Business credit is completely separate from personal credit — you can start building it now.</p>
              <a href="https://swiftedly.com" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 20px', background: '#C9A84C', color: '#1B2A4A', borderRadius: 4, fontWeight: 700, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <ExternalLink size={13} strokeWidth={2} />
                Explore Business Funding →
              </a>
            </div>
          </>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#D1D5DB', paddingBottom: 32 }}>
          Credit Comeback Club · Grand Junction, CO · creditcomebackclub.com · 970-644-0063
        </div>
      </div>
    </div>
  );
}
