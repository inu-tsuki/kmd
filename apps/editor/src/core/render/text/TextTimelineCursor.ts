export interface TimelineCursorTiming {
  speedMultiplier?: number;
  delayOverride?: number;
  advanceLevel?: string;
}

export class TextTimelineCursor {
  private cursor = 0;
  private persistentSpeedMult = 1.0;
  private groupSpeedMult = 1.0;
  private lastWasInstantGo = false;
  private groupForkCursor: number | undefined = undefined;
  private pauseCharOverride: number | undefined = undefined;
  private deferredCursorAdvance = 0;
  private _advanceTime: number | undefined = undefined;

  public get position() {
    return this.cursor;
  }

  public get advanceTime() {
    return this._advanceTime;
  }

  public beginToken(pauseCharOverride?: number) {
    this.deferredCursorAdvance = 0;
    this.pauseCharOverride = pauseCharOverride;
  }

  public consumeNewLine(baseSpeed: number) {
    if (this.groupForkCursor !== undefined) {
      this.cursor = this.groupForkCursor;
      this.groupForkCursor = undefined;
    } else if (!this.lastWasInstantGo) {
      this.cursor += baseSpeed * 10;
    }

    this.persistentSpeedMult = 1.0;
    this.groupSpeedMult = 1.0;
    this.lastWasInstantGo = false;
  }

  public applyTiming(timing: TimelineCursorTiming) {
    if (timing.speedMultiplier !== undefined) {
      this.persistentSpeedMult = timing.speedMultiplier;
    }

    const delayOverride = timing.delayOverride;
    const isSugarGo = delayOverride === 0;
    const isInstantGo = isSugarGo || this.lastWasInstantGo;

    if (timing.advanceLevel === "block") {
      this._advanceTime = this.cursor;
    }
    if (timing.advanceLevel === "group") {
      this.groupForkCursor = this.cursor;
    }

    return {
      delayOverride,
      isSugarGo,
      isInstantGo,
      pauseCharOverride: this.pauseCharOverride,
    };
  }

  public addDeferredAdvance(delta: number) {
    this.deferredCursorAdvance += delta;
  }

  public advanceChar(args: {
    charText: string;
    baseSpeed: number;
    isInstantGo: boolean;
    delayOverride?: number;
  }) {
    if (args.isInstantGo) {
      return;
    }

    if (this.pauseCharOverride !== undefined && args.charText.trim()) {
      this.cursor += this.pauseCharOverride;
      return;
    }

    if (args.delayOverride !== undefined && args.delayOverride > 0) {
      this.cursor += args.delayOverride;
      return;
    }

    if (args.delayOverride === undefined && args.charText !== "") {
      const isPunctuation = /[，。！？]/.test(args.charText);
      const speed = args.baseSpeed * this.persistentSpeedMult * this.groupSpeedMult;
      this.cursor += isPunctuation ? speed * 5 : speed;
    }
  }

  public flushTokenAdvance(isTokenEnd: boolean) {
    if (!isTokenEnd || this.deferredCursorAdvance <= 0) {
      return;
    }
    this.cursor += this.deferredCursorAdvance;
    this.deferredCursorAdvance = 0;
  }

  public finishItem(args: {
    isTokenEnd: boolean;
    isSugarGo: boolean;
    delayOverride?: number;
  }) {
    this.lastWasInstantGo = args.isSugarGo;
    if (args.delayOverride !== undefined && args.delayOverride > 0) {
      this.lastWasInstantGo = false;
    }
    if (args.isTokenEnd) {
      this.groupSpeedMult = 1.0;
      this.pauseCharOverride = undefined;
    }
  }
}
