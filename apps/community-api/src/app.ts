import express from 'express';
import type { ErrorRequestHandler } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommunityStore } from './data/store.js';
import { createReviewsRouter } from './routes/reviews.js';
import { createWorksRouter } from './routes/works.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const contentRoot = path.resolve(appRoot, 'content');

export function createApp(store = new CommunityStore()) {
  const app = express();

  app.use(express.json());

  // 静态资源——bg(src="tests/assets/sample-bg.jpg") 在运行时解析为
  // /tests/assets/sample-bg.jpg（stagePresets.ts 前缀 baseUrl "/"），
  // 故在此路径 serve 背景图，让 community-api 端预览也能加载图片。
  app.use('/tests/assets', express.static(path.resolve(contentRoot, 'assets')));

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
