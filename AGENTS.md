# Repository Guidelines

## Project Structure & Module Organization

cdfsend is a self-hosted email API and dashboard on Cloudflare Workers.

- `src/`: Svelte 5 dashboard; routed pages and async data loading in `pages/`, router mounting in `App.svelte`, session and action state in focused `lib/*.svelte.js` modules, direct page imports in `lib/router.js`, reusable components and browser utilities in `lib/`, styles in `app.css`.
- `worker/`: Worker entry point `index.js` and Hono app composition in `app.js`; HTTP handlers in `routes/` (dashboard routers in `routes/dashboard/`), request middleware in `middleware/`, business logic in `services/`, authorization and cryptography in `security/`, HTTP/pagination utilities in `lib/`, and Turso persistence in `storage/`.
- `shared/`: validation schemas and utilities; `migrations/`: numbered Turso SQL migrations.
- `tests/`: unit, Worker integration, and browser suites. `docs/`: API, deployment, and security guides.
- `dist/`: generated dashboard assets and Worker build; do not commit it.

## Build, Test, and Development Commands

Use Bun 1.4.3, Node.js >=22.12, and the local libSQL server (`sqld`, bundled with the Turso CLI).

- `bun install --frozen-lockfile`: install pinned dependencies.
- `bun run dev`: migrate local Turso and start Vite on localhost:5173; configured remote email sending can deliver real mail.
- Offline development: run `bun run dev:offline` (localhost:5174).
- `bun run build`: generate `dist/`.
- `bun run fmt` / `bun run lint`: format with Oxfmt / lint with Oxlint.
- `bun run ci:check`: type, formatting, and lint checks.
- `bun x playwright install chrome`: install the browser required by E2E tests.
- `bun run verify`: run all checks, test suites, and the production build; CI uses this command.

## Coding Style & Naming Conventions

Use JavaScript ES modules, `// @ts-check`, JSDoc types, and plain-JavaScript Svelte components. Follow tab indentation, double quotes, and semicolons. Use PascalCase component filenames and camelCase functions/variables. Respect `.oxfmtrc.json` and `.oxlintrc.json`: avoid object rest/spread and nested ternaries; keep function complexity <=10.

## Testing Guidelines

Run `bun run test` for Vitest unit tests (`tests/unit/*.test.js`), `bun run test:worker` for Cloudflare integration/Resend SDK tests (`tests/worker/*.test.js`), and `bun run test:e2e` for Playwright lifecycle tests (`tests/e2e/*.spec.js`). No numeric coverage threshold is configured. Add regression tests for changed behavior, especially authorization, tenant isolation, and idempotency. Automated tests must disable remote bindings and use synthetic messages.

## Commit & Pull Request Guidelines

Recent commits use “work in progress”; no formal convention is established. Prefer descriptive, imperative summaries. PRs should explain changes, link relevant issues, report verification results, and include desktop/mobile screenshots for UI changes.

## Security & Schema Changes

Never commit credentials or private message content. Add new migrations instead of rewriting applied ones. Review `docs/SECURITY.md` before changing access boundaries and update API/deployment documentation alongside behavior changes.
