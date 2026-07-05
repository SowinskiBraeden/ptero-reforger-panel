import { sha256Hex } from '../../../lib/crypto.js';

/** How much history to import when seeing a file for the first time (or after rotation). */
export const BOUNDED_TAIL_BYTES = 512 * 1024;

export type CursorState = {
  fileFingerprint: string | null;
  lastByteOffset: number;
  lastLineHash: string | null;
  partialTrailingLine: string | null;
};

export type FileSnapshot = {
  /** Raw downloaded bytes (possibly only the tail of the remote file). */
  buffer: Buffer;
  /** Byte offset of buffer[0] within the remote file. */
  contentStartOffset: number;
  /** Total remote file size if known. */
  totalSizeBytes: number | null;
};

export type IngestionPlan = {
  /** Text to parse this sync, starting at a line boundary. */
  chunk: string;
  /** Cursor byte offset to record after a successful parse. */
  nextByteOffset: number;
  /** True when the cursor was reset (first sync, rotation, truncation, or mismatch). */
  cursorReset: boolean;
  reason: 'first_sync' | 'append' | 'no_new_data' | 'rotation' | 'continuity_mismatch' | 'gap';
};

export function hashLine(line: string): string {
  return sha256Hex(line);
}

/** Extract the final complete line of a buffer region (for continuity checks). */
function lastCompleteLineBefore(buffer: Buffer, end: number): string | null {
  if (end <= 0) return null;
  const region = buffer.subarray(0, end);
  const text = region.toString('utf8');
  const withoutTrailing = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lastNewline = withoutTrailing.lastIndexOf('\n');
  const line = lastNewline >= 0 ? withoutTrailing.slice(lastNewline + 1) : withoutTrailing;
  return line.replace(/\r$/, '');
}

/** Skip a leading partial line after an arbitrary byte cut. */
function alignToNextLine(buffer: Buffer): Buffer {
  const newlineIndex = buffer.indexOf(0x0a);
  if (newlineIndex === -1) return Buffer.alloc(0);
  return buffer.subarray(newlineIndex + 1);
}

function boundedTail(snapshot: FileSnapshot, reason: IngestionPlan['reason']): IngestionPlan {
  let region = snapshot.buffer;
  let cutInsideLine = snapshot.contentStartOffset > 0;
  if (region.byteLength > BOUNDED_TAIL_BYTES) {
    region = region.subarray(region.byteLength - BOUNDED_TAIL_BYTES);
    cutInsideLine = true;
  }
  if (cutInsideLine) {
    region = alignToNextLine(region);
  }
  return {
    chunk: region.toString('utf8'),
    nextByteOffset: snapshot.contentStartOffset + snapshot.buffer.byteLength,
    cursorReset: reason !== 'first_sync',
    reason,
  };
}

/**
 * Decide what portion of the downloaded file to parse, handling first sync,
 * normal append, rotation/truncation/replacement, and download gaps.
 *
 * The fingerprint is the hash of the file's first line when the download
 * includes the start of the file; it changes when the file is replaced even
 * if the new file is larger than the old offset.
 */
export function planIngestion(cursor: CursorState | null, snapshot: FileSnapshot): IngestionPlan {
  const fileEnd = snapshot.contentStartOffset + snapshot.buffer.byteLength;

  if (!cursor) {
    return boundedTail(snapshot, 'first_sync');
  }

  const totalSize = snapshot.totalSizeBytes ?? fileEnd;

  // Rotation / truncation: the file shrank below what we already consumed.
  if (totalSize < cursor.lastByteOffset) {
    return boundedTail(snapshot, 'rotation');
  }

  // Replacement detection via fingerprint (only when we can see the file head).
  const fingerprint = computeFingerprint(snapshot);
  if (fingerprint && cursor.fileFingerprint && fingerprint !== cursor.fileFingerprint) {
    return boundedTail(snapshot, 'rotation');
  }

  // The download window no longer reaches back to our cursor (file grew more
  // than maxBytes between syncs). Process what we have; some lines were lost.
  if (cursor.lastByteOffset < snapshot.contentStartOffset) {
    return boundedTail(snapshot, 'gap');
  }

  const cutIndex = cursor.lastByteOffset - snapshot.contentStartOffset;
  if (cutIndex >= snapshot.buffer.byteLength) {
    return {
      chunk: '',
      nextByteOffset: cursor.lastByteOffset,
      cursorReset: false,
      reason: 'no_new_data',
    };
  }

  // Continuity check: the content just before the cut must be what we last
  // saw; otherwise the file was replaced by a same-size-or-larger one.
  if (cursor.partialTrailingLine !== null && cursor.partialTrailingLine !== '') {
    const fragment = lastCompleteLineBefore(snapshot.buffer, cutIndex);
    if (fragment !== null && cutIndex > 0 && !cursor.partialTrailingLine.endsWith(fragment)) {
      return boundedTail(snapshot, 'continuity_mismatch');
    }
  } else if (cursor.lastLineHash) {
    const previousLine = lastCompleteLineBefore(snapshot.buffer, cutIndex);
    if (previousLine !== null && hashLine(previousLine) !== cursor.lastLineHash) {
      return boundedTail(snapshot, 'continuity_mismatch');
    }
  }

  const newRegion = snapshot.buffer.subarray(cutIndex);
  const chunk = (cursor.partialTrailingLine ?? '') + newRegion.toString('utf8');
  return {
    chunk,
    nextByteOffset: fileEnd,
    cursorReset: false,
    reason: 'append',
  };
}

export function computeFingerprint(snapshot: FileSnapshot): string | null {
  if (snapshot.contentStartOffset !== 0) return null;
  const firstNewline = snapshot.buffer.indexOf(0x0a);
  if (firstNewline === -1) return null;
  return sha256Hex(snapshot.buffer.subarray(0, firstNewline).toString('utf8'));
}
