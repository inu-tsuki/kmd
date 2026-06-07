import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { CommunityStore } from './data/store.js';
import { createReviewsRouter } from './routes/reviews.js';
import { createWorksRouter } from './routes/works.js';

export function createApp(store = new CommunityStore()) {
  const app = express();

  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'kmd-community-api'
    });
  });

  app.use('/works', createWorksRouter(store));
  app.use('/reviews', createReviewsRouter(store));

  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found' });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: 'internal_error' });
  };

  app.use(errorHandler);

  return app;
}
