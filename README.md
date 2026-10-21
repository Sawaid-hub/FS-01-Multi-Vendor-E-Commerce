# FS-01: Multi-Vendor E-Commerce Marketplace

Market Lane is a multi-vendor marketplace capstone. The storefront is connected to an Express/Mongoose API for accounts, catalog, saved items, carts, quotes, Stripe test checkout, orders, vendor fulfillment, reviews, and admin moderation.

## Current release boundary

The implementation is a **test-mode pilot**, not a production-ready sales platform. The API rejects non-test Stripe secret keys. No real payment, vendor transfer, or live customer account should be used. Live sales remain blocked until payment-country/currency eligibility, legal and tax responsibilities, paid infrastructure, backups, security review, and incident operations are signed off. See [Production-readiness-review.md](Production-readiness-review.md) and [Backend-handoff.md](Backend-handoff.md).

The pilot supports US, Canada, and UK shipping/display currencies (USD, CAD, GBP), with vendor base currencies and order-level FX snapshots. Vendors manage shipping and tracking. Payouts are scheduled no earlier than 30 days after confirmed delivery, but only Stripe test-mode transfers are allowed.

## Requirements

- Node.js 20 or newer and npm
- MongoDB configured as a replica set (Atlas works; standalone MongoDB does not support the checkout transactions)
- Optional pilot services: Redis, S3-compatible storage such as R2, and Stripe test mode
- `client` uses Vite/React; `server` uses Express/Mongoose

## Local setup

### API

```powershell
cd server
Copy-Item .env.example .env
npm install
```

Set independent random values of at least 32 characters for `JWT_SECRET` and `REFRESH_TOKEN_SECRET` in `server/.env`. Configure `MONGODB_URI` to a replica-set database. `CORS_ORIGINS` and `CLIENT_BASE_URL` should match the client origin. For production, serve the client and API on the same site (for example, `shop.example.com` and `api.example.com`); browsers may block refresh cookies when the API is deployed as a third-party domain.

For a local pilot without paid providers, leave Stripe, Redis, Elastic, email-delivery, and S3 credentials blank. Development email verification and password-reset links print to the API terminal. Configure `FX_RATES_JSON` for deterministic local quotes, or keep the default FX API and confirm its availability/terms before using the pilot. Local product images are stored under `server/uploads`.

Start the API:

```powershell
npm run dev
```

In a separate terminal, optionally add test data. This is guarded, development-only, and does not create an admin:

```powershell
$env:ALLOW_PILOT_SEED = 'true'
$env:DEMO_PASSWORD = 'choose-a-long-local-password'
npm run seed:pilot
```

The seed creates `customer@marketlane.test` and `maker@marketlane.test` plus a small sample catalog. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` only in your local environment, then run `npm run admin:bootstrap` to create or promote the initial administrator. Never put credentials in source control.

To accept test payments, configure only Stripe test credentials and run Stripe CLI webhook forwarding to `http://localhost:4000/api/v1/webhooks/payments/stripe`. Set the CLI webhook signing secret as `STRIPE_WEBHOOK_SECRET`. Check the payment webhook and Connect capabilities in test mode before testing checkout.

`GET /health` reports process liveness. `GET /ready` checks MongoDB, configured Redis, storage, payments, and search mode. The API contract and route groups are in [server/API.md](server/API.md).

### Storefront

```powershell
cd client
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set `VITE_API_BASE_URL` if the API is not at `http://localhost:4000`. Create a customer through the account form and use the verification link shown in the API terminal for local development. Vendor/admin features require the corresponding server role; the storefront has no role-switch shortcut.

## Verification

```powershell
cd server
npm test
cd ..\client
npm run build
```

The automated API tests cover authentication and authorization boundaries, quote/FX calculations for the three pilot markets, and local upload validation. The disposable MongoDB/Stripe webhook and Redis integration tests are skipped unless `RUN_DISPOSABLE_DB_TESTS=true` with `MONGODB_TEST_URI` and `REDIS_TEST_URL` point to dedicated test services. They do not prove S3 uploads, cross-border Connect eligibility, or browser end-to-end flows. Those remain release gates. Do not interpret a successful local build as production approval.

To run only the disposable-service suite, set the required test environment variables and run `npm run test:integration` from `server`.

## Architecture and follow-up

- Search defaults to MongoDB text search. An Elastic adapter and transactional product-index outbox are available when `SEARCH_PROVIDER=elastic` is configured.
- Storage uses a local development adapter unless an S3-compatible bucket is configured.
- Redis is optional in development; production configuration requires it for shared rate limits and cart support.
- Orders preserve product, FX, discount, shipping, tax, payment, and vendor allocation snapshots. Price and stock are always recalculated by the server at checkout.
- Secrets belong in environment-specific secret storage. `.env.example` contains placeholders only.

See [Overview.md](Overview.md), [BRAND_GUIDE.md](BRAND_GUIDE.md), and [STOCK_PHOTO_CREDITS.md](STOCK_PHOTO_CREDITS.md) for project scope and frontend guidance.

## Separate deployment

The API and client have separate deployment builds. See [DEPLOYMENT.md](DEPLOYMENT.md) for the Render Blueprint, external provider requirements, and deployment steps. The Blueprint is prepared but has not been deployed; it requires external MongoDB, Redis, Elasticsearch, object storage, email, and Stripe test-mode configuration.
