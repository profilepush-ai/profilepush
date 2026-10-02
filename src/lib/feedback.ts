// Asks for a rating right after an AI Submit goes out. The send may navigate
// straight to the Inbox, so the request is kept in sessionStorage and picked
// up by FeedbackPrompt on whatever page comes next; the server
// (claim_feedback_prompt) decides whether it's too soon to ask again.
export const FEEDBACK_PENDING_KEY = 'feedback_prompt_pending';
export const FEEDBACK_EVENT = 'pp-feedback-request';

export function requestFeedback(context: string): void {
  try { sessionStorage.setItem(FEEDBACK_PENDING_KEY, context); } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail: context }));
}

export function takePendingFeedback(): string | null {
  try {
    const value = sessionStorage.getItem(FEEDBACK_PENDING_KEY);
    if (value) sessionStorage.removeItem(FEEDBACK_PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}
