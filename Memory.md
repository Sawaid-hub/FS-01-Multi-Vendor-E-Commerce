# Project Memory

## Confirmed from the internship portal

- Project: Multi-Vendor E-Commerce Marketplace (FS-01)
- Track: Full-Stack Development
- Assignment/start date: 19 October 2026
- Deadline: 20 November 2026
- Estimated effort: 14 days
- Required stack: React, Node.js, MongoDB, Elasticsearch, Razorpay/Stripe Connect, Redis, AWS S3
- Dataset: none required; optional seed/reference product data is suggested
- Portal asks for a working demo or recording, GitHub repository and setup guide, architecture and data/API documentation, test results, 10-minute presentation, and individual reflection.

## Initial working assumptions

- Implement a coherent demonstrable MVP before adding polish.
- Use payment test mode only.
- The architecture and directory layout in `Overview.md` are proposals until checked against any starter code or mentor guidance.

## Decisions to record

- Payment provider: Stripe Connect in test mode for the pilot; live payments and transfers are blocked.
- Hosting/deployment: no hosting target or production account has been selected/provisioned.
- Authentication/session approach: current implementation is custom email/password auth in the API with MongoDB users, short-lived JWT access tokens, and rotating refresh-cookie sessions. Firebase Auth was discussed, but no migration or Firebase project setup has been confirmed.
- Search/index strategy: MongoDB text search by default; an optional Elastic adapter and index outbox are implemented but not verified against a deployed Elastic service.
- Local substitutes for unavailable services: local email links in development, local image storage, optional Redis, and deterministic FX configuration are available/documented. Production providers remain unconfigured.
- Hosting target: Render selected on 2026-10-21; separate API and static client services will be described by a Blueprint. Deployment and provider wiring remain unverified until external services are configured.

## Open questions

- Should Firebase Auth replace the current custom API auth, or should the current auth remain for the pilot?
- The Stripe sandbox claim flow is still pending. After claiming it, which Stripe test capabilities and Connect onboarding paths can be exercised for US, Canada, and UK accounts?
- Which FX provider and rate/terms will be used for the pilot and later live service?
- What monthly spend cap will be approved for the Render pilot and external providers?
- Which accounts/endpoints will provide replica-set MongoDB, TLS Redis, Elasticsearch, S3-compatible storage, email delivery, and Stripe test mode? No service credentials should be committed; enter them in the provider dashboard.
- What sample order volume should be used for search/performance evidence?

## Current project state (2026-10-21)

- The project now has a React/Vite storefront and an Express/Mongoose modular API. The storefront uses API-backed account, catalog, cart, quote, checkout, order, vendor, review, and admin workflows; the previous role preview was replaced by server-authorized roles.
- The backend pilot includes persisted users/vendor profiles/products/carts/orders/coupons/reviews/audit events, role and ownership checks, email verification and password recovery, MongoDB text search with an optional Elastic adapter, local/S3-compatible image storage, server-calculated quotes, test-mode Stripe Checkout/webhooks, vendor fulfillment, and delayed payout scheduling. See `server/API.md` and `Production-readiness-review.md` for the implementation inventory and gaps.
- The current auth provider is the custom API implementation, not Firebase. It stores scrypt password hashes and hashed, one-time email tokens; access tokens are signed JWTs (15 minutes by default), refresh tokens are stored hashed in MongoDB and rotated through an HTTP-only cookie, and the frontend keeps the access token in memory.
- Stripe CLI created a claimable US test sandbox on 2026-10-21. The user still needs to claim it before account-backed Checkout/Connect testing. The claim URL and credentials were shared/configured outside project files and must not be copied into documentation or source control. The test sandbox claim expires 2026-10-28.
- The project is a test-mode pilot, not production-ready. Live payments/transfers, production deployment, legal/tax approval, cross-border Connect eligibility, backups/restore, monitoring/alerts, security review, and browser end-to-end validation remain open gates.
- Later integration verification superseded the earlier skipped result: `npm run test:integration` was run against temporary disposable replica-set MongoDB and Redis services; both integration tests passed (2 passed, 0 failed, 0 skipped). Those temporary services were shut down afterward. The test does not establish live Stripe account eligibility or deployed production readiness.
- Separate Render deployment scaffolding is now present (`render.yaml`, `DEPLOYMENT.md`, and distinct Docker builds for the API and client). The Blueprint expects externally provisioned MongoDB replica set, TLS Redis, Elasticsearch, S3-compatible storage, email delivery, and Stripe test-mode settings. No deployment has been created or run.
- GitHub is connected at `https://github.com/Sawaid-hub/FS-01-Multi-Vendor-E-Commerce` (private, `main`). The existing local project was initialized and pushed; local environment files, dependencies, uploads, and build output are ignored. No provider credentials were included.

## Progress log

