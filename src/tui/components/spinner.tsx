import { useEffect, useState } from 'react';
import { theme } from '../lib/theme.js';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ label }: { label: string }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <text fg={theme.accent}>
      {frames[frameIndex]} {label}
    </text>
  );
}
