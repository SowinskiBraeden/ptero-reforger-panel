import { Link } from 'react-router-dom';
import type { CurrentUser, ResourceSample } from '@reforger-panel/shared';
import {
  useConfiguration,
  useResourceHistory,
  useServerResources,
  useServers,
} from '../api/hooks.js';
import { formatBytes, formatDuration } from '../lib/format.js';
import { Card, Spinner } from '../components/ui.js';
import { TimeSeriesChart } from '../components/charts.js';
import {
  ConfigSummaryRows,
  CurrentPlayersCard,
  OpsHealthCard,
  RecentActivityCard,
} from '../components/widgets.js';

export function OverviewPage({ user }: { user: CurrentUser }) {
  const { data: serversData, isLoading } = useServers();
  const server = serversData?.servers[0];

  if (isLoading) return <Spinner label="Loading dashboard…" />;
  if (!server) {
    return (
      <Card title="No servers">
        <p className="text-sm text-slate-ink">
          No servers found. Run <code className="font-mono text-accent-400">npm run db:seed</code>{' '}
          to create the training server.
        </p>
      </Card>
    );
  }
  return <Dashboard user={user} slug={server.slug} />;
}

function seriesOf(
  samples: ResourceSample[] | undefined,
  pick: (s: ResourceSample) => number,
): { t: number; v: number }[] {
  return (samples ?? []).map((s) => ({ t: s.t, v: pick(s) }));
}

function Dashboard({ user, slug }: { user: CurrentUser; slug: string }) {
  const { data: serversData } = useServers();
  const server = serversData?.servers.find((s) => s.slug === slug);
  const { data: resources } = useServerResources(slug);
  const { data: config } = useConfiguration(slug);
  const { data: history } = useResourceHistory(slug);
  if (!server) return null;

  const installedMods = config?.config.mods ?? [];
  const samples = history?.samples;
  const memoryLimit = resources?.memoryLimitBytes ?? samples?.at(-1)?.memoryLimitBytes ?? null;
  const cpuLimit = resources?.cpuLimitPercent ?? samples?.at(-1)?.cpuLimitPercent ?? 100;

  const diskUsed = resources?.diskBytes ?? null;
  const diskLimit = resources?.diskLimitBytes ?? null;
  const diskPercent = diskUsed !== null && diskLimit ? (diskUsed / diskLimit) * 100 : null;

  return (
    <div className="w-full space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="CPU">
          <p className="text-2xl font-semibold text-zinc-100">
            {resources ? `${resources.cpuPercent.toFixed(0)}%` : '—'}
            <span className="text-sm font-normal text-slate-dim">
              {cpuLimit && cpuLimit !== 100 ? ` / ${cpuLimit}%` : ''}
            </span>
          </p>
          <TimeSeriesChart
            className="mt-2"
            max={cpuLimit}
            series={[
              {
                points: seriesOf(samples, (s) => s.cpuPercent),
                color: 'var(--color-accent-400)',
              },
            ]}
          />
        </Card>

        <Card title="Memory">
          <p className="text-2xl font-semibold text-zinc-100">
            {resources ? formatBytes(resources.memoryBytes) : '—'}
            <span className="text-sm font-normal text-slate-dim">
              {memoryLimit ? ` / ${formatBytes(memoryLimit)}` : ''}
            </span>
          </p>
          <TimeSeriesChart
            className="mt-2"
            max={memoryLimit}
            series={[
              {
                points: seriesOf(samples, (s) => s.memoryBytes),
                color: '#7dd3fc',
              },
            ]}
          />
        </Card>

        <Card title="Network">
          <p className="text-sm text-zinc-300">
            <span className="text-accent-400">
              ↓ {formatBytes(samples?.at(-1)?.networkRxRate ?? 0)}/s
            </span>
            <span className="ml-3 text-warn-400">
              ↑ {formatBytes(samples?.at(-1)?.networkTxRate ?? 0)}/s
            </span>
            <span className="ml-3 text-slate-dim">
              up{' '}
              {resources && resources.uptimeMs > 0
                ? formatDuration(resources.uptimeMs / 1000)
                : '—'}
            </span>
          </p>
          <TimeSeriesChart
            className="mt-2"
            series={[
              {
                points: seriesOf(samples, (s) => s.networkRxRate),
                color: 'var(--color-accent-400)',
                label: 'rx',
              },
              {
                points: seriesOf(samples, (s) => s.networkTxRate),
                color: 'var(--color-warn-400)',
                fill: false,
                label: 'tx',
              },
            ]}
          />
        </Card>
        <Card title="Storage">
          <p className="text-2xl font-semibold text-zinc-100">
            {diskUsed !== null ? formatBytes(diskUsed) : '—'}
            <span className="text-sm font-normal text-slate-dim">
              {diskLimit ? ` / ${formatBytes(diskLimit)}` : ''}
            </span>
          </p>
          {diskPercent !== null && (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-graphite-800">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, diskPercent).toFixed(1)}%`,
                    backgroundColor:
                      diskPercent > 90
                        ? 'var(--color-danger-400)'
                        : diskPercent > 75
                          ? 'var(--color-warn-400)'
                          : '#a3e635',
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-dim">{diskPercent.toFixed(1)}% used</p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <CurrentPlayersCard slug={slug} maxPlayers={server.maxPlayers} />
          <RecentActivityCard slug={slug} />
        </div>
        <div className="min-w-0 space-y-5">
          <Card
            title="Current configuration"
            action={
              <Link to="/configuration" className="text-xs text-accent-400 hover:underline">
                View configuration
              </Link>
            }
          >
            {config ? <ConfigSummaryRows config={config} /> : <Spinner />}
          </Card>
          <Card
            title="Installed mods"
            action={
              <Link to="/mods" className="text-xs text-accent-400 hover:underline">
                Manage
              </Link>
            }
          >
            {installedMods.length === 0 ? (
              <p className="text-sm text-slate-dim">The server runs vanilla (no mods).</p>
            ) : (
              <div>
                <p className="text-sm text-zinc-200">
                  {installedMods.length} mod{installedMods.length === 1 ? '' : 's'} in config.json
                </p>
                <ul className="mt-2 space-y-1">
                  {installedMods.slice(0, 5).map((mod) => (
                    <li key={mod.modId} className="truncate text-xs text-slate-ink">
                      {mod.name ?? mod.modId}
                    </li>
                  ))}
                  {installedMods.length > 5 && (
                    <li className="text-xs text-slate-dim">+ {installedMods.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </Card>
          <OpsHealthCard user={user} slug={slug} />
        </div>
      </div>
    </div>
  );
}
