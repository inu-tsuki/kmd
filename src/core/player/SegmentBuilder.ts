import { Container } from "pixi.js";
import { KineticText } from "../KineticText";
import { layout } from "../layout/LayoutEngine";
import { TextPlayer } from "../render/text/TextPlayer";
import { EffectProcessor } from "../effects/EffectProcessor";
import { effectManager } from "../effects/EffectManager";
import type { KMDMetadata, KMDParagraphData } from "../parser/types";
import type { Checkpoint, InFlightAnimation, ParagraphUnit, Segment } from "../state/Segment";
import type { BehaviorRecord, StyleRecord } from "../render/text/TextPlayer";
import { stageManager } from "../stage/StageManager";
import { createParagraphExecutionPlan } from "../execution/paragraphExecutionPlan";
import type { PlaybackRuntimeState } from "./PlaybackController";
import gsap from "gsap";

type ActiveStageTweenEntry = {
  tween: gsap.core.Tween | gsap.core.Timeline;
  startPosition: number;
  originalDuration: number;
  ease: string;
  fromValues: Record<string, number>;
  toValues: Record<string, number>;
  target: any;
};

export interface SegmentBuildContext {
  container: Container;
  metadata: KMDMetadata;
  paragraphs: KMDParagraphData[];
  rawParagraphs: string[];
  currentMode: "stage" | "scroll" | "page";
  playbackState: PlaybackRuntimeState;
}

export interface SegmentBuildResult {
  segment: Segment;
  timelineMarkers: any[];
  activeTexts: KineticText[];
}

function extractTweenTargets(command: string, params: any): Record<string, number> {
  switch (command) {
    case "cam.move":
      return { x: params.x ?? params[0] ?? 0, y: params.y ?? params[1] ?? 0 };
    case "cam.offset":
      return { x: params.x ?? params[0] ?? 0, y: params.y ?? params[1] ?? 0 };
    case "cam.zoom":
      return { zoom: params.val ?? params[0] ?? 1 };
    case "cam.rotate":
      return { rotation: params.val ?? params[0] ?? 0 };
    case "cam.reset":
      return { x: 0, y: 0, zoom: 1, rotation: 0 };
    default:
      return {};
  }
}

function getStagePropertyKey(command: string): string | null {
  const propertyKey = stageManager.getCommandMetadata(command)?.propertyKey;
  if (
    propertyKey === "camera.xy" ||
    propertyKey === "camera.zoom" ||
    propertyKey === "camera.rotation" ||
    propertyKey === "offset.xy"
  ) {
    return propertyKey;
  }
  return null;
}

function isModifierBasedStageCommand(command: string): boolean {
  return stageManager.getCommandMetadata(command)?.modifierBased === true;
}

function trimActiveStageTween(
  tl: gsap.core.Timeline,
  entry: ActiveStageTweenEntry,
  cutTime: number,
): Record<string, number> | null {
  if (cutTime >= entry.startPosition + entry.originalDuration) {
    return null;
  }
  if (cutTime <= entry.startPosition) {
    tl.remove(entry.tween);
    return { ...entry.fromValues };
  }

  const trimDur = cutTime - entry.startPosition;
  const cutRatio = trimDur / entry.originalDuration;
  const easeFn = gsap.parseEase(entry.ease);
  const progress = easeFn(cutRatio);
  const cutValues: Record<string, number> = {};
  for (const [prop, fromVal] of Object.entries(entry.fromValues)) {
    cutValues[prop] = fromVal + ((entry.toValues[prop] ?? fromVal) - fromVal) * progress;
  }

  tl.remove(entry.tween);
  const replacement = gsap.fromTo(
    entry.target,
    { ...entry.fromValues },
    { ...cutValues, duration: trimDur, ease: entry.ease, overwrite: false, immediateRender: false },
  );
  tl.add(replacement, entry.startPosition);
  return cutValues;
}

