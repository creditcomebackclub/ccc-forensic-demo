import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { supabase } from '../utils/supabase';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

// Explicit client attribution, chosen by staff before the audit runs — the
// replacement for inferring attribution from the name the model extracts off
// the report after the fact. New leads are created first and immediately
// become an exact { type: 'existing', id, name } selection.
export default function ClientPicker({ value, onChange }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase.from('clients').select('id,name,status').order('name').then(({ data, error }) => {
      if (cancelled) return;
      if (!error && data) setClients(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filtered = query.trim()
    ? clients.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : clients;

  const selectedLabel = value?.type === 'existing' ? value.name : null;

  const pick = (next) => {
    onChange(next);
    setOpen(false);
    setQuery('');
  };
  const newLeadName = query.trim().replace(/\s+/g, ' ');
  const createNewLead = async () => {
    if (creating || newLeadName.length < 2 || newLeadName.length > 120) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Your staff session has expired.');
      const { data, error } = await supabase.from('clients').insert({
        user_id: user.id,
        name: newLeadName,
        status: 'lead',
        lead_source: 'Audit upload',
        lead_created_at: new Date().toISOString(),
      }).select('id,name').single();
      if (error || !data?.id) throw error || new Error('The lead was not created.');
      pick({ type: 'existing', id: data.id, name: data.name });
    } catch (error) {
      setCreateError(error?.message || 'Could not create the lead.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-1 mb-1.5">
        <span className="text-[11px] font-medium" style={{ color: T.muted }}>Client</span>
        <span className="text-[11px]" style={{ color: '#DC2626' }}>*</span>
      </div>

      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-[13px] rounded-lg text-left transition-colors"
          style={{
            border: '1px solid ' + (open ? T.navy : T.border),
            background: '#fff',
            color: selectedLabel ? T.ink : T.faint,
          }}>
          <span>{selectedLabel || 'Select a client…'}</span>
          {open ? <ChevronUp size={14} strokeWidth={2} style={{ color: T.faint }} /> : <ChevronDown size={14} strokeWidth={2} style={{ color: T.faint }} />}
        </button>

        {open && (
          <div className="absolute z-10 mt-1 w-full rounded-lg overflow-hidden"
            style={{ border: '1px solid ' + T.border, background: '#fff', boxShadow: '0 4px 12px rgba(16,24,40,0.12)' }}>
            <div className="flex items-center gap-2 px-3" style={{ borderBottom: '1px solid ' + T.border }}>
              <Search size={13} strokeWidth={2} style={{ color: T.faint }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search existing clients…"
                className="flex-1 py-2.5 text-[12px] outline-none bg-transparent"
                style={{ color: T.ink }}
              />
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid ' + T.border }}>
                <div className="text-[11px] mb-2" style={{ color: T.muted }}>
                  Create the CRM lead first so the audit attaches to one exact record.
                </div>
                <button type="button" onClick={createNewLead}
                  disabled={creating || newLeadName.length < 2 || newLeadName.length > 120}
                  className="w-full py-2 text-[12px] text-left disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ color: T.navy, fontWeight: 600 }}>
                  {newLeadName.length >= 2
                    ? `${creating ? 'Creating' : 'Create lead'} “${newLeadName}”`
                    : 'Type the new lead’s full name above'}
                </button>
              </div>
              {createError && <div className="px-4 py-2 text-[11px] text-red-600">{createError}</div>}
              {loading && <div className="px-4 py-3 text-[11px]" style={{ color: T.faint }}>Loading clients…</div>}
              {!loading && filtered.length === 0 && (
                <div className="px-4 py-3 text-[11px]" style={{ color: T.faint }}>No matching clients</div>
              )}
              {!loading && filtered.map((c) => (
                <button type="button" key={c.id}
                  onClick={() => pick({ type: 'existing', id: c.id, name: c.name })}
                  className="w-full px-4 py-2 text-[12px] text-left hover:bg-gray-50 flex items-center justify-between gap-2"
                  style={{ color: T.ink }}>
                  <span className="truncate">{c.name}</span>
                  {c.status === 'lead' && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: '#FAF3DF', color: '#8F7524', fontWeight: 600 }}>Lead</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] mt-1.5" style={{ color: T.faint }}>
        {value?.type === 'existing'
          ? 'This audit will attach to this exact CRM record. Your selection confirms the uploaded report belongs to this client.'
          : 'Pick the exact client whose report you are uploading, or create a separate new lead first.'}
      </p>
    </div>
  );
}
