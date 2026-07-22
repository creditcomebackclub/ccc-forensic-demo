import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { LogOut, Users, DollarSign, TrendingUp, Plus, CheckCircle, Clock, AlertCircle, ChevronRight, X } from 'lucide-react';
import { getSettings } from '../utils/settings';

export default function AffiliatePortal({ session, onSignOut }) {
  const [affiliate, setAffiliate] = useState(null);
  const [clients, setClients] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [letters, setLetters] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showReferForm, setShowReferForm] = useState(false);
  const [referForm, setReferForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [referLoading, setReferLoading] = useState(false);
  const [referSuccess, setReferSuccess] = useState(false);
  const [error, setError] = useState(null);

  const brandColor = affiliate?.brand_color || '#22C55E';
  const isSwiftedly = affiliate?.company?.toLowerCase().includes('swiftedly') || affiliate?.name?.toLowerCase().includes('swiftedly');
  const accentColor = isSwiftedly ? '#FF6900' : brandColor; // Action Orange for Swiftedly
  const brandName = affiliate?.brand_name || affiliate?.company || 'Partner Portal';
  const brandLogo = affiliate?.brand_logo_url || null;

  useEffect(() => { loadData(); }, [session]);

  const loadData = async () => {
    try {
      const s = await getSettings();
      setSettings(s);

      // Load affiliate profile
      const { data: aff } = await supabase
        .from('affiliates')
        .select('*')
        .eq('user_id', session.user.id)
        .single();
      setAffiliate(aff);

      if (aff) {
        // Load referred clients
        const { data: clientData } = await supabase
          .from('clients')
          .select('*')
          .eq('referred_by', aff.id)
          .order('created_at', { ascending: false });
        setClients(clientData || []);

        // Load letters for those clients
        if (clientData && clientData.length > 0) {
          const names = clientData.map(c => c.name);
          const emails = clientData.map(c => c.email);

          const { data: letterData } = await supabase
            .from('letters')
            .select('client_name, furnisher, phase, mailed_date, tracking_status, delivered_at, response_outcome, saved_at')
            .in('client_name', names);
          setLetters(letterData || []);

          const { data: profileData } = await supabase
            .from('client_profiles')
            .select('email, full_name, starting_scores, current')
            .in('email', emails);
          setProfiles(profileData || []);
        }
      }
    } catch (e) {
      console.error('Affiliate portal load error:', e);
      setError('Could not load your portal data.');
    } finally {
      setLoading(false);
    }
  };

  const handleRefer = async () => {
    if (!referForm.name.trim() || !referForm.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    setReferLoading(true);
    setError(null);
    try {
      const { error: insertError } = await supabase.from('clients').insert({
        name: referForm.name.trim(),
        email: referForm.email.trim().toLowerCase(),
        phone: referForm.phone.trim() || null,
        notes: referForm.notes.trim() || null,
        referred_by: affiliate.id,
        referral_fee: null,
        commission_paid: false,
      });
      if (insertError) throw insertError;
      // Notify Chris of new referral if setting is enabled
      if (settings?.notifications?.emailNewLeads !== false) {
        await fetch('/.netlify/functions/send-lpoa', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
          },
          body: JSON.stringify({
            action: 'affiliate_new_referral',
            affiliateName: affiliate.name,
            companyName: affiliate.company,
            clientName: referForm.name.trim(),
            clientEmail: referForm.email.trim(),
            clientPhone: referForm.phone.trim(),
            clientNotes: referForm.notes.trim(),
          }),
        });
      }
      setReferSuccess(true);
      setReferForm({ name: '', email: '', phone: '', notes: '' });
      setTimeout(() => { setReferSuccess(false); setShowReferForm(false); loadData(); }, 2500);
    } catch (e) {
      setError('Could not submit referral: ' + (e.message || e));
    } finally {
      setReferLoading(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ['Client Name', 'Email', 'Phone', 'Date Referred', 'Status', 'Commissions Paid', 'Score Increase'];
    const rows = clients.map(c => {
      const status = getClientStatus(c.name).label;
      const profile = profiles.find(p => p.email === c.email);
      let scoreIncrease = 'N/A';
      if (profile && profile.starting_scores && profile.current) {
        const start = Math.round((profile.starting_scores.equifax + profile.starting_scores.experian + profile.starting_scores.transunion) / 3);
        const current = Math.round((profile.current.equifax + profile.current.experian + profile.current.transunion) / 3);
        if (current > start) scoreIncrease = `+${current - start} pts`;
      }
      return [
        `"${c.name}"`,
        `"${c.email}"`,
        `"${c.phone || ''}"`,
        `"${new Date(c.created_at).toLocaleDateString()}"`,
        `"${status}"`,
        `"${c.commission_paid ? 'Yes' : 'No'}"`,
        `"${scoreIncrease}"`
      ].join(',');
    });
    
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Referrals_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getClientStatus = (clientName) => {
    const clientLetters = letters.filter(l => l.client_name === clientName);
    if (clientLetters.length === 0) return { label: 'Pending Start', tone: 'neutral' };
    const deleted = clientLetters.filter(l => l.response_outcome === 'deleted');
    if (deleted.length > 0) return { label: deleted.length + ' Deletion' + (deleted.length > 1 ? 's' : ''), tone: 'green' };
    const delivered = clientLetters.filter(l => l.tracking_status === 'Delivered');
    const mailed = clientLetters.filter(l => l.mailed_date);
    if (delivered.length > 0) return { label: delivered.length + ' Letter' + (delivered.length > 1 ? 's' : '') + ' Delivered', tone: 'blue' };
    if (mailed.length > 0) return { label: mailed.length + ' Letter' + (mailed.length > 1 ? 's' : '') + ' In Transit', tone: 'amber' };
    return { label: 'Campaign Starting', tone: 'amber' };
  };

  const toneStyles = {
    green: { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0' },
    blue: { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
    amber: { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' },
    red: { bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' },
    neutral: { bg: '#F9FAFB', color: '#6B7280', border: '#E5E7EB' },
  };

  const totalCommission = clients.reduce((sum, c) => sum + (c.referral_fee ? c.referral_fee * (affiliate?.commission_rate || 0.20) : 0), 0);
  const paidCommission = clients.filter(c => c.commission_paid).reduce((sum, c) => sum + (c.referral_fee ? c.referral_fee * (affiliate?.commission_rate || 0.20) : 0), 0);
  const pendingCommission = totalCommission - paidCommission;
  const deletions = letters.filter(l => l.response_outcome === 'deleted').length;

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0C0C0C' }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading your portal…</div>
    </div>
  );

  if (!affiliate) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0C0C0C' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Portal not configured</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Contact Credit Comeback Club to set up your affiliate account.</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0C0C0C', fontFamily: 'Arial, sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#111', borderBottom: '1px solid #1E1E1E', padding: '0 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {brandLogo && (
              <img src={brandLogo} alt={brandName} style={{ height: 36, width: 'auto', objectFit: 'contain' }} />
            )}
            <div style={{ width: 1, height: 24, background: '#2A2A2A' }} />
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>Credit Comeback Club</div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Partner Portal</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{affiliate.name}</span>
            <button onClick={onSignOut} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid #2A2A2A', borderRadius: 4, padding: '6px 12px', color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <LogOut size={11} strokeWidth={1.75} /> Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: '#111', borderBottom: '1px solid #1E1E1E' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '0 24px', display: 'flex' }}>
          {['dashboard', 'clients', 'commissions'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '14px 16px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer', background: 'none',
              border: 'none', borderBottom: activeTab === tab ? `2px solid ${brandColor}` : '2px solid transparent',
              color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.35)', fontWeight: activeTab === tab ? 600 : 400,
              transition: 'all 0.2s',
            }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                Welcome back, {affiliate.name.split(' ')[0]}.
              </h1>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                Here's your Credit Comeback Club partnership at a glance.
              </p>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
              {[
                { label: 'Clients Referred', value: clients.length, icon: <Users size={16} style={{ color: brandColor }} strokeWidth={1.75} /> },
                { label: 'Active Campaigns', value: clients.filter(c => getClientStatus(c.name).tone !== 'neutral').length, icon: <TrendingUp size={16} style={{ color: brandColor }} strokeWidth={1.75} /> },
                { label: 'Deletions Achieved', value: deletions, icon: <CheckCircle size={16} style={{ color: brandColor }} strokeWidth={1.75} /> },
                { label: 'Commission Pending', value: '$' + pendingCommission.toFixed(2), icon: <DollarSign size={16} style={{ color: brandColor }} strokeWidth={1.75} /> },
              ].map(({ label, value, icon }) => (
                <div key={label} style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, padding: 20 }}>
                  <div style={{ marginBottom: 10 }}>{icon}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1, marginBottom: 4 }}>{value}</div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.35)' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Refer a client CTA */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
              <div style={{ background: '#111', border: `1px solid ${brandColor}33`, borderRadius: 8, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Manual Referral</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Submit client info directly and we'll handle the onboarding.</div>
                </div>
                <button onClick={() => setShowReferForm(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: accentColor, color: '#000', border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 24, alignSelf: 'flex-start' }}>
                  <Plus size={14} strokeWidth={2.5} /> Submit Info
                </button>
              </div>

              <div style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Your Custom Referral Link</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Share this link. Clients who sign up will be automatically attributed to you.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                  <input 
                    readOnly 
                    value={`https://creditcomebackclub.com/join?ref=${affiliate.id.slice(0, 8)}`} 
                    style={{ flex: 1, background: '#0A0A0A', border: '1px solid #2A2A2A', borderRadius: 4, padding: '8px 12px', color: '#fff', fontSize: 12, outline: 'none' }} 
                  />
                  <button 
                    onClick={(e) => {
                      navigator.clipboard.writeText(`https://creditcomebackclub.com/join?ref=${affiliate.id.slice(0, 8)}`);
                      const btn = e.currentTarget;
                      const orig = btn.innerText;
                      btn.innerText = 'Copied!';
                      setTimeout(() => btn.innerText = orig, 2000);
                    }}
                    style={{ background: '#2A2A2A', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Copy
                  </button>
                </div>
              </div>
            </div>

            {/* Recent clients */}
            <div style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #1E1E1E', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)' }}>Recent Referrals</span>
                <button onClick={() => setActiveTab('clients')} style={{ fontSize: 11, color: brandColor, background: 'none', border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>View All →</button>
              </div>
              {clients.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <Users size={24} style={{ color: '#2A2A2A', margin: '0 auto 10px' }} strokeWidth={1.5} />
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>No referrals yet. Use the "Refer Client" button above to get started.</p>
                </div>
              ) : (
                clients.slice(0, 5).map(c => {
                  const status = getClientStatus(c.name);
                  const style = toneStyles[status.tone];
                  
                  const profile = profiles.find(p => p.email === c.email);
                  let scoreIncrease = null;
                  if (profile && profile.starting_scores && profile.current) {
                    const start = Math.round((profile.starting_scores.equifax + profile.starting_scores.experian + profile.starting_scores.transunion) / 3);
                    const current = Math.round((profile.current.equifax + profile.current.experian + profile.current.transunion) / 3);
                    if (current > start) scoreIncrease = `+${current - start} pts`;
                  }

                  return (
                    <div key={c.id} style={{ padding: '14px 20px', borderBottom: '1px solid #1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{c.email}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {scoreIncrease && (
                          <span style={{ fontSize: 11, color: brandColor, fontWeight: 700 }}>{scoreIncrease}</span>
                        )}
                        <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, background: style.bg, color: style.color, border: `1px solid ${style.border}`, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* CLIENTS TAB */}
        {activeTab === 'clients' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Your Referred Clients</h2>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{clients.length} client{clients.length !== 1 ? 's' : ''} total</p>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={handleExportCSV} disabled={clients.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111', color: '#fff', border: '1px solid #2A2A2A', borderRadius: 6, padding: '10px 20px', fontSize: 12, fontWeight: 700, cursor: clients.length === 0 ? 'not-allowed' : 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: clients.length === 0 ? 0.5 : 1 }}>
                  Export CSV
                </button>
                <button onClick={() => setShowReferForm(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: accentColor, color: '#000', border: 'none', borderRadius: 6, padding: '10px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <Plus size={14} strokeWidth={2.5} /> Refer Client
                </button>
              </div>
            </div>

            {clients.length === 0 ? (
              <div style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, padding: 60, textAlign: 'center' }}>
                <Users size={28} style={{ color: '#2A2A2A', margin: '0 auto 12px' }} strokeWidth={1.5} />
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>No clients referred yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {clients.map(c => {
                  const status = getClientStatus(c.name);
                  const style = toneStyles[status.tone];
                  const clientLetters = letters.filter(l => l.client_name === c.name);
                  const mailed = clientLetters.filter(l => l.mailed_date).length;
                  const delivered = clientLetters.filter(l => l.tracking_status === 'Delivered').length;
                  const deleted = clientLetters.filter(l => l.response_outcome === 'deleted').length;

                  const profile = profiles.find(p => p.email === c.email);
                  let scoreIncrease = 'N/A';
                  if (profile && profile.starting_scores && profile.current) {
                    const start = Math.round((profile.starting_scores.equifax + profile.starting_scores.experian + profile.starting_scores.transunion) / 3);
                    const current = Math.round((profile.current.equifax + profile.current.experian + profile.current.transunion) / 3);
                    if (current > start) scoreIncrease = `+${current - start} pts`;
                  }

                  return (
                    <div key={c.id} style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, padding: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{c.name}</div>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{c.email}{c.phone ? ' · ' + c.phone : ''}</div>
                        </div>
                        <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, background: style.bg, color: style.color, border: `1px solid ${style.border}`, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, flexShrink: 0 }}>
                          {status.label}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: 24 }}>
                        {[
                          { label: 'Letters Sent', value: mailed },
                          { label: 'Delivered', value: delivered },
                          { label: 'Deletions', value: deleted },
                          { label: 'Score Increase', value: scoreIncrease },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: value > 0 || String(value).startsWith('+') ? brandColor : 'rgba(255,255,255,0.3)' }}>{value}</div>
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{label}</div>
                          </div>
                        ))}
                        {c.commission_paid && (
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CheckCircle size={13} style={{ color: brandColor }} strokeWidth={2} />
                            <span style={{ fontSize: 11, color: brandColor, fontWeight: 600 }}>Commission Paid</span>
                          </div>
                        )}
                      </div>

                      {c.notes && (
                        <div style={{ marginTop: 12, padding: '8px 12px', background: '#0A0A0A', borderRadius: 4, fontSize: 11, color: 'rgba(255,255,255,0.35)', borderLeft: `2px solid ${brandColor}44` }}>
                          {c.notes}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* COMMISSIONS TAB */}
        {activeTab === 'commissions' && (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Commissions</h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{settings?.affiliates?.defaultCommissionRate || 20}% of the initial consultation fee per referred client.</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 28 }}>
              {[
                { label: 'Total Earned', value: '$' + totalCommission.toFixed(2), color: '#fff' },
                { label: 'Paid Out', value: '$' + paidCommission.toFixed(2), color: brandColor },
                { label: 'Pending', value: '$' + pendingCommission.toFixed(2), color: '#D97706' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, padding: 24 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color, marginBottom: 6 }}>{value}</div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.35)' }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ background: '#111', border: '1px solid #1E1E1E', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #1E1E1E', background: '#0A0A0A' }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.5)' }}>Commission Ledger</span>
              </div>
              {clients.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)' }}>No referrals yet — commissions will appear here once clients are enrolled.</p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1A1A1A' }}>
                      <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.05em' }}>Client</th>
                      <th style={{ padding: '12px 20px', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.05em' }}>Consultation Fee</th>
                      <th style={{ padding: '12px 20px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.05em' }}>Your Commission</th>
                      <th style={{ padding: '12px 20px', textAlign: 'right', fontSize: 10, textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.05em' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map(c => {
                      const fee = c.referral_fee ? c.referral_fee * (affiliate?.commission_rate || 0.20) : null;
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid #1A1A1A' }}>
                          <td style={{ padding: '14px 20px' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{c.name}</div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Enrolled: {new Date(c.created_at).toLocaleDateString()}</div>
                          </td>
                          <td style={{ padding: '14px 20px', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                            {c.referral_fee ? '$' + c.referral_fee.toFixed(2) : 'Awaiting'}
                          </td>
                          <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: fee ? '#fff' : 'rgba(255,255,255,0.2)' }}>
                              {fee ? '$' + fee.toFixed(2) : '—'}
                            </span>
                          </td>
                          <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                            {c.commission_paid ? (
                              <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Paid</span>
                            ) : fee ? (
                              <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Pending</span>
                            ) : (
                              <span style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, background: '#1A1A1A', color: 'rgba(255,255,255,0.25)', border: '1px solid #2A2A2A', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>TBD</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ marginTop: 16, padding: 16, background: '#0A0A0A', borderRadius: 6, border: '1px solid #1A1A1A', fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
              Commissions are calculated at {Math.round((affiliate?.commission_rate || 0.20) * 100)}% of the initial consultation/audit fee paid by each referred client. Commissions are paid manually by Credit Comeback Club after the consultation is complete and payment is confirmed. Questions? Contact chris@cccpartners.co or call 970-644-0063.
            </div>
          </>
        )}

      </div>

      {/* Refer Client Modal */}
      {showReferForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => setShowReferForm(false)}>
          <div style={{ background: '#111', border: '1px solid #2A2A2A', borderRadius: 10, width: '100%', maxWidth: 440, padding: 32 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Refer a Client</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>We'll handle everything from here.</div>
              </div>
              <button onClick={() => setShowReferForm(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            {referSuccess ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <CheckCircle size={36} style={{ color: brandColor, margin: '0 auto 12px' }} strokeWidth={1.5} />
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Referral Submitted</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>We'll reach out to {referForm.name || 'your client'} within 1 business day.</div>
              </div>
            ) : (
              <>
                {error && (
                  <div style={{ marginBottom: 16, padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, fontSize: 12, color: '#DC2626' }}>
                    {error}
                  </div>
                )}
                {[
                  { key: 'name', label: 'Full Name', placeholder: 'John Smith', required: true },
                  { key: 'email', label: 'Email Address', placeholder: 'john@example.com', required: true },
                  { key: 'phone', label: 'Phone Number', placeholder: '(555) 000-0000', required: false },
                  { key: 'notes', label: 'Notes (optional)', placeholder: 'Any context about their credit situation…', required: false },
                ].map(({ key, label, placeholder, required }) => (
                  <div key={key} style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      {label}{required && <span style={{ color: brandColor, marginLeft: 3 }}>*</span>}
                    </label>
                    {key === 'notes' ? (
                      <textarea
                        value={referForm[key]}
                        onChange={e => setReferForm(p => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        rows={3}
                        style={{ width: '100%', background: '#0A0A0A', border: '1px solid #2A2A2A', borderRadius: 6, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'Arial, sans-serif' }}
                      />
                    ) : (
                      <input
                        type={key === 'email' ? 'email' : 'text'}
                        value={referForm[key]}
                        onChange={e => setReferForm(p => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        style={{ width: '100%', background: '#0A0A0A', border: '1px solid #2A2A2A', borderRadius: 6, padding: '10px 12px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                      />
                    )}
                  </div>
                ))}
                <button onClick={handleRefer} disabled={referLoading} style={{ width: '100%', background: referLoading ? '#1A1A1A' : accentColor, color: referLoading ? 'rgba(255,255,255,0.3)' : '#000', border: 'none', borderRadius: 6, padding: '12px 0', fontSize: 13, fontWeight: 700, cursor: referLoading ? 'not-allowed' : 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 8 }}>
                  {referLoading ? 'Submitting…' : 'Submit Referral'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '24px', fontSize: 11, color: 'rgba(255,255,255,0.15)', borderTop: '1px solid #1A1A1A', marginTop: 40 }}>
        Credit Comeback Club · Grand Junction, CO · creditcomebackclub.com · 970-644-0063
      </div>
    </div>
  );
}