export class SegmentBuilder {
  public static async build(context: SegmentBuildContext): Promise<SegmentBuildResult> {
    layout.reset();

    const segmentTl = gsap.timeline({ paused: true });
    const allBehaviors: BehaviorRecord[] = [];
    const allStyleRecords: StyleRecord[] = [];
    const paragraphUnits: ParagraphUnit[] = [];
    const markers: any[] = [];
    const stageTweenRecords: InFlightAnimation[] = [];
    const activeTexts: KineticText[] = [];

    const entryCheckpoint: Checkpoint = {
      stage: stageManager.dumpState(),
      layout: layout.dumpState(),
      activeParagraphs: [],
    };

    let segmentCursor = 0;
    let activeParagraphIndices: Array<{ index: number; x: number; y: number }> = [];

    stageManager.buildMode = true;
    const activeStageTweens = new Map<string, ActiveStageTweenEntry>();
    const virtualCam = { ...stageManager.camera };
    const virtualOff = { ...stageManager.cameraOffset };
    // page mode and authored scene.clear now share one clear path through StageRuntime.
    const clearActiveParagraphs = () => {
      const clearTl = gsap.timeline();
      for (const paragraphUnit of paragraphUnits) {
        if (activeParagraphIndices.some((active) => active.index === paragraphUnit.paragraphIndex)) {
          clearTl.set(paragraphUnit.kineticText, { visible: false }, 0);
        }
      }
      activeParagraphIndices = [];
      return clearTl;
    };

    stageManager.setSceneClearHandler(() => clearActiveParagraphs());

    try {
      for (let i = 0; i < context.paragraphs.length; i++) {
        const pData = context.paragraphs[i];
        const rawText = context.rawParagraphs[i];
        if (!pData || rawText === undefined) continue;

        pData.snapshot = {
          stage: stageManager.dumpState(),
          layout: layout.dumpState(),
          activeParagraphs: [...activeParagraphIndices],
        };

        const hasSceneClearCue = pData.tokens.some((token) =>
          token.layoutInstructions.some((instruction) => instruction.type === "scene.clear"),
        );

        // Page mode is treated as an implicit clear cue, but it still reuses the same runtime-owned hook.
        if (context.currentMode === "page" && activeParagraphIndices.length > 0) {
          const pageClearTl = clearActiveParagraphs();
          if (pageClearTl.getChildren().length > 0) {
            segmentTl.add(pageClearTl, segmentCursor);
          }
        }

        const paragraphText = await this.createParagraphText(context, pData, rawText);
        const pos = await this.placeParagraph(paragraphText, context, pData);

        const { visualConfigs, stageConfigs } = EffectProcessor.partition(pData.globalEffects);
        segmentCursor = this.applyStageConfigs(
          segmentTl,
          stageConfigs,
          stageTweenRecords,
          activeStageTweens,
          virtualCam,
          virtualOff,
          segmentCursor,
        );

        if (visualConfigs.length > 0) {
          EffectProcessor.applyGroupEffects(paragraphText, [...visualConfigs]);
        }

        const displayAssembly = paragraphText._displayAssembly;
        const paragraphExecutionPlan = createParagraphExecutionPlan(displayAssembly);
        const buildResult = TextPlayer.buildTimeline(
          paragraphText,
          paragraphExecutionPlan,
          { speed: context.metadata.speed },
        );

        const childCount = buildResult.timeline.getChildren().length;
        if (childCount > 0) {
          segmentTl.add(buildResult.timeline, segmentCursor);
        }

        context.container.addChild(paragraphText);
        activeTexts.push(paragraphText);
        displayAssembly.chars.forEach((char) => { char.visible = false; });
        paragraphText.visible = true;

        for (const behavior of buildResult.behaviors) {
          const absTime = behavior.timePosition + segmentCursor;
          allBehaviors.push({
            ...behavior,
            timePosition: absTime,
          });
          const behaviorChar = behavior.char;
          const behaviorName = behavior.effectName;
          const behaviorParams = { ...behavior.params };
          segmentTl.call(() => {
            if (!context.playbackState.isAutoPlaying) return;
            effectManager.apply(behaviorChar, behaviorName, behaviorParams, true);
            context.playbackState.activeBehaviorCleanups.push({
              char: behaviorChar,
              modName: behaviorName,
            });
          }, [], absTime);
        }

        for (const styleRecord of buildResult.styleRecords) {
          allStyleRecords.push({
            ...styleRecord,
            timePosition: styleRecord.timePosition + segmentCursor,
          });
        }

        paragraphUnits.push({
          paragraphIndex: i,
          kineticText: paragraphText,
          offsetInSegment: segmentCursor,
          behaviors: buildResult.behaviors,
          duration: buildResult.duration,
        });

        const absStartMs = segmentCursor * 1000;
        pData.absStartTime = absStartMs;
        pData.estimatedDuration = buildResult.duration * 1000;
        pData.tokens.forEach((token) => {
          if (token.startTime !== undefined && (token.content.trim() || token.isSceneClear)) {
            const absStart = absStartMs + token.startTime;
            const nextToken = pData.tokens[pData.tokens.indexOf(token) + 1];
            const endTime = nextToken
              ? absStartMs + nextToken.startTime!
              : absStartMs + buildResult.duration * 1000;

            markers.push({
              line: (token.line || 0) + 1,
              startTime: absStart,
              duration: Math.max(50, endTime - absStart),
              content: token.isSceneClear ? "--- SCENE CLEAR ---" : token.content,
              type: token.isSceneClear ? "scene" : "text",
            });
          }
        });

        activeParagraphIndices.push({ index: i, x: pos.x, y: pos.y });
        const height = paragraphText.getLayoutHeight();
        layout.currentY += height + 20;

        if (buildResult.advanceTime !== undefined) {
          segmentCursor += buildResult.advanceTime;
        } else {
          segmentCursor += buildResult.duration;
          if (!(context.currentMode === "page" || hasSceneClearCue)) {
            segmentCursor += 2;
          }
        }
      }
    } finally {
      stageManager.setSceneClearHandler(undefined);
      stageManager.buildMode = false;
    }

    segmentTl.set({}, {}, segmentCursor);

    const inFlight = stageTweenRecords.filter((record) => {
      const endTime = record.startTimeInSegment + record.totalDuration;
      return endTime > segmentCursor;
    });
    const exitCheckpoint: Checkpoint = {
      stage: stageManager.dumpState(),
      layout: layout.dumpState(),
      activeParagraphs: [...activeParagraphIndices],
      inFlightAnimations: inFlight.length > 0 ? inFlight : undefined,
    };

    segmentTl.eventCallback("onUpdate", () => {
      context.playbackState.onTimeUpdate?.(segmentTl.time() * 1000);
    });

    segmentTl.eventCallback("onComplete", () => {
      context.playbackState.isAutoPlaying = false;
    });

    const segment: Segment = {
      id: "main",
      paragraphs: paragraphUnits,
      timeline: segmentTl,
      behaviors: allBehaviors,
      styleRecords: allStyleRecords,
      stageTweenRecords,
      entryCheckpoint,
      exitCheckpoint,
      duration: Math.max(segmentTl.duration(), segmentCursor),
    };

    return {
      segment,
      timelineMarkers: markers,
      activeTexts,
    };
  }

