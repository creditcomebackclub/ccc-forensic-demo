import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';

const SUGGESTIONS = [
  "How does your credit repair process work?",
  "How much does it cost?",
  "I'd like to book a consultation."
];

export default function ProspectChatWidget() {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! I am the Credit Comeback Club AI Assistant. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = async (overrideText = null) => {
    const textToSend = typeof overrideText === 'string' ? overrideText : input;
    if (!textToSend.trim() || loading) return;
    
    const userMsg = textToSend.trim();
    if (typeof overrideText !== 'string') setInput('');
    
    const newMessages = [...messages, { role: 'user', text: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch('/.netlify/functions/chat-prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: newMessages })
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

  const handleClose = () => {
    if (window.parent !== window) {
      window.parent.postMessage('close_ccc_chat', '*');
    }
  };

  return (
    <div className="w-full h-screen bg-transparent flex flex-col justify-end items-end">
      <div 
        className="w-full h-full bg-white shadow-2xl overflow-hidden flex flex-col"
        style={{ borderRadius: '16px 16px 0 0' }}
      >
        <div className="bg-navy p-4 flex items-center justify-between text-white shadow-sm z-10" style={{ backgroundColor: '#1B2A4A' }}>
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-amber-400" />
            <span className="font-bold text-sm tracking-wide">CCC Assistant</span>
          </div>
          <button onClick={handleClose} className="hover:opacity-70 transition-opacity">
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
              <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 bg-white border-t border-gray-100 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type your message..."
              className="w-full bg-gray-50 border border-gray-200 rounded-full pl-4 pr-10 py-2.5 text-[13px] text-gray-800 focus:outline-none focus:border-navy focus:bg-white transition-colors"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="absolute right-1.5 w-7 h-7 bg-navy rounded-full flex items-center justify-center text-white disabled:opacity-50 disabled:bg-gray-300 transition-colors"
              style={{ backgroundColor: input.trim() && !loading ? '#1B2A4A' : undefined }}
            >
              <Send size={12} className="ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
