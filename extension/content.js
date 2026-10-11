// Runs inside a job application page (and each frame in it), when the side
// panel asks: reads the form's fields, and fills them with the answers.
// Never submits: the user reviews and presses the site's own Apply button.
(() => {
  if (window.__ppApply) return;

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (el.type === 'hidden' || el.disabled) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    // File inputs are often hidden behind a styled button; keep them.
    return el.type === 'file' || (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none');
  };

  // The question a field asks, from its label, aria, fieldset or nearby text.
  function labelOf(el) {
    let t = '';
    if (el.labels?.length) t = [...el.labels].map((l) => l.innerText).join(' ');
    if (!t && el.getAttribute('aria-label')) t = el.getAttribute('aria-label');
    if (!t && el.getAttribute('aria-labelledby')) {
      t = el.getAttribute('aria-labelledby').split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
    }
    if (!t && (el.type === 'radio' || el.type === 'checkbox')) t = el.closest('fieldset')?.querySelector('legend')?.innerText || '';
    if (!t) {
      let p = el.parentElement;
      for (let i = 0; i < 4 && p && !t; i++, p = p.parentElement) {
        const own = clean(p.innerText);
        if (own && own.length < 180) t = own;
      }
    }
    return clean(t || el.placeholder || el.name || el.id).slice(0, 200);
  }

  // The question for a radio group: its fieldset legend or the text above it.
  function groupLabel(el) {
    const legend = el.closest('fieldset')?.querySelector('legend')?.innerText;
    if (legend) return clean(legend).slice(0, 200);
    const group = el.closest('[role="radiogroup"], [role="group"]');
    if (group?.getAttribute('aria-labelledby')) return clean(document.getElementById(group.getAttribute('aria-labelledby'))?.innerText).slice(0, 200);
    let p = el.parentElement;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      const radios = p.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
      if (radios.length > 1) {
        const text = clean(p.innerText);
        return text.slice(0, 200);
      }
    }
    return labelOf(el);
  }

  let counter = 0;
  const keyOf = (el) => el.dataset.ppKey || (el.dataset.ppKey = `k${++counter}`);

  function scan() {
    const fields = [];
    const seenGroups = new Set();
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (!visible(el)) continue;
      const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text');
      if (['submit', 'button', 'reset', 'image', 'search', 'password'].includes(type)) continue;
      if (type === 'radio') {
        if (!el.name || seenGroups.has(el.name)) continue;
        seenGroups.add(el.name);
        const radios = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
        fields.push({ key: keyOf(el), type: 'radio', label: groupLabel(el), required: radios.some((r) => r.required), options: radios.map((r) => clean(r.labels?.[0]?.innerText || r.value)) });
        continue;
      }
      const field = { key: keyOf(el), type, label: labelOf(el), required: el.required || el.getAttribute('aria-required') === 'true', name: el.name || '', autocomplete: el.autocomplete || '' };
      if (type === 'select') field.options = [...el.options].map((o) => clean(o.text)).filter((t) => t && !/^(select|choose|--)/i.test(t)).slice(0, 80);
      if (type === 'file') field.accept = el.accept || '';
      field.filled = type === 'checkbox' ? el.checked : type === 'file' ? Boolean(el.files?.length) : Boolean(el.value);
      fields.push(field);
    }
    // Custom dropdowns (Workday and others): a button that opens a listbox.
    for (const el of document.querySelectorAll('button[aria-haspopup="listbox"], [role="combobox"]:not(input)')) {
      if (!visible(el)) continue;
      fields.push({ key: keyOf(el), type: 'listbox', label: labelOf(el), required: el.getAttribute('aria-required') === 'true', filled: !/select|choose/i.test(el.innerText) });
    }
    return { url: location.href, title: document.title, fields };
  }

  // Values a React or Angular form actually registers.
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    for (const type of ['input', 'change', 'blur']) el.dispatchEvent(new Event(type, { bubbles: true }));
  }
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
  const close = (a, b) => clean(a).toLowerCase().includes(clean(b).toLowerCase()) || clean(b).toLowerCase().includes(clean(a).toLowerCase());
  const mark = (el, ok) => { el.style.outline = ok ? '2px solid #10b981' : '2px solid #f59e0b'; el.style.outlineOffset = '2px'; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fill(answers, resume) {
    const done = [];
    for (const [key, value] of Object.entries(answers)) {
      const el = document.querySelector(`[data-pp-key="${key}"]`);
      if (!el || value === '' || value == null) continue;
      try {
        if (el.type === 'radio') {
          const radios = [...document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
          const pick = radios.find((r) => same(r.labels?.[0]?.innerText || r.value, value)) || radios.find((r) => close(r.labels?.[0]?.innerText || r.value, value));
          if (pick) { pick.click(); mark(pick.closest('fieldset') || pick.parentElement, true); done.push(key); }
        } else if (el.type === 'checkbox') {
          const want = /^(yes|true|1|checked)$/i.test(String(value));
          if (el.checked !== want) el.click();
          mark(el, true); done.push(key);
        } else if (el.tagName === 'SELECT') {
          const opt = [...el.options].find((o) => same(o.text, value)) || [...el.options].find((o) => close(o.text, value));
          if (opt) { setValue(el, opt.value); mark(el, true); done.push(key); }
        } else if (el.type === 'file') {
          if (value === 'RESUME' && resume?.url) {
            const blob = await (await fetch(resume.url)).blob();
            const dt = new DataTransfer();
            dt.items.add(new File([blob], resume.file_name || 'resume.pdf', { type: blob.type || 'application/pdf' }));
            el.files = dt.files;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            mark(el.parentElement || el, true); done.push(key);
          }
        } else if (el.matches('button[aria-haspopup="listbox"], [role="combobox"]')) {
          el.click();
          await sleep(350);
          const options = [...document.querySelectorAll('[role="option"]')];
          const opt = options.find((o) => same(o.innerText, value)) || options.find((o) => close(o.innerText, value));
          if (opt) { opt.click(); mark(el, true); done.push(key); } else el.click();
          await sleep(150);
        } else {
          el.focus();
          setValue(el, String(value));
          mark(el, true); done.push(key);
        }
      } catch {
        // Leave this one for the user.
      }
    }
    // Required fields still empty: highlighted for the user.
    for (const f of scan().fields) {
      if (f.required && !f.filled) {
        const el = document.querySelector(`[data-pp-key="${f.key}"]`);
        if (el) mark(el, false);
      }
    }
    return done;
  }

  window.__ppApply = { scan, fill };
})();
