import React from 'react';
import { motion } from 'framer-motion';
import { Star, ChevronRight } from 'lucide-react';

const T = {
  navy: '#0B1F3A',
  navyMid: '#1B2A4A',
  gold: '#C9A84C',
  ink: '#111827',
  muted: '#9CA3AF',
};

function Avatar({ name, isVip, size = 52 }) {
  const initials = (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.32),
        background: isVip ? 'linear-gradient(135deg,#C9A84C,#8F7524)' : 'rgba(255,255,255,0.12)',
        color: isVip ? '#0B1F3A' : '#F7F4ED',
        border: isVip ? '2px solid #F0D78C' : '1px solid rgba(201,168,76,0.35)',
        letterSpacing: '0.04em',
      }}
    >
      {initials}
    </div>
  );
}

const toneBtn = {
  urgent: { bg: '#C9A84C', color: '#0B1F3A' },
  action: { bg: '#C9A84C', color: '#0B1F3A' },
  wait: { bg: 'rgba(255,255,255,0.1)', color: '#F7F4ED', border: '1px solid rgba(255,255,255,0.2)' },
  clear: { bg: 'rgba(34,197,94,0.15)', color: '#86EFAC', border: '1px solid rgba(34,197,94,0.35)' },
  neutral: { bg: 'rgba(255,255,255,0.1)', color: '#F7F4ED', border: '1px solid rgba(255,255,255,0.2)' },
};

export default function ClientCommandHeader({
  client,
  isAdmin,
  auditors = [],
  primaryStatus,
  nextAction,
  onBack,
  onNextAction,
  vipButton,
  emailButton,
  menu,
  children,
}) {
  const c = client;
  const btn = toneBtn[nextAction?.tone] || toneBtn.action;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="mb-5 overflow-hidden"
      style={{
        borderRadius: 18,
        background: `linear-gradient(145deg, ${T.navy} 0%, ${T.navyMid} 55%, #152238 100%)`,
        boxShadow: '0 12px 40px rgba(11,31,58,0.28)',
        border: c.isVip ? '1px solid rgba(201,168,76,0.55)' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ height: 3, background: `linear-gradient(90deg, transparent, ${T.gold}, transparent)` }} />
      <div className="px-5 sm:px-6 pt-4 pb-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] mb-4 transition-opacity hover:opacity-100 opacity-70"
          style={{ color: T.gold }}
        >
          ← Back to Clients
        </button>

        <div className="flex items-start gap-4 flex-wrap">
          <Avatar name={c.name} isVip={c.isVip} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h1 className="ccc-display text-[26px] sm:text-[28px] font-semibold leading-none truncate" style={{ color: '#F7F4ED' }}>
                {c.name}
              </h1>
              {c.isVip && <Star size={15} fill={T.gold} style={{ color: T.gold }} />}
              {c.lpoaSigned && (
                <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#86EFAC', border: '1px solid rgba(34,197,94,0.3)' }}>
                  LPOA
                </span>
              )}
              {c.billingStatus === 'Active' && (
                <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: '#93C5FD', border: '1px solid rgba(59,130,246,0.3)' }}>
                  Active
                </span>
              )}
              {c.billingStatus === 'Paused' && (
                <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.15)', color: '#FCD34D' }}>
                  Paused
                </span>
              )}
              {c.billingStatus === 'Graduated' && (
                <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: '#86EFAC' }}>
                  Graduated
                </span>
              )}
              {c.billingStatus === 'Inactive' && (
                <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: '#FCA5A5' }}>
                  Inactive
                </span>
              )}
            </div>
            <div className="text-[12px] truncate" style={{ color: T.muted }}>
              {c.email || <span style={{ color: '#FCD34D' }}>No email</span>}
              {c.address && <span> · {c.address}</span>}
              {isAdmin && auditors.length > 0 && <span> · {auditors.join(', ')}</span>}
            </div>
            {primaryStatus && (
              <div className="mt-2.5">
                <span
                  className="inline-block text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#E5E7EB', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {primaryStatus.label}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-stretch sm:items-end gap-2.5 shrink-0 w-full sm:w-auto">
            {nextAction && (
              <button
                type="button"
                onClick={() => onNextAction?.(nextAction)}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-transform hover:scale-[1.02] active:scale-[0.99]"
                style={{
                  background: btn.bg,
                  color: btn.color,
                  border: btn.border || 'none',
                  minWidth: 220,
                  boxShadow: nextAction.tone === 'urgent' || nextAction.tone === 'action'
                    ? '0 4px 20px rgba(201,168,76,0.35)'
                    : 'none',
                }}
              >
                <div className="text-left">
                  <div className="text-[9px] uppercase tracking-[0.16em] opacity-70 font-bold">Next action</div>
                  <div className="text-[13px] font-semibold leading-tight mt-0.5">{nextAction.label}</div>
                  {nextAction.detail && (
                    <div className="text-[10px] opacity-70 mt-0.5 max-w-[200px]">{nextAction.detail}</div>
                  )}
                </div>
                <ChevronRight size={16} strokeWidth={2.5} className="shrink-0 opacity-80" />
              </button>
            )}
            <div className="flex items-center gap-2 justify-end">
              {emailButton}
              {vipButton}
              {menu}
            </div>
          </div>
        </div>
      </div>
      {children}
    </motion.div>
  );
}
