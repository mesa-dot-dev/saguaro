import type { InputRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useRef, useState } from 'react';
import { getCompletions, parseCommand } from '../lib/commands.js';
import { useInputBarContext } from '../lib/input-bar-context.js';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

export function InputBar({ focused }: { focused: boolean }) {
  const { navigate } = useRouter();
  const { screenInput } = useInputBarContext();
  const [value, setValue] = useState('');
  const [completions, setCompletions] = useState<string[]>([]);
  const inputRef = useRef<InputRenderable>(null);

  useKeyboard((e) => {
    if (!focused) return;
    if (screenInput) return;
    if (e.name === 'tab' && completions.length > 0) {
      const completed = completions[0];
      setValue(completed);
      if (inputRef.current) {
        inputRef.current.value = completed;
      }
      setCompletions(getCompletions(completed));
    }
  });

  const handleInput = (text: string) => {
    setValue(text);
    if (screenInput) {
      setCompletions([]);
      return;
    }
    if (text.startsWith('/')) {
      setCompletions(getCompletions(text));
    } else {
      setCompletions([]);
    }
  };

  const handleSubmit = () => {
    const current = inputRef.current?.value ?? value;

    if (screenInput) {
      screenInput.onSubmit(current);
      setValue('');
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      return;
    }

    const input = current.startsWith('/') ? current : `/${current}`;
    const route = parseCommand(input);
    if (route) {
      navigate(route);
    }
    setValue('');
    setCompletions([]);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const placeholder = screenInput ? screenInput.placeholder : 'type a command...';

  return (
    <box flexDirection="column" width="100%">
      {focused && !screenInput && completions.length > 0 && (
        <box flexDirection="row" paddingLeft={2} gap={1}>
          {completions.slice(0, 5).map((c) => (
            <text key={c} fg={theme.textDim}>
              {c}
            </text>
          ))}
        </box>
      )}
      <box
        flexDirection="row"
        paddingLeft={1}
        borderStyle="single"
        borderColor={focused ? theme.accent : theme.border}
        width="100%"
      >
        <input
          ref={inputRef}
          focused={focused}
          value={value}
          placeholder={placeholder}
          textColor={theme.text}
          placeholderColor={theme.textDim}
          cursorColor={theme.accent}
          flexGrow={1}
          onInput={handleInput}
          onSubmit={handleSubmit}
        />
      </box>
    </box>
  );
}
