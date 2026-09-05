import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleLine } from '@reforger-panel/shared';
import { useConsoleFeed, usePrimaryServer, useRawLogs } from '../api/hooks.js';
import { formatBytes, formatRelativeTime } from '../lib/format.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Spinner,
  StatusBadge,
  Toggle,
  useToast,
} from '../components/ui.js';

type Source = 'live' | 'file';

/** Colour by severity, inferred from the line itself — Wings sends no level. */
function lineTone(line: ConsoleLine): string {
  if (line.stream === 'install') return 'text-info-400';
  if (line.stream === 'daemon') return 'text-accent-400';
  const text = line.text;
  if (/\b(ERROR|FATAL|Failed|failure|exception)\b/i.test(text)) return 'text-danger-400';
  if (/\bWARN(ING)?\b/i.test(text)) return 'text-warn-400';
  if (/\b(Success|ready to accept|successfully)\b/i.test(text)) return 'text-ok-400';
  return 'text-zinc-300';
}

function timestamp(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function ConsolePage() {
  const server = usePrimaryServer();
  if (!server) return <Spinner />;
  return <ConsoleBody slug={server.slug} />;
}

function ConsoleBody({ slug }: { slug: string }) {
  const toast = useToast();
  const [source, setSource] = useState<Source>('live');
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [fileLines, setFileLines] = useState(300);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const feed = useConsoleFeed(slug, source === 'live');
  const file = useRawLogs(slug, fileLines, source === 'file');

  const visible = useMemo(() => {
    if (source === 'file') {
      const lines = file.data?.lines ?? [];
      return lines
        .filter((text) => !filter || text.toLowerCase().includes(filter.toLowerCase()))
        .map((text, index): ConsoleLine => ({ seq: index, stream: 'console', text, at: 0 }));
    }
    if (!filter) return feed.lines;
    const needle = filter.toLowerCase();
    return feed.lines.filter((line) => line.text.toLowerCase().includes(needle));
  }, [source, feed.lines, file.data?.lines, filter]);

  useEffect(() => {
    if (!follow || !viewportRef.current) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [visible, follow]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(visible.map((line) => line.text).join('\n'));
      toast(`Copied ${visible.length} lines`, 'ok');
    } catch {
      toast('Clipboard is not available in this browser', 'danger');
    }
  };

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Console"
        kicker={
          source === 'live'
            ? 'Streamed live from Pterodactyl — installs, updates and mod downloads included, not just what the game writes to its own log.'
            : "The game's own console.log, downloaded from the server."
        }
        actions={
          <SegmentedControl<Source>
            value={source}
            onChange={setSource}
            options={[
              { value: 'live', label: 'Live', icon: 'terminal' },
              { value: 'file', label: 'Game log', icon: 'download' },
            ]}
          />
        }
      />

      <Card
        padded={false}
        title={source === 'live' ? 'Pterodactyl live output' : (file.data?.path ?? 'console.log')}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {source === 'live' ? (
              <>
                <StatusBadge status={feed.status} />
                <Badge tone={feed.connected ? 'ok' : 'warn'}>
                  {feed.connected ? 'connected' : 'reconnecting'}
                </Badge>
                <span className="numeric text-2xs text-slate-dim">{feed.lines.length} lines</span>
              </>
            ) : (
              <>
                {file.data && (
                  <span className="text-2xs text-slate-dim">
                    fetched {formatRelativeTime(file.data.fetchedAt)}
                  </span>
                )}
                <select
                  value={fileLines}
                  onChange={(event) => setFileLines(Number(event.target.value))}
                  className="input w-auto py-1 text-xs"
                >
                  {[100, 300, 600, 1000].map((n) => (
                    <option key={n} value={n}>
                      last {n} lines
                    </option>
                  ))}
                </select>
                <IconButton icon="refresh" label="Reload" onClick={() => void file.refetch()} />
              </>
            )}
            <IconButton icon="copy" label="Copy visible lines" onClick={() => void copyAll()} />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-graphite-700 px-4 py-2.5">
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter lines…"
            className="w-full sm:w-72"
          />
          <label className="flex items-center gap-2 text-xs text-slate-ink">
            <Toggle checked={follow} onChange={setFollow} label="Follow output" />
            Follow
          </label>
          {source === 'live' && feed.lines.length > 0 && (
            <Button size="sm" variant="ghost" icon="trash" onClick={feed.clear}>
              Clear view
            </Button>
          )}
          {filter && (
            <span className="numeric text-2xs text-slate-dim">{visible.length} matching</span>
          )}
        </div>

        <div
          ref={viewportRef}
          onWheel={() => setFollow(false)}
          className="console-surface h-[calc(100vh-22rem)] min-h-80 overflow-auto rounded-none border-0"
        >
          {source === 'file' && file.isLoading ? (
            <Spinner label="Downloading console.log…" />
          ) : visible.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon="terminal"
                title={filter ? 'No lines match that filter' : 'Waiting for output'}
                hint={
                  filter
                    ? undefined
                    : source === 'live'
                      ? 'Output appears the moment the server does anything — press Start and watch the install and mod download run.'
                      : 'The game writes this file once it has started.'
                }
              />
            </div>
          ) : (
            <ol>
              {visible.map((line) => (
                <li
                  key={`${line.seq}-${line.at}`}
                  className="flex items-baseline gap-3 px-3 py-px hover:bg-graphite-900/60"
                >
                  {line.at > 0 && (
                    <span className="numeric shrink-0 select-none text-slate-faint">
                      {timestamp(line.at)}
                    </span>
                  )}
                  {line.stream !== 'console' && (
                    <span className="shrink-0 select-none text-2xs uppercase text-slate-faint">
                      {line.stream}
                    </span>
                  )}
                  <span
                    className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${lineTone(line)}`}
                  >
                    {line.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {source === 'live' && feed.stats && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-graphite-700 px-4 py-2 text-2xs text-slate-dim">
            <span className="numeric">CPU {feed.stats.cpuPercent.toFixed(1)}%</span>
            <span className="numeric">MEM {formatBytes(feed.stats.memoryBytes)}</span>
            <span className="numeric">DISK {formatBytes(feed.stats.diskBytes)}</span>
            <span className="numeric">
              NET {formatBytes(feed.stats.networkRxBytes)} in /{' '}
              {formatBytes(feed.stats.networkTxBytes)} out
            </span>
            <span>source: {feed.stats.source}</span>
          </div>
        )}
      </Card>
    </div>
  );
}
