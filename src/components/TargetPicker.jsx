import React from 'react';
import { Building2, Check, Landmark } from 'lucide-react';

function Choice({ selected, icon: Icon, title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`w-full text-left p-4 rounded border transition-colors ${selected ? 'border-gold bg-amber-50' : 'border-border hover:border-gray-400'}`}>
      <span className="flex items-start gap-3">
        <span className={`p-2 rounded ${selected ? 'bg-gold text-navy-dark' : 'bg-gray-100 text-ink-muted'}`}><Icon size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">{title}</span>
          <span className="block text-[11px] text-ink-muted mt-1 leading-relaxed">{description}</span>
        </span>
        {selected && <Check size={14} className="text-gold-dark mt-1" />}
      </span>
    </button>
  );
}

export default function TargetPicker({ value, onChange, furnisherOptions = [], furnisherName, bureauName, compact = false }) {
  const furnishers = furnisherOptions.length ? furnisherOptions : (furnisherName ? [furnisherName] : []);
  return (
    <div className={compact ? 'space-y-2' : 'grid grid-cols-2 gap-3'}>
      {furnishers.map((name) => (
        <Choice
          key={`furnisher-${name}`}
          selected={value?.track === 'furnisher' && value?.furnisherName === name}
          icon={Building2}
          title={compact ? `Furnisher: ${name}` : 'Direct Furnisher'}
          description={compact ? 'Build the record against this reporting company.' : 'Dispute directly with the company reporting the account.'}
          onClick={() => onChange({ track: 'furnisher', furnisherName: name })}
        />
      ))}
      <Choice
        selected={value?.track === 'bureau'}
        icon={Landmark}
        title={compact ? `Bureau: ${bureauName || 'selected CRA'}` : 'Credit Bureau'}
        description={compact ? 'Address the bureau’s own reinvestigation record.' : 'Create separate letters only for bureaus proven active on the latest audit.'}
        onClick={() => onChange({ track: 'bureau' })}
      />
    </div>
  );
}
