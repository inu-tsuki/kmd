import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

describe('kmd-community-api', () => {
  it('returns health status', async () => {
    const response = await request(createApp()).get('/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      service: 'kmd-community-api'
    });
  });

  it('lists works with filters', async () => {
    const response = await request(createApp())
      .get('/works')
      .query({ mode: 'stage', status: 'submitted' })
      .expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body.map((work: { id: string }) => work.id)).toEqual([
      'glass-rail',
      'final-test'
    ]);
    expect(response.body[0]).toMatchObject({
      id: 'glass-rail',
      presentationMode: 'stage',
      lifecycleStatus: 'submitted'
    });
  });

  it('returns work details and issues', async () => {
    const app = createApp();
    const detail = await request(app).get('/works/glass-rail').expect(200);
    const issues = await request(app).get('/works/glass-rail/issues').expect(200);

    expect(detail.body).toMatchObject({
      id: 'glass-rail',
      script: {
        activeRevisionId: 'rev-1',
        revisions: [{
          id: 'rev-1',
          sourceUrl: '/works/glass-rail/source',
          mimeType: 'text/x-kmd'
        }]
      },
      stats: {
        scenes: 7
      }
    });
    expect(issues.body.length).toBeGreaterThan(0);
    expect(issues.body[0]).toHaveProperty('suggestion');
  });

  it('serves active KMD source for a work', async () => {
    const response = await request(createApp())
      .get('/works/glass-rail/source')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/x-kmd');
    expect(response.headers['x-kmd-work-id']).toBe('glass-rail');
    expect(response.headers['x-kmd-revision-id']).toBe('rev-1');
    expect(response.text).toContain('Glass Rail');
  });

  it('serves the final runtime integration KMD source', async () => {
    const response = await request(createApp())
      .get('/works/final-test/source')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/x-kmd');
    expect(response.headers['x-kmd-work-id']).toBe('final-test');
    expect(response.text).toContain('最终集成全功能测试');
    expect(response.text).toContain('cam.reset');
  });

  it('lists all 31 works including reader typography and visual fixtures without filters', async () => {
    const response = await request(createApp()).get('/works').expect(200);

    expect(response.body).toHaveLength(31);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'reader-visual-scroll', presentationMode: 'scroll', lifecycleStatus: 'published' }),
      expect.objectContaining({ id: 'reader-visual-paged', presentationMode: 'paged', lifecycleStatus: 'published' })
    ]));
    // 打包自 public/ 的新 work 全部是 published，不应撞 submitted 过滤器
    const publishedFromPublic = response.body.filter((w: { lifecycleStatus: string; tags: string[] }) =>
      w.lifecycleStatus === 'published' && w.tags.includes('demo')
    );
    expect(publishedFromPublic.length).toBeGreaterThanOrEqual(3);
  });

  it('serves source-backed reader host visual fixtures', async () => {
    const app = createApp();
    const scroll = await request(app).get('/works/reader-visual-scroll/source').expect(200);
    const paged = await request(app).get('/works/reader-visual-paged/source').expect(200);

    expect(scroll.headers['content-type']).toContain('text/x-kmd');
    expect(scroll.headers['x-kmd-work-id']).toBe('reader-visual-scroll');
    expect(scroll.headers['x-kmd-revision-id']).toBe('rev-1');
    expect(scroll.text).toContain('VISUAL_SCROLL_SENTINEL');
    expect(paged.headers['content-type']).toContain('text/x-kmd');
    expect(paged.headers['x-kmd-work-id']).toBe('reader-visual-paged');
    expect(paged.headers['x-kmd-revision-id']).toBe('rev-1');
    expect(paged.text).toContain('VISUAL_PAGED_SENTINEL');
  });

  it('serves an fx filter showcase source', async () => {
    const response = await request(createApp())
      .get('/works/bloom/source')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/x-kmd');
    expect(response.headers['x-kmd-work-id']).toBe('bloom');
    expect(response.text).toContain('bloom');
  });

  it('serves the cyberpunk title demo source with bg(src) references', async () => {
    const response = await request(createApp())
      .get('/works/cyberpunk-title/source')
      .expect(200);

    expect(response.text).toContain('bg(src');
    expect(response.text).toContain('NEON CITY');
  });

  it('serves the background image at /tests/assets/sample-bg.jpg', async () => {
    const response = await request(createApp())
      .get('/tests/assets/sample-bg.jpg')
      .expect(200);

    expect(response.headers['content-type']).toBe('image/jpeg');
  });

  it('creates a review for an existing work', async () => {
    const response = await request(createApp())
      .post('/reviews')
      .send({
        workId: 'glass-rail',
        reviewerName: 'demo-reviewer',
        decision: 'needs_changes',
        note: 'Mobile preview needs a softer default motion preset.'
      })
      .expect(201);

    expect(response.body).toMatchObject({
      id: 'review-001',
      workId: 'glass-rail',
      decision: 'needs_changes',
      accepted: true
    });
  });
});
