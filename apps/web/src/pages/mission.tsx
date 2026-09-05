import type { CurrentUser } from '@reforger-panel/shared';
import { usePrimaryServer } from '../api/hooks.js';
import { PageHeader, Spinner } from '../components/ui.js';
import { MissionCard } from '../components/mission-card.js';

export function MissionPage({ user }: { user: CurrentUser }) {
  const server = usePrimaryServer();
  if (!server) return <Spinner />;
  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Mission"
        kicker="Vanilla scenarios plus everything the installed mods ship. Switching writes game.scenarioId and takes effect on the next restart."
      />
      <MissionCard slug={server.slug} canEdit={user.capabilities.includes('config.edit')} />
    </div>
  );
}
