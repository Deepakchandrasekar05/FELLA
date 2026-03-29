// desktop/renderer/AvatarApp.tsx — Floating avatar face (rendered in the small avatar window)
import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

type AvatarState = 'idle' | 'listening' | 'thinking' | 'responding';

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

function AvatarFace({ state, onClick }: { state: AvatarState; onClick: () => void }) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
    }, 3500 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, []);

  const colors: Record<AvatarState, string> = {
    idle:       '#E8865A',
    listening:  '#6CB6FF',
    thinking:   '#F4A261',
    responding: '#E8865A',
  };

  const glowColors: Record<AvatarState, string> = {
    idle:       'rgba(232,134,90,0.3)',
    listening:  'rgba(108,182,255,0.4)',
    thinking:   'rgba(244,162,97,0.4)',
    responding: 'rgba(232,134,90,0.4)',
  };

  const color = colors[state];
  const glow = glowColors[state];
  const isPulsing = state === 'thinking' || state === 'responding';

  return (
    <div
      onClick={onClick}
      style={{
        width: '100px',
        height: '100px',
        cursor: 'pointer',
        WebkitAppRegion: 'no-drag',
        animation: isPulsing ? 'avatar-pulse 1.2s ease-in-out infinite' : 'avatar-float 3s ease-in-out infinite',
        filter: `drop-shadow(0 0 12px ${glow})`,
        transition: 'filter 0.3s ease',
      } as any}
    >
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        {/* Outer glow ring */}
        <circle
          cx="50" cy="50" r="47"
          fill="none"
          stroke={color}
          strokeWidth="2"
          opacity="0.3"
          style={{ transition: 'stroke 0.3s ease' }}
        >
          {isPulsing && (
            <animate attributeName="r" values="44;47;44" dur="1.2s" repeatCount="indefinite" />
          )}
        </circle>

        {/* Second ring */}
        <circle
          cx="50" cy="50" r="42"
          fill="none"
          stroke={color}
          strokeWidth="1"
          opacity="0.15"
          strokeDasharray="4 6"
        >
          <animateTransform attributeName="transform" type="rotate" values="0 50 50;360 50 50" dur="20s" repeatCount="indefinite" />
        </circle>

        {/* Face background */}
        <circle
          cx="50" cy="50" r="38"
          fill="rgba(10,10,20,0.9)"
          stroke={color}
          strokeWidth="1.5"
          strokeOpacity="0.2"
        />

        {/* Inner gradient */}
        <defs>
          <radialGradient id="faceGrad" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="36" fill="url(#faceGrad)" />

        {/* Eyes */}
        {blink ? (
          <>
            <line x1="33" y1="40" x2="43" y2="40" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
            <line x1="57" y1="40" x2="67" y2="40" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            {/* Left eye */}
            <circle cx="38" cy="40" r={state === 'listening' ? 6 : state === 'thinking' ? 4 : 5} fill={color}>
              {state === 'thinking' && (
                <animate attributeName="r" values="4;5;4" dur="0.8s" repeatCount="indefinite" />
              )}
            </circle>
            <circle cx="40" cy="38" r="2" fill="white" opacity="0.7" />

            {/* Right eye */}
            <circle cx="62" cy="40" r={state === 'listening' ? 6 : state === 'thinking' ? 4 : 5} fill={color}>
             {state === 'thinking' && (
                <animate attributeName="r" values="4;5;4" dur="0.8s" repeatCount="indefinite" />
              )}
            </circle>
            <circle cx="64" cy="38" r="2" fill="white" opacity="0.7" />
          </>
        )}

        {/* Mouth — changes with state */}
        {state === 'idle' && (
          <path d="M 38 58 Q 50 65 62 58" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        )}
        {state === 'listening' && (
          <ellipse cx="50" cy="60" rx="8" ry="6" fill={color} opacity="0.8">
            <animate attributeName="ry" values="6;7;6" dur="1s" repeatCount="indefinite" />
          </ellipse>
        )}
        {state === 'thinking' && (
          <>
            <path d="M 38 58 Q 50 54 62 58" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
            {/* Thinking dots */}
            <circle cx="38" cy="72" r="2.5" fill={color} opacity="0.5">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" begin="0s" repeatCount="indefinite" />
            </circle>
            <circle cx="50" cy="72" r="2.5" fill={color} opacity="0.7">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
            </circle>
            <circle cx="62" cy="72" r="2.5" fill={color} opacity="0.5">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" begin="0.8s" repeatCount="indefinite" />
            </circle>
          </>
        )}
        {state === 'responding' && (
          <path d="M 35 57 Q 50 67 65 57" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round">
            <animate attributeName="d" values="M 35 57 Q 50 67 65 57;M 35 57 Q 50 63 65 57;M 35 57 Q 50 67 65 57" dur="0.6s" repeatCount="indefinite" />
          </path>
        )}
      </svg>

      <style>{`
        @keyframes avatar-pulse {
          0%   { transform: scale(1);    }
          50%  { transform: scale(1.06); }
          100% { transform: scale(1);    }
        }
        @keyframes avatar-float {
          0%   { transform: translateY(0px); }
          50%  { transform: translateY(-3px); }
          100% { transform: translateY(0px); }
        }
      `}</style>
    </div>
  );
}

function AvatarApp() {
  const [state, setState] = useState<AvatarState>('idle');

  useEffect(() => {
    const unsub = window.fella.onState((newState) => {
      setState(newState as AvatarState);
    });
    return unsub;
  }, []);

  // Auto-return to idle after responding
  useEffect(() => {
    if (state === 'responding') {
      const timer = setTimeout(() => setState('idle'), 5000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const handleClick = useCallback(() => {
    window.fella.toggleInput();
    setState((prev) => (prev === 'idle' ? 'listening' : prev));
  }, []);

  return <AvatarFace state={state} onClick={handleClick} />;
}

// Mount
const root = createRoot(document.getElementById('root')!);
root.render(<AvatarApp />);
