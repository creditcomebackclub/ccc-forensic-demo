import React, { useEffect, useState } from 'react';
import { RefreshCw, Shield, User } from 'lucide-react';
import { supabase } from '../utils/supabase';

// Brand tokens — matches the dashboard / clients card system
const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

async function listProfiles() {
  // profiles is the staff identity table — admin/auditor only. Some rows
  // with role 'client' exist as leftovers from before the handle_new_user
  // trigger was fixed to stop granting staff-table rows to client signups;
  // client portal access is driven by client_profiles, not this table, so
  // those rows are never meant to appear here.
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['admin', 'auditor'])
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

function Avatar({ name, isAdmin }) {
  const initials = (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="shrink-0 flex items-center justify-center rounded-full font-semibold"
      style={{
        width: 32, height: 32, fontSize: 11,
        background: isAdmin ? '#FAF3DF' : '#EEF1F7', color: isAdmin ? '#8F7524' : T.navy,
        border: isAdmin ? '1.5px solid ' + T.gold : '1px solid #E3E7EF',
      }}>
      {initials}
    </div>
  );
}

export default function TeamPage({ currentUserId }) {
  const [profiles, setProfiles] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const admins = profiles.filter((p) => p.role === 'admin').length;

  return (
    <div className="max-w-4xl mx-auto" style={{ padding: '20px 32px 32px' }}>
      {/* Branded page header */}
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <span style={{ width: 4, height: 30, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
          <div>
            <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>Team</h1>
            <p className="text-[11px]" style={{ color: T.muted }}>
              {profiles.length} registered user{profiles.length === 1 ? '' : 's'} · {admins} admin{admins === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <button onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          title="Refresh"
          className="flex items-center justify-center rounded-lg border bg-white transition-colors hover:border-navy"
          style={{ width: 30, height: 30, borderColor: T.border, color: T.muted }}>
          <RefreshCw size={13} strokeWidth={1.75} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mb-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="bg-white overflow-hidden" style={{ borderRadius: 14, border: '1px solid ' + T.border, boxShadow: T.cardShadow }}>
        <div className="grid grid-cols-12 px-4 py-2.5" style={{ background: '#FAFBFC', borderBottom: '1px solid ' + T.grid }}>
          <div className="col-span-5 text-[10px] uppercase tracking-wider font-medium" style={{ color: T.faint }}>User</div>
          <div className="col-span-3 text-[10px] uppercase tracking-wider font-medium" style={{ color: T.faint }}>Role</div>
          <div className="col-span-2 text-[10px] uppercase tracking-wider font-medium" style={{ color: T.faint }}>Joined</div>
          <div className="col-span-2 text-[10px] uppercase tracking-wider font-medium text-right" style={{ color: T.faint }}>Action</div>
        </div>

        {profiles.length === 0 && (
          <div className="px-5 py-8 text-center text-[13px]" style={{ color: T.muted }}>No users found</div>
        )}

        {profiles.map((p, i) => {
          const isCurrentUser = p.id === currentUserId;
          const isAdmin = p.role === 'admin';
          const isClientRole = p.role === 'client';
          const busy = updating === p.id;
          return (
            <div
              key={p.id}
              className="grid grid-cols-12 px-4 py-3 items-center transition-colors hover:bg-gray-50"
              style={{ borderTop: i > 0 ? '1px solid ' + T.grid : 'none' }}
            >
              <div className="col-span-5 min-w-0">
                <div className="flex items-center gap-2.5">
                  <Avatar name={p.full_name || p.email} isAdmin={isAdmin} />
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium truncate" style={{ color: T.ink }}>
                      {p.full_name || '—'}
                      {isCurrentUser && <span className="ml-1.5 text-[10px] font-normal" style={{ color: T.faint }}>(you)</span>}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: T.muted }}>{p.email}</div>
                  </div>
                </div>
              </div>

              <div className="col-span-3">
                {isAdmin ? (
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full w-fit"
                    style={{ background: T.navy, color: T.gold }}>
                    <Shield size={10} strokeWidth={2} /> Admin
                  </span>
                ) : isClientRole ? (
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full w-fit bg-green-50 text-green-700">
                    <User size={10} strokeWidth={2} /> Client
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full w-fit bg-gray-100 text-gray-600">
                    <User size={10} strokeWidth={2} /> Auditor
                  </span>
                )}
              </div>

              <div className="col-span-2 text-[11px]" style={{ color: T.muted }}>
                {fmt(p.created_at)}
              </div>

              <div className="col-span-2 text-right">
                {isClientRole ? (
                  <span className="text-[10px]" style={{ color: T.faint }} title="Client accounts are managed from the Clients tab">
                    Managed in Clients
                  </span>
                ) : (
                  <button
                    onClick={() => handleRoleToggle(p)}
                    disabled={busy}
                    className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-lg border transition-colors hover:border-navy"
                    style={{ borderColor: T.border, color: busy ? '#B5BBC9' : T.navy }}
                  >
                    {busy ? '…' : isAdmin ? 'Make Auditor' : 'Make Admin'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-[11px] leading-relaxed" style={{ color: T.faint }}>
        New users sign up via the login screen and are assigned the Auditor role by default.
        Promote to Admin to grant cross-user visibility and team management access.
      </div>
    </div>
  );
}
