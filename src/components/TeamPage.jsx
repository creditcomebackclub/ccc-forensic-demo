import React, { useEffect, useState } from 'react';
import { Users, RefreshCw, Shield, User } from 'lucide-react';
import { supabase } from '../utils/supabase';

async function listProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function updateRole(id, role) {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', id);
  if (error) throw error;
}

function fmt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return iso; }
}

export default function TeamPage({ currentUserId }) {
  const [profiles, setProfiles] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      setError(null);
      const data = await listProfiles();
      setProfiles(data);
    } catch (e) {
      console.error('Failed to load profiles', e);
      setError(e.message || 'Failed to load team');
      setProfiles([]);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRoleToggle = async (profile) => {
    const newRole = profile.role === 'admin' ? 'auditor' : 'admin';
    if (profile.id === currentUserId && newRole !== 'admin') {
      if (!window.confirm('This will remove your own admin access. Are you sure?')) return;
    }
    setUpdating(profile.id);
    try {
      await updateRole(profile.id, newRole);
      await load();
    } catch (e) {
      console.error('Role update failed', e);
      alert('Could not update role: ' + (e.message || e));
    } finally {
      setUpdating(null);
    }
  };

  if (profiles === null) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20 text-ink-muted">
        <RefreshCw size={20} className="mx-auto mb-3 animate-spin" strokeWidth={1.5} />
        <p className="text-[13px]">Loading team…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <p className="text-[12px] text-ink-muted">
          {profiles.length} registered user{profiles.length === 1 ? '' : 's'}
        </p>
        <button onClick={load} className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">
          <RefreshCw size={13} strokeWidth={1.75} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="bg-white border border-border rounded overflow-hidden">
        <div className="grid grid-cols-12 px-5 py-2 border-b border-border bg-navy">
          <div className="col-span-5 text-[10px] uppercase tracking-wider text-white font-medium">User</div>
          <div className="col-span-3 text-[10px] uppercase tracking-wider text-white font-medium">Role</div>
          <div className="col-span-2 text-[10px] uppercase tracking-wider text-white font-medium">Joined</div>
          <div className="col-span-2 text-[10px] uppercase tracking-wider text-white font-medium text-right">Action</div>
        </div>

        {profiles.length === 0 && (
          <div className="px-5 py-8 text-center text-[13px] text-ink-muted">No users found</div>
        )}

        {profiles.map((p, i) => {
          const isCurrentUser = p.id === currentUserId;
          const isAdmin = p.role === 'admin';
          const busy = updating === p.id;
          return (
            <div
              key={p.id}
              className="grid grid-cols-12 px-5 py-3 items-center"
              style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB', borderTop: i > 0 ? '1px solid #E5E7EB' : 'none' }}
            >
              <div className="col-span-5 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium bg-navy text-gold shrink-0">
                    {(p.full_name || p.email || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] text-ink font-medium truncate">
                      {p.full_name || '—'}
                      {isCurrentUser && <span className="ml-1.5 text-[10px] text-ink-faint">(you)</span>}
                    </div>
                    <div className="text-[11px] text-ink-muted truncate">{p.email}</div>
                  </div>
                </div>
              </div>

              <div className="col-span-3">
                {isAdmin ? (
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-navy text-gold w-fit">
                    <Shield size={10} strokeWidth={2} /> Admin
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-gray-100 text-gray-600 w-fit">
                    <User size={10} strokeWidth={2} /> Auditor
                  </span>
                )}
              </div>

              <div className="col-span-2 text-[11px] text-ink-muted">
                {fmt(p.created_at)}
              </div>

              <div className="col-span-2 text-right">
                <button
                  onClick={() => handleRoleToggle(p)}
                  disabled={busy}
                  className="text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm border border-border hover:bg-gray-50 transition-colors"
                  style={{ color: busy ? '#B5BBC9' : '#1B2A4A' }}
                >
                  {busy ? '…' : isAdmin ? 'Make Auditor' : 'Make Admin'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-[11px] text-ink-faint leading-relaxed">
        New users sign up via the login screen and are assigned the Auditor role by default.
        Promote to Admin to grant cross-user visibility and team management access.
      </div>
    </div>
  );
}
