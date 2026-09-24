import React from 'react';
import { Box, Text } from 'ink';
import RawTextInput from 'ink-text-input';

const TextInput = RawTextInput.default || RawTextInput;
const h = React.createElement;

export default function InputBar({ value, onChange, onSubmit, isThinking }) {
  return h(Box, { flexDirection: 'column' },
    h(Text, { color: '#333333' }, '─'.repeat(60)),
    h(Box, { flexDirection: 'row', gap: 1, paddingX: 1, paddingY: 0 },
      h(Text, { color: isThinking ? '#555555' : '#6CB6FF', bold: true }, '❯'),
      isThinking
        ? h(Text, { color: '#555555' }, 'waiting for response…')
        : h(TextInput, {
            value,
            onChange,
            onSubmit,
            placeholder: 'Ask fella anything…',
          })
    )
  );
}
