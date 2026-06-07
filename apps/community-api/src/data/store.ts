import type { Review, ScriptIssue, Work, WorkFilters } from '../domain/types.js';
import { seedIssues, seedWorks } from './seed.js';

export class CommunityStore {
  private readonly works: Work[];
  private readonly issues: ScriptIssue[];
  private readonly reviews: Review[] = [];

  constructor(works: Work[] = seedWorks, issues: ScriptIssue[] = seedIssues) {
    this.works = works;
    this.issues = issues;
  }

  listWorks(filters: WorkFilters = {}): Work[] {
    const keyword = filters.q?.trim().toLowerCase();

    return this.works.filter((work) => {
      if (filters.mode && work.presentationMode !== filters.mode) {
        return false;
      }

      if (filters.status && work.lifecycleStatus !== filters.status) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const searchable = [
        work.title,
        work.authorName,
        work.description,
        ...work.tags
      ].join(' ').toLowerCase();

      return searchable.includes(keyword);
    });
  }

  getWork(id: string): Work | undefined {
    return this.works.find((work) => work.id === id);
  }

  listIssues(workId: string): ScriptIssue[] {
    return this.issues.filter((issue) => issue.workId === workId);
  }

  createReview(input: Omit<Review, 'id' | 'createdAt'>): Review {
    const review: Review = {
      ...input,
      id: `review-${String(this.reviews.length + 1).padStart(3, '0')}`,
      createdAt: new Date().toISOString()
    };

    this.reviews.push(review);
    return review;
  }
}
