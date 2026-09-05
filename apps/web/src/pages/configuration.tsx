import { useState } from 'react';
import type { CurrentUser } from '@reforger-panel/shared';
import { useConfiguration, usePrimaryServer } from '../api/hooks.js';
import { formatRelativeTime } from '../lib/format.js';
import { Card, EmptyState, PageHeader, SegmentedControl, Spinner } from '../components/ui.js';
import { ConfigKeyEditor } from '../components/config/key-editor.js';
import { ConfigRawEditor } from '../components/config/raw-editor.js';
import { PerformanceForm } from '../components/performance-form.js';
import { StartupVarsCard } from '../components/startup-vars-card.js';
import { SchedulesCard } from '../components/schedules-card.js';
import { ConfigSummaryRows } from '../components/widgets.js';

type Tab = 'settings' | 'keys' | 'raw' | 'startup' | 'schedules';

export function ConfigurationPage({ user }: { user: CurrentUser }) {
  const server = usePrimaryServer();
  if (!server) return <Spinner />;
  return <ConfigurationBody slug={server.slug} user={user} />;
}

function ConfigurationBody({ slug, user }: { slug: string; user: CurrentUser }) {
  const canEdit = user.capabilities.includes('config.edit');
  const [tab, setTab] = useState<Tab>('settings');
  const { data: config } = useConfiguration(slug);

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Configuration"
        kicker={
          <>
            Edits are written straight to the server&rsquo;s config.json, verified by reading it
            back, and rejected if the file changed since this page loaded.
            {config && ` Read ${formatRelativeTime(config.fetchedAt)}.`}
          </>
        }
      />

      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'settings', label: 'Settings', icon: 'sliders' },
          { value: 'keys', label: 'All keys', icon: 'search' },
          { value: 'raw', label: 'Raw JSON', icon: 'terminal' },
          { value: 'startup', label: 'Startup variables', icon: 'server' },
          { value: 'schedules', label: 'Restarts', icon: 'restart' },
        ]}
      />

      {tab === 'settings' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Performance settings" className="lg:col-span-2">
            <PerformanceForm slug={slug} canEdit={canEdit} />
          </Card>
          <Card title="Live summary">
            {config ? <ConfigSummaryRows config={config} /> : <Spinner />}
          </Card>
        </div>
      )}

      {tab === 'keys' && (
        <Card title="Every key in config.json">
          <ConfigKeyEditor slug={slug} canEdit={canEdit} />
        </Card>
      )}

      {tab === 'raw' && (
        <Card title="config.json">
          <ConfigRawEditor slug={slug} canEdit={canEdit} />
        </Card>
      )}

      {tab === 'startup' &&
        (canEdit ? (
          <StartupVarsCard slug={slug} />
        ) : (
          <EmptyState icon="lock" title="Startup variables are restricted to admins" />
        ))}

      {tab === 'schedules' && <SchedulesCard slug={slug} canEdit={canEdit} />}
    </div>
  );
}
