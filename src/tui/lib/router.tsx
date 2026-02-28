import type { ReviewResult } from '@mesa/code-review';
import { createContext, useCallback, useContext, useState } from 'react';

export type Route =
  | { screen: 'home' }
  | { screen: 'review'; baseRef?: string; headRef?: string }
  | { screen: 'review-results'; result: ReviewResult }
  | { screen: 'rules' }
  | { screen: 'rules-list' }
  | { screen: 'rules-explain'; ruleId: string }
  | { screen: 'rules-create' }
  | { screen: 'rules-generate' }
  | { screen: 'rules-validate' }
  | { screen: 'rules-delete'; ruleId: string }
  | { screen: 'model' }
  | { screen: 'stats' }
  | { screen: 'init' }
  | { screen: 'index' }
  | { screen: 'hook'; action?: 'install' | 'uninstall' }
  | { screen: 'help' };

interface RouterContextValue {
  route: Route;
  navigate: (route: Route) => void;
  goHome: () => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>({ screen: 'home' });

  const navigate = useCallback((r: Route) => setRoute(r), []);
  const goHome = useCallback(() => setRoute({ screen: 'home' }), []);

  return <RouterContext.Provider value={{ route, navigate, goHome }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
