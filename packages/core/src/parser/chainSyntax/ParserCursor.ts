import type {
  ChainDiagnostic,
  ChainDiagnosticCode,
  SourceRange,
} from "./types";

export interface BalancedReadResult {
  raw: string;
  inner: string;
  range: SourceRange;
  closed: boolean;
}

export class ParserCursor {
  readonly source: string;
  readonly baseOffset: number;
  readonly diagnostics: ChainDiagnostic[];
  private index = 0;

  constructor(
    source: string,
    baseOffset = 0,
    diagnostics: ChainDiagnostic[] = [],
  ) {
    this.source = source;
    this.baseOffset = baseOffset;
    this.diagnostics = diagnostics;
  }

  get position(): number {
    return this.index;
  }

  get absolutePosition(): number {
    return this.baseOffset + this.index;
  }

  get eof(): boolean {
    return this.index >= this.source.length;
  }

  peek(offset = 0): string | undefined {
    return this.source[this.index + offset];
  }

  consume(): string | undefined {
    const value = this.peek();
    if (value !== undefined) {
      this.index += 1;
    }
    return value;
  }

  consumeIf(text: string): boolean {
    if (!this.source.startsWith(text, this.index)) {
      return false;
    }
    this.index += text.length;
    return true;
  }

  mark(): number {
    return this.index;
  }

  advanceTo(position: number): void {
    if (position < this.index || position > this.source.length) {
      throw new RangeError(`Invalid cursor advance: ${this.index} -> ${position}`);
    }
    this.index = position;
  }

  restore(position: number): void {
    if (position < 0 || position > this.source.length) {
      throw new RangeError(`Invalid cursor position: ${position}`);
    }
    this.index = position;
  }

  rangeFrom(mark: number): SourceRange {
    return {
      start: this.baseOffset + mark,
      end: this.absolutePosition,
    };
  }

  rawFrom(mark: number): string {
    return this.source.slice(mark, this.index);
  }

  skipInlineWhitespace(): void {
    while (this.peek() === " " || this.peek() === "\t") {
      this.consume();
    }
  }

  expect(
    text: string,
    code: ChainDiagnosticCode,
    message = `Expected ${JSON.stringify(text)}.`,
  ): boolean {
    if (this.consumeIf(text)) {
      return true;
    }
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      range: {
        start: this.absolutePosition,
        end: this.absolutePosition,
      },
    });
    return false;
  }

  /**
   * Reads a balanced region while ignoring delimiters inside quoted or escaped text.
   * The cursor remains at EOF when the closing delimiter is missing so the caller can recover.
   */
  readBalanced(open: string, close: string): BalancedReadResult | null {
    const start = this.mark();
    if (!this.consumeIf(open)) {
      return null;
    }

    let depth = 1;
    let quote: "\"" | "'" | null = null;
    let escaped = false;

    while (!this.eof) {
      if (quote !== null) {
        const char = this.consume();
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }

      const char = this.peek();
      if (char === "\"" || char === "'") {
        quote = char;
        this.consume();
      } else if (this.consumeIf(open)) {
        depth += 1;
      } else if (this.consumeIf(close)) {
        depth -= 1;
        if (depth === 0) {
          const raw = this.rawFrom(start);
          return {
            raw,
            inner: raw.slice(open.length, -close.length),
            range: this.rangeFrom(start),
            closed: true,
          };
        }
      } else {
        this.consume();
      }
    }

    const raw = this.rawFrom(start);
    return {
      raw,
      inner: raw.slice(open.length),
      range: this.rangeFrom(start),
      closed: false,
    };
  }
}
