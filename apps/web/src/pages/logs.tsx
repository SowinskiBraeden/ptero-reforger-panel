import { useCallback, useEffect, useRef, useState } from 'react';
import { useConsoleStream, useRawLogs, useServers } from '../api/hooks.js';
import { formatRelativeTime } from '../lib/format.js';
import { Button, Card, Spinner } from '../components/ui.js';

const MAX_STREAM_LINES = 1000;

export function LogsPage() {
  const { data: serversData } = useServers();
  const slug = serversData?.servers[0]?.slug;
  const [mode, setMode] = useState<'stream' | 'poll'>('stream');
  const [lines, setLines] = useState(300);
  const [follow, setFollow] = useState(true);
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const viewportRef = useRef<HTMLPreElement | null>(null);

  const onLine = useCallback((line: string) => {
    setStreamLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_STREAM_LINES ? next.slice(next.length - MAX_STREAM_LINES) : next;
    });
  }, []);

  useConsoleStream(slug ?? '', onLine, mode === 'stream' && slug !== undefined);

  // Polling fallback
  const { data: pollData, isLoading: pollLoading, error: pollError, refetch, isFetching } =
    useRawLogs(slug ?? '', lines, mode === 'poll', mode === 'poll' && slug !== undefined);

  useEffect(() => {
    if (follow && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [streamLines, pollData, follow]);

  if (!slug) return <Spinner />;

  const title = mode === 'stream' ? (streamLines.length > 0 ? 'Live log' : 'console.log') : (pollData ? pollData.path : 'console.log');

  return (
    <div className="w-full space-y-5">
      <h1 className="page-title">Logs</h1>
      <Card
        title={title}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode === 'poll' && pollData && (
              <span className="text-xs text-slate-dim">
                fetched {formatRelativeTime(pollData.fetchedAt)}
              </span>
            )}
            {mode === 'stream' && streamLines.length > 0 && (
              <span className="text-xs text-slate-dim">
                {streamLines.length} lines
              </span>
            )}
            {mode === 'poll' && (
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
            )}
            <Button
              variant={mode === 'stream' ? 'accent' : 'default'}
              onClick={() => {
                setStreamLines([]);
                setMode((m) => (m === 'stream' ? 'poll' : 'stream'));
              }}
              title="Toggle between live SSE stream and 10s polling"
            >
              {mode === 'stream' ? 'Live' : 'Polling'}
            </Button>
            <Button
              variant={follow ? 'accent' : 'default'}
              onClick={() => setFollow((v) => !v)}
              title="Keep scrolled to the newest lines"
            >
              {follow ? 'Follow' : 'Free scroll'}
            </Button>
            {mode === 'poll' && (
              <Button disabled={isFetching} onClick={() => void refetch()}>
                {isFetching ? '…' : 'Refresh'}
              </Button>
            )}
          </div>
        }
      >
        {mode === 'stream' ? (
          streamLines.length === 0 ? (
            <Spinner label="Connecting to console…" />
          ) : (
            <pre
              ref={viewportRef}
              className="max-h-[65vh] overflow-auto whitespace-pre rounded-md border border-graphite-800 bg-graphite-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
            >
              {streamLines.join('\n')}
            </pre>
          )
        ) : pollLoading ? (
          <Spinner label="Downloading log…" />
        ) : pollError ? (
          <p className="text-sm text-danger-400">{pollError.message}</p>
        ) : (
          <pre
            ref={viewportRef}
            className="max-h-[65vh] overflow-auto whitespace-pre rounded-md border border-graphite-800 bg-graphite-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
          >
            {pollData?.lines.join('\n')}
          </pre>
        )}
        <p className="mt-3 text-xs text-slate-dim">
          {mode === 'stream'
            ? 'Live log tail streamed via SSE (polls every 2 s). Switch to polling for manual refresh.'
            : 'Read-only tail of the current Reforger console log, downloaded through the Pterodactyl API.'}
          {' '}Visible to owner and server admins only.
        </p>
      </Card>
    </div>
  );
}
