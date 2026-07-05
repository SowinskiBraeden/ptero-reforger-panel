import { describe, expect, it } from 'vitest';
import { BOUNDED_TAIL_BYTES, hashLine, planIngestion, type CursorState } from './cursor-service.js';

function snapshot(content: string, opts: { startOffset?: number; totalSize?: number } = {}) {
  const buffer = Buffer.from(content, 'utf8');
  return {
    buffer,
    contentStartOffset: opts.startOffset ?? 0,
    totalSizeBytes: opts.totalSize ?? (opts.startOffset ?? 0) + buffer.byteLength,
  };
}

function cursorFor(consumed: string, extra: Partial<CursorState> = {}): CursorState {
  const lines = consumed.endsWith('\n') ? consumed.slice(0, -1).split('\n') : consumed.split('\n');
  return {
    fileFingerprint: null,
    lastByteOffset: Buffer.byteLength(consumed, 'utf8'),
    lastLineHash: hashLine(lines.at(-1) ?? ''),
    partialTrailingLine: null,
    ...extra,
  };
}

describe('planIngestion', () => {
  it('first sync processes the whole (small) file', () => {
    const plan = planIngestion(null, snapshot('line1\nline2\n'));
    expect(plan.reason).toBe('first_sync');
    expect(plan.cursorReset).toBe(false);
    expect(plan.chunk).toBe('line1\nline2\n');
    expect(plan.nextByteOffset).toBe(12);
  });

  it('first sync bounds a huge file to a tail starting at a line boundary', () => {
    const bigLine = 'x'.repeat(1000) + '\n';
    const content = bigLine.repeat(600); // ~600 KB > BOUNDED_TAIL_BYTES
    const plan = planIngestion(null, snapshot(content));
    expect(Buffer.byteLength(plan.chunk)).toBeLessThanOrEqual(BOUNDED_TAIL_BYTES);
    expect(plan.chunk.startsWith('x')).toBe(true);
    expect(plan.chunk.endsWith('\n')).toBe(true);
    expect(plan.nextByteOffset).toBe(Buffer.byteLength(content));
  });

  it('normal append processes only new content', () => {
    const consumed = 'line1\nline2\n';
    const appended = 'line3\nline4\n';
    const plan = planIngestion(cursorFor(consumed), snapshot(consumed + appended));
    expect(plan.reason).toBe('append');
    expect(plan.chunk).toBe(appended);
    expect(plan.cursorReset).toBe(false);
  });

  it('prepends a stored partial trailing line to new content', () => {
    const consumed = 'line1\npart';
    const cursor = cursorFor(consumed, {
      partialTrailingLine: 'part',
      lastLineHash: hashLine('line1'),
    });
    const plan = planIngestion(cursor, snapshot('line1\npartial-done\nline3\n'));
    expect(plan.reason).toBe('append');
    expect(plan.chunk).toBe('partial-done\nline3\n');
  });

  it('reports no new data when the file has not grown', () => {
    const consumed = 'line1\nline2\n';
    const plan = planIngestion(cursorFor(consumed), snapshot(consumed));
    expect(plan.reason).toBe('no_new_data');
    expect(plan.chunk).toBe('');
    expect(plan.cursorReset).toBe(false);
  });

  it('resets on rotation (file shrank)', () => {
    const cursor = cursorFor('a'.repeat(5000) + '\n');
    const plan = planIngestion(cursor, snapshot('fresh1\nfresh2\n'));
    expect(plan.reason).toBe('rotation');
    expect(plan.cursorReset).toBe(true);
    expect(plan.chunk).toBe('fresh1\nfresh2\n');
  });

  it('resets when the fingerprint (first line) changed despite a larger file', () => {
    const oldContent = 'old-header\nold-line\n';
    const cursor = cursorFor(oldContent, { fileFingerprint: hashLine('old-header') });
    const newContent = 'new-header-longer\nnew-line-1\nnew-line-2\n';
    const plan = planIngestion(cursor, snapshot(newContent));
    expect(plan.reason).toBe('rotation');
    expect(plan.cursorReset).toBe(true);
  });

  it('resets on continuity mismatch (replaced file, same-or-larger size, no visible head)', () => {
    const consumed = 'line1\nline2\n';
    const cursor = cursorFor(consumed);
    // Same length as consumed but different content before the cut.
    const replaced = 'lineX\nlineZ\nline3\n';
    const plan = planIngestion(cursor, snapshot(replaced, { startOffset: 0, totalSize: 100 }));
    // fingerprint check triggers first only if cursor had one; here continuity check fires
    expect(['continuity_mismatch', 'rotation']).toContain(plan.reason);
    expect(plan.cursorReset).toBe(true);
  });

  it('processes a bounded tail when the download window skipped past the cursor', () => {
    const cursor = cursorFor('early\n'); // offset 6
    const plan = planIngestion(
      cursor,
      snapshot('tail-line-1\ntail-line-2\n', { startOffset: 10_000, totalSize: 10_024 }),
    );
    expect(plan.reason).toBe('gap');
    expect(plan.cursorReset).toBe(true);
    // Head-cut downloads drop the first partial line.
    expect(plan.chunk).toBe('tail-line-2\n');
  });

  it('advances the cursor across consecutive appends', () => {
    let content = 'l1\n';
    let cursor: CursorState | null = null;
    const offsets: number[] = [];
    for (const next of ['l2\n', 'l3\n', 'l4\n']) {
      const plan = planIngestion(cursor, snapshot(content));
      offsets.push(plan.nextByteOffset);
      const lines = content.slice(0, plan.nextByteOffset);
      cursor = cursorFor(lines, { fileFingerprint: null });
      content += next;
    }
    expect(offsets).toEqual([3, 6, 9]);
  });
});
