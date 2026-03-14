import React from 'react';
import { Box, Text } from 'ink';

type Shortcut = {
  keys: string;
  label: string;
};

const SHORTCUTS: Shortcut[] = [
  { keys: 'ctrl+c',   label: 'exit'       },
  { keys: 'ctrl+l',   label: 'clear'      },
  { keys: 'enter',    label: 'send'       },
  { keys: '?',        label: 'help'       },
];

type Props = {
  sessionId?: string;
};

export default function StatusBar({ sessionId }: Props) {
  return (
    <Box
      paddingX={1}
      paddingY={0}
      gap={2}
      marginTop={0}
      justifyContent="space-between"
    >
      <Box gap={2}>
        {SHORTCUTS.map(({ keys, label }) => (
          <Box key={keys} gap={1}>
            <Box borderStyle="single" borderColor="#444444" paddingX={1}>
              <Text color="#888888">{keys}</Text>
            </Box>
            <Text color="#555555">{label}</Text>
          </Box>
        ))}
      </Box>
      {sessionId && (
        <Text color="#444444">{sessionId}</Text>
      )}
    </Box>
  );
}
