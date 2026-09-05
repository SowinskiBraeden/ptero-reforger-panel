import type { ModOverviewEntry, ReforgerConfigMod } from '@reforger-panel/shared';

/**
 * The Mods page edits a local draft of `game.mods` and writes it once.
 *
 * The previous page autosaved 1.5s after every keystroke, which meant a bulk
 * operation like "update all" or importing another server's list produced a
 * burst of writes to config.json and no chance to review the result. Here every
 * edit is staged, diffed against what the server actually has, and applied in
 * a single request.
 */

export type DraftMod = ReforgerConfigMod & { modId: string };

export type ChangeKind = 'add' | 'remove' | 'version';

export type Change = {
  modId: string;
  kind: ChangeKind;
  name: string;
  /** Previous pinned version, for `version` and `remove`. */
  from: string | null;
  /** New pinned version, for `version` and `add`. */
  to: string | null;
};

export function normalizeId(modId: string): string {
  return modId.toUpperCase();
}

export function draftFromOverview(mods: readonly ModOverviewEntry[]): DraftMod[] {
  return mods.map((mod) => ({
    modId: mod.modId,
    ...(mod.configName ? { name: mod.configName } : {}),
    ...(mod.pinnedVersion ? { version: mod.pinnedVersion } : {}),
  }));
}

export function displayName(
  modId: string,
  entry: ModOverviewEntry | undefined,
  fallback?: string | null,
): string {
  return entry?.workshop?.name ?? entry?.configName ?? fallback ?? modId;
}

export function computeChanges(
  baseline: readonly DraftMod[],
  draft: readonly DraftMod[],
  nameOf: (modId: string, fallback?: string | null) => string,
): Change[] {
  const before = new Map(baseline.map((mod) => [mod.modId, mod]));
  const after = new Map(draft.map((mod) => [mod.modId, mod]));
  const changes: Change[] = [];

  for (const [modId, mod] of after) {
    const existing = before.get(modId);
    if (!existing) {
      changes.push({
        modId,
        kind: 'add',
        name: nameOf(modId, mod.name),
        from: null,
        to: mod.version ?? null,
      });
    } else if ((existing.version ?? null) !== (mod.version ?? null)) {
      changes.push({
        modId,
        kind: 'version',
        name: nameOf(modId, mod.name),
        from: existing.version ?? null,
        to: mod.version ?? null,
      });
    }
  }

  for (const [modId, mod] of before) {
    if (after.has(modId)) continue;
    changes.push({
      modId,
      kind: 'remove',
      name: nameOf(modId, mod.name),
      from: mod.version ?? null,
      to: null,
    });
  }

  // Adds first, then version bumps, then removals — reads as a plan.
  const order: Record<ChangeKind, number> = { add: 0, version: 1, remove: 2 };
  return changes.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

export function upsertMod(draft: readonly DraftMod[], mod: DraftMod): DraftMod[] {
  const modId = normalizeId(mod.modId);
  const next = draft.filter((entry) => entry.modId !== modId);
  next.push({ ...mod, modId });
  return next;
}

export function removeMod(draft: readonly DraftMod[], modId: string): DraftMod[] {
  const id = normalizeId(modId);
  return draft.filter((entry) => entry.modId !== id);
}

export function setModVersion(
  draft: readonly DraftMod[],
  modId: string,
  version: string | null,
): DraftMod[] {
  const id = normalizeId(modId);
  return draft.map((entry) => {
    if (entry.modId !== id) return entry;
    const { version: _dropped, ...rest } = entry;
    return version ? { ...rest, version } : rest;
  });
}

/**
 * Merge keeps everything already installed and adds what is missing; replace
 * mirrors the source list exactly, including removals and version pins.
 */
export function mergeModLists(
  draft: readonly DraftMod[],
  incoming: readonly DraftMod[],
  mode: 'merge' | 'replace',
): DraftMod[] {
  if (mode === 'replace') {
    return incoming.map((mod) => ({ ...mod, modId: normalizeId(mod.modId) }));
  }
  const existing = new Set(draft.map((mod) => mod.modId));
  return [
    ...draft,
    ...incoming
      .filter((mod) => !existing.has(normalizeId(mod.modId)))
      .map((mod) => ({ ...mod, modId: normalizeId(mod.modId) })),
  ];
}
