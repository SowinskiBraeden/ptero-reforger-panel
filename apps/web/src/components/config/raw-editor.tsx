import { useEffect, useMemo, useState } from 'react';
import { useConfigRaw, usePutConfigRaw } from '../../api/hooks.js';
import { formatRelativeTime } from '../../lib/format.js';
import { Badge, Button, EmptyState, Notice, Spinner, useToast } from '../ui.js';

/**
 * Direct editor for config.json, for the cases a structured form cannot cover.
 * The write is refused server-side if the file moved since it was loaded, and
 * the previous content is always kept as config.json.bak.
 */
export function ConfigRawEditor({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, isLoading, error, refetch } = useConfigRaw(slug, canEdit);
  const save = usePutConfigRaw(slug);
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (data) setContent((current) => current ?? data.content);
  }, [data]);

  const parseError = useMemo(() => {
    if (content === null) return null;
    try {
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'config.json must be a JSON object.';
      }
      if (!('game' in parsed)) return 'config.json must contain a "game" section.';
      return null;
    } catch (jsonError) {
      return jsonError instanceof Error ? jsonError.message : 'Invalid JSON.';
    }
  }, [content]);

  if (!canEdit) {
    return <EmptyState icon="lock" title="Configuration editing is restricted to admins" />;
  }
  if (isLoading || content === null) return <Spinner label="Downloading config.json…" />;
  if (error || !data) {
    return (
      <EmptyState
        icon="alert"
        title="Could not read config.json"
        hint={error?.message}
        action={
          <Button icon="refresh" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const dirty = content !== data.content;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={parseError ? 'danger' : 'ok'} icon={parseError ? 'alert' : 'check'}>
          {parseError ? 'invalid JSON' : 'valid JSON'}
        </Badge>
        {dirty && <Badge tone="warn">unsaved changes</Badge>}
        <span className="numeric ml-auto text-2xs text-slate-dim">
          revision {data.revision} · read {formatRelativeTime(data.fetchedAt)}
        </span>
      </div>

      {parseError && <Notice tone="danger">{parseError}</Notice>}

      <textarea
        spellCheck={false}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        className="input h-[28rem] w-full resize-y font-mono text-xs leading-5"
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-2xs text-slate-dim">
          The previous file is kept as config.json.bak. Changes apply on the next restart.
        </span>
        <Button onClick={() => setContent(data.content)} disabled={!dirty || save.isPending}>
          Revert
        </Button>
        <Button
          variant="accent"
          icon="upload"
          disabled={!dirty || parseError !== null}
          loading={save.isPending}
          onClick={() =>
            save.mutate(
              { content, expectedRevision: data.revision },
              {
                onSuccess: (result) => {
                  setContent(result.content);
                  toast('config.json written. Restart to apply.', 'ok');
                },
                onError: (mutationError) => toast(mutationError.message, 'danger'),
              },
            )
          }
        >
          Write config.json
        </Button>
      </div>
    </div>
  );
}
