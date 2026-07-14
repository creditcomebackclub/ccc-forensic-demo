import React from 'react';
import { Star, Calendar, TrendingUp, ExternalLink } from 'lucide-react';

export default function VipTab({ isVip }) {
  if (!isVip) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 text-white">
          <Star size={120} />
        </div>
        <div className="flex items-center gap-2 mb-3 relative z-10">
          <Star size={16} className="text-amber-400" strokeWidth={2.5} />
          <span className="text-amber-400 font-bold text-xs uppercase tracking-[0.08em]">VIP Member</span>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 relative z-10 ccc-display">Your VIP Benefits</h2>
        <p className="text-sm text-white/70 relative z-10">Priority service, monthly strategy calls, and exclusive business credit resources.</p>
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
            <Calendar size={16} className="text-amber-600" strokeWidth={2} />
          </div>
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-slate-900">Monthly Strategy Call</span>
        </div>
        <p className="text-sm text-gray-600 mb-4 leading-relaxed">Book your 15-minute strategy call with Christopher Holland. Review your campaign, discuss next steps, and map your path to business credit.</p>
        <p className="text-xs text-gray-400 italic">Your strategy call link is coming soon — we'll send it to you directly.</p>
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
            <TrendingUp size={16} className="text-amber-600" strokeWidth={2} />
          </div>
          <span className="text-xs font-bold uppercase tracking-[0.06em] text-slate-900">Business Credit & Funding</span>
        </div>
        <p className="text-sm text-gray-600 mb-2 leading-relaxed">Once your personal credit is positioned, the next step is business credit and funding. Our partner Swiftedly specializes in business funding for entrepreneurs.</p>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">Business credit is completely separate from personal credit — you can start building it now.</p>
        <a href="https://swiftedly.com" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs px-5 py-2.5 bg-amber-400 text-slate-900 rounded-lg font-bold uppercase tracking-[0.06em] hover:bg-amber-300 transition-colors shadow-sm">
          <ExternalLink size={14} strokeWidth={2} />
          Explore Business Funding →
        </a>
      </div>
    </div>
  );
}
