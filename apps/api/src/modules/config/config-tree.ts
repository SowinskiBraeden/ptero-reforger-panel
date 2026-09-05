import type { ConfigEntry, ConfigPatchOp, ConfigValueType } from '@reforger-panel/shared';
import { asRecord } from './config-file-gateway.js';

/**
 * `game.mods` is owned by the Mods page, which understands versions and
 * dependencies. Hand-editing a 90-entry array in a generic key editor is a
 * good way to break a server, so it is hidden from the flat view (the raw JSON
 * tab still shows it).
 */
const HIDDEN_PATHS = new Set(['game.mods']);

function typeOf(value: unknown): ConfigValueType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

/**
 * Flattens config.json into dotted leaf paths (`game.gameProperties.battlEye`)
 * so the editor can search and address every value the file actually contains,
 * rather than only the handful of keys the panel happens to know about.
 *
 * Arrays are surfaced as single non-recursive entries carrying their JSON text;
 * the flat editor renders them read-only and defers to the raw tab.
 */
export function flattenConfig(root: Record<string, unknown>): ConfigEntry[] {
  const entries: ConfigEntry[] = [];

  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (HIDDEN_PATHS.has(path)) continue;
      const child = asRecord(value);
      if (child) {
        walk(child, path);
        continue;
      }
      if (Array.isArray(value)) {
        entries.push({ path, value: null, type: 'array', raw: JSON.stringify(value) });
        continue;
      }
      entries.push({
        path,
        value: value as string | number | boolean | null,
        type: typeOf(value),
      });
    }
  };

  walk(root, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

export function readAtPath(
  root: Record<string, unknown>,
  path: string,
): string | number | boolean | null {
  const segments = path.split('.');
  let node: unknown = root;
  for (const segment of segments) {
    const record = asRecord(node);
    if (!record || !(segment in record)) return null;
    node = record[segment];
  }
  if (node === undefined || asRecord(node) || Array.isArray(node)) return null;
  return node as string | number | boolean | null;
}

/**
 * Applies patch operations in place and returns the paths that actually
 * changed. `value: null` removes the key entirely so the game's own default
 * applies — the same semantics the performance form has always had.
 *
 * Only the supplied paths are touched, which is the core fix for the old
 * whole-object form submit that silently reverted concurrent edits.
 */
export function applyConfigOps(
  root: Record<string, unknown>,
  ops: readonly ConfigPatchOp[],
): string[] {
  const changed: string[] = [];

  for (const op of ops) {
    const segments = op.path.split('.').filter(Boolean);
    const leaf = segments.pop();
    if (!leaf) continue;

    if (op.value === null) {
      // Removal: never create the intermediate objects on the way down.
      let node: Record<string, unknown> | null = root;
      for (const segment of segments) {
        node = asRecord(node[segment]);
        if (!node) break;
      }
      if (node && leaf in node) {
        delete node[leaf];
        changed.push(op.path);
      }
      continue;
    }

    let node: Record<string, unknown> = root;
    for (const segment of segments) {
      const child = asRecord(node[segment]);
      if (child) {
        node = child;
      } else {
        const created: Record<string, unknown> = {};
        node[segment] = created;
        node = created;
      }
    }
    if (node[leaf] !== op.value) {
      node[leaf] = op.value;
      changed.push(op.path);
    }
  }

  return changed;
}

/** Verifies that a write landed, for the gateway's read-back check. */
export function verifyConfigOps(
  readBack: Record<string, unknown>,
  ops: readonly ConfigPatchOp[],
): string | null {
  for (const op of ops) {
    const actual = readAtPath(readBack, op.path);
    if (op.value === null) {
      if (actual !== null) return op.path;
    } else if (actual !== op.value) {
      return op.path;
    }
  }
  return null;
}
