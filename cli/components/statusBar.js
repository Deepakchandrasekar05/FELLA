import React from 'react';
import { Box, Text } from 'ink';

const h = React.createElement;

const SHORTCUTS = [
  { keys: 'ctrl+c',   label: 'exit'  },
  { keys: 'ctrl+l',   label: 'clear' },
  { keys: 'enter',    label: 'send'  },
  { keys: '?',        label: 'help'  },
];

export default function StatusBar({ sessionId }) {
  return h(Box, {
    paddingX: 1,
    paddingY: 0,
    gap: 2,
    marginTop: 0,
    justifyContent: 'space-between',
  },
    h(Box, { gap: 2 },
      SHORTCUTS.map(({ keys, label }) =>
        h(Box, { key: keys, gap: 1 },
          h(Box, { borderStyle: 'single', borderColor: '#444444', paddingX: 1 },
            h(Text, { color: '#888888' }, keys)
          ),
          h(Text, { color: '#555555' }, label)
        )
      )
    ),
    sessionId ? h(Text, { color: '#444444' }, sessionId) : null
  );
}