- 2026-10-20: Created initial project documentation from portal instructions.
- 2026-10-21: Confirmed FS-01 has no starter application. Added the initial Node.js API scaffold under `server/` with MongoDB connection gating, liveness/readiness endpoints, and placeholder-only local configuration. React and external integrations remain unimplemented; payment credentials are not configured.
- 2026-10-21: Added a React/Vite storefront starter under `client/` with responsive marketplace landing, sample catalog, client-side search/category filters, favorite toggles, and working local cart interactions. Checkout remains an explicit placeholder until API and sandbox payment flow are implemented. Updated setup notes with installed runtime status and later service needs. Awaiting user's visual reference before finalizing styling.
- 2026-10-21: User installed npm dependencies in both app folders. Verified `npm run build` succeeds for the client and started the Vite development server at `http://127.0.0.1:5173/`. Visual reference is still pending.
- 2026-10-21: User supplied Bagisto's GitHub repository as broad inspiration and asked for original work. Reviewed the repository's marketplace scope (seller catalog/order/transaction tools and admin seller/commission/order oversight); built an original responsive Market Lane frontend with customer shopping/checkout/orders/saved/reviews/invoices, vendor catalog and order tools, admin analytics/orders/catalog/vendors/coupons, and browser-local demo state. Checkout is explicitly simulated; role switching is only a UI preview, not authorization. Updated README with capabilities, limits, and inspiration attribution.
- 2026-10-21: Rebuilt the original storefront into role-aware customer, vendor, and admin preview areas with responsive styling. Added search/category/sort, product details, local cart and checkout with active admin-managed coupon codes, simulated test orders, order lifecycle controls, reviews, print-to-PDF invoice view, vendor product editing and local photo upload, and admin sales/commission/vendor/catalog/coupon screens. Ran production build and server-rendered smoke checks; all passed. The demo role selector is presentation-only and no API/payment provider is wired yet.
- 2026-10-21: Rechecked all three role previews by server rendering and verified their key workflow labels; production build passes. The elevated Vite process is still live on port 5174 (session 50903); the older browser tab points at port 5173 and should be replaced with the active 5174 URL.
- 2026-10-21: Added local-preview sign-in/create-customer and seller application forms. Seller profile values now drive the vendor studio and newly added product ownership. These flows are explicitly local-only until real auth, verification, and seller approval are implemented in the API.
- 2026-10-21: User provided Faire as the storefront design reference. Adapted broad catalog-first patterns into Market Lane: trending search prompts, a maker/shop spotlight with locations and product specialties, clearer category-led product discovery, and a revised hero. Kept original branding, copy, styling and CSS-made artwork; preserved customer/vendor/admin demos. README now attributes both the Faire and Bagisto references and documents the original implementation.
- 2026-10-21: User requested a consistent single-font brand system and prominent dark colors. Created `BRAND_GUIDE.md` first, then applied its DM Sans-only typography, ink/pine surfaces, lime accent, and shared palette to the storefront and core navigation. README now links the guide as the standard for future UI work.
- 2026-10-21: User asked to apply the brand guide across the full frontend. Extended its dark ink/pine navigation and lime accents, one-family typography, and more readable text sizing to seller/admin dashboards, checkout, forms, dialogs, and shared cards/tables; left data-heavy catalog/dashboard surfaces paper-colored for readability. Client production build passes.
- 2026-10-21: User opened Faire and requested its visual format (colors, animation, layout). Inspected the live Faire homepage: white two-row sticky header, edge-to-edge image hero, pill category selectors, featured brand/product cards, a bright citrus confidence band, editorial sections, and quiet hover/carousel motion. Updated `BRAND_GUIDE.md` to match those visual principles using Market Lane's own near-black/warm-white/citrus palette, then reordered and restyled the Market Lane storefront with original CSS product artwork/copy. Added subtle entrance and card motion with reduced-motion support. Client build passes.
- 2026-10-21: Read `Backend-handoff.md` and completed the backend implementation pass for the test-mode marketplace pilot. Added modular API routes/models/services for auth, marketplace, payments/webhooks, admin, audit, search, storage, FX/quotes, checkout, and payout jobs; connected the storefront to the API. The implementation and known gaps are summarized in `server/API.md`, `README.md`, and `Production-readiness-review.md`.
- 2026-10-21: User requested a production-readiness review and implementation plan. The implementation pass is complete for the pilot scope, but the review explicitly blocks real sales pending external service, security, legal/tax, operational, and cross-border payment gates. `npm test` was documented as 18 passing tests and 2 skipped integrations; the client production build and server syntax checks passed.
- 2026-10-21: User ran `npm run test:integration`; both tests initially skipped because disposable MongoDB and Redis URLs were not configured. At the user's request, the integration suite was then run using temporary disposable replica-set MongoDB and Redis services; result: 2 passed, 0 failed, 0 skipped. Services were stopped after the run. No project credentials were added.
- 2026-10-21: Continued Stripe setup. Installed Stripe CLI and created a claimable US test sandbox after the managed blank-sandbox command was unavailable without an active live account. The claim URL was provided in chat and remains unclaimed; no Stripe secret was written to project files. Claim expires 2026-10-28.
- 2026-10-21: User asked about Firebase Auth. Confirmed it is technically possible, with MongoDB remaining authoritative for marketplace roles/vendor state, but no provider migration has been made. Current API auth flow was inspected and explained; it remains the custom email/password implementation described above.
- 2026-10-21: User requested persistent project memory and a project-wide rules document. Added `RULES.md` and updated this memory and `Agents.md` to require ongoing, dated progress/decision/test recording without storing secrets or personal credentials.
- 2026-10-21: User asked to continue closing the production-readiness gaps and confirmed that `Memory.md` should be updated as work progresses. They selected Render. Added separate API/client Dockerfiles, Docker ignore files, Nginx SPA serving config, a Render Blueprint, and deployment instructions. Updated README deployment pointers. Deployment is prepared only; no Render service or external provider was configured or verified.
- 2026-10-21: User asked to connect the project to GitHub. Confirmed the authenticated account is `Sawaid-hub`, created the private repository `Sawaid-hub/FS-01-Multi-Vendor-E-Commerce`, initialized the project `main` branch, and pushed the initial project snapshot. `.env` files, dependency folders, uploaded files, and build output were excluded by ignore rules. Updated this memory entry and pushed it as a follow-up commit.

## Memory maintenance

- Keep this file as the concise, dated project record across future sessions. Update it after meaningful implementation, testing, external setup, decision, or release-gate changes.
- Record completed work separately from planned work, and include exact test commands/results and any skipped coverage when tests are run.
- Never save credentials, tokens, secret URLs, private keys, or unnecessary personal information here. Put only safe configuration names and non-sensitive setup state in the log.
