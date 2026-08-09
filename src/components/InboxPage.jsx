import React, { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  Star, ChevronRight, Send, Clock, Inbox as InboxIcon, FileSignature, FileSearch,
  Mail as MailIcon, Zap, GripVertical, UserPlus,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { convertLeadToClient, getLetterForMail, updateLetter } from '../utils/storage';
import { supabase } from '../utils/supabase';
import { getUnanalyzedResponseStats } from '../utils/actionItems';
import LobMailer from './LobMailer';

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

const BACKLOG_WARN_DAYS = 7;
const BACKLOG_LATE_DAYS = 14;

const COL = {
  newLeads: 'newLeads',
  needsLpoa: 'needsLpoa',
  auditComplete: 'auditComplete',
  readyToMail: 'readyToMail',
  phase2Inbox: 'phase2Inbox',
  mailAction: 'mailAction',
};

const COLUMN_HINTS = {
  [COL.newLeads]: 'Not yet converted — drag to Needs LPOA to convert',
  [COL.needsLpoa]: "Can't dispute until signed — driven by LPOA signature",
  [COL.auditComplete]: 'No letters generated yet — generate letters on the client',
  [COL.readyToMail]: 'Generated, not yet sent — drag to Mail or hit Send',
  [COL.phase2Inbox]: 'Response uploaded, not analyzed — open Documents to triage',
};

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function daysBetween(aIso, bIso) {
  const a = new Date(String(aIso).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(bIso).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diffH = Math.round((Date.now() - d) / 3600000);
    if (diffH < 1) return 'just now';
    if (diffH < 24) return diffH + 'h ago';
    if (diffH < 48) return 'yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return iso; }
}

function computeInboxColumns({ leads, lpoaClients, auditOnlyClients, unmaledLetters, unanalyzedNames, unanalyzedClientIds }) {
  const newLeads = leads.map((r) => ({
    clientId: r.id, name: r.name, isVip: !!r.is_vip,
    createdAt: r.lead_created_at, source: r.lead_source,
  })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const needsLpoa = lpoaClients.map((r) => ({
    clientId: r.id, name: r.name, isVip: !!r.is_vip,
    hasAudit: r.audit_count > 0, enrollmentDate: r.enrollment_date,
  })).sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0));

  const auditComplete = auditOnlyClients.map((r) => ({
    clientId: r.id, name: r.name, isVip: !!r.is_vip,
    accountsTargeted: r.accounts_targeted || 0, savedAt: r.latest_audit_at,
  })).sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0) || (b.savedAt || '').localeCompare(a.savedAt || ''));

  const readyToMail = unmaledLetters.map((r) => ({
    clientId: r.client_id, client: r.client_name, isVip: !!r.is_vip,
    furnisher: r.furnisher, savedAt: r.saved_at,
    ageDays: r.saved_at ? daysBetween(r.saved_at, todayISO()) : 0,
    letter: {
      id: r.id, clientId: r.client_id, clientName: r.client_name,
      furnisher: r.furnisher, phase: r.phase, savedAt: r.saved_at,
      mailedDate: r.mailed_date, coveredFurnishers: r.covered_furnishers || [],
      lob_id: r.lob_id, trackingNumber: r.tracking_number,
    },
  })).sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0) || (a.savedAt || '').localeCompare(b.savedAt || ''));

  const phase2Inbox = [];
  for (const name of (unanalyzedNames || [])) {
    phase2Inbox.push({ clientId: null, name, isVip: false });
  }
  for (const id of (unanalyzedClientIds || [])) {
    if (!phase2Inbox.some((p) => p.clientId === id)) {
      phase2Inbox.push({ clientId: id, name: null, isVip: false });
    }
  }

  return { newLeads, needsLpoa, auditComplete, readyToMail, phase2Inbox };
}

