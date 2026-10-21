# Agent and Contributor Instructions

## Before changing code

- Read this file, [RULES.md](RULES.md), [Memory.md](Memory.md), [README.md](README.md), and [Overview.md](Overview.md). For backend changes, also read [Backend-handoff.md](Backend-handoff.md) and the relevant API documentation. For UI changes, read [BRAND_GUIDE.md](BRAND_GUIDE.md).
- Inspect the existing repository and preserve its conventions; do not replace an existing architecture without a clear reason.
- Keep the MVP tied to the acceptance criteria in `Overview.md`.

## Implementation rules

- Keep frontend, API, persistence, search, cache, storage, and payment responsibilities separated.
- Enforce authorization on the server for every protected action. A hidden UI control is not an access check.
- Scope vendor product/order operations to the authenticated vendor.
- Use only payment sandbox/test credentials. Never commit secrets, tokens, personal data, or real credentials.
- Validate inputs and handle external-service failures without losing order consistency.
- Document required environment variables in `.env.example`; never put real values there.
- Make small, focused changes and keep commits understandable.
- Update setup/API/data documentation when behavior or contracts change.

## Verification

Follow the testing and verification rules in [RULES.md](RULES.md). Do not claim a feature or external integration works unless it has been exercised; label mock behavior clearly.

## Collaboration

Follow the collaboration guidance in [RULES.md](RULES.md). Before parallel work, agree on file ownership and API/data contracts. Avoid multiple contributors editing the same files at once. Record non-obvious decisions and unresolved questions in `Memory.md`.
