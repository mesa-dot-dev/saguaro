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
  { name: 'Review', description: 'Run reviews and build index', route: { screen: 'review-hub' } },
  { name: 'Rules', description: 'Manage review rules', route: { screen: 'rules' } },
  { name: 'Stats', description: 'View review analytics', route: { screen: 'stats' } },
  { name: 'Daemon', description: 'View daemon analytics', route: { screen: 'daemon-stats' } },
  { name: 'Model', description: 'Switch AI model', route: { screen: 'model' } },
  { name: 'Configure', description: 'Index, hooks, and project setup', route: { screen: 'configure' } },
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
        <text fg={theme.textDim}>Saguaro</text>
        <text fg={theme.textDim}>Infrastructure for the next generation of AI-native software development</text>
      </box>

      <box flexDirection="column" paddingLeft={2} flexGrow={1} flexShrink={0} minHeight={13}>
        <select focused flexGrow={1} options={menuOptions} {...selectColors} onSelect={handleSelect} />
      </box>

      <box paddingLeft={2} paddingBottom={1} flexShrink={0}>
        <text fg={theme.textDim}>↑↓ navigate · enter select · / commands · q quit</text>
      </box>
    </box>
  );
}
