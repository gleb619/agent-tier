import { Match, Switch } from 'solid-js';
import type { JSX } from 'solid-js';
import { selectedRunId } from '../../tui/store/sessions';
import { activeView, focusZone, showPromptOverlay } from '../store/ui';
import { Dashboard } from './Dashboard';
import { NewTask } from './NewTask';
import { RunDetails } from './RunDetails';
import { Settings } from './Settings';

/** Right column: renders the view picked by `activeView` (design doc §4.2). */
export function MainView(): JSX.Element {
  return (
    <Switch>
      <Match when={activeView() === 'dashboard'}>
        <Dashboard />
      </Match>
      <Match when={activeView() === 'new-task'}>
        <NewTask focused={focusZone() === 'prompt'} />
      </Match>
      <Match when={activeView() === 'run-details'}>
        <RunDetails
          runId={selectedRunId()}
          focused={focusZone() === 'log'}
          showPrompt={showPromptOverlay()}
        />
      </Match>
      <Match when={activeView() === 'settings'}>
        <Settings focused={focusZone() === 'settings'} />
      </Match>
    </Switch>
  );
}
