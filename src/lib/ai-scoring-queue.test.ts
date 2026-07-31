import { describe, expect, it } from 'vitest';
import { getAiScoringQueueState } from './ai-scoring-queue';

describe('getAiScoringQueueState', () => {
  it('returns completed when the queue item finished', () => {
    expect(getAiScoringQueueState('completed', 1)).toBe('completed');
  });

  it('returns failed once the retry limit is exceeded', () => {
    expect(getAiScoringQueueState('pending', 12, 12)).toBe('failed');
  });

  it('returns pending while the queue item is still processing', () => {
    expect(getAiScoringQueueState('pending', 3, 12)).toBe('pending');
  });
});
