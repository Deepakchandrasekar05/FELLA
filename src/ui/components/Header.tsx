import React from 'react';
import { Box, Text } from 'ink';

// ── Logo ──────────────────────────────────────────────────────────────────────

const LOGO_LINES = [
  '███████╗ ███████╗ ██╗      ██╗       █████╗ ',
  '██╔════╝ ██╔════╝ ██║      ██║      ██╔══██╗',
  '█████╗   █████╗   ██║      ██║      ███████║',
  '██╔══╝   ██╔══╝   ██║      ██║      ██╔══██║',
  '██║      ███████╗ ███████╗ ███████╗ ██║  ██║',
  '╚═╝      ╚══════╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝',
];

// Light pastel gradient: white → sky → lavender → lilac
const LOGO_COLORS = ['#bbe2fd', '#a9d7fc', '#a0cafd', '#66b9fd', '#49b9ff', '#44a8fb'];


// ── Component ─────────────────────────────────────────────────────────────────

export default function Header() {
  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={1}>

      {/* ── Left: text content ── */}
      <Box flexDirection="column">

        {/* Big logo */}
        <Box flexDirection="column">
          {LOGO_LINES.map((line, i) => (
            <Text key={i} color={LOGO_COLORS[i] ?? '#ffffff'} bold>{line}</Text>
          ))}
        </Box>

        {/* Subtitle + badges */}
        <Box marginTop={1} gap={1} alignItems="center">
          <Text color="#aaaaaa">◆ File Exploration and Local Logic Automation ◆</Text>
          <Box borderStyle="round" borderColor="#88aacc" paddingX={1}>
            <Text color="#cce8ff">An Agentic CLI</Text>
          </Box>
          <Box borderStyle="round" borderColor="#c5b8ff" paddingX={1}>
            <Text color="#e8c5ff" bold>v1.0</Text>
          </Box>
        </Box>

      </Box>

    </Box>
  );
}

