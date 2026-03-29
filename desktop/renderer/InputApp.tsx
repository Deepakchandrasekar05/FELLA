// desktop/renderer/InputApp.tsx — Chat input window with response history
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

declare global {
  interface Window {
    fella: {
      command: (text: string) => Promise<{ success: boolean; response: string; steps?: unknown[] }>;
      toggleInput: () => Promise<void>;
      closeInput: () => Promise<void>;
      getState: () => Promise<{ engineReady: boolean }>;
      onState: (cb: (state: string) => void) => () => void;
      onStep: (cb: (step: { tool: string; success: boolean }) => void) => () => void;
    };
  }
}

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'step';
  content: string;
  timestamp: Date;
};

// ── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const isStep = msg.role === 'step';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '6px',
      animation: 'fadeSlideIn 0.25s ease-out',
    }}>
      <div style={{
        maxWidth: '85%',
        padding: isStep ? '4px 10px' : '8px 12px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: isUser
          ? 'linear-gradient(135deg, #6CB6FF, #4A90E2)'
          : isStep
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(255, 255, 255, 0.06)',
        color: isStep ? '#aaaaaa' : isUser ? '#ffffff' : '#DEDEDE',
        fontSize: isStep ? '11px' : '13px',
        fontFamily: isStep ? "'JetBrains Mono', monospace" : "'Inter', sans-serif",
        lineHeight: '1.45',
        border: isStep ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
        wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ── Typing Indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={{
      display: 'flex',
      gap: '4px',
      padding: '8px 14px',
      alignItems: 'center',
    }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: '#E8865A',
          animation: `typingBounce 1s ease-in-out ${i * 0.15}s infinite`,
        }} />
      ))}
      <span style={{
        fontSize: '11px',
        color: '#aaaaaa',
        marginLeft: '6px',
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        thinking...
      </span>
    </div>
  );
}

// ── Main Input App ───────────────────────────────────────────────────────────
function InputApp() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Listen for step updates
  useEffect(() => {
    const unsub = window.fella.onStep((step) => {
      const stepMsg: ChatMessage = {
        id: `step-${Date.now()}-${Math.random()}`,
        role: 'step',
        content: `⚙ ${step.tool} ${step.success ? '✓' : '✕'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, stepMsg]);
    });
    return unsub;
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setText('');
    setIsThinking(true);

    try {
      const result = await window.fella.command(trimmed);
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.success ? result.response : `❌ ${result.response}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `❌ ${String(err)}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsThinking(false);
      inputRef.current?.focus();
    }
  }, [text, isThinking]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      window.fella.closeInput();
    }
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(12, 12, 18, 0.92)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRadius: '16px',
      border: '1px solid rgba(232, 134, 90, 0.15)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        WebkitAppRegion: 'drag',
      } as any}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#E8865A',
            boxShadow: '0 0 6px rgba(232,134,90,0.5)',
          }} />
          <span style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#E8865A',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.05em',
          }}>
            FELLA
          </span>
        </div>
        <button
          onClick={() => window.fella.closeInput()}
          style={{
            background: 'none',
            border: 'none',
            color: '#555',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '2px 6px',
            borderRadius: '4px',
            WebkitAppRegion: 'no-drag',
            transition: 'color 0.2s',
          } as any}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ff4444')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#555')}
        >
          ✕
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) transparent',
        }}
      >
        {messages.length === 0 && !isThinking && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: '8px',
            opacity: 0.5,
          }}>
            <span style={{ fontSize: '32px' }}>🐱</span>
            <span style={{
              fontSize: '12px',
              color: '#666',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              Ask FELLA anything...
            </span>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isThinking && <TypingIndicator />}
      </div>

      {/* Input bar */}
      <div style={{
        padding: '10px 12px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{
          color: '#E8865A',
          fontSize: '14px',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 600,
        }}>
          ❯
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          disabled={isThinking}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#ffffff',
            fontSize: '13px',
            fontFamily: "'JetBrains Mono', monospace",
            caretColor: '#E8865A',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={isThinking || !text.trim()}
          style={{
            background: text.trim() ? 'rgba(232, 134, 90, 0.15)' : 'transparent',
            border: '1px solid rgba(232, 134, 90, 0.2)',
            borderRadius: '8px',
            color: text.trim() ? '#E8865A' : '#333',
            cursor: text.trim() && !isThinking ? 'pointer' : 'default',
            padding: '4px 10px',
            fontSize: '12px',
            fontFamily: "'JetBrains Mono', monospace",
            transition: 'all 0.2s',
          }}
        >
          ↵
        </button>
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-6px); }
        }
        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        /* Input placeholder */
        input::placeholder { color: #444; }
      `}</style>
    </div>
  );
}

// Mount
const root = createRoot(document.getElementById('root')!);
root.render(<InputApp />);
