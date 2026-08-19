import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, UserPlus, MoreHorizontal, ChevronRight, FileText } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { updateLeadInfo, updateLeadStage } from '../utils/storage';

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

function Avatar({ name }) {
  const initials = String(name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold"
      style={{ width: 28, height: 28, background: '#EEF1F7', color: T.navy }}
    >
      {initials}
    </div>
  );
}

function CardMenu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1 rounded hover:bg-gray-100"
        style={{ color: T.faint }}
      >
        <MoreHorizontal size={14} strokeWidth={2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-30 bg-white rounded-lg py-1 min-w-[140px]"
            style={{ border: '1px solid ' + T.border, boxShadow: T.cardShadow }}
          >
            {items.map((item, i) => (
              item === 'divider' ? (
                <div key={i} className="my-1" style={{ borderTop: '1px solid ' + T.grid }} />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOpen(false); item.onClick(); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50"
                  style={{ color: item.danger ? '#B91C1C' : T.ink }}
                >
                  {item.label}
                </button>
              )
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StageColumn({ stage, count, itemIds, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  return (
    <div className="flex flex-col min-w-0" style={{ minWidth: 260, flex: '1 1 0' }}>
      <div className="flex items-center gap-2 mb-2 px-1">
        <div className="text-[11px] uppercase tracking-wider font-bold" style={{ color: T.navy }}>{stage.label}</div>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
          style={{ background: count > 0 ? stage.bg : T.grid, color: count > 0 ? stage.text : T.faint }}
        >
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="flex-1 space-y-2 rounded-xl p-2 transition-colors"
        style={{
          background: isOver ? '#F5F7FB' : '#FAFBFC',
          border: '1px solid ' + (isOver ? T.navy : T.border),
          minHeight: 140,
        }}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {count === 0 ? (
            <div className="text-[11px] text-center py-8" style={{ color: T.faint }}>Drop leads here</div>
          ) : children}
        </SortableContext>
      </div>
    </div>
  );
}

function LeadTile({
  lead,
  stages,
  stageDef,
  isLeadRecent,
  isAdmin,
  affiliates = [],
  converting,
  onConvert,
  onDelete,
  onViewed,
  onOpenSummaryAudit,
  onChanged,
  onStageChange,
  dragHandleProps,
  isDragging,
  compact,
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [emailVal, setEmailVal] = useState(lead.email || '');
  const [phoneVal, setPhoneVal] = useState(lead.leadPhone || '');
  const [sourceVal, setSourceVal] = useState(lead.leadSource || '');
  const [referredByVal, setReferredByVal] = useState(lead.referredBy || '');
  const [notesVal, setNotesVal] = useState(lead.leadNotes || '');
  const [saving, setSaving] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  // Resolve referred_by UUID to a display label. A stale/missing affiliate
  // row falls back to the truncated id so the association is still visible
  // rather than silently omitted.
  const referringAffiliate = lead.referredBy ? affiliates.find((a) => a.id === lead.referredBy) : null;
  const referringAffiliateLabel = referringAffiliate
    ? (referringAffiliate.name + (referringAffiliate.company ? ' · ' + referringAffiliate.company : ''))
    : (lead.referredBy ? 'Affiliate ' + String(lead.referredBy).slice(0, 8) : null);

  const hasAudits = (lead.audits || []).length > 0;
  const ageDays = lead.leadCreatedAt ? daysBetween(lead.leadCreatedAt, todayISO()) : null;
  const ageTone = ageDays == null ? null
    : ageDays >= 14 ? { bg: '#FEF2F2', text: '#B91C1C' }
    : ageDays >= 7 ? { bg: '#FFFBEB', text: '#B45309' }
    : { bg: '#F3F4F6', text: '#6B7280' };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLeadInfo(lead.name, {
        email: emailVal.trim(),
        phone: phoneVal.trim(),
        source: sourceVal,
        notes: notesVal.trim(),
        referredBy: referredByVal || null,
      }, lead.id);
      setEditing(false);
      if (onChanged) await onChanged();
    } catch (e) {
      toast.error('Could not save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStageSelect = async (next) => {
    if (!next || next === stageDef?.key) return;
    setSavingStage(true);
    try {
      if (onStageChange) await onStageChange(next);
      else {
        await updateLeadStage(lead.name, next, lead.tags, lead.id);
        if (onChanged) await onChanged();
      }
    } catch (e) {
      toast.error('Could not update stage: ' + e.message);
    } finally {
      setSavingStage(false);
    }
  };

  return (
    <div
      className="bg-white rounded-lg"
      style={{
        border: '1px solid ' + T.border,
        boxShadow: T.cardShadow,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <div className="flex items-start gap-1.5 px-2 py-2">
        {dragHandleProps && (
          <button
            type="button"
            className="mt-1 p-0.5 rounded cursor-grab active:cursor-grabbing touch-none shrink-0"
            style={{ color: T.faint }}
            title="Drag to move stage"
            {...dragHandleProps}
          >
            <GripVertical size={14} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          className="flex-1 min-w-0 text-left"
          onClick={() => {
            if (onViewed) onViewed();
            if (!compact) setExpanded((v) => !v);
          }}
        >
          <div className="flex items-center gap-2">
            <Avatar name={lead.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="ccc-display text-[13px] font-medium truncate" style={{ color: T.ink }}>{lead.name}</span>
                {isLeadRecent?.(lead) && !lead.leadViewedAt && (
                  <span className="px-1 py-0.5 rounded text-[8px] uppercase tracking-wider font-bold bg-red-100 text-red-700">NEW</span>
                )}
              </div>
              <div className="text-[10px] truncate mt-0.5" style={{ color: T.faint }}>
                {lead.email || 'No email'}
                {referringAffiliateLabel ? ' · ' + referringAffiliateLabel : ''}
                {lead.leadSource ? ' · ' + lead.leadSource : ''}
              </div>
            </div>
            {!compact && (
              <ChevronRight
                size={12}
                strokeWidth={2}
                className="shrink-0 transition-transform"
                style={{ color: T.faint, transform: expanded ? 'rotate(90deg)' : 'none' }}
              />
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap mt-1.5 ml-9">
            {hasAudits && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium bg-blue-50 text-blue-700 flex items-center gap-0.5">
                <FileText size={9} /> {lead.audits.length}
              </span>
            )}
            {ageTone && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-medium" style={{ background: ageTone.bg, color: ageTone.text }}>
                {ageDays}d
              </span>
            )}
            {!lead.email && (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium bg-amber-50 text-amber-700">
                No email
              </span>
            )}
          </div>
        </button>
        {isAdmin && !compact && (
          <div className="flex flex-col items-end gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={onConvert}
              disabled={converting}
              title="Convert to client"
              className="flex items-center gap-1 px-2 py-1 text-[9px] uppercase tracking-wider rounded-md transition-colors disabled:opacity-50"
              style={{ backgroundColor: T.navy, color: T.gold }}
            >
              <UserPlus size={10} strokeWidth={2} /> {converting ? '…' : 'Convert'}
            </button>
            <CardMenu items={[
              { label: expanded ? 'Collapse' : 'Expand details', onClick: () => setExpanded((v) => !v) },
              { label: 'Edit details', onClick: () => { setExpanded(true); setEditing(true); } },
              'divider',
              { label: 'Delete lead…', danger: true, onClick: onDelete },
            ]} />
          </div>
        )}
      </div>

      {expanded && !compact && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid ' + T.grid }} onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <div className="space-y-2">
              <input type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)} placeholder="Email"
                className="w-full border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy" style={{ borderColor: T.border }} />
              <input type="text" value={phoneVal} onChange={(e) => setPhoneVal(e.target.value)} placeholder="Phone"
                className="w-full border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy" style={{ borderColor: T.border }} />
              <select value={referredByVal} onChange={(e) => setReferredByVal(e.target.value)}
                title="Affiliate partner who referred this lead"
                className="w-full border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy bg-white" style={{ borderColor: T.border }}>
                <option value="">No affiliate partner</option>
                {affiliates.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.company ? ' · ' + a.company : ''}</option>
                ))}
              </select>
              <select value={sourceVal} onChange={(e) => setSourceVal(e.target.value)}
                title="Marketing channel"
                className="w-full border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy bg-white" style={{ borderColor: T.border }}>
                <option value="">Select marketing source…</option>
                <option value="Facebook">Facebook</option>
                <option value="Website">Website</option>
                <option value="Word of Mouth">Word of Mouth</option>
                <option value="Other">Other</option>
              </select>
              <textarea value={notesVal} onChange={(e) => setNotesVal(e.target.value)} placeholder="Notes" rows={2}
                className="w-full border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy resize-none" style={{ borderColor: T.border }} />
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleSave} disabled={saving}
                  className="text-[10px] uppercase tracking-wider text-white bg-navy px-3 py-1 rounded-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="text-[10px] uppercase tracking-wider" style={{ color: T.muted }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {lead.leadPhone && <div className="text-[11px]" style={{ color: T.muted }}>{lead.leadPhone}</div>}
              {lead.leadNotes && <p className="text-[11px]" style={{ color: T.muted }}>{lead.leadNotes}</p>}
              <select
                value={stageDef.key}
                disabled={savingStage || !isAdmin}
                onChange={(e) => handleStageSelect(e.target.value)}
                className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 font-medium cursor-pointer focus:outline-none disabled:opacity-60"
                style={{ background: stageDef.bg, color: stageDef.text, border: '1px solid transparent' }}
              >
                {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </>
          )}
          {hasAudits && (
            <div className="space-y-1">
              <div className="text-[9px] uppercase tracking-wider font-medium" style={{ color: T.muted }}>Audits</div>
              {lead.audits.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <span className="text-[11px]" style={{ color: T.ink }}>
                    Report {a.reportDate}
                    {a.audit && <span style={{ color: T.muted }}> · {a.audit.accountsTargeted || 0} accts</span>}
                  </span>
                  {onOpenSummaryAudit && (
                    <button type="button" onClick={() => onOpenSummaryAudit(lead.id, a.id)}
                      className="text-[10px] uppercase tracking-wider text-navy hover:text-gold">Open</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SortableLeadTile(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.lead.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <LeadTile
        {...props}
        isDragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

/**
 * Four-column lead pipeline board. Dragging a card between columns persists
 * via updateLeadStage (lead-stage:* tag). Click expands details; grip handle
 * owns the drag so click and drag don't fight.
 */
export default function LeadsKanban({
  leads,
  stages,
  leadStage,
  isLeadRecent,
  isAdmin,
  affiliates = [],
  convertingId,
  onConvert,
  onDelete,
  onViewed,
  onOpenSummaryAudit,
  onChanged,
}) {
  const [overrides, setOverrides] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [movingId, setMovingId] = useState(null);

  useEffect(() => {
    setOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of Object.keys(next)) {
        const lead = leads.find((l) => l.id === id);
        if (!lead || leadStage(lead) === next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [leads, leadStage]);

  const stageOf = (lead) => overrides[lead.id] || leadStage(lead);

  const columns = useMemo(() => {
    const map = Object.fromEntries(stages.map((s) => [s.key, []]));
    for (const lead of leads) {
      const key = stageOf(lead);
      (map[key] || map[stages[0].key]).push(lead);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stageOf closes over overrides
  }, [leads, stages, overrides]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;
  const activeStageDef = activeLead
    ? (stages.find((s) => s.key === stageOf(activeLead)) || stages[0])
    : stages[0];

  const resolveTargetStage = (overId) => {
    if (stages.some((s) => s.key === overId)) return overId;
    for (const stage of stages) {
      if ((columns[stage.key] || []).some((l) => l.id === overId)) return stage.key;
    }
    return null;
  };

  const persistMove = async (lead, toStage) => {
    const fromStage = stageOf(lead);
    if (!toStage || toStage === fromStage) return;
    setOverrides((prev) => ({ ...prev, [lead.id]: toStage }));
    setMovingId(lead.id);
    try {
      await updateLeadStage(lead.name, toStage, lead.tags, lead.id);
      if (onChanged) await onChanged();
    } catch (e) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[lead.id];
        return next;
      });
      toast.error('Could not move lead: ' + e.message);
    } finally {
      setMovingId(null);
    }
  };

  const tileProps = (lead) => ({
    lead,
    stages,
    stageDef: stages.find((s) => s.key === stageOf(lead)) || stages[0],
    isLeadRecent,
    isAdmin,
    affiliates,
    converting: convertingId === lead.id,
    onConvert: () => onConvert(lead),
    onDelete: () => onDelete(lead),
    onViewed: () => onViewed?.(lead),
    onOpenSummaryAudit,
    onChanged,
    onStageChange: (next) => persistMove(lead, next),
  });

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={async ({ active, over }) => {
        setActiveId(null);
        if (!over || movingId) return;
        const lead = leads.find((l) => l.id === active.id);
        if (!lead) return;
        await persistMove(lead, resolveTargetStage(over.id));
      }}
    >
      <div className="flex gap-3 overflow-x-auto pb-2 items-start">
        {stages.map((stage) => {
          const items = columns[stage.key] || [];
          return (
            <StageColumn key={stage.key} stage={stage} count={items.length} itemIds={items.map((l) => l.id)}>
              {items.map((lead) => (
                <SortableLeadTile key={lead.id} {...tileProps(lead)} />
              ))}
            </StageColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeLead ? (
          <div style={{ width: 260, boxShadow: '0 8px 24px rgba(16,24,40,0.16)', borderRadius: 8 }}>
            <LeadTile {...tileProps(activeLead)} isAdmin={false} compact />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
