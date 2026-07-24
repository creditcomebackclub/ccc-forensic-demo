import React, { useState, useEffect } from 'react';
import { X, Check, User, Save, DollarSign, Bell, Users, ShieldAlert } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { getSettings, saveSettings } from '../utils/settings';

export default function SettingsModal({ onClose, displayName, email }) {
  const [activeTab, setActiveTab] = useState('profile');
  
  // Profile state
  const [savedName, setSavedName] = useState(false);
  const [fullName, setFullName] = useState(displayName || '');
  const [savingName, setSavingName] = useState(false);
  
  // Global settings state
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSettings, setSavedSettings] = useState(false);

  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      const s = await getSettings();
      setSettings(s);
    }
    load();
  }, []);

  const handleSaveName = async () => {
    setSavingName(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim() }
      });
      if (error) throw error;
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() })
        .eq('id', (await supabase.auth.getUser()).data.user.id);
      if (profileError) throw profileError;
      setSavedName(true);
      setTimeout(() => setSavedName(false), 2000);
    } catch (e) {
      setError(e.message || 'Could not save name');
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setError(null);
    try {
      const success = await saveSettings(settings);
      if (!success) throw new Error('Failed to save settings.');
      setSavedSettings(true);
      setTimeout(() => setSavedSettings(false), 2000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'pricing', label: 'Pricing', icon: DollarSign },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'affiliates', label: 'Affiliates', icon: Users },
    { id: 'disputes', label: 'Disputes', icon: ShieldAlert }
  ];

  if (!settings) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border border-border w-full max-w-2xl flex overflow-hidden shadow-2xl">
        
        {/* Sidebar */}
        <div className="w-48 bg-gray-50 border-r border-border flex flex-col">
          <div className="px-5 py-4 border-b border-border">
            <div className="text-navy text-[14px] font-bold ccc-display">Settings</div>
          </div>
          <div className="flex-1 py-2">
            {tabs.map(t => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-[12px] font-medium transition-colors ${
                    isActive ? 'bg-white border-y border-border text-navy shadow-[inset_3px_0_0_#C9A84C]' : 'text-gray-500 hover:bg-gray-100 border-y border-transparent'
                  }`}
                >
                  <Icon size={14} className={isActive ? 'text-gold' : 'text-gray-400'} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col h-[500px]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="text-[14px] font-bold text-navy">{tabs.find(t => t.id === activeTab).label} Settings</div>
            <button onClick={onClose} className="text-gray-400 hover:text-navy">
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {activeTab === 'profile' && (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">Display Name</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                      placeholder="Your full name"
                      className="flex-1 border border-border rounded-sm px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-navy"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={savingName}
                      className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                      style={{ backgroundColor: savedName ? '#15803D' : '#1B2A4A', color: savedName ? '#FFFFFF' : '#C9A84C' }}
                    >
                      {savedName ? <><Check size={12} strokeWidth={2} /> Saved</> : <><Save size={12} strokeWidth={2} /> Save</>}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">Email Address</label>
                  <div className="text-[13px] text-ink-muted px-3 py-2 border border-border rounded-sm bg-gray-50">{email}</div>
                </div>
              </div>
            )}

            {activeTab === 'pricing' && (
              <div className="space-y-5">
                <p className="text-[12px] text-gray-500">
                  These fees are dynamically injected into a client's Limited Power of Attorney based on their assigned Service Tier — set per-client in the Billing panel, not here. Each tier's real fee schedule is below.
                </p>
                {Object.entries(settings.pricing.tiers).map(([tierName, tier]) => (
                  <div key={tierName} className="border border-border rounded-sm p-3.5 space-y-3">
                    <div className="text-[12px] font-bold text-navy">{tierName}</div>
                    {tierName === 'Paid In Full' ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">Flat Fee ($)</label>
                          <input
                            type="number"
                            value={tier.flatFee}
                            onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, tiers: { ...settings.pricing.tiers, [tierName]: { ...tier, flatFee: parseInt(e.target.value) || 0 } } } })}
                            className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">For (months)</label>
                          <input
                            type="number"
                            value={tier.flatMonths}
                            onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, tiers: { ...settings.pricing.tiers, [tierName]: { ...tier, flatMonths: parseInt(e.target.value) || 0 } } } })}
                            className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">Monthly Fee ($)</label>
                        <input
                          type="number"
                          value={tier.monthlyFee}
                          onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, tiers: { ...settings.pricing.tiers, [tierName]: { ...tier, monthlyFee: parseInt(e.target.value) || 0 } } } })}
                          className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                        />
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">First Work Fee ($)</label>
                      <input
                        type="number"
                        value={tier.firstWorkFee}
                        onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, tiers: { ...settings.pricing.tiers, [tierName]: { ...tier, firstWorkFee: parseInt(e.target.value) || 0 } } } })}
                        className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                      />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">Credit Monitoring Fee (est., $)</label>
                  <input
                    type="number"
                    value={settings.pricing.monitoringFee}
                    onChange={(e) => setSettings({ ...settings, pricing: { ...settings.pricing, monitoringFee: parseInt(e.target.value) || 0 } })}
                    className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Estimated cost regardless of which monitoring service (PrivacyGuard, IdentityIQ, etc.) a client actually uses — the LPOA names their specific service, only this estimate is shared.</p>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-4">
                <p className="text-[12px] text-gray-500 mb-4">
                  Control which events trigger an email notification to you.
                </p>
                {[
                  { key: 'emailNewLeads', label: 'New Affiliate Leads', desc: 'When an affiliate refers a new client via their portal.' },
                  { key: 'emailClientUploads', label: 'Client Document Uploads', desc: 'When a client uploads a new document or ID.' },
                  { key: 'emailEscalations', label: 'Action Required Escalations', desc: 'When the system flags a response that needs manual review.' }
                ].map(opt => (
                  <label key={opt.key} className="flex items-start gap-3 cursor-pointer p-3 border border-border rounded-sm hover:bg-gray-50 transition-colors">
                    <div className="pt-0.5">
                      <input
                        type="checkbox"
                        checked={settings.notifications[opt.key]}
                        onChange={(e) => setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, [opt.key]: e.target.checked }
                        })}
                        className="accent-navy w-4 h-4"
                      />
                    </div>
                    <div>
                      <div className="text-[13px] font-bold text-navy">{opt.label}</div>
                      <div className="text-[11px] text-gray-500">{opt.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {activeTab === 'affiliates' && (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">Default Commission Rate (%)</label>
                  <input
                    type="number"
                    value={settings.affiliates.defaultCommissionRate}
                    onChange={(e) => setSettings({ ...settings, affiliates: { ...settings.affiliates, defaultCommissionRate: parseInt(e.target.value) || 0 } })}
                    className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">This percentage will be displayed in the Affiliate Portal as their cut of the First Work Fee.</p>
                </div>
              </div>
            )}

            {activeTab === 'disputes' && (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-ink-faint font-bold block mb-1.5">Default Aggressiveness</label>
                  <select
                    value={settings.disputes.defaultAggressiveness}
                    onChange={(e) => setSettings({ ...settings, disputes: { ...settings.disputes, defaultAggressiveness: e.target.value } })}
                    className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy bg-white"
                  >
                    <option value="Standard">Standard (FCRA/FDCPA compliance focus)</option>
                    <option value="Aggressive">Aggressive (Demand immediate deletion with legal threats)</option>
                  </select>
                  <p className="text-[10px] text-gray-400 mt-1">The default tone used when AI generates initial dispute letters.</p>
                </div>
              </div>
            )}

            {error && (
              <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border bg-gray-50 flex justify-between items-center">
            {activeTab !== 'profile' ? (
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors shadow-sm"
                style={{ backgroundColor: savedSettings ? '#15803D' : '#1B2A4A', color: savedSettings ? '#FFFFFF' : '#C9A84C' }}
              >
                {savedSettings ? <><Check size={14} strokeWidth={2.5} /> Settings Saved</> : <><Save size={14} strokeWidth={2.5} /> Save Settings</>}
              </button>
            ) : <div />}
            <button onClick={onClose} className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm text-gray-500 hover:text-navy hover:bg-gray-200 transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
