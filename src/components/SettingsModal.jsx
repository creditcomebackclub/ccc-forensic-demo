import React, { useState } from 'react';
import { X, Check, User, Save } from 'lucide-react';
import { supabase } from '../utils/supabase';

export default function SettingsModal({ onClose, displayName, email }) {
  const [savedName, setSavedName] = useState(false);
  const [fullName, setFullName] = useState(displayName || '');
  const [savingName, setSavingName] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border border-border w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-navy rounded-t">
          <div className="text-white text-[14px] font-medium ccc-display">Settings</div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User size={13} strokeWidth={1.75} className="text-navy" />
              <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Profile</div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Display Name</label>
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
                    className="flex items-center gap-1.5 px-3 py-2 text-[11px] uppercase tracking-wider rounded-sm transition-colors"
                    style={{ backgroundColor: savedName ? '#15803D' : '#1B2A4A', color: savedName ? '#FFFFFF' : '#C9A84C' }}
                  >
                    {savedName ? <><Check size={12} strokeWidth={2} /> Saved</> : <><Save size={12} strokeWidth={2} /> Save</>}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Email</label>
                <div className="text-[13px] text-ink-muted px-3 py-2 border border-border rounded-sm bg-gray-50">{email}</div>
              </div>
            </div>
          </div>


          {error && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[11px] uppercase tracking-wider rounded-sm bg-navy text-gold">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
