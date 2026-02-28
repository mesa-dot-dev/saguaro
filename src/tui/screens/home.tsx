import type { SelectOption } from '@opentui/core';
import type { Route } from '../lib/router.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

const CACTUS = `%%%%%%%%%%%%%###********###%%%%%%%%%%%%%
%%%%%%%%%#*******************##%%%%%%%%%
%%%%%%%*************************#%%%%%%%
%%%%%*************=--+************#%%%%%
%%%#************=.-++:.+***********#%%%%
%%#*************-.+**=.=*************%%%
%#**************-..::..=***----******#%%
%###############-......=#*:-#*:=#######%
################-......=#*:.==.-#######%
########*:::-*##-......-*+.....=########
########:=##:=##-..............#########
########:.::.=##-............-*#########
########-....:=+:.........-+*##########%
%#######*:.............:*##############%
%########*-............=##############%%
%%##########=-::.......=#############%%%
%%%#############:......=############%%%%
%%%%%###########-......=###########%%%%%
%%%%%%%#########-......=#########%%%%%%%
%%%%%%%%%%######-......=######%%%%%%%%%%
%%%%%%%%%%%%%%%#-:...::+%%%%%%%%%%%%%%%%`;

const menuOptions: (SelectOption & { route: Route })[] = [
  { name: 'Review', description: 'Run a code review against your rules', route: { screen: 'review' } },
  { name: 'Index', description: 'Build the codebase import graph', route: { screen: 'index' } },
  { name: 'Rules', description: 'Manage review rules', route: { screen: 'rules' } },
  { name: 'Stats', description: 'View review analytics', route: { screen: 'stats' } },
  { name: 'Model', description: 'Switch AI model', route: { screen: 'model' } },
  { name: 'Init', description: 'Set up Mesa in your repo', route: { screen: 'init' } },
  { name: 'Hooks', description: 'Manage Claude Code hooks', route: { screen: 'hook' } },
  { name: 'Help', description: 'Show all commands and keybindings', route: { screen: 'help' } },
];

export function HomeScreen() {
  const { navigate } = useRouter();

  const handleSelect = (index: number, _option: SelectOption | null) => {
    const entry = menuOptions[index];
    if (entry) navigate(entry.route);
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="column" alignItems="center" paddingTop={1} paddingBottom={1}>
        <text fg={theme.accentDim}>{CACTUS}</text>
        <text fg={theme.textDim}>Mesa</text>
        <text fg={theme.textDim}>Infrastructure for the next generation of AI-native software development</text>
      </box>

      <box flexDirection="column" paddingLeft={2} flexGrow={1}>
        <select focused flexGrow={1} options={menuOptions} {...selectColors} onSelect={handleSelect} />
      </box>

      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>↑↓ navigate · enter select · / commands · q quit</text>
      </box>
    </box>
  );
}
