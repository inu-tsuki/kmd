import { z } from 'zod';

export const reviewRequestSchema = z.object({
  workId: z.string().trim().min(1),
  reviewerName: z.string().trim().min(1).max(80),
  decision: z.enum(['approve', 'needs_changes', 'reject']),
  note: z.string().trim().min(1).max(1000)
});

export type ReviewRequestDto = z.infer<typeof reviewRequestSchema>;

export function toReviewResponseDto(review: {
  id: string;
  workId: string;
  decision: 'approve' | 'needs_changes' | 'reject';
}) {
  return {
    id: review.id,
    workId: review.workId,
    decision: review.decision,
    accepted: true
  };
}
