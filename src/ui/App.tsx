// App.tsx
import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp, type Key } from 'ink';
import Header from './components/Header.js';
import MessageList, { type Message, type MessageRole } from './components/MessageList.js';
import InputBar from './components/InputBar.js';
import StatusBar from './components/StatusBar.js';
import { Engine } from '../execution/engine.js';

type Screen = 'login' | 'welcome' | 'chat';

const LOGIN_MESSAGES: Message[] = [
  {
    id: 'login-intro',
    role: 'system',
    content: "You're not logged in. Choose how to continue:",
    timestamp: new Date(),
  },
  {
    id: 'login-options',
    role: 'assistant',
    content: 'signup  — Create a new account\nlogin   — Sign in with email & password\ngoogle  — Sign in with Google (opens browser)',
    timestamp: new Date(),
  },
];

const WELCOME_MESSAGES: Message[] = [
  {
    id: 'welcome',
    role: 'system',
    content: 'Session started. Type a message and press Enter to begin.',
    timestamp: new Date(),
  },
];

type Props = { isAuthenticated: boolean; sessionId?: string; onRequestAuth?: (choice: 'signup' | 'login' | 'google') => void };

export default function App({ isAuthenticated, sessionId, onRequestAuth }: Props) {
  const { exit } = useApp();

  const [screen, setScreen]         = useState<Screen>(isAuthenticated ? 'welcome' : 'login');

  /** Single engine instance lives for the lifetime of the app. */
  const engineRef = useRef<Engine>(new Engine(sessionId));

  const initialMessages = (): Message[] => {
    if (!isAuthenticated) return LOGIN_MESSAGES;
    if (sessionId) {
      const history = engineRef.current.getVisibleHistory();
      if (history.length > 0) {
        return [
          {
            id: 'resume-note',
            role: 'system' as MessageRole,
            content: `Session resumed — ${history.length} message${history.length !== 1 ? 's' : ''} loaded.`,
            timestamp: new Date(),
          },
          ...history.map((t, i) => ({
            id: `resume-${i}`,
            role: t.role as MessageRole,
            content: t.content,
            timestamp: new Date(),
          })),
        ];
      }
    }
    return WELCOME_MESSAGES;
  };

  const [messages, setMessages]     = useState<Message[]>(initialMessages);
  const [input, setInput]           = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [assistantLabel, setAssistantLabel] = useState<string>(engineRef.current.getAssistantLabel());

  const currentSessionId = engineRef.current.id;

  /**
   * Command history — oldest first, matching classic shell behaviour.
   * historyIndex: -1 = current draft, 0 = most-recent entry, 1 = one before, …
   */
  const historyRef      = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  /** Saves the user's in-progress draft before they start navigating up. */
  const savedDraftRef   = useRef<string>('');

  useInput((ch: string, key: Key) => {
    // Global: ctrl+c always exits
    if (key.ctrl && ch === 'c') {
      exit();
      return;
    }

    // Login screen: Ctrl+C exits (already handled above); block history navigation
    if (screen === 'login') {
      // InputBar handles its own text input; nothing else needed here
      return;
    }

    // Welcome screen: any Enter press advances to chat
    if (screen === 'welcome' && key.return) {
      setScreen('chat');
      return;
    }

    // Chat: ctrl+l clears messages and resets engine history
    if (screen === 'chat' && key.ctrl && ch === 'l') {
      engineRef.current.reset();
      setMessages(WELCOME_MESSAGES);
      setInput('');
      historyIndexRef.current = -1;
      savedDraftRef.current   = '';
      return;
    }

    // ── History navigation ────────────────────────────────────────────────────
    if (!isThinking && key.upArrow) {
      const hist = historyRef.current;
      if (hist.length === 0) return;
      // Save the current draft the first time the user presses Up
      if (historyIndexRef.current === -1) {
        savedDraftRef.current = input;
      }
      const newIndex = Math.min(historyIndexRef.current + 1, hist.length - 1);
      historyIndexRef.current = newIndex;
      // hist is oldest-first; index 0 = most recent
      setInput(hist[hist.length - 1 - newIndex] ?? '');
      return;
    }

    if (!isThinking && key.downArrow) {
      if (historyIndexRef.current === -1) return;   // already at the fresh prompt
      const newIndex = historyIndexRef.current - 1;
      historyIndexRef.current = newIndex;
      if (newIndex === -1) {
        setInput(savedDraftRef.current);             // restore the saved draft
      } else {
        const hist = historyRef.current;
        setInput(hist[hist.length - 1 - newIndex] ?? '');
      }
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────
  });

  const handleSubmit = useCallback(
    (value: string) => {
      if (!value.trim() || isThinking) return;

      const trimmed = value.trim();
      setInput('');

      // ── Login screen: parse auth choice ──────────────────────────────────
      if (screen === 'login') {
        const cmd = trimmed.toLowerCase().replace(/^fella\s+/, '');
        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: trimmed, timestamp: new Date() };

        let choice: 'signup' | 'login' | 'google' | null = null;
        if (cmd === 'signup')                                             choice = 'signup';
        else if (cmd === 'login')                                         choice = 'login';
        else if (cmd === 'google' || cmd === 'login --google')            choice = 'google';

        if (!choice) {
          setMessages((prev) => [
            ...prev,
            userMsg,
            { id: (Date.now() + 1).toString(), role: 'error', content: "Unknown option. Type  signup,  login, or  google.", timestamp: new Date() },
          ]);
          return;
        }

        setMessages((prev) => [...prev, userMsg]);
        onRequestAuth?.(choice);
        exit();
        return;
      }

      // Push to history (avoid consecutive duplicates, matching bash behaviour)
      const hist = historyRef.current;
      if (hist.length === 0 || hist[hist.length - 1] !== trimmed) {
        historyRef.current = [...hist, trimmed];
      }
      // Reset navigation cursor and saved draft
      historyIndexRef.current = -1;
      savedDraftRef.current   = '';

      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsThinking(true);

      let liveStep = 0;

      // Send to the Ollama engine and display the reply
      engineRef.current
        .send(trimmed, (step) => {
          liveStep += 1;

          // ── Filter verbose browser logs ──────────────────────────────────
          // Never show raw accessibility tree data (rowgroup, gridcell, refs)
          // to the user. Show only clean one-line step summaries.
          const isBrowserStep = step.tool === 'browserAutomation';
          const rawResult =
            typeof step.result === 'string'
              ? step.result
              : JSON.stringify(step.result);

          // Detect accessibility tree noise in results
          const isBrowserVerbose =
            /\[ref=e\d+\]/.test(rawResult) ||
            /\browgroup\b/i.test(rawResult) ||
            /\bgridcell\b/i.test(rawResult) ||
            rawResult.length > 500;

          let displayContent: string;
          if (isBrowserStep && isBrowserVerbose) {
            // For browser steps with verbose output, show only the status
            displayContent = `Step ${liveStep} — ${step.tool} ${step.success ? '✓' : '✕'}`;
          } else {
            // For other steps, show a compact result
            const truncatedResult = rawResult.length > 200
              ? rawResult.slice(0, 200) + '…'
              : rawResult;
            displayContent = `Step ${liveStep} — ${step.tool} ${step.success ? '✓' : '✕'}\n${truncatedResult}`;
          }

          const stepMessage: Message = {
            id: `${Date.now()}-step-${liveStep}`,
            role: 'system',
            content: displayContent,
            timestamp: new Date(),
          };

          setMessages((prev) => [...prev, stepMessage]);
          setAssistantLabel(engineRef.current.getAssistantLabel());
        })
        .then((reply) => {
          const assistantMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: reply,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setAssistantLabel(engineRef.current.getAssistantLabel());
        })
        .catch((err: unknown) => {
          const errorMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: 'error',
            content: err instanceof Error ? err.message : 'Unknown error',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, errorMsg]);
          setAssistantLabel(engineRef.current.getAssistantLabel());
        })
        .finally(() => {
          setIsThinking(false);
          setAssistantLabel(engineRef.current.getAssistantLabel());
        });
    },
    [isThinking],
  );

  return (
    <Box flexDirection="column">
      {/* Branding header — always visible */}
      <Header />

      {screen === 'login' ? (
        /* ── Login screen ── */
        <>
          <MessageList messages={messages} isThinking={false} />
          <InputBar value={input} onChange={setInput} onSubmit={handleSubmit} isThinking={false} />
          <StatusBar sessionId={currentSessionId} />
        </>
      ) : screen === 'welcome' ? (
        /* ── Welcome splash ── */
        <Box flexDirection="column" alignItems="center" gap={1} marginTop={1}>
          <Text color="#4CAF50" bold>✔  Login successful.</Text>
          <Text color="#888888">
            Press <Text color="white" bold>Enter</Text> to continue
          </Text>
        </Box>
      ) : (
        /* ── Chat interface ── */
        <>
          <MessageList
            messages={messages}
            isThinking={isThinking}
            assistantLabel={assistantLabel}
          />
        </>
      )}

      {screen === 'chat' && (
        <>
          <InputBar
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            isThinking={isThinking}
          />
          <StatusBar sessionId={currentSessionId} />
        </>
      )}
    </Box>
  );
}
