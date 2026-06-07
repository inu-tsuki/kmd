import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommunityStore } from '../data/store.js';
import { getActiveRevision, toWorkDetailDto, toWorkSummaryDto, workQuerySchema } from '../dto/workDto.js';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const contentRoot = path.resolve(appRoot, 'content');

export function createWorksRouter(store: CommunityStore): Router {
  const router = Router();

  router.get('/', (request, response, next) => {
    const parsed = workQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      response.status(400).json({
        error: 'invalid_query',
        issues: parsed.error.flatten().fieldErrors
      });
      return;
    }

    try {
      response.json(store.listWorks(parsed.data).map(toWorkSummaryDto));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', (request, response) => {
    const work = store.getWork(request.params.id);

    if (!work) {
      response.status(404).json({ error: 'work_not_found' });
      return;
    }

    response.json(toWorkDetailDto(work));
  });

  router.get('/:id/source', async (request, response, next) => {
    const work = store.getWork(request.params.id);

    if (!work) {
      response.status(404).json({ error: 'work_not_found' });
      return;
    }

    try {
      const revision = getActiveRevision(work);
      const source = await readKmdSource(revision.sourcePath);
      response
        .type(`${revision.mimeType}; charset=utf-8`)
        .setHeader('X-KMD-Work-Id', work.id);
      response.setHeader('X-KMD-Revision-Id', revision.id);
      response.send(source);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/revisions/:revisionId/source', async (request, response, next) => {
    const work = store.getWork(request.params.id);

    if (!work) {
      response.status(404).json({ error: 'work_not_found' });
      return;
    }

    const revision = work.script.revisions.find((candidate) => (
      candidate.id === request.params.revisionId
    ));

    if (!revision) {
      response.status(404).json({ error: 'revision_not_found' });
      return;
    }

    try {
      const source = await readKmdSource(revision.sourcePath);
      response
        .type(`${revision.mimeType}; charset=utf-8`)
        .setHeader('X-KMD-Work-Id', work.id);
      response.setHeader('X-KMD-Revision-Id', revision.id);
      response.send(source);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/issues', (request, response) => {
    const work = store.getWork(request.params.id);

    if (!work) {
      response.status(404).json({ error: 'work_not_found' });
      return;
    }

    response.json(store.listIssues(request.params.id));
  });

  return router;
}

async function readKmdSource(sourcePath: string): Promise<string> {
  const resolvedPath = path.resolve(appRoot, sourcePath);

  if (!resolvedPath.startsWith(`${contentRoot}${path.sep}`)) {
    throw new Error(`KMD source is outside content root: ${sourcePath}`);
  }

  return readFile(resolvedPath, 'utf8');
}
