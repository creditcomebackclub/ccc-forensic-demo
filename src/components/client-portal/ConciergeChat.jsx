import React, { useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ConciergeChat({ clientId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I am the CCC Concierge. How can I help you with your credit repair journey today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, message: userMsg })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply }]);
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'assistant', text: "I'm sorry, I'm having trouble connecting right now." }]);
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
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-100 text-gray-400 rounded-2xl rounded-bl-sm px-4 py-2 text-[13px] shadow-sm">
                    typing...
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 bg-white border-t border-gray-100">
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  placeholder="Ask a question..."
                  className="w-full bg-slate-50 border border-gray-200 rounded-full pl-4 pr-10 py-2.5 text-[13px] focus:outline-none focus:border-navy focus:ring-1 transition-all"
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
        className="w-14 h-14 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all"
        style={{ backgroundColor: '#1B2A4A' }}
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </div>
  );
}
