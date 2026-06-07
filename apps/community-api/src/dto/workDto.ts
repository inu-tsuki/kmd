import { z } from 'zod';
import type { KmdScriptRevision, Work } from '../domain/types.js';

export const workQuerySchema = z.object({
  mode: z.enum(['scroll', 'paged', 'stage', 'interactive']).optional(),
  status: z.enum(['published', 'submitted', 'draft']).optional(),
  q: z.string().trim().min(1).optional()
});

export type WorkQueryDto = z.infer<typeof workQuerySchema>;

export function toWorkSummaryDto(work: Work) {
  const activeRevision = getActiveRevision(work);

  return {
    id: work.id,
    title: work.title,
    authorName: work.authorName,
    description: work.description,
    tags: work.tags,
    presentationMode: work.presentationMode,
    orientationHint: work.orientationHint,
    aspectRatio: work.aspectRatio,
    lifecycleStatus: work.lifecycleStatus,
    interactionLevel: work.interactionLevel,
    previewMode: work.previewMode,
    estimatedDurationSec: work.estimatedDurationSec,
    coverUrl: work.coverUrl,
    script: toActiveScriptDto(activeRevision)
  };
}

export function toWorkDetailDto(work: Work) {
  return {
    ...toWorkSummaryDto(work),
    script: toScriptRefDto(work),
    assetManifest: work.assetManifest,
    stats: work.stats,
    commentSummary: work.commentSummary
  };
}

export function getActiveRevision(work: Work): KmdScriptRevision {
  const revision = work.script.revisions.find((candidate) => (
    candidate.id === work.script.activeRevisionId
  ));

  if (!revision) {
    throw new Error(`Active KMD revision not found for work: ${work.id}`);
  }

  return revision;
}

function toActiveScriptDto(revision: KmdScriptRevision) {
  return {
    activeRevisionId: revision.id,
    sourceUrl: revision.sourceUrl,
    mimeType: revision.mimeType,
    kmdVersion: revision.kmdVersion,
    runtimeVersion: revision.runtimeVersion,
    contentHash: revision.contentHash
  };
}

function toScriptRefDto(work: Work) {
  return {
    activeRevisionId: work.script.activeRevisionId,
    revisions: work.script.revisions.map((revision) => ({
      id: revision.id,
      label: revision.label,
      sourceUrl: revision.sourceUrl,
      mimeType: revision.mimeType,
      kmdVersion: revision.kmdVersion,
      runtimeVersion: revision.runtimeVersion,
      createdAt: revision.createdAt,
      contentHash: revision.contentHash
    }))
  };
}
