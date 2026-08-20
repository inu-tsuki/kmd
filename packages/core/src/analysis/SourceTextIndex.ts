import type { SourceRange } from '../types/diagnostics';

export interface SourceTextPosition {
  line: number;
  character: number;
}

/**
 * UTF-16 offset index shared by Monaco and LSP adapters. JavaScript string
 * offsets already use UTF-16 code units, so no secondary encoding pass is used.
 */
export class SourceTextIndex {
  private readonly lineStarts: number[] = [0];
  private readonly sourceLength: number;

  public constructor(source: string) {
    this.sourceLength = source.length;
    for (let offset = 0; offset < source.length; offset += 1) {
      if (source.charCodeAt(offset) === 10) this.lineStarts.push(offset + 1);
    }
  }

  public positionAt(offset: number): SourceTextPosition {
    const clamped = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, this.sourceLength));
    let low = 0;
    let high = this.lineStarts.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.lineStarts[middle]! <= clamped) low = middle + 1;
      else high = middle;
    }
    const line = Math.max(0, low - 1);
    return { line, character: clamped - this.lineStarts[line]! };
  }

  public lineSpan(range: SourceRange): { startLine: number; endLine: number } {
    const start = this.positionAt(range.start);
    const endOffset = Math.max(range.start, range.end - 1);
    const end = this.positionAt(endOffset);
    return { startLine: start.line, endLine: end.line };
  }
}
