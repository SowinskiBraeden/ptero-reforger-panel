import { useState } from 'react';
import type { Role } from '@reforger-panel/shared';
import { ROLE_LABELS } from '@reforger-panel/shared';
import { useCreateInvite, useDeleteInvite, useInvites } from '../api/hooks.js';
import { formatDateTime, formatRelativeTime } from '../lib/format.js';
import { Button, Card, EmptyState, RoleBadge, Spinner } from './ui.js';

const INVITABLE_ROLES: Role[] = ['server_admin', 'mission_lead', 'viewer'];
const INVITE_DURATIONS = [
  { label: 'Never expires', value: 'never', hours: null },
  { label: '7 days', value: '168', hours: 168 },
  { label: '30 days', value: '720', hours: 720 },
] as const;

function inviteLink(code: string): string {
  return `${window.location.origin}/?invite=${code}`;
}

function isEffectivelyPermanent(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() - Date.now() > 20 * 365 * 24 * 60 * 60 * 1000;
}

export function InvitesCard() {
  const { data, isLoading } = useInvites(true);
  const createInvite = useCreateInvite();
  const deleteInvite = useDeleteInvite();
  const [role, setRole] = useState<Role>('mission_lead');
  const [duration, setDuration] = useState<(typeof INVITE_DURATIONS)[number]['value']>('never');
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Card
      title="Invites"
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="input min-w-0 py-1.5"
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select
            value={duration}
            onChange={(event) =>
              setDuration(event.target.value as (typeof INVITE_DURATIONS)[number]['value'])
            }
            className="input min-w-0 py-1.5"
          >
            {INVITE_DURATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            variant="accent"
            disabled={createInvite.isPending}
            onClick={() =>
              createInvite.mutate({
                role,
                expiresInHours: INVITE_DURATIONS.find((option) => option.value === duration)!.hours,
              })
            }
          >
            {createInvite.isPending ? 'Creating…' : 'Create invite'}
          </Button>
        </div>
      }
    >
      {isLoading || !data ? (
        <Spinner />
      ) : data.invites.length === 0 ? (
        <EmptyState
          title="No invites yet"
          hint="Create one and send the link — the recipient logs in with Discord and gets the role automatically."
        />
      ) : (
        <ul className="space-y-2">
          {data.invites.map((invite) => {
            const permanent = isEffectivelyPermanent(invite.expiresAt);
            const expired = !permanent && new Date(invite.expiresAt).getTime() < Date.now();
            const state = invite.usedAt ? 'used' : expired ? 'expired' : 'active';
            return (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-graphite-800 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <code className="font-mono text-zinc-200">{invite.code}</code>
                    <RoleBadge role={invite.role} />
                    {state === 'active' && <span className="text-xs text-accent-400">active</span>}
                    {state === 'used' && (
                      <span className="text-xs text-slate-dim">
                        used by {invite.usedBy} {formatRelativeTime(invite.usedAt)}
                      </span>
                    )}
                    {state === 'expired' && <span className="text-xs text-warn-400">expired</span>}
                  </p>
                  <p className="text-xs text-slate-dim">
                    {permanent ? 'never expires' : `expires ${formatDateTime(invite.expiresAt)}`} ·
                    created by {invite.createdBy ?? '—'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {state === 'active' && (
                    <Button onClick={() => void copy(invite.code)}>
                      {copied === invite.code ? 'Copied!' : 'Copy link'}
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    disabled={deleteInvite.isPending}
                    onClick={() => deleteInvite.mutate(invite.id)}
                  >
                    {state === 'active' ? 'Revoke' : 'Remove'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-dim">
        Invite links are single-use and grant the selected role at login. Redeemed roles persist
        until you change them under Users & roles.
      </p>
    </Card>
  );
}
