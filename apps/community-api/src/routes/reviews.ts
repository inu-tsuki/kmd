import { Router } from 'express';
import type { CommunityStore } from '../data/store.js';
import { reviewRequestSchema, toReviewResponseDto } from '../dto/reviewDto.js';

export function createReviewsRouter(store: CommunityStore): Router {
  const router = Router();

  router.post('/', (request, response) => {
    const parsed = reviewRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_review',
        issues: parsed.error.flatten().fieldErrors
      });
      return;
    }

    if (!store.getWork(parsed.data.workId)) {
      response.status(404).json({ error: 'work_not_found' });
      return;
    }

    const review = store.createReview(parsed.data);
    response.status(201).json(toReviewResponseDto(review));
  });

  return router;
}
