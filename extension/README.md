# ProfilePush Apply (Chrome extension)

Fills a career site's job application for one of your ProfilePush profiles.
You review it and press the site's own Apply button; it never submits.

- `content.js` reads the form (every frame) and fills it.
- `sidepanel.*` picks the profile and runs Fill.
- `background.js` keeps the ProfilePush sign-in and calls the `ai-apply`
  Supabase function (rules for names and the resume, Llama on Cloudflare for
  the rest; ₹1 = 4 credits when the AI answers questions, once per profile
  and site every 6 hours).

The `key` in manifest.json pins the extension ID to
`bmafklabjfahaillaeemjfokdmangkhj`, which the web app uses
(`src/lib/extension.ts`) to connect it and to say which profile is applying.

## Try it

1. Chrome → `chrome://extensions` → turn on Developer mode → Load unpacked →
   pick this `extension` folder.
2. Open https://profilepush.ai/extension (or http://localhost:5173/extension)
   while signed in: it connects the extension.
3. Open a job's application form, click the ProfilePush icon in the toolbar,
   pick the profile and press Fill this form.