function AgeBadge({ days }) {
  if (days == null || days < BACKLOG_WARN_DAYS) return null;
  if (days >= BACKLOG_LATE_DAYS) {
    return (
      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-red-50 text-red-700 font-medium shrink-0">
        <Clock size={9} strokeWidth={2.5} /> {days}d
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-50 text-amber-700 font-medium shrink-0">
      <Clock size={9} strokeWidth={2.5} /> {days}d
    </span>
  );
}

function DropColumn({ id, icon: Icon, title, hint, count, empty, children, acceptHint }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div className="flex flex-col min-w-0" style={{ minWidth: 260 }}>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon size={13} strokeWidth={2} style={{ color: T.navy }} />
        <div className="text-[11px] uppercase tracking-wider font-bold" style={{ color: T.navy }}>{title}</div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
          style={{ background: count > 0 ? '#EEF1F7' : T.grid, color: count > 0 ? T.navy : T.faint }}
        >
          {count}
        </span>
      </div>
      <div className="text-[10px] mb-2 px-1" style={{ color: T.faint }}>{hint}</div>
      <div
        ref={setNodeRef}
        className="flex-1 space-y-2 rounded-xl p-2 transition-colors"
        style={{
          background: isOver ? '#F5F7FB' : '#FAFBFC',
          border: '1px solid ' + (isOver ? T.navy : T.border),
          minHeight: 120,
          boxShadow: isOver ? 'inset 0 0 0 1px ' + T.navy : undefined,
        }}
      >
        {count === 0 ? (
          <div className="text-[11px] text-center py-6" style={{ color: T.faint }}>
            {isOver && acceptHint ? acceptHint : empty}
          </div>
        ) : children}
      </div>
    </div>
  );
}

function MailDropZone({ active }) {
  const { setNodeRef, isOver } = useDroppable({ id: COL.mailAction });
  if (!active) return null;
  return (
    <div
      ref={setNodeRef}
      className="mb-4 rounded-xl px-4 py-3 flex items-center gap-3 transition-colors"
      style={{
        background: isOver ? T.navy : '#EEF1F7',
        border: '1px dashed ' + (isOver ? T.gold : T.navy),
        color: isOver ? T.gold : T.navy,
      }}
    >
      <Send size={16} strokeWidth={2} />
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wider">Drop here to mail</div>
        <div className="text-[11px]" style={{ opacity: 0.8 }}>Opens Lob for the letter you are dragging</div>
      </div>
    </div>
  );
}

