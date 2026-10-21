# Project Overview: Multi-Vendor E-Commerce Marketplace

## Purpose

Build an Amazon-style marketplace with distinct customer, vendor, and admin workflows. Vendors manage their catalog; customers search, purchase, and review products; the platform manages orders and calculates its commission. Payment integration must use test mode only.

## Goals

1. Demonstrate role-aware authentication and authorization.
2. Support vendor onboarding and product management, including image uploads.
3. Make products searchable with filters and sorting.
4. Support a cart, checkout, and an order lifecycle.
5. Demonstrate split-payment/commission handling in provider test mode.
6. Provide useful admin visibility and clear project documentation.

## Scope

### Required features

- Customer, vendor, and admin roles; JWT-based authentication and role-based access
- Vendor onboarding and vendor-owned product create/read/update/delete operations
- Product image upload using AWS S3 (or a clearly documented local development substitute)
- Product search, filtering, and sorting using Elasticsearch
- Cart and checkout; Redis caching for carts/sessions
- Orders with statuses: placed, packed, shipped, delivered
- Razorpay or Stripe Connect integration in test mode, with marketplace commission and split-payment flow
- Product reviews and coupons
- PDF invoices
- Admin analytics page
- Separate frontend and backend deployments

### Out of scope for the capstone

- Real charges or production payment credentials
- Real fulfillment, tax, or regulatory workflows
- Production-grade fraud detection, recommendation systems, or global-scale operations

## Proposed architecture

React client → Node.js API → MongoDB for durable marketplace data. The API uses Elasticsearch for catalog search, Redis for cart/session caching, S3 for images, and a payment provider's sandbox for checkout and split-payment demonstrations. Keep all external integrations behind small service modules so local development can use safe substitutes where appropriate.

See [Backend-handoff.md](Backend-handoff.md) for the target modular-monolith structure, portal responsibilities, role/ownership boundaries, detailed data model, API route plan, security rules, checkout lifecycle, local dependency setup, and implementation milestones. It distinguishes the planned design from the API foundation that currently exists.

## Core data concepts

- User (role and account details)
- Vendor profile
- Product (vendor, price, inventory, category, image references)
- Cart and cart items
- Order and order items (including vendor allocation, status, totals, commission)
- Review
- Coupon
- Payment/payout record (sandbox identifiers and status)

Document final fields, indexes, ownership rules, and API contracts in the repository before implementation is considered complete.

## Delivery plan

1. **Define:** Confirm MVP flows, draw architecture/data diagrams, list API routes, and prepare acceptance criteria.
2. **Foundation:** Scaffold React and Node.js, connect MongoDB, implement authentication and role checks.
3. **Catalog:** Build vendor onboarding and product management; add image upload and catalog search/filter/sort.
4. **Commerce:** Add cart, checkout, order statuses, Redis caching, and sandbox split-payment/commission flow.
5. **Completion features:** Add reviews, coupons, invoices, and admin analytics.
6. **Quality and release:** Test role boundaries, cart/order/payment flows, search, and failure states; deploy client and API separately; capture demo evidence.
7. **Submission:** Finalize docs, test results, 10-minute presentation, and individual reflection.

## Acceptance criteria

- A vendor can manage only their own products; customers cannot use vendor/admin actions.
- Customers can find products, add them to a cart, and place a test order.
- The order lifecycle can be demonstrated through all four statuses.
- Commission and vendor allocation are visible in a sandbox payment/order record; no live charge is made.
- Search, filters, and sorting return expected results on documented sample data.
- Reviews, coupons, PDF invoices, and admin analytics are demonstrable.
- A new developer can follow the README to configure and run the project, and the deployed demo or recording works.

## Risks and scope control

This feature set is large for a 14-day estimated effort. Prioritize the end-to-end customer/vendor flow and sandbox payment first. Treat analytics, invoice polish, and deeper search tuning as later milestones. If external credentials or services are unavailable, provide a documented local substitute and explain the limitation in the demo; do not represent a mock as a live integration.

## Portal deliverables

Put code, reports, screenshots, and any datasets in the `FS-01` submission subfolder. Include the shared deliverables listed in the portal: working demo/recording, repository and setup guide, architecture and API/data docs, test results, 10-minute presentation, and individual reflection.
