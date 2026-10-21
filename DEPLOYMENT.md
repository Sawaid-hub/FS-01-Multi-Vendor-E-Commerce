# Separate deployment on Render

The repository includes a Render Blueprint at [`render.yaml`](render.yaml) and separate API and storefront builds. The Blueprint does not create or select paid external service accounts. It asks for provider settings in Render and keeps secret values out of Git.

## Required external services

Before the first deploy, provision:

- MongoDB Atlas (or another MongoDB replica set) for `MONGODB_URI`.
- TLS Redis for `REDIS_URL` (`rediss://...`).
- Elasticsearch-compatible service and API key.
- S3-compatible object storage and credentials.
- An email delivery API URL and key.
- Stripe test-mode secret and webhook signing secret only.
- An FX API URL or fixed pilot rates. The current default FX URL is used when neither is configured.

`render.yaml` generates independent JWT secrets. Populate each `sync: false` value with the credentials issued by the corresponding test/pilot provider. Do not use Stripe live keys. The API rejects them.

## Create the Blueprint

1. Push this repository to a Git provider connected to Render.
2. In Render, create a new Blueprint and select the repository and its root `render.yaml`.
3. Enter the external provider values requested for the API service. Keep MongoDB on a replica set; checkout relies on transactions.
4. Deploy both `market-lane-api` and `market-lane-client`. The Blueprint passes the API's public URL to the Vite build and configures the API CORS and client origin from the storefront URL.
5. Configure the Stripe test webhook to `https://<api-host>/api/v1/webhooks/payments/stripe` and set its signing secret as `STRIPE_WEBHOOK_SECRET` in the API service.
6. Check `https://<api-host>/health` and `/ready`. `/ready` must show connected MongoDB, Redis, Elasticsearch, object storage, and Stripe test mode before exercising the pilot.
7. Create the initial admin using the documented bootstrap procedure from a controlled environment; never add bootstrap credentials to the Blueprint.

For a polished demo, attach custom domains for the client and API under the same registrable domain (for example, `shop.example.com` and `api.example.com`) and update `CLIENT_BASE_URL` and `CORS_ORIGINS` to the exact HTTPS storefront origin. This keeps refresh-cookie behavior reliable across browsers.

## Build separation

- `server/Dockerfile` builds and runs only the Express API. It listens on `PORT` (default 4000) and has a `/health` container health check.
- `client` is built as a Render static site with `npm ci && npm run build`; `VITE_API_BASE_URL` is injected at build time and must be the public API URL.
- `client/Dockerfile` is also available for container-based static hosting and serves the SPA on port 8080.

The deployment definition is prepared but **has not been deployed or validated against Render**. External service accounts, credentials, domain ownership, and provider-specific configuration are still required. A successful deploy would establish a test-mode pilot, not production approval for live transactions.
