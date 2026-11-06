# Vantage Supplements — headless commerce platform

> **Running the build with an agent?** Fill `launch.env.example` → save as `launch.env`, start
> your local LLM server (optional), open Claude Code in this repo, and say **"Do Phase 1."**
> Then Phase 2, and so on, one per session (`/clear` between them). The model and effort for each
> phase are in `CLAUDE.md`. Progress goes to `docs/LAUNCH_LOG.md`.

A Canadian DTC supplement storefront built from existing commerce pieces:

| Layer | Tech | Source |
|---|---|---|
| Commerce backend | Spree 6 (Store + Admin API v3), PostgreSQL, Redis | `ghcr.io/spree/spree` image + a thin Vantage layer (`backend/`) |
| Storefront | Next.js 16, React 19, Tailwind 4 | Fork of `spree/storefront` (`storefront/`) |
| Sign-in | Google Identity Services (One Tap + button) → Spree session | `backend/app/models/vantage/google_id_token_strategy.rb` |
| Welcome discount | Server-side Spree Admin API calls, idempotent | `storefront/src/lib/vantage/welcome-discount.ts` |
| Email | react-email + Resend (writes HTML files in dev) | storefront's existing mailer |
| Tax / shipping | Spree tax categories + delivery methods, seeded | `scripts/` |
| Search | Meilisearch (optional) | `docker compose --profile search` |
| Deploy | Vercel (storefront) + Render/Fly.io (API + worker) | — |

```
vantage-supplements/
├── backend/                 # Spree API = official image + Vantage Google strategy
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── app/models/vantage/google_id_token_strategy.rb
│   └── config/initializers/vantage.rb
├── storefront/              # fork of spree/storefront
│   └── src/
│       ├── app/api/auth/signup-discount/route.ts
│       ├── app/[country]/[locale]/(storefront)/compare/page.tsx
│       ├── components/auth/GoogleSignIn.tsx
│       ├── components/compare/{CompareBar,CompareToggle}.tsx
│       ├── components/products/ProductCard.tsx       (supplement facts)
│       ├── contexts/CompareContext.tsx
│       └── lib/vantage/{admin-client,welcome-discount,supplement}.ts
├── scripts/
│   ├── lib/ca-tax-data.ts   # the tax matrix (source of truth, with citations)
│   ├── seed-ca-tax.ts       # tax categories, 13 provinces/territories, shipping
│   └── seed-products.ts     # custom fields, Flavour option, demo catalogue
└── docs/
    ├── admin-workflows.md
    └── tax-compliance.md
```

## Architecture

```
                        ┌──────────────────────────────┐
  Browser               │ Google Identity Services      │
  ───────               │ (One Tap / button)            │
  RSC pages, cart,      └──────────────┬───────────────┘
  compare tray                         │ ① ID token (JWT, signed by Google)
      │                                ▼
      │        ┌───────────────────────────────────────────────────────────┐
      │        │ Next.js storefront (Vercel)                               │
      └───────▶│                                                           │
               │  Server Action loginWithGoogle(idToken)                   │
               │   ├─ ② POST /api/v3/store/auth/login {provider:"google"}  │──┐
               │   ├─ ④ set httpOnly Spree JWT + refresh cookies           │  │
               │   └─ ⑤ issueWelcomeDiscount(customerId) ──────────────────┼──┼─┐
               │                                                           │  │ │
               │  POST /api/auth/signup-discount  (same service; retries)  │  │ │
               │  RSC catalog / PDP / compare  ── publishable key ─────────┼──┤ │
               │                                                           │  │ │
               │  🔒 SPREE_ADMIN_API_KEY: server-only module, never bundled│  │ │
               └───────────────────────────────────────────────────────────┘  │ │
                                                                              │ │
               ┌──────────────────────────────────────────────────────────┐   │ │
               │ Spree API (Render/Fly)                                   │◀──┘ │
               │  Store API  /api/v3/store                                │     │
               │   └─ ③ GoogleIdTokenStrategy: verify sig/iss/aud/exp,    │     │
               │        find-or-create customer + UserIdentity            │     │
               │  Admin API  /api/v3/admin  ◀── ⑥ customers.get/update,   │◀────┘
               │                                promotions.create         │
               │  Tax categories × provinces, delivery methods + rules    │
               │  Spree Admin UI  /admin                                  │
               └───────────────┬──────────────────────────┬───────────────┘
                               ▼                          ▼
                         PostgreSQL                 Redis / Solid Queue worker
                                                          │
                                       ⑦ Resend ◀─────────┘ (storefront sends
                                       welcome + order emails via react-email)
```

## Decisions that differ from the brief

