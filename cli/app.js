import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Header from './components/header.js';
import MessageList from './components/messageList.js';
import InputBar from './components/inputBar.js';
import StatusBar from './components/statusBar.js';
import { Engine } from '../server/execution/engine.js';

const h = React.createElement;

const WELCOME_MESSAGES = [
  {
    id: 'welcome-1',
    role: 'assistant',
    content: "Hey! I'm FELLA. Ask me to find, organise, or manage your files, or automate browser tasks.",
    timestamp: new Date(),
  },
  {
    id: 'welcome-2',
    role: 'system',
    content: 'Tip: Try "organise downloads by type", "find budget spreadsheets", or "open chrome". Type ? for help.',
    timestamp: new Date(),
  },
];

const AUTH_REQUIRED_MESSAGES = [
  {
    id: 'auth-1',
    role: 'system',
    content: 'Welcome to FELLA. Please sign in to continue.',
    timestamp: new Date(),
  },
  {
    id: 'auth-2',
    role: 'assistant',
    content:
      'Choose an authentication option below:\n\n' +
      '  1. fella signup         — create a new account with email\n' +
      '  2. fella login          — sign in with email and password\n' +
      '  3. fella login --google — sign in with your Google account in browser\n\n' +
      'Type  signup,  login, or  google  to begin.',
    timestamp: new Date(),
  },
];

export default function App({
  isAuthenticated = true,
  sessionId,
  onRequestAuth,
}) {
  const { exit } = useApp();

  const [screen, setScreen] = useState(isAuthenticated ? 'chat' : 'login');
  const [messages, setMessages] = useState(
    isAuthenticated ? WELCOME_MESSAGES : AUTH_REQUIRED_MESSAGES,
  );
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [assistantLabel, setAssistantLabel] = useState('fella');

  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new Engine(sessionId);
  }

  const currentSessionId = engineRef.current.id;

  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const savedDraftRef = useRef('');

  useEffect(() => {
    if (isAuthenticated) {
      setScreen('chat');
      setMessages(WELCOME_MESSAGES);
    } else {
      setScreen('login');
      setMessages(AUTH_REQUIRED_MESSAGES);
    }
  }, [isAuthenticated]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      exit();
      return;
    }

    if (screen === 'login') {
      return;
    }

    if (screen === 'welcome' && key.return) {
      setScreen('chat');
      return;
    }

    if (screen === 'chat' && key.ctrl && inputChar === 'l') {
      engineRef.current.reset();
      setMessages(WELCOME_MESSAGES);
      setInput('');
      historyIndexRef.current = -1;
      savedDraftRef.current = '';
      return;
    }

    // History navigation
    if (!isThinking && key.upArrow) {
      const hist = historyRef.current;
      if (hist.length === 0) return;
      if (historyIndexRef.current === -1) {
        savedDraftRef.current = input;
      }
      const newIndex = Math.min(historyIndexRef.current + 1, hist.length - 1);
      historyIndexRef.current = newIndex;
      setInput(hist[hist.length - 1 - newIndex] ?? '');
      return;
    }

    if (!isThinking && key.downArrow) {
      if (historyIndexRef.current === -1) return;
      const newIndex = historyIndexRef.current - 1;
      historyIndexRef.current = newIndex;
      if (newIndex === -1) {
        setInput(savedDraftRef.current);
      } else {
        const hist = historyRef.current;
        setInput(hist[hist.length - 1 - newIndex] ?? '');
      }
    }
  }, { isActive: Boolean(process.stdin && process.stdin.isTTY) });

  const handleSubmit = useCallback(
    (value) => {
      if (!value.trim() || isThinking) return;

      const trimmed = value.trim();
      setInput('');

      if (screen === 'login') {
        const cmd = trimmed.toLowerCase().replace(/^fella\s+/, '');
        const userMsg = { id: Date.now().toString(), role: 'user', content: trimmed, timestamp: new Date() };

        let choice = null;
        if (cmd === 'signup')                                  choice = 'signup';
        else if (cmd === 'login')                              choice = 'login';
        else if (cmd === 'google' || cmd === 'login --google') choice = 'google';

        if (!choice) {
          setMessages((prev) => [
            ...prev,
            userMsg,
            { id: (Date.now() + 1).toString(), role: 'error', content: 'Unknown option. Type  signup,  login, or  google.', timestamp: new Date() },
          ]);
          return;
        }

        setMessages((prev) => [...prev, userMsg]);
        onRequestAuth?.(choice);
        exit();
        return;
      }

      const hist = historyRef.current;
      if (hist.length === 0 || hist[hist.length - 1] !== trimmed) {
        historyRef.current = [...hist, trimmed];
      }
      historyIndexRef.current = -1;
      savedDraftRef.current = '';

      const userMsg = {
        id: Date.now().toString(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsThinking(true);

      let liveStep = 0;

      engineRef.current
        .send(trimmed, (step) => {
          liveStep += 1;
          const isBrowserStep = step.tool === 'browserAutomation';
          const rawResult =
            typeof step.result === 'string'
              ? step.result
              : JSON.stringify(step.result);

          const isBrowserVerbose =
            /\[ref=e\d+\]/.test(rawResult) ||
            /\browgroup\b/i.test(rawResult) ||
            /\bgridcell\b/i.test(rawResult) ||
            rawResult.length > 500;

          let displayContent;
          if (isBrowserStep && isBrowserVerbose) {
            displayContent = `Step ${liveStep} — ${step.tool} ${step.success ? '✓' : '✕'}`;
          } else {
            const truncatedResult = rawResult.length > 200
              ? `${rawResult.slice(0, 200)}…`
              : rawResult;
            displayContent = `Step ${liveStep} — ${step.tool} ${step.success ? '✓' : '✕'}\n${truncatedResult}`;
          }

          const stepMessage = {
            id: `${Date.now()}-step-${liveStep}`,
            role: 'system',
            content: displayContent,
            timestamp: new Date(),
          };

          setMessages((prev) => [...prev, stepMessage]);
          setAssistantLabel(engineRef.current.getAssistantLabel());
        })
        .then((reply) => {
          const assistantMsg = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: reply,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setAssistantLabel(engineRef.current.getAssistantLabel());
        })
        .catch((err) => {
          const errorMsg = {
            id: (Date.now() + 1).toString(),
            role: 'error',
            content: err instanceof Error ? err.message : String(err),
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
    [isThinking, screen, onRequestAuth, exit],
  );

  return h(Box, { flexDirection: 'column' },
    h(Header, null),
    screen === 'login'
      ? h(Box, { flexDirection: 'column' },
          h(MessageList, { messages, isThinking: false }),
          h(InputBar, { value: input, onChange: setInput, onSubmit: handleSubmit, isThinking: false }),
          h(StatusBar, { sessionId: currentSessionId })
        )
      : screen === 'welcome'
      ? h(Box, { flexDirection: 'column', alignItems: 'center', gap: 1, marginTop: 1 },
          h(Text, { color: '#4CAF50', bold: true }, '✔  Login successful.'),
          h(Text, { color: '#888888' },
            'Press ',
            h(Text, { color: 'white', bold: true }, 'Enter'),
            ' to continue'
          )
        )
      : h(Box, { flexDirection: 'column' },
          h(MessageList, {
            messages,
            isThinking,
            assistantLabel,
          }),
          h(InputBar, {
            value: input,
            onChange: setInput,
            onSubmit: handleSubmit,
            isThinking,
          }),
          h(StatusBar, { sessionId: currentSessionId })
        )
  );
}
