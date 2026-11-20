# JobSync Autofill (Firefox extension)

Fills in job application forms from the user's JobSync data. The user reviews and submits; the extension never submits.

- `src/background.ts` — toolbar click, injects `content.js` into every frame, calls the JobSync API (`/api/extension/*`) and drives the fill over one port to the review panel.
- `src/content/` — `extract.ts` reads form fields and labels, `apply.ts` sets values the way framework-controlled inputs expect, `panel.ts` is the review panel (shadow DOM, top frame only).
- `src/shared/` — message protocol, settings and API client, and the pure review helpers.
- Answer logic lives server-side in `src/lib/autofill/` (shared types in `types.ts`).

Build: `npm run build:extension` bundles into `extension/dist/` and writes `public/extension/jobsync-autofill.xpi`, which JobSync serves for download. The Docker build runs it.

Tests: `tests/unit/extension/` (jsdom) and `tests/unit/lib/autofill/`.

Signing for permanent installs: `npx web-ext sign --channel=unlisted --source-dir extension/dist --api-key=... --api-secret=...` (credentials from addons.mozilla.org). If the add-on id in `manifest.json` is already taken on AMO, change it first.
