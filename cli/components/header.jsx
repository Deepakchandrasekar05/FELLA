import React from 'react';
import { Box, Text } from 'ink';

const LOGO_LINES = [
  '███████╗ ███████╗ ██╗      ██╗       █████╗ ',
  '██╔════╝ ██╔════╝ ██║      ██║      ██╔══██╗',
  '█████╗   █████╗   ██║      ██║      ███████║',
  '██╔══╝   ██╔══╝   ██║      ██║      ██╔══██║',
  '██║      ███████╗ ███████╗ ███████╗ ██║  ██║',
  '╚═╝      ╚══════╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝',
];

const LOGO_COLORS = ['#bbe2fd', '#a9d7fc', '#a0cafd', '#66b9fd', '#49b9ff', '#44a8fb'];

export default function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column">
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={LOGO_COLORS[i] ?? '#ffffff'} bold>
            {line}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} gap={1} alignItems="center">
        <Text color="#aaaaaa">◆ File Exploration and Local Logic Automation ◆</Text>
        <Box borderStyle="round" borderColor="#88aacc" paddingX={1}>
          <Text color="#cce8ff">An Agentic CLI</Text>
        </Box>
        <Box borderStyle="round" borderColor="#c5b8ff" paddingX={1}>
          <Text color="#e8c5ff" bold>v2.0</Text>
        </Box>
      </Box>
    </Box>
  );
}
