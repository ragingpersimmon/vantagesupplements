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
