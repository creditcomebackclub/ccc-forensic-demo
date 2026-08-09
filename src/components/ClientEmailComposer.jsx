import React, { useEffect, useState } from 'react';
import { Loader2, Mail, Send, X } from 'lucide-react';
import { supabase } from '../utils/supabase.js';
import { resolveEmailMergeFields } from '../utils/emailMergeFields.js';

export default function ClientEmailComposer({ client, roundId = null, onClose, onSent }) {
  const [subject, setSubject] = useState('An update from Credit Comeback Club');
  const [bodyText, setBodyText] = useState(`Hi ${(client?.name || '').split(/\s+/)[0] || 'there'},\n\n`);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const query = supabase.from('client_email_templates').select('id,name,subject_template,body_template,event_type').eq('is_active', true).order('name');
    const scoped = client?.userId ? query.eq('user_id', client.userId) : query;
    scoped.then(({ data, error: loadError }) => {
      if (cancelled) return;
      if (loadError) setError('Could not load canned email templates: ' + loadError.message);
      else setTemplates(data || []);
    });
    return () => { cancelled = true; };
  }, [client?.userId]);

  function chooseTemplate(id) {
    setTemplateId(id);
    if (!id) return;
    const template = templates.find((item) => item.id === id);
    if (!template) return;
    try {
      const round = (client?.rounds || []).find((item) => item.round_id === roundId) || (client?.rounds || [])[0] || {};
      const account = { furnisher: client?.letters?.find((letter) => letter.roundId === round.round_id)?.furnisher || '' };
      const context = { client, account, round };
      setSubject(resolveEmailMergeFields(template.subject_template, context));
      setBodyText(resolveEmailMergeFields(template.body_template, context));
      setError(null);
    } catch (templateError) {
      setError(templateError.message);
    }
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('You are no longer signed in.');
      const response = await fetch('/.netlify/functions/round-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'send_custom', clientId: client.id, roundId, templateId: templateId || null, subject, bodyText }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not send the email.');
      onSent?.(result);
      onClose();
    } catch (sendError) {
      setError(sendError.message || 'Could not send the email.');
    } finally {
      setSending(false);
    }
  }

  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4"><div className="bg-white rounded border border-border w-full max-w-xl">
    <div className="px-5 py-4 bg-navy rounded-t flex items-center justify-between"><div className="flex items-center gap-2"><Mail size={15} className="text-gold" /><div><div className="text-white text-[14px] font-medium">Email {client.name}</div><div className="text-gold text-[10px] uppercase tracking-wider">Safe plain-text editor</div></div></div><button onClick={onClose} className="text-gray-300 hover:text-white"><X size={16} /></button></div>
    <div className="p-5 space-y-4">
      <label className="block"><span className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Canned template</span><select value={templateId} onChange={(event) => chooseTemplate(event.target.value)} className="w-full border border-border rounded p-2 text-[12px]"><option value="">Custom message</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <label className="block"><span className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} className="w-full border border-border rounded p-2 text-[12px]" /></label>
      <label className="block"><span className="block text-[10px] uppercase tracking-wider text-ink-muted mb-1">Message</span><textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} maxLength={10000} rows={10} className="w-full border border-border rounded p-3 text-[12px] leading-relaxed" /></label>
      <div className="text-[10px] text-ink-faint">Formatting is converted safely on the server. HTML and scripts are never accepted from this editor. The sent message is retained in client email history.</div>
      {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 p-2 rounded">{error}</div>}
    </div>
    <div className="px-5 py-4 border-t border-border flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 text-[11px] uppercase tracking-wider border border-border rounded">Cancel</button><button onClick={send} disabled={sending || !subject.trim() || !bodyText.trim()} className="px-4 py-2 text-[11px] uppercase tracking-wider bg-navy text-gold rounded disabled:opacity-40 flex items-center gap-2">{sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}{sending ? 'Sending…' : 'Send Email'}</button></div>
  </div></div>;
}
