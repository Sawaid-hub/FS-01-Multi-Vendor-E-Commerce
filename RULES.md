# Project Rules

These rules apply to implementation, documentation, verification, and handoffs for the FS-01 Market Lane marketplace. Follow the user's current request and the project scope; record lasting decisions and progress in `Memory.md`.

## IRON CLADE RULES:
1. After every change update the memory.md
2. In every new session read the RULES.md and memory.md first before doing anything.

## 1. Start-of-task workflow

- Read `Agents.md`, `RULES.md`, `Memory.md`, `README.md`, and `Overview.md` before substantial project work.
- For backend work, also read `Backend-handoff.md` and the relevant parts of `server/API.md`. For UI work, read `BRAND_GUIDE.md`. Check related code and tests before changing behavior.
- Treat `Memory.md` as the evolving record of confirmed decisions, current status, test evidence, external setup, and open work. Do not assume an old plan is still current when the source or a newer memory entry says otherwise.
- Make focused changes that fit the existing architecture. Preserve unrelated local work and existing file conventions.

## 2. Project continuity and memory

- After each meaningful implementation, documentation, test, service-setup, or release decision, add a dated entry to `Memory.md` describing what changed and its status.
- Distinguish **planned**, **in progress**, **completed**, **failed**, and **not verified** work. Do not record an intention as a completion.
- When verification is performed, record the command, relevant environment (for example, disposable local services), and exact pass/fail/skip result. Correct older status when newer evidence supersedes it; retain history where it explains how the status changed.
- Keep a concise current-state summary, confirmed decisions, unresolved questions, and next known steps near the top of `Memory.md`.
- Never save passwords, API keys, access or refresh tokens, signing secrets, private keys, claim links, or other bearer URLs in project documentation or memory. Do not store unnecessary personal data. Use environment variable names and placeholders instead.

## 3. Documentation rules

- Write for a developer who has not worked on the project: use clear headings, concise explanations, and commands that identify the directory in which they should run.
- Keep setup instructions, API routes and contracts, environment-variable references, data/ownership rules, architecture, limitations, and verification guidance aligned with the implementation.
- Put configuration names and safe placeholders in `.env.example`; never put real values there. Document whether a provider is required, optional, mocked, test-only, or unverified.
- When behavior, routes, configuration, or architecture changes, update the relevant README/API/handoff documentation in the same task where practical.
- Label test-mode, simulated, local-only, and unavailable behavior plainly. Do not describe a mock as a live integration or a passing build as release approval.
- Keep `Production-readiness-review.md` evidence-based. Separate implemented features from verified features and unresolved production gates.
- Use Markdown links with repository-relative paths inside project docs. Keep examples syntactically valid and avoid embedding secret-looking values that could be mistaken for real credentials.

## 4. Code-writing rules

- Preserve the current stack and conventions: React/Vite in `client/`; Express, CommonJS, and Mongoose in `server/`. Keep API routes, models, middleware, and external-service adapters in their existing modules.
- Keep the client presentation-focused. The API/database is authoritative for identities, roles, vendor ownership, catalog prices, inventory, discounts, quotes, orders, payments, and fulfillment state.
- Enforce authentication, role checks, vendor ownership, validation, and state transitions on the server for every protected operation. A hidden or disabled UI control is never authorization.
- Validate and normalize untrusted input at API boundaries. Return consistent API errors and handle provider/database failures without silently losing order or payment state.
- Store money as integer minor units with explicit currency. Calculate checkout prices, shipping, tax, discounts, stock, and vendor allocations on the server; preserve the exact inputs and results as order snapshots.
- Keep payment actions idempotent. Verify webhook signatures and replay/idempotency state before applying payment changes. Do not enable real charges or transfers in this pilot; use Stripe test mode only.
- Validate image uploads for size, type/content, ownership, and access. Keep local storage clearly scoped to development and provider credentials out of source files.
- Keep external services behind the existing service adapters. Preserve safe local substitutes and make unavailable dependencies fail clearly.
- Prefer small, readable changes. Avoid unrelated refactors, duplicate abstractions, and new dependencies unless the task needs them.

## 5. Testing and verification rules

- Do not add or run tests unless the user explicitly asks for testing or verification. When requested, choose checks that match the changed behavior and the available environment.
- Use disposable test databases and isolated test credentials for integration checks. Never point tests or seed scripts at a production database or use live payment credentials.
- Report the exact command and result. State which tests passed, failed, or were skipped and why. A skipped test is not a pass; a unit test is not proof of an external provider or production deployment.
- For API changes, consider authentication/authorization boundaries, ownership isolation, input validation, external-service failures, and idempotent/replayed operations in the requested verification scope.
- For UI changes, include the production build and relevant manual/browser workflow only when requested. Clearly report if browser end-to-end testing was not performed.
- Do not claim production readiness without evidence for deployed services, backups/restore, security review, monitoring/incident response, legal/tax approvals, and payment-provider eligibility.

## 6. Pilot and production boundaries

- The current release is a **test-mode pilot**. The application rejects live Stripe credentials; do not weaken that guard as part of routine implementation.
- Do not perform live customer charges, real vendor transfers, production provisioning, publishing, or other externally consequential actions unless the user has clearly authorized that specific action.
- Before any live launch, track written sign-off for Stripe Connect country/currency/account capabilities; legal, tax, seller, returns, and privacy obligations; paid infrastructure and spend cap; verified backups and restore; centralized logs/metrics/alerts; incident and rollback procedures; and security/dependency review.
- Vendors manage their own shipping and provide tracking in the current scope. Carrier labels/rate shopping are out of scope unless the user changes that scope.

## 7. Handoffs and completion reports

- Keep `Agents.md` as the short contributor entry point and use this file for the detailed rules. If the rules change, keep the two documents consistent.
- At task completion, state what changed, where it lives, what was verified, and any material open gap. Update `Memory.md` before handing work back.
- Never claim a file, test, provider setup, or feature is complete unless it was actually created or exercised.
