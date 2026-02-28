import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export interface ScreenInputConfig {
  placeholder: string;
  onSubmit: (value: string) => void;
}

interface InputBarContextValue {
  screenInput: ScreenInputConfig | null;
  setScreenInput: (config: ScreenInputConfig | null) => void;
}

const InputBarContext = createContext<InputBarContextValue | null>(null);

export function InputBarProvider({ children }: { children: React.ReactNode }) {
  const [screenInput, setScreenInput] = useState<ScreenInputConfig | null>(null);
  const value = useMemo(() => ({ screenInput, setScreenInput }), [screenInput]);
  return <InputBarContext.Provider value={value}>{children}</InputBarContext.Provider>;
}

export function useInputBarContext(): InputBarContextValue {
  const ctx = useContext(InputBarContext);
  if (!ctx) throw new Error('useInputBarContext must be used within InputBarProvider');
  return ctx;
}

/**
 * Hook for screens to claim the InputBar as their text input.
 * While active, the InputBar shows the screen's placeholder and routes
 * Enter to the screen's onSubmit. Automatically releases on unmount.
 */
export function useScreenInput(config: ScreenInputConfig | null) {
  const { setScreenInput } = useInputBarContext();
  useEffect(() => {
    setScreenInput(config);
    return () => setScreenInput(null);
  }, [config, setScreenInput]);
}
