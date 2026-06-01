import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { LogOut, FileText, Mail, CheckCircle, Clock, AlertCircle, Shield } from 'lucide-react';

export default function ClientPortal({ session, onSignOut }) {
  const [profile, setProfile] = useState(null);
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [session]);

  const loadData = async () => {
    try {
      const { data: cp } = await supabase
        .from('client_profiles')
        .select('*')
        .eq('user_id', session.user.id)
        .single();
      setProfile(cp);

      if (cp) {
        const { data: ls } = await supabase
          .from('letters')
          .select('*')
          .eq('client_name', cp.full_name)
          .order('saved_at', { ascending: false });
        setLetters(ls || []);
      }
    } catch (e) {
      console.error('Portal load error:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-[13px] text-ink-muted">Loading your portal…</div>
      </div>
    );
  }

  const mailed = letters.filter(l => l.mailed_date);
  const pending = letters.filter(l => !l.mailed_date);
  const delivered = letters.filter(l => l.tracking_status === 'Delivered');
  const responded = letters.filter(l => l.response_outcome);

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div style={{ backgroundColor: '#1B2A4A' }} className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.jpg" alt="CCC" className="w-8 h-8 object-contain rounded" onError={(e) => e.target.style.display='none'} />
          <div>
            <div className="text-[14px] font-medium" style={{ color: '#C9A84C' }}>Credit Comeback Club</div>
            <div className="text-[11px] text-white opacity-70">Client Portal</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[12px] text-white opacity-80">{profile?.full_name || session.user.email}</span>
          <button onClick={onSignOut} className="flex items-center gap-1.5 text-[11px] text-white opacity-60 hover:opacity-100 transition-opacity">
            <LogOut size={13} strokeWidth={1.75} /> Sign Out
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Welcome */}
        <div>
          <h1 className="ccc-display text-2xl text-ink font-medium">
            Welcome back, {(profile?.full_name || '').split(' ')[0] || 'there'}.
          </h1>
          <p className="text-[13px] text-ink-muted mt-1">Here's the current status of your credit dispute campaign.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Letters Sent', value: mailed.length, icon: Mail, color: '#1B2A4A' },
            { label: 'Delivered', value: delivered.length, icon: CheckCircle, color: '#16a34a' },
            { label: 'Pending Mail', value: pending.length, icon: Clock, color: '#d97706' },
            { label: 'Responses', value: responded.length, icon: AlertCircle, color: '#7c3aed' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white border border-border rounded p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} strokeWidth={1.75} style={{ color }} />
                <span className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
              </div>
              <div className="ccc-mono text-2xl font-medium text-ink">{value}</div>
            </div>
          ))}
        </div>

        {/* LPOA Status */}
        <div className="bg-white border border-border rounded p-4 flex items-center gap-3">
          <Shield size={16} strokeWidth={1.75} className="text-green-600 shrink-0" />
          <div>
            <div className="text-[12px] font-medium text-ink">Authorization on File</div>
            <div className="text-[11px] text-ink-muted">
              Limited Power of Attorney signed
              {profile?.lpoa_signed_at ? ' on ' + new Date(profile.lpoa_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}
            </div>
          </div>
          <div className="ml-auto">
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-green-50 text-green-700 border border-green-200">✓ Active</span>
          </div>
        </div>

        {/* Letters */}
        <div>
          <h2 className="text-[13px] font-medium text-ink uppercase tracking-wider mb-3">Dispute Letters</h2>
          {letters.length === 0 ? (
            <div className="bg-white border border-border rounded p-8 text-center">
              <FileText size={24} className="mx-auto mb-2 text-ink-faint" strokeWidth={1.5} />
              <p className="text-[13px] text-ink-muted">No dispute letters yet. Your campaign will begin shortly.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {letters.map((l) => (
                <div key={l.id} className="bg-white border border-border rounded p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink truncate">{l.furnisher}</div>
                      <div className="text-[11px] text-ink-muted mt-0.5">{l.phase} · {l.type && `Type ${l.type}`}</div>
                    </div>
                    <div className="shrink-0">
                      {l.response_outcome ? (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-green-50 text-green-700">Response Received</span>
                      ) : l.tracking_status === 'Delivered' ? (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-blue-50 text-blue-700">Delivered</span>
                      ) : l.mailed_date ? (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-amber-50 text-amber-700">In Transit</span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-gray-100 text-ink-muted">Pending Mail</span>
                      )}
                    </div>
                  </div>
                  {l.mailed_date && (
                    <div className="mt-2 text-[11px] text-ink-muted">
                      Mailed {new Date(l.mailed_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {l.tracking_number && (
                        <a href={`https://tools.usps.com/go/TrackConfirmAction?tLabels=${l.tracking_number}`}
                          target="_blank" rel="noopener noreferrer"
                          className="ml-2 text-navy hover:text-gold">
                          Track →
                        </a>
                      )}
                    </div>
                  )}
                  {l.response_outcome && (
                    <div className="mt-2 text-[11px] text-ink-muted">
                      Response: {l.response_outcome}
                      {l.response_date && ` · ${new Date(l.response_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-center text-[11px] text-ink-faint pb-8">
          Questions? Contact us at creditcomebackclub@gmail.com · 970-644-0063
        </div>
      </div>
    </div>
  );
}
