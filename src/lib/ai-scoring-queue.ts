export const DEFAULT_AI_SCORING_MAX_ATTEMPTS = 12;
export const DEFAULT_AI_SCORING_POLL_MS = 4000;

export type AiScoringQueueState = 'pending' | 'completed' | 'failed';

export function getAiScoringQueueState(status: string | null | undefined, attempts: number, maxAttempts = DEFAULT_AI_SCORING_MAX_ATTEMPTS): AiScoringQueueState {
  if (status === 'completed') return 'completed';
  if (status === 'dead') return 'failed';
  return attempts >= maxAttempts ? 'failed' : 'pending';
}
