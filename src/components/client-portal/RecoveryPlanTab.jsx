import React, { useState } from 'react';
import { Download, FileCheck2, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../../utils/supabase.js';

export default function RecoveryPlanTab({ blueprints }) {
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState(null);

  const openBlueprint = async (blueprint) => {
    setOpening(blueprint.id);
    setError(null);
    try {
      const { data, error: signError } = await supabase.storage
        .from('recovery-blueprints')
        .createSignedUrl(blueprint.storage_path, 60 * 10);
      if (signError) throw signError;
      // Best-effort engagement tracking. Opening the approved artifact must
      // still work if the timestamp update is temporarily unavailable.
      supabase.rpc('mark_recovery_blueprint_viewed', { p_blueprint_id: blueprint.id })
        .then(({ error: viewError }) => {
          if (viewError) console.warn('Could not record Blueprint view:', viewError.message);
        });
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError('We could not open your Blueprint. Please try again or contact Credit Comeback Club.');
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-amber-600 text-[10px] uppercase tracking-[.14em] font-bold mb-2">
          <ShieldCheck size={14} /> Forensic recovery plan
        </div>
        <h2 className="text-xl font-bold text-slate-900">Your Recovery Blueprint</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">Your reviewed file snapshot, opening priorities, and documented path forward—all in one private plan.</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="space-y-3">
        {blueprints.map((blueprint, index) => (
          <div key={blueprint.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center shrink-0">
              <FileCheck2 size={22} strokeWidth={1.6} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-slate-900">Recovery Blueprint</div>
                {index === 0 && <span className="text-[9px] uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-bold">Latest</span>}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Report {blueprint.report_date || 'date unavailable'} · Version {blueprint.version}
                {blueprint.sent_at ? ` · Delivered to your portal ${new Date(blueprint.sent_at).toLocaleDateString()}` : ''}
              </div>
            </div>
            <button onClick={() => openBlueprint(blueprint)} disabled={opening === blueprint.id}
              className="flex items-center justify-center gap-2 bg-slate-900 text-amber-400 rounded-lg px-4 py-2.5 text-[11px] uppercase tracking-wider font-bold hover:bg-slate-800 disabled:opacity-50">
              {opening === blueprint.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {opening === blueprint.id ? 'Opening…' : 'View Blueprint'}
            </button>
          </div>
        ))}
      </div>

      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs text-slate-500 leading-relaxed">
        This Blueprint summarizes the reviewed priorities in your file. It does not promise a deletion or score increase; furnishers and credit bureaus make the final reporting decisions.
      </div>
    </div>
  );
}
