import React from 'react';
import { Box, Text } from 'ink';

const h = React.createElement;

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
  return h(Box, { flexDirection: 'column', marginBottom: 1 },
    h(Box, { flexDirection: 'column' },
      LOGO_LINES.map((line, i) =>
        h(Text, { key: i, color: LOGO_COLORS[i] ?? '#ffffff', bold: true }, line)
      )
    ),
    h(Box, { marginTop: 1, gap: 1, alignItems: 'center' },
      h(Text, { color: '#aaaaaa' }, '◆ File Exploration and Local Logic Automation ◆'),
      h(Box, { borderStyle: 'round', borderColor: '#88aacc', paddingX: 1 },
        h(Text, { color: '#cce8ff' }, 'An Agentic CLI')
      ),
      h(Box, { borderStyle: 'round', borderColor: '#c5b8ff', paddingX: 1 },
        h(Text, { color: '#e8c5ff', bold: true }, 'v2.0')
      )
    )
  );
}
