import { useKeyboard } from '@opentui/react';
import { useState } from 'react';
import { InputBar } from './components/input-bar.js';
import { exitTui } from './lib/exit.js';
import { InputBarProvider, useInputBarContext } from './lib/input-bar-context.js';
import { RouterProvider, useRouter } from './lib/router.js';
import { ConfigureScreen } from './screens/configure.js';
import { DaemonStatsScreen } from './screens/daemon-stats/index.js';
import { HelpScreen } from './screens/help.js';
import { HomeScreen } from './screens/home.js';
import { HookScreen } from './screens/hook.js';
import { IndexBuildScreen } from './screens/index-build.js';
import { InitScreen } from './screens/init.js';
import { ModelScreen } from './screens/model.js';
import { ReviewScreen } from './screens/review.js';
import { ReviewHubScreen } from './screens/review-hub.js';
import { ReviewResultsScreen } from './screens/review-results.js';
import { RulesCreateScreen } from './screens/rules-create.js';
import { RulesDeleteScreen } from './screens/rules-delete.js';
import { RulesExplainScreen } from './screens/rules-explain.js';
import { RulesGenerateScreen } from './screens/rules-generate.js';
import { RulesHubScreen } from './screens/rules-hub.js';
import { RulesListScreen } from './screens/rules-list.js';
import { RulesValidateScreen } from './screens/rules-validate.js';
import { StatsScreen } from './screens/stats.js';

function ScreenRouter() {
  const { route } = useRouter();

  switch (route.screen) {
    case 'home':
      return <HomeScreen />;
    case 'review-hub':
      return <ReviewHubScreen />;
    case 'review':
      return <ReviewScreen baseRef={route.baseRef} headRef={route.headRef} mode={route.mode} />;
    case 'review-results':
      return <ReviewResultsScreen result={route.result} />;
    case 'rules':
      return <RulesHubScreen />;
    case 'rules-list':
      return <RulesListScreen />;
    case 'rules-explain':
      return <RulesExplainScreen ruleId={route.ruleId} />;
    case 'rules-create':
      return <RulesCreateScreen />;
    case 'rules-generate':
      return <RulesGenerateScreen />;
    case 'rules-validate':
      return <RulesValidateScreen />;
    case 'rules-delete':
      return <RulesDeleteScreen ruleId={route.ruleId} />;
    case 'model':
      return <ModelScreen />;
    case 'stats':
      return <StatsScreen />;
    case 'daemon-stats':
      return <DaemonStatsScreen />;
    case 'configure':
      return <ConfigureScreen />;
    case 'init':
      return <InitScreen />;
    case 'index':
      return <IndexBuildScreen />;
    case 'hook':
      return <HookScreen action={route.action} />;
    case 'help':
      return <HelpScreen />;
  }
}

function AppShell() {
  const { route, navigate, goHome } = useRouter();
  const [inputFocused, setInputFocused] = useState(false);
  const { screenInput } = useInputBarContext();

  useKeyboard((e) => {
    // When a screen owns the input, suppress all global shortcuts
    if (screenInput) return;

    if (inputFocused) {
      if (e.name === 'escape') {
        setInputFocused(false);
      }
      return;
    }

    if (e.name === '/') {
      setInputFocused(true);
      return;
    }
    if (e.name === '?') {
      navigate({ screen: 'help' });
      return;
    }
    if (e.name === 'escape' && route.screen !== 'home') {
      goHome();
      return;
    }
    if (e.name === 'q' && route.screen === 'home') {
      exitTui();
    }
  });

  const isInputFocused = screenInput ? true : inputFocused;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexGrow={1}>
        <ScreenRouter />
      </box>
      <InputBar focused={isInputFocused} />
    </box>
  );
}

export function App() {
  return (
    <InputBarProvider>
      <RouterProvider>
        <AppShell />
      </RouterProvider>
    </InputBarProvider>
  );
}
