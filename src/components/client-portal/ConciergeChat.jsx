import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SUGGESTIONS = [
  "When is my next update?",
  "What casework has been mailed?",
  "Has a result been recorded?"
];

export default function ConciergeChat({ accessToken }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I’m the CCC Concierge. I can explain the status already recorded in your portal. How can I help?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, loading]);

  const sendMessage = async (overrideText = null) => {
    const textToSend = typeof overrideText === 'string' ? overrideText : input;
    if (!textToSend.trim() || loading) return;
    
    const userMsg = textToSend.trim();
    if (typeof overrideText !== 'string') setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      if (!accessToken) throw new Error('Your session expired. Please sign in again.');
      const apiUrl = String(import.meta.env.VITE_AGENTS_API_URL || 'http://localhost:8000').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/portal/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || 'The concierge could not answer right now.');
      if (!data.reply || typeof data.reply !== 'string') throw new Error('The concierge returned an invalid response.');
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply, handoff: data.handoff === true }]);
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'assistant', text: e.message || "I'm sorry, I'm having trouble connecting right now." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="absolute bottom-16 right-0 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
            style={{ height: '400px' }}
          >
            <div className="bg-navy p-4 flex items-center justify-between text-white" style={{ backgroundColor: '#1B2A4A' }}>
              <div className="flex items-center gap-2">
                <MessageCircle size={18} className="text-amber-400" />
                <span className="font-bold text-sm tracking-wide">CCC Concierge</span>
              </div>
              <button onClick={() => setIsOpen(false)} className="hover:opacity-70 transition-opacity">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-[13px] leading-relaxed shadow-sm ${m.role === 'user' ? 'text-white rounded-br-sm' : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'}`}
                       style={m.role === 'user' ? { backgroundColor: '#1B2A4A' } : {}}>
                    {m.text}
                    {m.handoff && <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">Staff handoff recorded</div>}
                  </div>
                </div>
              ))}
              {messages.length === 1 && (
                <div className="flex flex-col gap-2 mt-2 items-start pl-2">
                  {SUGGESTIONS.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => sendMessage(s)}
                      className="text-[12px] bg-white text-navy border border-gray-200 rounded-full px-3 py-1.5 shadow-sm hover:bg-gray-50 transition-colors text-left"
                      style={{ color: '#1B2A4A' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-100 text-gray-400 rounded-2xl rounded-bl-sm px-4 py-3 text-[13px] shadow-sm flex items-center gap-1.5 h-[38px]">
                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                    <motion.div animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-white border-t border-gray-100">
              <p className="mb-2 px-1 text-[10px] leading-snug text-slate-400">Never send an SSN, card number, password, or monitoring login in chat.</p>
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  maxLength={1500}
                  placeholder="Ask a question..."
                  className="w-full bg-slate-50 border border-gray-200 rounded-full pl-4 pr-10 py-2.5 text-[16px] focus:outline-none focus:border-navy focus:ring-1 transition-all"
                />
                <button 
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 text-white rounded-full flex items-center justify-center hover:bg-opacity-90 disabled:opacity-50 transition-all"
                  style={{ backgroundColor: '#1B2A4A' }}
                >
                  <Send size={12} style={{ transform: 'translateX(-1px) translateY(1px)' }} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close CCC Concierge' : 'Open CCC Concierge'}
        className="w-14 h-14 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all"
        style={{ backgroundColor: '#1B2A4A' }}
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </div>
  );
}
