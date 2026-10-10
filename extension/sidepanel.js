// The side panel: connect to ProfilePush, pick the profile that's applying,
// fill the form on the page. The user reviews and presses Apply themselves.
const app = document.getElementById('app');
const send = (msg) => chrome.runtime.sendMessage(msg);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let profiles = [];
let chosen = null;

async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }

async function render() {
  const { session } = await send({ type: 'signed-in' });
  if (!session) {
    const tab = await activeTab();
    const local = tab?.url?.startsWith('http://localhost:5173');
    app.innerHTML = `
      <h2>Fill job applications in one click</h2>
      <p class="muted">Connect your ProfilePush account. Then open any job's application, pick the profile, and press Fill. You check it and press Apply.</p>
      <a class="button primary" target="_blank" href="${local ? 'http://localhost:5173' : 'https://profilepush.ai'}/extension">Connect ProfilePush</a>
      <p class="muted">After connecting, come back here.</p>`;
    return;
  }
  const res = await send({ type: 'api', fn: 'ai-apply', body: { action: 'profiles' } });
  if (res.error) { app.innerHTML = `<div class="result err">${esc(res.error)}</div>`; return; }
  profiles = res.profiles || [];
  const tab = await activeTab();
  const { contexts = {} } = await chrome.storage.local.get('contexts');
  const ctx = tab?.url ? contexts[new URL(tab.url).origin] : null;
  chosen = chosen || (ctx && Date.now() - ctx.at < 6 * 3600_000 ? ctx.subject_id : null) || profiles[0]?.id || null;
  app.innerHTML = `
    <div><h2>Applying as</h2><p class="muted">${esc(res.balance_label || '')}</p></div>
    <div class="list">${profiles.map((p) => `
      <label class="profile"><input type="radio" name="p" value="${p.id}" ${p.id === chosen ? 'checked' : ''}>
        <span><b>${esc(p.name)}</b><small>${esc(p.title || '')}${p.resume ? '' : ' · no resume'}</small></span></label>`).join('') || '<p class="muted">No profiles yet. Add one in ProfilePush.</p>'}
    </div>
    <button class="primary" id="fill" ${profiles.length ? '' : 'disabled'}>Fill this form</button>
    <div id="out"></div>
    <button class="quiet" id="signout">Sign out</button>`;
  app.querySelectorAll('input[name="p"]').forEach((r) => r.addEventListener('change', () => { chosen = r.value; }));
  document.getElementById('fill').addEventListener('click', fillForm);
  document.getElementById('signout').addEventListener('click', async () => { await send({ type: 'sign-out' }); render(); });
}

async function fillForm() {
  const button = document.getElementById('fill');
  const out = document.getElementById('out');
  button.disabled = true; button.textContent = 'Reading the form…';
  try {
    const tab = await activeTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] });
    const scans = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.__ppApply?.scan() });
    const fields = [];
    for (const s of scans) for (const f of s.result?.fields || []) fields.push({ ...f, key: `${s.frameId}:${f.key}` });
    const open = fields.filter((f) => !f.filled);
    if (open.length === 0) { out.innerHTML = '<div class="result warn">No empty form fields on this page. Open the application form first.</div>'; return; }
    button.textContent = 'Working out the answers…';
    const res = await send({ type: 'api', fn: 'ai-apply', body: { action: 'fill', subject_id: chosen, url: tab.url, title: tab.title, fields: open } });
    if (res.error) {
      out.innerHTML = res.status === 402
        ? `<div class="result err">No credits left. AI Apply is ₹1 an application. <a target="_blank" href="https://profilepush.ai/billing">Top up</a></div>`
        : `<div class="result err">${esc(res.error)}</div>`;
      return;
    }
    button.textContent = 'Filling…';
    const byFrame = {};
    for (const [key, value] of Object.entries(res.answers || {})) {
      const [frame, k] = key.split(':');
      (byFrame[frame] ||= {})[k] = value;
    }
    let filled = 0;
    for (const [frameId, answers] of Object.entries(byFrame)) {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [Number(frameId)] }, func: (a, resume) => window.__ppApply?.fill(a, resume), args: [answers, res.resume || null] });
      filled += r?.result?.length || 0;
    }
    const left = open.filter((f) => f.required).length - filled;
    out.innerHTML = `<div class="result ${left > 0 ? 'warn' : ''}">Filled ${filled} of ${open.length} fields.${left > 0 ? ` Check the ones outlined in yellow,` : ' Check them,'} then press Apply on the page.</div>
      ${res.unanswered?.length ? `<p class="muted">Left for you:</p><ul class="fields">${res.unanswered.slice(0, 8).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      ${res.charged ? `<p class="muted">₹1 used · ${esc(res.balance_label || '')}</p>` : ''}`;
  } catch (e) {
    out.innerHTML = `<div class="result err">Could not fill this page: ${esc(e.message || e)}</div>`;
  } finally {
    button.disabled = false; button.textContent = 'Fill this form';
  }
}

chrome.tabs.onActivated.addListener(() => render());
chrome.storage.onChanged.addListener((c) => { if (c.session) render(); });
render();
