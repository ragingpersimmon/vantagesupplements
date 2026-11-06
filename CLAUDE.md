# Vantage Supplements — agent guide

Canadian DTC supplement store. `backend/` = Spree 6 API (official image + Google login
provider). `storefront/` = fork of spree/storefront (Next.js 16; its own rules live in
`storefront/CLAUDE.md`). `scripts/` = tax, shipping and product seeds. `docs/` = runbooks.

## How to work
- The user said: "Do Phase N." Read ONLY `docs/phases/N.md` plus the files it lists. Don't
  explore the repo beyond that, and never read `node_modules/`, `.next/` or lockfiles.
- All user inputs live in `launch.env` (repo root, gitignored). Never ask for anything in it.
  If a value is blank, use the phase's fallback and note it in the report.
- Branch `phase-N-<slug>`, small conventional commits, open a PR when done. Never push to main.
- Logs: `tail -50` or `pnpm llm summarize < file`. Never dump full logs into context.
- Bulk text (translations, copy, alt text, legal drafts, fixtures) → `pnpm llm` (local
  model), then review. The local model never writes code.
- If an assumption in code is wrong, read the real source (github.com/spree/spree,
  `@spree/admin-sdk` types) and fix it, with a regression test. Don't guess API shapes.
- Same approach fails twice → stop, write what you tried in the report, and recommend escalating the model.
- Done = the phase's acceptance checks pass + `pnpm check && pnpm test` (storefront) +
  `pnpm typecheck` (scripts) are green. Append evidence to `docs/LAUNCH_LOG.md`.
- End every phase with a ≤10-line report: done / evidence / blocked / next phase.

## Locked decisions (don't reverse)
- Sessions are Spree JWTs; no NextAuth. Google ID token → Spree `google` provider.
- Welcome coupon = one promotion per customer (customer + first_order rules, usage_limit 1).
  Spree does NOT enforce unique codes and stores them lowercased; duplicates are prevented by
  lookup-before-create + post-create reconciliation in `storefront/src/lib/vantage/welcome-discount.ts`.
- The tax matrix lives only in `scripts/lib/ca-tax-data.ts`. Supplements are BC PST-exempt.
- `SPREE_ADMIN_API_KEY` is server-only. Never `NEXT_PUBLIC_`, never committed.
- Official Spree image: RAILS_ENV=production, app in /rails, worker `bin/jobs`.
  Seed with `bin/rails db:seed`; keys via `NAME= KEY_TYPE= SCOPES= bin/rails spree:cli:create_api_key`.

## Phases
| # | Phase | Model / effort |
|---|---|---|
| 1 | Backend boots + inputs distributed | Sonnet 5.5 / Medium |
| 2 | Tax + shipping proven correct | Opus 5.5 / High |
| 3 | Catalogue + compare render, local-LLM content | Sonnet 5.5 / Medium |
| 4 | Google sign-in + welcome coupon end to end | Opus 5.5 / High |
| 5 | Stripe payments | Sonnet 5.5 / High |
| 6 | Quality bar: Lighthouse, e2e, branding | Sonnet 5.5 / Medium (e2e Google mock: Opus) |
| 7 | Compliance features (CASL, legal pages, NPN gate) | Sonnet 5.5 / Medium |
| 8 | Staging deploy + smoke | Sonnet 5.5 / Medium |
