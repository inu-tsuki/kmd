export type PresentationMode = 'scroll' | 'paged' | 'stage' | 'interactive';

export type OrientationHint = 'portrait' | 'landscape' | 'adaptive';

export type LifecycleStatus = 'published' | 'submitted' | 'draft';

export type InteractionLevel = 'read_only' | 'light_interactive' | 'interactive';

export type IssueSeverity = 'info' | 'warning' | 'error';

export type IssueSource = 'syntax' | 'performance' | 'accessibility' | 'metadata' | 'runtime';

export type ReviewDecision = 'approve' | 'needs_changes' | 'reject';

export interface CommentSummary {
  count: number;
  preview: string[];
}

export interface WorkStats {
  scenes: number;
  lines: number;
  effects: number;
}

export interface KmdScriptRevision {
  id: string;
  label: string;
  sourcePath: string;
  sourceUrl: string;
  mimeType: 'text/x-kmd';
  kmdVersion: string;
  runtimeVersion: string;
  createdAt: string;
  contentHash?: string;
}

export interface KmdScriptRef {
  activeRevisionId: string;
  revisions: KmdScriptRevision[];
}

export interface RuntimeAssetRef {
  url: string;
  type?: 'font' | 'image' | 'shader' | 'audio' | 'video' | 'data';
}

export interface RuntimeAssetManifest {
  baseUrl?: string;
  assets?: Record<string, RuntimeAssetRef>;
}

export interface Work {
  id: string;
  title: string;
  authorName: string;
  description: string;
  tags: string[];
  presentationMode: PresentationMode;
  orientationHint: OrientationHint;
  aspectRatio: string;
  lifecycleStatus: LifecycleStatus;
  interactionLevel: InteractionLevel;
  previewMode: 'clip' | 'cover' | 'none';
  estimatedDurationSec: number;
  coverUrl: string;
  script: KmdScriptRef;
  assetManifest?: RuntimeAssetManifest;
  stats: WorkStats;
  commentSummary: CommentSummary;
}

export interface ScriptIssue {
  id: string;
  workId: string;
  severity: IssueSeverity;
  source: IssueSource;
  location: string;
  message: string;
  suggestion: string;
}

export interface Review {
  id: string;
  workId: string;
  reviewerName: string;
  decision: ReviewDecision;
  note: string;
  createdAt: string;
}

export interface WorkFilters {
  mode?: PresentationMode;
  status?: LifecycleStatus;
  q?: string;
}
