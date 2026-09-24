import React from 'react';
import { Box, Text } from 'ink';
import { CAT_ART } from './catArt.js';

const h = React.createElement;

function renderCell(cell, x) {
  if (cell.t === 's') return h(Text, { key: x }, ' ');
  if (cell.t === 'f') return h(Text, { key: x, color: cell.fg, backgroundColor: cell.bg }, '▄');
  if (cell.t === 'l') return h(Text, { key: x, color: cell.fg }, '▄');
  return h(Text, { key: x, color: cell.fg }, '▀');
}

export function FellaLogo() {
  return h(Box, { flexDirection: 'column' },
    CAT_ART.map((row, y) =>
      h(Box, { key: y },
        row.map((cell, x) => renderCell(cell, x))
      )
    )
  );
}

export default FellaLogo;
