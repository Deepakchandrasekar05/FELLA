import React from 'react';
import { Box, Text } from 'ink';
import { CAT_ART } from './catArt.js';

function renderCell(cell, x) {
  if (cell.t === 's') return <Text key={x}> </Text>;
  if (cell.t === 'f') return <Text key={x} color={cell.fg} backgroundColor={cell.bg}>▄</Text>;
  if (cell.t === 'l') return <Text key={x} color={cell.fg}>▄</Text>;
  return <Text key={x} color={cell.fg}>▀</Text>;
}

export function FellaLogo() {
  return (
    <Box flexDirection="column">
      {CAT_ART.map((row, y) => (
        <Box key={y}>
          {row.map((cell, x) => renderCell(cell, x))}
        </Box>
      ))}
    </Box>
  );
}

export default FellaLogo;