  private static async createParagraphText(
    context: SegmentBuildContext,
    paragraph: KMDParagraphData,
    rawText: string,
  ) {
    const maxWidth = paragraph.blockOptions.maxWidth || stageManager.designWidth * 0.8;
    const paragraphText = new KineticText({
      maxWidth: context.metadata.maxWidth || maxWidth,
      ...paragraph.blockOptions,
      externalMarkers: layout.globalMarkers,
      baseOffset: { x: 0, y: 0 },
    });

    // Segment build now keeps the parser-produced paragraph as the semantic source of truth.
    await paragraphText.initFromParagraph({
      paragraph,
      sourceKMD: rawText,
    });
    return paragraphText;
  }

  private static async placeParagraph(
    paragraphText: KineticText,
    context: SegmentBuildContext,
    paragraph: KMDParagraphData,
  ) {
    const designWidth = stageManager.designWidth;
    const designHeight = stageManager.designHeight;
    const align = paragraph.blockOptions.align || "left";
    const maxWidth = paragraph.blockOptions.maxWidth || designWidth * 0.8;
    let x: number;
    let y: number;

    if (context.currentMode === "stage" || context.currentMode === "scroll") {
      paragraphText.isAutoLayout = true;
      x = align === "center" ? (designWidth - maxWidth) / 2 : designWidth * 0.1;
      y = layout.currentY;
    } else {
      paragraphText.isAutoLayout = false;
      x = align === "center" ? (designWidth - paragraphText.getLayoutWidth()) / 2 : designWidth * 0.1;
      y = designHeight * 0.7;
    }

    paragraphText.x = x;
    paragraphText.y = y;

    await paragraphText.rebuild(
      {
        baseOffset: { x, y },
        externalMarkers: layout.globalMarkers,
      },
    );

    return { x, y };
  }

