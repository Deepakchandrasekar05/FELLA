import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isThinking: boolean;
};

export default function InputBar({ value, onChange, onSubmit, isThinking }: Props) {
  return (
    <Box flexDirection="column">
      {/* Top border of input area */}
      <Text color="#333333">{'─'.repeat(60)}</Text>

      <Box flexDirection="row" gap={1} paddingX={1} paddingY={0}>
        {/* Prompt glyph */}
        <Text color={isThinking ? '#555555' : '#6CB6FF'} bold>
          ❯
        </Text>

        {/* Text input */}
        {isThinking ? (
          <Text color="#555555">waiting for response…</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder="Ask fella anything…"
          />
        )}
      </Box>
    </Box>
  );
}
