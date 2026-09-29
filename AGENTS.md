# AGENTS.md — Inventory-back (OCC Decks API)

Express 5 + Mongoose (ESM, `"type": "module"`) API for a NYC catering company's internal system.
Frontend is the sibling repo `../Inventory-front` (React/Vite on Vercel). This API runs on Render
(Dockerfile). It is in daily production use; reliability and data safety come first.

## Commands
- `npm test` — node:test suite in `test/*.test.js` (run after every change)
- `npm run dev` — nodemon; `npm start` — production entry (`server.js`)
- Scripts in `scripts/` (migrations, imports, prod→dev sync) touch real data: never run them
  without explicit approval.

## Where things live
- `server.js` — app setup and ALL route mounts with their auth guards (`app.use('/api/...', ...)`).
  Check the mount line before reasoning about who can call a route.
- `middleware/auth.js` — `requireAuth`, roles (`ADMIN_ROLES`, `WORKSPACE_ROLES`, …), guards.
  `middleware/rateLimit.js` — in-memory rate limiters.
- `routes/*.js` — one router per area. Key ones:
  - `catereaseIntegration.js` — Caterease sync, operational snapshots, event Dropbox files, Leadership print
  - `decorPackouts.js` — Decor packouts: create/scan/items/sync-board/export
  - `pages.js`, `decks.js` — board pages with optimistic `revision` locking
  - `dropboxIntegration.js`, `automationAlerts.js`, `assistant.js`, `bar.js`, `events.js`, `kitchen*.js`
- `models/*.js` — Mongoose schemas (Event, Deck, Page, Product, DecorPackout, DropboxDocument, …).
- `utils/*.js` — pure/business logic (`decorPackoutBoard.js`, `automationAlerts.js`,
  `dropboxDocuments.js`, `operationalDropbox.js`, `catereaseOperations.js`, …). Put testable logic here.
- `test/` — behavioral tests. Route handlers can be tested by mocking Mongoose model statics
  (`Model.find = () => ({ sort, select, lean, ... })`) and invoking the router layer's handler directly.

## Large files — do NOT read whole
Use `rg`/grep for the symbol, then read only nearby lines (`sed -n 'START,ENDp'`).
- `routes/catereaseIntegration.js` (~2.1k lines), `routes/bar.js` (~1.9k), `routes/events.js` (~1.6k),
  `utils/catereaseOperations.js` (~1.5k), `routes/dropboxIntegration.js` (~1.1k),
  `test/catereaseOperations.test.js` (~2k). Never open `package-lock.json`, `node_modules/`, `uploads/`.

## Critical invariants (regressions here have hit production)
- **Page revisions:** any server-side write to `Page.canvas` must use a revision filter and `$inc: { revision: 1 }`.
  Avoid writing pages on read/poll paths unless something actually changed — every write causes a
  409 for users who have the board open.
- **Decor packout ↔ canvas sync** (`mergePackoutItemsFromEventBoards`, `buildDecorPackoutCanvas`,
  `removeGeneratedDecorPackoutDuplicates`): never delete user-placed canvas images; only generated
  `packout-<id>-…` images. Never write aggregated quantities onto user images. Never auto-delete a packout
  from a sync path. Check every change for feedback loops across repeated sync calls.
- **Caterease snapshots:** a partial response (any core source failed) must not replace the last complete
  snapshot or trigger destructive downstream updates (Bar items, alerts).
- **Automation alerts:** deliveries are deduplicated by signature; changing the signature format must not
  re-send alerts for already-sent deliveries. Sending must stay atomic (claim before send).
- **Dropbox access:** file listing/download must stay scoped to an event folder the user may access;
  never broaden to month/year/root folders.
- **Authorization:** new routes need an explicit guard; `requireAuth` alone means ANY logged-in role.

## Working rules
- Match surrounding style; no new dependencies without asking.
- One problem per commit; message explains user-visible symptom and fix.
- Every bug fix ships with a behavioral test. No tests that regex-match source text.
- Run `npm test` before committing; if the change affects the frontend contract, also run
  `npm test && npm run build` in `../Inventory-front`.
- No schema changes that alter existing documents, no migrations, no production data access,
  no env/Docker/deploy changes without explicit approval.
- Hardcoded owner/recipient emails exist (assistant owner, alert recipients); don't add new ones —
  prefer env vars with the current values as defaults.
- If unsure whether behavior is a bug or intended, ask.

## Keep context small
- Search before reading; read line ranges, not whole files.
- Report failing test names and relevant lines, not full logs.
- Stay within the files the task names; don't re-audit everything unless asked.
