import { layoutManager } from "./LayoutManager";
import type {
  CursorState,
  LayoutCommand,
  LayoutContext,
  LayoutEngineOptions,
  LayoutItem,
  LayoutStream,
  MarkerMap,
} from "./types";

export interface MeasuredLayoutItem {
  item: LayoutItem;
  charText: string;
  stepDistance: number;
}

export interface LayoutPassState {
  context: LayoutContext;
  options: LayoutEngineOptions;
}

export interface LayoutPassHooks<TState extends LayoutPassState> {
  beforeNode?: (state: TState, node: LayoutItem | LayoutCommand) => void;
  onCommand?: (state: TState, command: LayoutCommand) => boolean | void;
  onNewline?: (state: TState, item: MeasuredLayoutItem) => void;
  onWrap?: (state: TState, item: MeasuredLayoutItem) => void;
  onItem?: (state: TState, item: MeasuredLayoutItem) => void;
  afterItem?: (state: TState, item: MeasuredLayoutItem) => void;
}

export class LayoutPassRunner {
  public static findFirstLineMaxAscent(stream: LayoutStream) {
    let firstLineMaxAscent = 0;
    for (const node of stream) {
      if (node.isCommand) continue;
      const item = node as LayoutItem;
      if (item.charData?.char?.text === "\n") break;
      const ascent = item.charData?.ascent || 0;
      if (ascent > firstLineMaxAscent) firstLineMaxAscent = ascent;
    }
    return firstLineMaxAscent;
  }

  public static createContext(
    options: LayoutEngineOptions,
    markers: MarkerMap,
    baselineY: number,
    baseOffset: CursorState = options.baseOffset,
  ): LayoutContext {
    return {
      activeCursor: {
        x: options.indent * options.fontSize,
        y: baselineY,
      },
      isFlowBroken: false,
      justMoved: false,
      markers,
      touchedMarkers: [],
      displayOffset: { x: 0, y: 0 },
      _displayOffsetStack: [],
      baselineY,
      options: {
        ...options,
        baseOffset,
      },
    };
  }

  public static run<TState extends LayoutPassState>(
    stream: LayoutStream,
    state: TState,
    hooks: LayoutPassHooks<TState>,
  ) {
    for (const node of stream) {
      hooks.beforeNode?.(state, node);

      if (node.isCommand) {
        const command = node as LayoutCommand;
        const handled = hooks.onCommand?.(state, command);
        if (!handled) {
          const operator = layoutManager.getOperator(command.type);
          if (operator) operator(state.context, command.params);
        }
        continue;
      }

      const measured = this.measureItem(node as LayoutItem, state.options);
      if (measured.charText === "\n") {
        hooks.onNewline?.(state, measured);
        continue;
      }

      if (this.shouldWrap(state.context, measured.item, state.options)) {
        hooks.onWrap?.(state, measured);
      }

      hooks.onItem?.(state, measured);

      state.context.activeCursor.x += measured.stepDistance;
      state.context.justMoved = false;

      hooks.afterItem?.(state, measured);
    }
  }

  private static shouldWrap(context: LayoutContext, item: LayoutItem, options: LayoutEngineOptions) {
    return (
      !context.isFlowBroken &&
      !context.justMoved &&
      context.activeCursor.x + item.width > options.maxWidth * 1.05
    );
  }

  private static measureItem(item: LayoutItem, options: LayoutEngineOptions): MeasuredLayoutItem {
    const charText = item.charData?.char?.text || "";
    const fontSize = this.resolveFontSize(
      item.charData?.fontSize ?? item.charData?.char?.style?.fontSize,
      options.fontSize,
    );
    const tracking = fontSize * 0.02;
    return {
      item,
      charText,
      stepDistance: item.width + tracking + options.letterSpacing,
    };
  }

  private static resolveFontSize(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }
}
