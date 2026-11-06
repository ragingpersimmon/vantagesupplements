# Launch log

Append-only. Each phase: date, model, what ran, what broke + fix, evidence.

## Phase 1: Backend boots, inputs distributed (2026-11-06, Sonnet 5.5 worker)
- Fallbacks (launch.env all blank): GOOGLE_CLIENT_ID kept at example placeholder; SHIP_FROM_PROVINCE=BC; Stripe/Resend/Sentry blank. Local LLM not needed.
- Added `scripts/sync-env.ts` (`pnpm sync-env`) and `scripts/setup-store.ts` (`pnpm setup-store`: mints the 3 API keys if still placeholders, market "Canada" CAD en+fr default, stock location "Main warehouse" in BC). Run on the droplet (Docker 29, Node 22).
- `docker compose up -d --build --wait` + `db:seed` OK. `curl localhost:4000/up` -> 200; worker Up/healthy.
- Store API login `{"provider":"google","id_token":"junk"}` -> `authentication_failed: Invalid Google credential`; provider `nope` -> `invalid_provider` (proves google is registered).
- Re-run sync-env + setup-store: all `unchanged` / `=` keep. Store: currency=CAD country=CA locale=en.
- Green: storefront `pnpm check` + `pnpm test` (307 tests), scripts `pnpm typecheck`.
- Note: `spree:cli:create_api_key` prints a secret only once, so keys are minted only when the env file holds a placeholder. One throwaway `probe-test` key was minted and revoked while probing the task output.
- Step 6 (.claude permissions): N/A.

## Phase 2: Tax + shipping proven correct (2026-11-06, Opus 5.5 worker)
- Fallbacks (launch.env blank/deferred): REGISTERED_PROVINCIAL blank -> all four (BC, MB, QC, SK), printed as a warning (staging only; fix before launch); SHIP_FROM_PROVINCE=BC; SK_SUPPLEMENTS=unknown (SK PST on supplements charged, flagged `vantage_verify`). Local LLM not needed.
- `ca-tax-data.ts` now resolves the matrix from launch.env (`parseTaxConfig`, `provincialLayers`, `taxRates`): REGISTERED_PROVINCIAL drops provincial layers on goods AND shipping; SK_SUPPLEMENTS exempt/taxable/unknown. 17 node:test unit tests (`pnpm test` in scripts/).
- Wrong assumptions fixed against Spree v6.0.3 source, each with a regression test: tax rate names must be unique per store across categories (`validates_store_uniqueness :name`) -> non-supplement rates get ` · Merchandise` / ` · Shipping` suffixes, `show_rate_in_label` off (name already has the %); delivery method names unique per store -> free/reduced tiers renamed (`lib/shipping-data.ts`); json custom fields can't be `searchable` (seed:products failed); products must be published on the channel or the Store API 404s them (seed:products now publishes; existing unpublished demo products were published once).
- Seed: `pnpm seed:tax --dry-run` (58 planned creates) -> `pnpm seed:tax` -> (first apply stopped on the duplicate delivery-method name after 56 creates; fixed, re-applied: 3 creates) -> re-run: 0 `+` / 58 `=` / 0 `~` (idempotent; delivery methods now drift-checked instead of always updated). `pnpm seed:products` created 5 products; re-run 0 changes.
- Note for the accountant: SK_SUPPLEMENTS=exempt removes SK PST from supplements only; SK PST on shipping stays (flagged) since launch.env doesn't decide it.
- `pnpm verify:tax` (Store API guest carts, expected values computed from ca-tax-data.ts):

Config: ship-from BC · provincial registered BC, MB, QC, SK · SK supplements unknown
⚠ REGISTERED_PROVINCIAL is blank: charging provincial tax in all of BC, MB, QC, SK (staging only; fix before launch).

