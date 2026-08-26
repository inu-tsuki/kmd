import { z } from 'zod';
import type { KmdScriptRevision } from '../domain/types.js';

export const issueQuerySchema = z.object({
  revisionId: z.string().trim().min(1).optional()
}).strict();

export type IssueQueryDto = z.infer<typeof issueQuerySchema>;

export function toRevisionDto(workId: string, revision: KmdScriptRevision) {
  return {
    id: revision.id,
    label: revision.label,
    sourceUrl: `/works/${encodeURIComponent(workId)}/revisions/${encodeURIComponent(revision.id)}/source`,
    mimeType: revision.mimeType,
    kmdVersion: revision.kmdVersion,
    runtimeVersion: revision.runtimeVersion,
    createdAt: revision.createdAt,
    contentHash: revision.contentHash
  };
}