1. **No NextAuth.** `spree/storefront` already has its own session: Spree JWT + refresh token in httpOnly cookies, used for cart association, account pages and checkout. Adding NextAuth would mean two sessions that drift apart, plus a custom token exchange anyway. Spree 6 has pluggable login providers, so I added a `google` provider to Spree. The storefront sends it the Google ID token and gets a normal Spree session back. One Tap is a Google Identity Services feature that NextAuth doesn't provide, so it would have needed GIS either way. As a result, `GOOGLE_CLIENT_SECRET` and `NEXTAUTH_SECRET` aren't needed. The only Google value needed is the public client ID.
2. **One promotion per customer, not one code on a shared promotion.** Spree's Admin API only generates coupon codes in batches, so it can't mint a single code on demand. A per-customer promotion with `customer` + `first_order` rules and `usage_limit: 1` gives exactly "a unique code only this person can use, once, on their first order."
3. **Four tax categories, not one rate per province.** Supplements are **BC PST-exempt**, and GST/HST applies to them, but qualifying meal replacements are zero-rated. A single per-province rate would over-charge every BC customer 7%. Details and sources: `docs/tax-compliance.md`.
4. **Shipping "tiers" use rules.** Each tier is a delivery method limited by an item-total rule, so a shopper only ever sees one Standard and one Expedited option at the right price. Free Standard applies at $75+.

## Idempotency of the welcome discount

Spree does **not** enforce unique promotion codes (no validation, non-unique index), so uniqueness is handled in the storefront:

| Layer | Protects against |
|---|---|
| `metadata.welcome_discount_issued` on the Spree customer | callback refresh, repeat sign-ins |
| Code = HMAC(customer ID); look the code up before creating | a retry after an attempt that created the promotion but failed before setting the flag |
| After creating, list all promotions with that code; the oldest wins and the rest are deleted | two simultaneous requests. Worst case, the same code is emailed twice; a second working coupon can't survive |
| `orders_count > 0` → ineligible; promotion has `first_order` + `customer` rules | existing customers; leaked or forwarded codes |

Email failure doesn't roll anything back. The coupon is flagged and can be resent from the code stored on the customer.

## Local development

**Prerequisites:** Docker, Node 22+, pnpm 10, and a Google Cloud OAuth **Web** client (APIs & Services → Credentials). Add `http://localhost:3001` to *Authorized JavaScript origins*.

```bash
# 1. Backend
cd backend
cp .env.example .env            # set SECRET_KEY_BASE, GOOGLE_CLIENT_ID
docker compose up -d --build --wait
docker compose exec web bin/rails db:seed   # store + first admin (ADMIN_EMAIL/PASSWORD)
#  Spree Admin → Settings: set store currency CAD, default country Canada,
#  and create a "Canada" market (CAD, en + fr). Add a stock location.

# 2. API keys (three keys, least privilege)
key() { docker compose exec -e NAME="$1" -e KEY_TYPE="$2" -e SCOPES="$3" web bin/rails spree:cli:create_api_key; }
key storefront publishable
key storefront-runtime secret read_customers,write_customers,read_promotions,write_promotions
key seed secret write_settings,write_delivery_methods,write_products,read_all

# 3. Seed tax, shipping, catalogue
cd ../scripts
cp .env.example .env            # SPREE_SEED_API_KEY, SHIP_FROM_PROVINCE
pnpm install
pnpm seed:tax --dry-run         # review the plan
pnpm seed                       # tax + shipping, then products

# 4. Storefront
cd ../storefront
cp .env.example .env.local      # SPREE_PUBLISHABLE_KEY, SPREE_ADMIN_API_KEY,
                                # NEXT_PUBLIC_GOOGLE_CLIENT_ID, WELCOME_DISCOUNT_SECRET
pnpm install
pnpm dev                        # http://localhost:3001/ca/en
```

In dev, emails aren't sent. They're written to `storefront/.next/emails/*.html` and the path is logged.

**Test the flow:** open the storefront in a private window → the One Tap prompt appears → sign in. You should get a toast with `VANTAGE-WELCOME-…`, a welcome email HTML file, a new promotion under Spree Admin → Promotions, and a flag on the customer. Sign out and back in: no second coupon.

```bash
cd storefront
pnpm test        # unit tests, including welcome-discount idempotency
pnpm check       # biome
pnpm test:e2e    # Playwright (spins up its own Spree)
```

## Production notes

- **Hosting**: `render.yaml` is a Render Blueprint for the API, the worker and Postgres. The storefront goes on Vercel with project root `storefront/`.
- **Pin `SPREE_IMAGE`** to an exact tag. The backend Dockerfile relies on the image's app root being `/rails` and on the `rails` user (verified against spree-starter's Dockerfile).
- **`RAILS_ENV` must be `production`** even locally. The official image ships without development gems.
- **Secrets**: `SPREE_ADMIN_API_KEY` and `WELCOME_DISCOUNT_SECRET` are server-only env vars on Vercel. **Revoke the seed key** after go-live.
- **Google**: add production origins to the OAuth client. Once sign-in volume grows, publish the OAuth consent screen (the scopes are basic `openid email profile`).
- **Performance**: the GIS script loads with `lazyOnload` and the button reserves its height, so it adds no LCP or CLS cost. Product facts come from the same server-side listing fetch (`expand: custom_fields`), so there's no client waterfall. Re-run Lighthouse mobile after theming; the upstream baseline is 98.
- **Rate limits**: Spree throttles logins per IP (`SPREE_RATE_LIMIT_LOGIN`). Defaults are fine for production.
- **Hardening follow-up**: add a GIS `nonce` (server-issued, checked in the Ruby strategy) to block replay of an intercepted ID token within its 1-hour lifetime.
