import React from 'react';
import { Box, Text } from 'ink';
import RawTextInput from 'ink-text-input';

const TextInput = RawTextInput.default || RawTextInput;

export default function InputBar({ value, onChange, onSubmit, isThinking }) {
  return (
    <Box flexDirection="column">
      <Text color="#333333">{'─'.repeat(60)}</Text>
      <Box flexDirection="row" gap={1} paddingX={1} paddingY={0}>
        <Text color={isThinking ? '#555555' : '#6CB6FF'} bold>
          ❯
        </Text>
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
