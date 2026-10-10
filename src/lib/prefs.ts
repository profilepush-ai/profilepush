// Small per-browser display choices.

// The match score shown plainly instead of swinging before it lands (chosen
// with "Show score" on a card; Settings switches it back).
export const PLAIN_SCORE_KEY = 'pp_plain_score';
export const plainScore = () => { try { return localStorage.getItem(PLAIN_SCORE_KEY) === '1'; } catch { return false; } };

// The app's first-launch slides (StartPage) were seen; signup comes straight up.
export const INTRO_SEEN_KEY = 'pp_intro_seen';
