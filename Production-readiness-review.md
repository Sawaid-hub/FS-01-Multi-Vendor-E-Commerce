# Production-readiness review

**Reviewed:** 21 October 2026 (implementation pass)  
**Result:** **Not ready for live production.** The API and storefront now implement the test-mode marketplace pilot flows, but they have not been exercised against real disposable services or a deployed browser environment. No live payment or transfer credentials are accepted by the code.

## Verification performed

- `server`: `npm test` passes 18 tests and skips 2 disposable MongoDB/Stripe and Redis integrations because their required service URLs are not configured. The passing tests cover authentication/authorization boundaries, FX and checkout quotes for all three markets, and local upload validation. The skipped tests cover checkout reservation/idempotency, signed Stripe webhooks (including Connect capability updates), payout holds, and shared Redis rate limits.
- `client`: `npm run build` succeeds with Vite 7.3.7.
- `node --check` passes for the server JavaScript files.
- No automated browser end-to-end suite has been added or run against the connected application.
- MongoDB is not running in this workspace, and no `.env` or real provider configuration is present. The API, seed, checkout, webhook, and external-service paths were not run against a live disposable stack.

## Implementation status

| Area | Status | Evidence / gap |
| --- | --- | --- |
| Customer accounts | Implemented; mocked tests pass | Registration, email verification, login, refresh rotation, logout, profile, and password recovery. Production needs a configured email delivery adapter and Mongo integration tests. |
| Authorization | Implemented in API | Roles are read from persisted users; seller products/orders/uploads are ownership scoped; admin routes require admin. Needs cross-role integration and browser E2E coverage. |
| Catalog and search | Implemented | Mongo text search pilot adapter; optional Elastic HTTP adapter with transactional product outbox. Neither database indexes nor Elastic credentials were exercised here. |
| Vendor applications and listing moderation | Implemented | Server-backed vendor state, product CRUD, admin decisions, and audit events. Needs integration and concurrent-access coverage. |
| Cart, quote, FX, stock, coupons | Implemented | Mongo source of truth, optional Redis cart cache, server price/stock/coupon calculations, FX snapshots, transactional reservations. Needs real replica-set and Redis race tests. |
| Checkout and payment | Test-mode implementation | Stripe-hosted Checkout, idempotency, signed webhook handling, amount/currency checks, replay records, failure release, idempotent allocation refunds, transfer reversal, and retry paths. No Stripe test account/webhook run was possible. |
| Fulfillment and payouts | Test-mode implementation | Vendor tracking and fulfillment; admin must confirm delivery before a 30-day payout queue starts; Connect capability checks, transfer retries, return holds, and dispute/refund review. Cross-border eligibility remains unverified. Cross-border Connect country/currency eligibility remains unverified. |
| Images | Implemented adapters | Local or S3-compatible storage, owner/type/size/signature checks. No actual S3/R2 upload/read test was performed. |
| Reviews and invoices | Implemented | Reviews require a paid delivered purchase; invoice data is built from order snapshots. No browser printing or Mongo invoice integration test was performed. |
| Admin operations | Implemented | Overview, vendors, products, orders, payments, coupons, audits, and delivery confirmation. Needs usability/access tests with seeded data. |
| Frontend integration | Implemented; build passes | Storefront uses API-backed catalog/account/cart/quotes/orders/vendor/admin flows and Stripe test checkout. No post-integration E2E run. |
| Operations and deployment | Not complete | No deployment config, paid accounts, backup/restore evidence, alerts, dashboards, incident procedure, security review, or production runbook is present. |
| Legal, tax, and launch approval | Not complete | Tax is zero by default; seller terms, privacy, returns, tax obligations, platform duties, country eligibility, and spending cap require owner approval. |

## Pilot setup and known boundaries

- MongoDB must be a replica set for transactional checkout, product/outbox writes, and reservation recovery.
- The pilot seed is opt-in and disabled in production. It creates `.test` customer/vendor accounts; the admin is created separately through the bootstrap command.
- Configure deterministic FX rates for local testing or verify the chosen FX provider’s availability and terms before pilot use.
- `STRIPE_SECRET_KEY` must use a Stripe test key. Production-mode application startup also requires a test-mode key and webhook secret; live keys are rejected.
- Production-mode configuration expects HTTPS client/API origins, TLS Redis, Elastic settings, S3-compatible storage, email delivery, and an FX configuration. These checks do not provision services or prove their resilience.
- Separate client/API deployments should use same-site custom domains so browsers can send refresh cookies reliably.
- Local test pass counts are not integration, penetration, load, backup, or release certification.

## Release decision

Use this build only as a clearly labeled **test-mode pilot** after configuring and validating the disposable services. Do not launch live sales or real vendor payouts.

Before reconsidering live launch:

1. Run integration tests against disposable replica-set MongoDB and Redis; exercise Stripe test webhooks, payment retries, refunds, Connect onboarding, uploads, and payout holds.
2. Complete browser E2E for registration, seller approval, listing/search, US/CA/UK quotes, multi-vendor checkout, payment, fulfillment, delivery confirmation, review, invoice, and admin oversight.
3. Complete security and dependency review, including access boundaries, injection, rate limiting, file uploads, secrets, and failure recovery.
4. Configure paid production services, verified backups and restore, centralized logs/metrics, alerts, incident response, and a documented rollback.
5. Obtain Stripe confirmation for required country/currency/account capabilities and legal/accounting approval for tax, seller terms, returns, privacy, and marketplace obligations.
6. Agree a monthly spending cap. Keep live payments blocked until every gate has an owner and written sign-off, then make a deliberate code/config release change to support live credentials.
