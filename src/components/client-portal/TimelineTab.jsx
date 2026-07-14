import React from 'react';
import TimelineEvent from './TimelineEvent';

export default function TimelineTab({ timeline }) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Dispute Journal</h2>
        <p className="text-sm text-gray-500 mt-1">A chronological record of every action in your campaign.</p>
      </div>
      
      {timeline.length === 0 ? (
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-10 text-center shadow-sm">
          <p className="text-sm text-gray-400">Your timeline will populate as your campaign progresses.</p>
        </div>
      ) : (
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-6 shadow-sm overflow-hidden">
          {timeline.map((event, i) => <TimelineEvent key={i} {...event} />)}
        </div>
      )}
    </div>
  );
}
