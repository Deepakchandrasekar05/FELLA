import React from 'react';
import { Box, Text } from 'ink';
import RawSpinner from 'ink-spinner';

const Spinner = RawSpinner.default || RawSpinner;

const ROLE_STYLES = {
  user:      { prefix: '❯',  prefixColor: '#6CB6FF', textColor: 'white'   },
  assistant: { prefix: '◆',  prefixColor: '#E8865A', textColor: '#DEDEDE' },
  system:    { prefix: '·',  prefixColor: '#555555', textColor: '#666666' },
  error:     { prefix: '✕',  prefixColor: '#FF6B6B', textColor: '#FF6B6B' },
};

function sanitizeForTuiLabel(label) {
  return String(label || 'fella').replace(/C:\\Users\\[^\\)]+/gi, 'C:\\Users');
}

function sanitizeContent(role, content) {
  if (role !== 'system') return content;
  const lines = String(content || '').split('\n');
  const filtered = lines.filter((line) => {
    if (/\[ref=e\d+\]/.test(line) && /\b(rowgroup|gridcell|generic|row)\b/i.test(line)) return false;
    if (/^\s*-\s*$/.test(line)) return false;
    return true;
  });
  const result = filtered.join('\n').trim();
  return result.length > 300 ? `${result.slice(0, 300)}…` : result;
}

function MessageItem({ message, assistantLabel }) {
  const style = ROLE_STYLES[message.role] || ROLE_STYLES.system;
  const visibleAssistantLabel = sanitizeForTuiLabel(assistantLabel);
  const displayContent = sanitizeContent(message.role, message.content);

  return (
    <Box flexDirection="row" marginBottom={1} gap={1}>
      <Box width={3} flexShrink={0} justifyContent="flex-end">
        <Text color={style.prefixColor} bold>
          {style.prefix}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {message.role !== 'system' && (
          <Text
            color={style.prefixColor}
            bold
            dimColor={message.role === 'assistant'}
          >
            {message.role === 'user' ? 'you' : visibleAssistantLabel}
          </Text>
        )}
        <Text color={style.textColor} wrap="wrap">
          {displayContent}
        </Text>
      </Box>
    </Box>
  );
}

function ThinkingIndicator() {
  return (
    <Box flexDirection="row" gap={1} marginBottom={1}>
      <Box width={3} flexShrink={0} justifyContent="flex-end">
        <Text color="#E8865A">◆</Text>
      </Box>
      <Box gap={1}>
        <Text color="#E8865A">
          <Spinner type="dots" />
        </Text>
        <Text color="#666666">fella is thinking…</Text>
      </Box>
    </Box>
  );
}

export default function MessageList({ messages, isThinking, assistantLabel = 'fella' }) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} marginBottom={1}>
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} assistantLabel={assistantLabel} />
      ))}
      {isThinking && <ThinkingIndicator />}
    </Box>
  );
}