function ItemCard({
  onClick, isVip, title, subtitle, right, actions, ageDays, dragHandleProps, isDragging,
}) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg px-2.5 py-2 cursor-pointer hover:shadow-sm transition-shadow group"
      style={{
        border: '1px solid ' + T.border,
        boxShadow: T.cardShadow,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <div className="flex items-start gap-1.5">
        {dragHandleProps && (
          <button
            type="button"
            className="mt-0.5 p-0.5 rounded cursor-grab active:cursor-grabbing touch-none shrink-0 opacity-50 group-hover:opacity-100"
            style={{ color: T.faint }}
            title="Drag for allowed actions"
            onClick={(e) => e.stopPropagation()}
            {...dragHandleProps}
          >
            <GripVertical size={13} strokeWidth={2} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {isVip && <Star size={10} strokeWidth={2.5} style={{ color: T.gold, flexShrink: 0 }} />}
              <div className="min-w-0">
                <div className="text-[12px] font-medium truncate group-hover:text-navy" style={{ color: T.ink }}>{title}</div>
                {subtitle && <div className="text-[10px] truncate" style={{ color: T.faint }}>{subtitle}</div>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <AgeBadge days={ageDays} />
              {right}
              <ChevronRight size={12} strokeWidth={2} className="group-hover:text-navy" style={{ color: T.faint }} />
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DraggableCard({ id, data, children }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div ref={setNodeRef} style={style}>
      {children({ dragHandleProps: { ...attributes, ...listeners }, isDragging })}
    </div>
  );
}

function rejectDrop(reason) {
  toast(reason, { icon: '⛔', duration: 3500 });
}

export default function InboxPage({ isAdmin, onNavigate }) {
  const [columns, setColumns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lobMailerLetter, setLobMailerLetter] = useState(null);
  const [openingLetterId, setOpeningLetterId] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [convertingId, setConvertingId] = useState(null);
  const [activeDrag, setActiveDrag] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [leadsRes, lpoaRes, unanalyzed] = await Promise.all([
        supabase.from('clients')
          .select('id,name,is_vip,lead_created_at,lead_source')
          .eq('status', 'lead')
          .order('lead_created_at', { ascending: false })
          .limit(200),
        supabase.from('clients')
          .select('id,name,is_vip,enrollment_date,audit_count:audits(count)')
          .neq('status', 'lead')
          .eq('lpoa_signed', false)
          .limit(200),
        getUnanalyzedResponseStats(),
      ]);

      let unmailedResult = await supabase.from('letters')
        .select('id,client_id,client_name,furnisher,phase,round_id,round_number,target_type,target_bureau,saved_at,mailed_date,covered_furnishers,lob_id,tracking_number')
        .is('mailed_date', null)
        .order('saved_at', { ascending: true })
        .limit(300);
      if (unmailedResult.error && /round_id|round_number|target_type|target_bureau/i.test(unmailedResult.error.message || '')) {
        unmailedResult = await supabase.from('letters')
          .select('id,client_id,client_name,furnisher,phase,saved_at,mailed_date,covered_furnishers,lob_id,tracking_number')
          .is('mailed_date', null)
          .order('saved_at', { ascending: true })
          .limit(300);
      }
      const { data: unmailedLetters, error: unmailedError } = unmailedResult;
      if (unmailedError) throw unmailedError;
      const unmaledLettersRes = {
        data: (unmailedLetters || []).filter((letter) => letter.target_type
          ? letter.target_type !== 'bureau'
          : !String(letter.phase || '').startsWith('Phase 3')),
      };

      const clientsWithLetters = new Set((unmaledLettersRes.data || []).map((l) => l.client_id).filter(Boolean));
      const { data: auditRows } = await supabase
        .from('audits')
        .select('client_id,client_name,saved_at,audit')
        .order('saved_at', { ascending: false })
        .limit(500);
      const auditOnlyMap = new Map();
      for (const row of (auditRows || [])) {
        const cid = row.client_id;
        if (!cid || clientsWithLetters.has(cid)) continue;
        if (!auditOnlyMap.has(cid)) {
          auditOnlyMap.set(cid, {
            id: cid, name: row.client_name, is_vip: false,
            accounts_targeted: row.audit?.accountsTargeted || 0,
            latest_audit_at: row.saved_at,
          });
        }
      }

      setColumns(computeInboxColumns({
        leads: leadsRes.data || [],
        lpoaClients: (lpoaRes.data || []).map((r) => ({ ...r, audit_count: r.audit_count?.[0]?.count || 0 })),
        auditOnlyClients: Array.from(auditOnlyMap.values()),
        unmaledLetters: unmaledLettersRes.data || [],
        unanalyzedNames: unanalyzed.clientNames,
        unanalyzedClientIds: unanalyzed.clientIds,
      }));
      setTruncated(false);
    } catch (error) {
      console.error('Could not load inbox work items:', error);
      setColumns(computeInboxColumns({
        leads: [], lpoaClients: [], auditOnlyClients: [],
        unmaledLetters: [], unanalyzedNames: new Set(), unanalyzedClientIds: new Set(),
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const openMailer = async (letterId) => {
    if (!letterId || openingLetterId) return;
    setOpeningLetterId(letterId);
    try {
      setLobMailerLetter(await getLetterForMail(letterId));
    } catch (error) {
      console.error('Could not open letter for mailing:', error);
      toast.error('Could not load this letter for mailing. Open the client record and try again.');
    } finally {
      setOpeningLetterId(null);
    }
  };

  const convertLead = async (lead) => {
    if (!lead?.clientId || convertingId) return;
    setConvertingId(lead.clientId);
    try {
      await convertLeadToClient(lead.name, lead.clientId);
      toast.success(lead.name + ' converted — now in Needs LPOA');
      await load();
    } catch (e) {
      toast.error('Could not convert lead: ' + e.message);
    } finally {
      setConvertingId(null);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = async ({ active, over }) => {
    const drag = active.data.current;
    setActiveDrag(null);
    if (!over || !drag) return;

    const target = over.id;
    const type = drag.type;

    if (type === 'lead') {
      if (target === COL.needsLpoa) {
        await convertLead(drag.item);
        return;
      }
      if (target === COL.newLeads) return;
      if (target === COL.mailAction) {
        rejectDrop('Mail is for generated letters — convert this lead first.');
        return;
      }
      if (target === COL.auditComplete) {
        rejectDrop('Audit Complete is driven by running an audit, not drag.');
        return;
      }
      if (target === COL.readyToMail) {
        rejectDrop('Ready to Mail needs generated letters on a converted client.');
        return;
      }
      if (target === COL.phase2Inbox) {
        rejectDrop('Response analysis is driven by an uploaded response tied to an exact letter.');
        return;
      }
      rejectDrop('That drop is not allowed for leads.');
      return;
    }

    if (type === 'letter') {
      if (target === COL.mailAction || target === COL.readyToMail) {
        await openMailer(drag.item.letter.id);
        return;
      }
      rejectDrop('Letters leave Ready to Mail when you send them via Lob.');
      return;
    }

    rejectDrop('This column is driven by real workflow state — open the client to advance it.');
  };

  if (!isAdmin) {
    return <div className="p-8 text-center text-muted">Access Denied. Admins only.</div>;
  }

  if (loading || !columns) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-navy border-t-gold rounded-full animate-spin"></div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Loading inbox...</div>
        </div>
      </div>
    );
  }

  const goto = (clientId, fallbackName) => onNavigate('clients', { jumpTo: clientId || fallbackName });
  const draggingLetter = activeDrag?.type === 'letter';

  return (
    <div style={{ padding: '20px 32px 32px' }}>
      <div className="mb-5">
        <h1 className="text-2xl font-bold ccc-display" style={{ color: T.navy }}>Inbox</h1>
        <p className="text-[13px] mt-1" style={{ color: T.muted }}>
          Work queues driven by real state — drag leads to Needs LPOA to convert, or drag letters to Mail to send.
        </p>
        {truncated && (
          <p className="text-[11px] mt-1 text-amber-700">
            Showing the first 10,000 client summaries. Refine the CRM before adding more operating queues.
          </p>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => setActiveDrag(active.data.current || null)}
        onDragCancel={() => setActiveDrag(null)}
        onDragEnd={handleDragEnd}
      >
        <MailDropZone active={draggingLetter} />

        <div className="flex gap-4 overflow-x-auto pb-2">
          <DropColumn
            id={COL.newLeads}
            icon={InboxIcon}
            title="New Leads"
            hint={COLUMN_HINTS[COL.newLeads]}
            count={columns.newLeads.length}
            empty="No new leads"
            acceptHint="Leads stay here until converted"
          >
            {columns.newLeads.map((l) => (
              <DraggableCard
                key={l.clientId}
                id={'lead:' + l.clientId}
                data={{ type: 'lead', item: l, from: COL.newLeads }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <ItemCard
                    onClick={() => goto(l.clientId, l.name)}
                    isVip={l.isVip}
                    title={l.name}
                    subtitle={[l.source, l.createdAt ? fmtTime(l.createdAt) : null].filter(Boolean).join(' · ')}
                    ageDays={l.createdAt ? daysBetween(l.createdAt, todayISO()) : null}
                    dragHandleProps={dragHandleProps}
                    isDragging={isDragging}
                    actions={
                      <button
                        type="button"
                        disabled={convertingId === l.clientId}
                        onClick={() => convertLead(l)}
                        className="flex items-center gap-1 text-[9px] uppercase tracking-wider px-2 py-1 rounded-md disabled:opacity-50"
                        style={{ backgroundColor: T.navy, color: T.gold }}
                      >
                        <UserPlus size={10} strokeWidth={2} />
                        {convertingId === l.clientId ? 'Converting…' : 'Convert'}
                      </button>
                    }
                  />
                )}
              </DraggableCard>
            ))}
          </DropColumn>

          <DropColumn
            id={COL.needsLpoa}
            icon={FileSignature}
            title="Needs LPOA"
            hint={COLUMN_HINTS[COL.needsLpoa]}
            count={columns.needsLpoa.length}
            empty="Everyone's signed"
            acceptHint="Drop a lead here to convert → client"
          >
            {columns.needsLpoa.map((c) => (
              <ItemCard
                key={c.clientId}
                onClick={() => goto(c.clientId, c.name)}
                isVip={c.isVip}
                title={c.name}
                subtitle={c.hasAudit ? 'Audit on file, awaiting signature' : 'No audit yet'}
                ageDays={c.enrollmentDate ? daysBetween(c.enrollmentDate, todayISO()) : null}
              />
            ))}
          </DropColumn>

          <DropColumn
            id={COL.auditComplete}
            icon={Zap}
            title="Audit Complete"
            hint={COLUMN_HINTS[COL.auditComplete]}
            count={columns.auditComplete.length}
            empty="Nothing waiting"
          >
            {columns.auditComplete.map((c) => (
              <ItemCard
                key={c.clientId}
                onClick={() => goto(c.clientId, c.name)}
                isVip={c.isVip}
                title={c.name}
                subtitle={c.accountsTargeted + ' account' + (c.accountsTargeted === 1 ? '' : 's') + ' targeted'}
                ageDays={c.savedAt ? daysBetween(c.savedAt, todayISO()) : null}
              />
            ))}
          </DropColumn>

          <DropColumn
            id={COL.readyToMail}
            icon={MailIcon}
            title="Ready to Mail"
            hint={COLUMN_HINTS[COL.readyToMail]}
            count={columns.readyToMail.length}
            empty="Nothing waiting to mail"
            acceptHint="Drop here or on Mail strip to open Lob"
          >
            {columns.readyToMail.map((r) => (
              <DraggableCard
                key={r.letter.id}
                id={'letter:' + r.letter.id}
                data={{ type: 'letter', item: r, from: COL.readyToMail }}
              >
                {({ dragHandleProps, isDragging }) => (
                  <ItemCard
                    onClick={() => goto(r.clientId, r.client)}
                    isVip={r.isVip}
                    title={r.client}
                    subtitle={r.furnisher + ' · generated ' + fmtTime(r.savedAt)}
                    ageDays={r.ageDays}
                    dragHandleProps={dragHandleProps}
                    isDragging={isDragging}
                    actions={
                      <button
                        type="button"
                        onClick={() => openMailer(r.letter.id)}
                        disabled={openingLetterId === r.letter.id}
                        className="flex items-center gap-1 text-[9px] uppercase tracking-wider px-2 py-1 rounded-md disabled:opacity-60"
                        style={{ backgroundColor: T.navy, color: T.gold }}
                      >
                        <Send size={10} strokeWidth={2} />
                        {openingLetterId === r.letter.id ? 'Opening…' : 'Send'}
                      </button>
                    }
                  />
                )}
              </DraggableCard>
            ))}
          </DropColumn>

          <DropColumn
            id={COL.phase2Inbox}
            icon={FileSearch}
            title="Responses to Analyze"
            hint={COLUMN_HINTS[COL.phase2Inbox]}
            count={columns.phase2Inbox.length}
            empty="Nothing to triage"
          >
            {columns.phase2Inbox.map((c, i) => (
              <ItemCard
                key={c.clientId || c.name || i}
                onClick={() => goto(c.clientId, c.name)}
                isVip={c.isVip}
                title={c.name || 'Client'}
                subtitle="Open Documents tab to analyze"
              />
            ))}
          </DropColumn>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag?.item ? (
            <div style={{ width: 250, boxShadow: '0 8px 24px rgba(16,24,40,0.16)', borderRadius: 8 }}>
              <ItemCard
                title={activeDrag.type === 'lead' ? activeDrag.item.name : activeDrag.item.client}
                subtitle={activeDrag.type === 'letter' ? activeDrag.item.furnisher : (activeDrag.item.source || 'Lead')}
                isVip={!!activeDrag.item.isVip}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {lobMailerLetter && (
        <LobMailer
          letter={lobMailerLetter}
          onClose={() => setLobMailerLetter(null)}
          onSent={async (data) => {
            await updateLetter(lobMailerLetter.id, {
              mailedDate: data.mailedDate,
              lobId: data.lobId,
              trackingNumber: data.trackingNumber,
            });
            load();
          }}
        />
      )}
    </div>
  );
}