  private static applyStageConfigs(
    segmentTl: gsap.core.Timeline,
    stageConfigs: any[],
    stageTweenRecords: InFlightAnimation[],
    activeStageTweens: Map<string, ActiveStageTweenEntry>,
    virtualCam: Record<string, number>,
    virtualOff: Record<string, number>,
    segmentCursor: number,
  ) {
    let cursor = segmentCursor;

    for (const config of stageConfigs) {
      if (config.name === "pause") {
        const duration = Number(config.params?.duration ?? config.params?.d ?? config.params?.[0] ?? 1);
        cursor += duration;
        continue;
      }

      if (isModifierBasedStageCommand(config.name)) {
        const configCopy = { name: config.name, params: { ...(config.params || {}) } };
        segmentTl.call(() => {
          stageManager.apply(configCopy.name, configCopy.params);
        }, [], cursor);
        continue;
      }

      const propKey = getStagePropertyKey(config.name);
      if (config.name === "cam.reset") {
        for (const [, entry] of activeStageTweens) {
          trimActiveStageTween(segmentTl, entry, cursor);
        }
        activeStageTweens.clear();
        Object.assign(virtualCam, { x: 0, y: 0, zoom: 1, rotation: 0 });
        Object.assign(virtualOff, { x: 0, y: 0, zoom: 1, rotation: 0 });
      } else if (propKey) {
        const existing = activeStageTweens.get(propKey);
        if (existing) {
          stageManager.reportConflictDiagnostic({
            severity: "warning",
            channel: propKey,
            command: config.name,
            message: `Trimmed active stage tween on channel "${propKey}" before applying "${config.name}".`,
          });
          const cutValues = trimActiveStageTween(segmentTl, existing, cursor);
          if (cutValues) {
            Object.assign(propKey.startsWith("offset") ? virtualOff : virtualCam, cutValues);
          }
          activeStageTweens.delete(propKey);
        }
      }

      const result = stageManager.apply(config.name, config.params);
      this.captureTween(segmentTl, result, cursor);

      if (propKey && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
        const duration = result.duration();
        if (duration > 0) {
          const toValues = extractTweenTargets(config.name, config.params);
          const virtualState = propKey.startsWith("offset") ? virtualOff : virtualCam;
          const fromValues: Record<string, number> = {};
          for (const key of Object.keys(toValues)) fromValues[key] = virtualState[key] ?? 0;
          activeStageTweens.set(propKey, {
            tween: result,
            startPosition: cursor,
            originalDuration: duration,
            ease: "power2.inOut",
            fromValues,
            toValues,
            target: propKey.startsWith("offset") ? stageManager.cameraOffset : stageManager.camera,
          });
          Object.assign(virtualState, toValues);
        }
      }

      if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
        const duration = result.duration();
        if (duration > 0) {
          stageTweenRecords.push({
            command: config.name,
            targets: extractTweenTargets(config.name, config.params),
            totalDuration: duration,
            startTimeInSegment: cursor,
            ease: duration > 0 ? "power2.inOut" : "none",
          });
        }
      }

      if (config.blocking && (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline)) {
        cursor += result.duration();
      }
    }

    return cursor;
  }

  private static captureTween(timeline: gsap.core.Timeline, result: any, position: number) {
    if (result instanceof gsap.core.Tween || result instanceof gsap.core.Timeline) {
      timeline.add(result, position);
    }
  }
}
