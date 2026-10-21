# Marketplace API (v1)

Base path: `/api/v1`. JSON endpoints use `{ "data": ... }` envelopes. Errors use `{ "error": { "code", "message", "requestId" } }`. Amounts ending in `Minor` are integer minor units (for example, 1099 means USD 10.99); every amount is paired with a three-letter currency. Authenticated calls use a short-lived bearer access token. A rotated refresh token is kept in an HttpOnly, SameSite=Strict cookie.

## Authentication

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public, rate limited | Create a customer and send a verification link. Requires name, email, and password (12+ characters). |
| POST | `/auth/login` | Public, rate limited | Sign in after email verification. |
| POST | `/auth/refresh` | Refresh cookie | Rotate refresh session and return a new access token. |
| POST | `/auth/logout` | Refresh cookie | Revoke the current refresh session. |
| POST | `/auth/verify-email` | Public, rate limited | Consume one-time verification token. |
| POST | `/auth/resend-verification` | Public, rate limited | Send a replacement link without disclosing account existence. |
| POST | `/auth/forgot-password`, `/auth/reset-password` | Public, rate limited | Start and complete password recovery. |
| GET/PATCH | `/auth/me` | Signed in | Read or update the current account name. |

The only initial admin path is `npm run admin:bootstrap`. Public registration cannot select privileged roles.

## Catalog and customer

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/products` | Public | Browse/search published products. Supports `q`, `category`, `productType`, `sort`, `country`, `page`, and `limit`. |
| GET | `/products/:slug`, `/shops/:slug` | Public | Product and shop detail. Product detail includes recent published reviews. |
| GET | `/media?key=...` | Public | Read a validated image object. |
| GET/PUT/DELETE | `/cart`, `/cart/items/:productId` | Signed in | Read cart and set/remove item quantity. Quantity zero removes an item. |
| POST | `/checkout/quote` | Signed in | Recalculate current catalog prices, FX, shipping, and coupon. Body: `{ country, couponCode? }`. |
| POST | `/checkout` | Signed in, rate limited | Reserve stock and create a Stripe-hosted **test-mode** checkout. Requires `Idempotency-Key`; body has `address` and optional `couponCode`. |
| GET | `/orders`, `/orders/:orderNumber` | Signed in | Read only the current customer’s saved order snapshots. Admin may inspect orders through admin routes. |
| GET | `/orders/:orderNumber/invoice` | Signed in | Read invoice data for a paid order owned by the current customer. |
| POST | `/orders/:orderNumber/allocations/:allocationId/returns` | Signed in | Request a return for a delivered vendor allocation within 30 days; the allocation is held for review. |
| GET/PUT/DELETE | `/me/saved-products[/:productId]` | Signed in | Manage the current customer’s saved products. |
| POST | `/products/:productId/reviews` | Signed in, rate limited | Add one review only after a paid purchase has been delivered. |

The shopper’s `country` selects the display currency: US/USD, CA/CAD, or GB/GBP. Each quote and order stores conversion rate, source, and timestamp. The API recalculates price, coupon, shipping, and stock; client totals are never accepted as payment amounts. Tax is zero in the default pilot configuration. Stripe automatic tax is opt-in and is not a substitute for tax/legal approval.

## Vendor

Vendor access comes from an approved vendor profile. Every product, order allocation, upload, and payout query is scoped to the authenticated vendor.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/vendor-applications` | Submit a seller application. |
| GET/PATCH | `/vendor/profile` | Read/update the current seller profile. |
| POST | `/vendor/connect/onboarding` | Create/reuse the vendor’s Stripe test Connect account and hosted onboarding link. |
| GET/POST | `/vendor/products` | List owned listings or submit a draft. |
| GET/PATCH/DELETE | `/vendor/products/:id` | Read/edit/archive an owned listing. Edits return the listing to draft for review. |
| POST | `/vendor/uploads/presign`, `/vendor/uploads/confirm` | Create and confirm an owned, type/size/signature checked image upload. |
| PUT | `/vendor/uploads/local?key=...` | Development-only local upload endpoint. |
| GET | `/vendor/orders`, `/vendor/payouts`, `/vendor/analytics/summary` | View only this vendor’s allocations and payout state. |
| PATCH | `/vendor/orders/:allocationId/status` | Advance an owned paid allocation through packed, shipped, and seller-reported delivered; tracking is required when shipping. Seller-reported delivery stays on payout review. |

## Administrator

All `/api/v1/admin/*` routes require the admin role. Admin routes cover overview, vendor application decisions, product moderation, order/payment ledgers, coupon management, delivery and return review, and audit-event review. Moderation changes require reasons where relevant and write audit events. `PATCH /admin/orders/:orderNumber/allocations/:allocationId/delivery` can confirm a delivered allocation after tracking review; it starts the 30-day payout delay from the admin confirmation time. Unconfirmed allocations remain held for review. `PATCH /admin/orders/:orderNumber/allocations/:allocationId/return` approves or rejects a pending return; approval requests an idempotent Stripe test refund. Signed refund events finalize the return and reverse any transfer. `POST /admin/orders/:orderNumber/allocations/:allocationId/return/refund` retries a known failed refund or checks a pending request using the same Stripe idempotency key.

## Payments and event processing

Configure only Stripe `sk_test_` credentials. Set `STRIPE_WEBHOOK_SECRET` and forward Stripe CLI events to `POST /api/v1/webhooks/payments/stripe`. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed`, `account.updated`, `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.updated`. The endpoint requires the raw Stripe signature, deduplicates provider event IDs, checks saved order amount/currency, and treats verified payment events as authoritative. Browser redirects do not confirm payment. `account.updated` refreshes the vendor’s saved Connect capabilities; payout processing remains held until required capabilities are enabled. Admin return approval requests an idempotent Stripe test refund; signed refund events finalize the return and reverse any seller transfer. Failed refunds can be retried through the admin API; payout reversals use Stripe idempotency and webhook retries.

Connect transfers are queued until 30 days after the vendor allocation is marked delivered. Refunds, disputes, missing seller capabilities, and transfer failures hold allocations for review or retry. This pilot does not enable live payments, real payouts, carrier labels, or cross-border eligibility by assumption.

## Search, cache, and storage

`SEARCH_PROVIDER=mongodb` uses the catalog text index for the pilot. `SEARCH_PROVIDER=elastic` uses Elasticsearch and a Mongo transactional outbox to enqueue product changes for an indexing worker. Catalog API responses are independent of the search provider. Production configuration requires Elastic settings.

MongoDB is the source of truth. Redis provides shared rate limits and cart cache when configured. Images use local storage in development or an S3-compatible bucket; production configuration requires object storage. For deployment environment variables, see `server/.env.example` and the setup instructions in the root README.
