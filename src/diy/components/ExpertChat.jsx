import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { sendFieldworkExpertChat } from '../api';
import { useFieldwork } from '../state';

const SUGGESTIONS = [
  'What should I mail first?',
  'How do the 30-day clocks work?',
  'When do I send a follow-up?',
];

function greeting(name) {
  const first = (name || 'there').split(' ')[0];
  return `Hi ${first} — I’m your Fieldwork campaign expert. Ask about your audit, mail credits, or the next certified packet. Weekdays 9am–5pm Mountain · 8 messages / month.`;
}

export default function ExpertChat() {
  const {
    user,
    plan,
    planId,
    expertChatCredits,
    setExpertChatCredits,
    audit,
    documents,
  } = useFieldwork();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => [
    { role: 'assistant', text: greeting(user?.name) },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  const creditsLeft = typeof expertChatCredits === 'number'
    ? expertChatCredits
    : plan.expertChats;

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, loading]);

  if (planId !== 'unlimited') return null;

  const sendMessage = async (overrideText = null) => {
    const textToSend = typeof overrideText === 'string' ? overrideText : input;
    if (!textToSend.trim() || loading) return;

    if (creditsLeft < 1) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'You’ve used all 8 expert-chat messages for this billing period. Credits refresh with your next Campaign cycle.',
        },
      ]);
      return;
    }

    const userMsg = textToSend.trim();
    if (typeof overrideText !== 'string') setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const history = [...messages, { role: 'user', text: userMsg }];
      const data = await sendFieldworkExpertChat({
        message: userMsg,
        history,
        context: {
          audit: audit
            ? {
                summary: audit.summary || null,
                accounts: (audit.accounts || []).slice(0, 12),
              }
            : null,
          documents: (documents || []).slice(0, 12).map((d) => ({
            name: d.name,
            kind: d.kind,
          })),
        },
      });

      if (typeof data.expert_chat_credits === 'number') {
        setExpertChatCredits(data.expert_chat_credits);
      } else {
        setExpertChatCredits((c) => Math.max(0, c - 1));
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: data.reply || 'No reply returned.' },
      ]);
    } catch (err) {
      const outside = err?.body?.outsideHours || /business hours/i.test(err?.message || '');
      if (!outside) {
        // Failed after possible reserve — keep local count unless server said otherwise
        if (typeof err?.body?.expert_chat_credits === 'number') {
          setExpertChatCredits(err.body.expert_chat_credits);
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: err?.message || 'I’m having trouble connecting right now. Try again shortly.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 md:bottom-6 md:right-6">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-16 right-0 flex w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[var(--fw-line)] bg-white shadow-[0_18px_50px_rgba(7,19,31,0.22)]"
            style={{ height: 420 }}
          >
            <div className="flex items-center justify-between bg-[var(--fw-ink)] px-4 py-3 text-white">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} className="text-[var(--fw-signal)]" />
                  <span className="text-sm font-semibold tracking-wide">Campaign expert</span>
                </div>
                <div className="mt-0.5 fw-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                  {creditsLeft} msgs left · 9–5 MT
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Close expert chat"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-[var(--fw-paper)] px-3 py-3">
              {messages.map((m, i) => (
                <div key={`${m.role}-${i}`} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[88%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                      m.role === 'user'
                        ? 'rounded-br-sm bg-[var(--fw-ink)] text-white'
                        : 'rounded-bl-sm border border-[var(--fw-line)] bg-white text-[var(--fw-ink)]'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}

              {messages.length === 1 && creditsLeft > 0 && (
                <div className="flex flex-col items-start gap-2 pl-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => sendMessage(s)}
                      className="rounded border border-[var(--fw-line)] bg-white px-3 py-1.5 text-left text-[12px] text-[var(--fw-sea)] hover:border-[var(--fw-sea)]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {loading && (
                <div className="flex justify-start">
                  <div className="flex h-[36px] items-center gap-1.5 rounded-lg rounded-bl-sm border border-[var(--fw-line)] bg-white px-3">
                    {[0, 0.15, 0.3].map((delay) => (
                      <motion.span
                        key={delay}
                        animate={{ y: [0, -3, 0] }}
                        transition={{ repeat: Infinity, duration: 0.55, delay }}
                        className="h-1.5 w-1.5 rounded-full bg-[var(--fw-sea)]/50"
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-[var(--fw-line)] bg-white p-3">
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder={creditsLeft < 1 ? 'Message cap reached' : 'Ask about your campaign…'}
                  disabled={creditsLeft < 1 || loading}
                  className="w-full rounded-lg border border-[var(--fw-line)] bg-[var(--fw-paper)] py-2.5 pl-3 pr-10 text-[15px] text-[var(--fw-ink)] outline-none focus:border-[var(--fw-sea)] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading || creditsLeft < 1}
                  className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded bg-[var(--fw-ink)] text-white disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send size={12} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--fw-ink)] text-white shadow-[0_10px_28px_rgba(7,19,31,0.35)]"
        aria-label={isOpen ? 'Close expert chat' : 'Open campaign expert chat'}
      >
        {isOpen ? <X size={22} /> : <MessageCircle size={22} className="text-[var(--fw-signal)]" />}
      </motion.button>
    </div>
  );
}
