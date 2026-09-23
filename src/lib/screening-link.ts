// Places the screening link inside a generated draft.
//
// The draft ends with the sender's first name on its own line. Appending the
// link to the end puts it below the signature, where it reads as a footer and
// gets skipped — the recipient has to forward this to their consultant, so the
// link is the one thing that must not look like boilerplate.
//
// Separated from the components because both the single invite and the bulk
// send use it, and because the signature detection is worth a test rather than
// an assumption.

const LINK_LABEL = 'Screening link:';

/** A trailing line that is a name rather than a sentence. */
function isSignatureLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // A signature is short, has no sentence punctuation and is a word or three:
  // "Poorna", "Poorna P", "— Poorna". Anything longer is the last sentence of
  // the message and the link belongs after it.
  if (trimmed.length > 40) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  return trimmed.replace(/^[—–-]\s*/, '').split(/\s+/).length <= 3;
}

export function withScreeningLink(body: string, url: string): string {
  const block = `${LINK_LABEL}\n${url}`;
  const trimmed = body.trimEnd();
  if (!trimmed) return block;

  const lines = trimmed.split('\n');
  const last = lines[lines.length - 1];

  if (lines.length > 1 && isSignatureLine(last)) {
    const head = lines.slice(0, -1).join('\n').trimEnd();
    return `${head}\n\n${block}\n\n${last.trim()}`;
  }

  return `${trimmed}\n\n${block}`;
}

/** True when a draft already carries a screening link, so it is not added twice. */
export function hasScreeningLink(body: string): boolean {
  return body.includes('/screen/');
}