| Province | Cart | Expected | Actual | |
|---|---|---|---|---|
| AB | whey | $3.65 (GST 3.65) | $3.65 (GST 3.65) | ✅ |
| AB | whey + shaker | $4.40 (GST 4.40) | $4.40 (GST 4.40) | ✅ |
| BC | whey | $3.65 (GST 3.65) | $3.65 (GST 3.65) | ✅ |
| BC | whey + shaker | $5.45 (GST 4.40 + PST 1.05) | $5.45 (GST 4.40 + PST 1.05) | ✅ |
| MB | whey | $8.76 (GST 3.65 + RST 5.11) | $8.76 (GST 3.65 + RST 5.11) | ✅ |
| MB | whey + shaker | $10.56 (GST 4.40 + RST 6.16) | $10.56 (GST 4.40 + RST 6.16) | ✅ |
| NB | whey | $10.95 (HST 10.95) | $10.95 (HST 10.95) | ✅ |
| NB | whey + shaker | $13.20 (HST 13.20) | $13.20 (HST 13.20) | ✅ |
| NL | whey | $10.95 (HST 10.95) | $10.95 (HST 10.95) | ✅ |
| NL | whey + shaker | $13.20 (HST 13.20) | $13.20 (HST 13.20) | ✅ |
| NS | whey | $10.22 (HST 10.22) | $10.22 (HST 10.22) | ✅ |
| NS | whey + shaker | $12.32 (HST 12.32) | $12.32 (HST 12.32) | ✅ |
| NT | whey | $3.65 (GST 3.65) | $3.65 (GST 3.65) | ✅ |
| NT | whey + shaker | $4.40 (GST 4.40) | $4.40 (GST 4.40) | ✅ |
| NU | whey | $3.65 (GST 3.65) | $3.65 (GST 3.65) | ✅ |
| NU | whey + shaker | $4.40 (GST 4.40) | $4.40 (GST 4.40) | ✅ |
| ON | whey | $9.49 (HST 9.49) | $9.49 (HST 9.49) | ✅ |
| ON | whey + shaker | $11.44 (HST 11.44) | $11.44 (HST 11.44) | ✅ |
| PE | whey | $10.95 (HST 10.95) | $10.95 (HST 10.95) | ✅ |
| PE | whey + shaker | $13.20 (HST 13.20) | $13.20 (HST 13.20) | ✅ |
| QC | whey | $10.93 (GST 3.65 + QST 7.28) | $10.93 (GST 3.65 + QST 7.28) | ✅ |
| QC | whey + shaker | $13.18 (GST 4.40 + QST 8.78) | $13.18 (GST 4.40 + QST 8.78) | ✅ |
| SK | whey | $8.03 (GST 3.65 + PST 4.38) | $8.03 (GST 3.65 + PST 4.38) | ✅ |
| SK | whey + shaker | $9.68 (GST 4.40 + PST 5.28) | $9.68 (GST 4.40 + PST 5.28) | ✅ |
| YT | whey | $3.65 (GST 3.65) | $3.65 (GST 3.65) | ✅ |
| YT | whey + shaker | $4.40 (GST 4.40) | $4.40 (GST 4.40) | ✅ |

| Shipping tier check | Item total | Standard | Expedited | |
|---|---|---|---|---|
| whey, all 13 provinces, exactly 1 Standard + 1 Expedited | $59.99 | $12.99 (want $12.99) | $24.99 (want $24.99) | ✅ |
| whey + shaker, all 13 provinces, exactly 1 Standard + 1 Expedited | $74.98 | $12.99 (want $12.99) | $24.99 (want $24.99) | ✅ |
| whey ×2 (ON) | $119.98 | $0.00 (want $0.00) | $24.99 (want $24.99) | ✅ |
| whey ×3 (ON) | $179.97 | $0.00 (want $0.00) | $14.99 (want $14.99) | ✅ |

26/26 cart cases ✅ · all tier checks ✅

- Green: scripts `pnpm test` (17) + `pnpm typecheck`; storefront `pnpm check` + `pnpm test` (307 tests).