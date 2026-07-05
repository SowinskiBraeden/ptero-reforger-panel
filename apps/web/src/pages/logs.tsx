import { useEffect, useRef, useState } from 'react';
import { useRawLogs, useServers } from '../api/hooks.js';
import { formatRelativeTime } from '../lib/format.js';
import { Button, Card, Spinner } from '../components/ui.js';

export function LogsPage() {
  const { data: serversData } = useServers();
  const slug = serversData?.servers[0]?.slug;
  const [lines, setLines] = useState(300);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [follow, setFollow] = useState(true);
  const { data, isLoading, error, refetch, isFetching } = useRawLogs(
    slug ?? '',
    lines,
    autoRefresh,
    slug !== undefined,
  );
  const viewportRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (follow && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [data, follow]);

  if (!slug) return <Spinner />;

  return (
    <div className="w-full space-y-5">
      <h1 className="page-title">Logs</h1>
      <Card
        title={data ? data.path : 'console.log'}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {data && (
              <span className="text-xs text-slate-dim">
                fetched {formatRelativeTime(data.fetchedAt)}
              </span>
            )}
            <select
              value={lines}
              onChange={(event) => setLines(Number(event.target.value))}
              className="input py-1.5"
            >
              {[100, 300, 600, 1000].map((n) => (
                <option key={n} value={n}>
                  last {n} lines
                </option>
              ))}
            </select>
            <Button
              variant={autoRefresh ? 'accent' : 'default'}
              onClick={() => setAutoRefresh((v) => !v)}
              title="Refresh every 10 seconds"
            >
              {autoRefresh ? 'Auto: on' : 'Auto: off'}
            </Button>
            <Button
              variant={follow ? 'accent' : 'default'}
              onClick={() => setFollow((v) => !v)}
              title="Keep scrolled to the newest lines"
            >
              {follow ? 'Follow' : 'Free scroll'}
            </Button>
            <Button disabled={isFetching} onClick={() => void refetch()}>
              {isFetching ? '…' : 'Refresh'}
            </Button>
          </div>
        }
      >
        {isLoading ? (
          <Spinner label="Downloading log…" />
        ) : error ? (
          <p className="text-sm text-danger-400">{error.message}</p>
        ) : (
          <pre
            ref={viewportRef}
            className="max-h-[65vh] overflow-auto whitespace-pre rounded-md border border-graphite-800 bg-graphite-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
          >
            {data?.lines.join('\n')}
          </pre>
        )}
        <p className="mt-3 text-xs text-slate-dim">
          Read-only tail of the current Reforger console log, downloaded through the Pterodactyl
          API. Visible to owner and server admins only.
        </p>
      </Card>
    </div>
  );
}
