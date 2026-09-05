import { Link } from 'react-router-dom';
import type { CurrentUser, ResourceSample } from '@reforger-panel/shared';
import {
  useConfiguration,
  useModsOverview,
  usePrimaryServer,
  useResourceHistory,
  useServerResources,
} from '../api/hooks.js';
import { formatBytes, formatDuration } from '../lib/format.js';
import { Badge, Card, EmptyState, MetricTile, ProgressBar, Spinner } from '../components/ui.js';
import { TimeSeriesChart } from '../components/charts.js';
import {
  ConfigSummaryRows,
  CurrentPlayersCard,
  OpsHealthCard,
  RecentActivityCard,
} from '../components/widgets.js';

export function OverviewPage({ user }: { user: CurrentUser }) {
  const server = usePrimaryServer();
  const { isLoading } = useConfiguration(server?.slug ?? '');

  if (!server) {
    return isLoading ? (
      <Spinner label="Loading dashboard…" />
    ) : (
      <EmptyState
        icon="server"
        title="No servers configured"
        hint="Run npm run db:seed to create the initial server record."
      />
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
  const server = usePrimaryServer();
  const { data: resources } = useServerResources(slug);
  const { data: config } = useConfiguration(slug);
  const { data: history } = useResourceHistory(slug);
  const { data: mods } = useModsOverview(slug);
  if (!server) return null;

  const samples = history?.samples;
  const latest = samples?.at(-1);
  const memoryLimit = resources?.memoryLimitBytes ?? latest?.memoryLimitBytes ?? null;
  const cpuLimit = resources?.cpuLimitPercent ?? latest?.cpuLimitPercent ?? 100;
  const diskUsed = resources?.diskBytes ?? null;
  const diskLimit = resources?.diskLimitBytes ?? null;

  return (
    <div className="w-full space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="CPU"
          value={resources ? `${resources.cpuPercent.toFixed(1)}%` : '—'}
          unit={cpuLimit && cpuLimit !== 100 ? `of ${cpuLimit}%` : undefined}
          detail={
            resources && (
              <Badge tone={resources.source === 'live' ? 'ok' : 'neutral'}>
                {resources.source === 'live' ? 'live' : 'polled'}
              </Badge>
            )
          }
        >
          <TimeSeriesChart
            max={cpuLimit}
            format={(value) => `${value.toFixed(0)}%`}
            series={[
              { points: seriesOf(samples, (s) => s.cpuPercent), color: 'var(--color-accent-400)' },
            ]}
          />
        </MetricTile>

        <MetricTile
          label="Memory"
          value={resources ? formatBytes(resources.memoryBytes) : '—'}
          unit={memoryLimit ? `of ${formatBytes(memoryLimit)}` : undefined}
        >
          <TimeSeriesChart
            max={memoryLimit}
            format={formatBytes}
            series={[
              { points: seriesOf(samples, (s) => s.memoryBytes), color: 'var(--color-info-400)' },
            ]}
          />
        </MetricTile>

        <MetricTile
          label="Network"
          value={`${formatBytes(latest?.networkRxRate ?? 0)}/s`}
          unit="in"
          detail={
            <>
              {formatBytes(latest?.networkTxRate ?? 0)}/s out · up{' '}
              {resources && resources.uptimeMs > 0
                ? formatDuration(resources.uptimeMs / 1000)
                : '—'}
            </>
          }
        >
          <TimeSeriesChart
            format={(value) => `${formatBytes(value)}/s`}
            series={[
              {
                points: seriesOf(samples, (s) => s.networkRxRate),
                color: 'var(--color-accent-400)',
                label: 'in',
              },
              {
                points: seriesOf(samples, (s) => s.networkTxRate),
                color: 'var(--color-warn-400)',
                fill: false,
                label: 'out',
              },
            ]}
          />
        </MetricTile>

        <MetricTile
          label="Storage"
          value={diskUsed !== null ? formatBytes(diskUsed) : '—'}
          unit={diskLimit ? `of ${formatBytes(diskLimit)}` : undefined}
          detail={
            diskUsed !== null && diskLimit
              ? `${((diskUsed / diskLimit) * 100).toFixed(1)}% used`
              : undefined
          }
        >
          <ProgressBar value={diskUsed ?? 0} max={diskLimit} className="mt-1" />
        </MetricTile>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <CurrentPlayersCard slug={slug} maxPlayers={server.maxPlayers} />
          <RecentActivityCard slug={slug} />
        </div>

        <div className="min-w-0 space-y-4">
          <Card
            title="Configuration"
            action={
              <Link to="/configuration" className="text-2xs text-accent-400 hover:underline">
                Edit
              </Link>
            }
          >
            {config ? <ConfigSummaryRows config={config} /> : <Spinner />}
          </Card>

          <Card
            title="Mods"
            action={
              <Link to="/mods" className="text-2xs text-accent-400 hover:underline">
                Manage
              </Link>
            }
          >
            {!mods ? (
              <Spinner />
            ) : mods.mods.length === 0 ? (
              <p className="text-sm text-slate-dim">The server runs vanilla (no mods).</p>
            ) : (
              <div className="space-y-2">
                <p className="numeric text-sm text-zinc-100">
                  {mods.mods.length} installed
                  {mods.totalSizeBytes ? ` · ${formatBytes(mods.totalSizeBytes)}` : ''}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {mods.updatesAvailable > 0 && (
                    <Badge tone="warn">{mods.updatesAvailable} updates</Badge>
                  )}
                  {mods.unresolvedIds.length > 0 && (
                    <Badge tone="neutral">{mods.unresolvedIds.length} unidentified</Badge>
                  )}
                  {mods.orphanedMission && <Badge tone="danger">mission missing</Badge>}
                  {mods.warming && <Badge>loading metadata…</Badge>}
                </div>
                <ul className="space-y-0.5">
                  {mods.mods.slice(0, 5).map((mod) => (
                    <li key={mod.modId} className="truncate text-xs text-slate-ink">
                      {mod.workshop?.name ?? mod.configName ?? mod.modId}
                    </li>
                  ))}
                  {mods.mods.length > 5 && (
                    <li className="text-xs text-slate-faint">+ {mods.mods.length - 5} more</li>
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
