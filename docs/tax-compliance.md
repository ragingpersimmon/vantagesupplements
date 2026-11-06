# Canadian sales tax — design notes

> Not tax advice. This explains what the seed configures and why. Have a Canadian sales-tax accountant review `scripts/lib/ca-tax-data.ts` before launch.

## Rates seeded (checked 2026-11-04)

| Province | Federal | Provincial | Combined |
|---|---|---|---|
| AB, NT, NU, YT | GST 5% | — | 5% |
| BC | GST 5% | PST 7% | 12% |
| MB | GST 5% | RST 7% | 12% |
| SK | GST 5% | PST 6% | 11% |
| QC | GST 5% | QST 9.975% (not compounded) | 14.975% |
| ON | HST 13% | — | 13% |
| NS | HST 14% (was 15% before 2025-04-01) | — | 14% |
| NB, NL, PE | HST 15% | — | 15% |

## The issue the original brief missed: product taxability

"PST applies in BC, SK, MB, QC" is true for *general goods*. For a supplement store, the catalogue mostly isn't general goods:

1. **GST/HST applies to dietary supplements.** CRA's GI-001 says products commonly described as dietary supplements are not zero-rated basic groceries. CRA has ruled the same for protein powders designed to supplement normal protein intake. Products that legally qualify as **meal replacements / nutritional supplements** under the Food and Drug Regulations are zero-rated.
2. **BC PST does NOT apply to dietary supplements.** BC exempts orally ingestible vitamins and dietary supplements, explicitly including protein and sports supplements (PSTERR s.3(2)(a); Bulletins PST 206/207). Charging 7% BC PST on protein would over-collect from your home-province customers.
3. **MB RST does apply.** Manitoba's 2026 changes exempted prenatal vitamins and more foods, but dietary supplements stay taxable.
4. **SK PST** is seeded as taxable and flagged `vantage_verify=true` until confirmed against Saskatchewan's taxable/exempt list (Bulletin PST-2). Record the accountant's answer as `SK_SUPPLEMENTS` in `launch.env`: `exempt` removes SK PST from supplements, `taxable` keeps it and clears the flag, `unknown` (default) keeps it flagged.

So the seed creates **four tax categories** (Dietary Supplements / General Merchandise / Zero-Rated Food / Shipping) instead of one rate per province. Each product's tax category decides what it's charged.

## Tax on shipping

Spree taxes a shipping charge using the delivery method's tax category (**Shipping**):

- **GST/HST and QST** follow the goods → applied to shipping everywhere.
- **MB RST**: applies to delivery charges when the vendor ships from outside MB. **SK PST**: applies when delivery originates outside SK. Both are controlled by `SHIP_FROM_PROVINCE`.
- **BC PST** on delivery follows the goods. The core catalogue is BC PST-exempt, so BC shipping carries no PST.

**Known limitation:** Spree's built-in tax engine taxes shipping per delivery method, not split across exempt and taxable items in a mixed cart. A BC cart with protein and a shaker should, in principle, carry PST on the shaker's share of shipping, and the built-in engine won't add it. If merchandise becomes a meaningful share of BC revenue, plug in a tax provider that prorates (Spree lists them under `GET /api/v3/admin/tax_providers`).

## Registration thresholds

- **GST/HST**: mandatory once taxable sales pass $30,000 over four consecutive quarters (small-supplier threshold).
- **QST**: out-of-province sellers to Quebec consumers must register under the specified (simplified) regime once sales pass $30,000.
- **BC PST, MB RST, SK PST**: each province has its own rules for out-of-province sellers who ship goods in.

Don't charge a tax you're not registered for. List the provinces where you're registered for provincial tax in `REGISTERED_PROVINCIAL` (`launch.env`, comma list from BC, MB, QC, SK) and re-run `pnpm seed:tax`: provincial layers (goods and shipping) for unlisted provinces are dropped, and the seed deletes rates it owns that are no longer in the matrix. Blank means all four, with a warning (staging only). GST/HST is always charged.

## Verifying

`pnpm verify:tax` (scripts/) builds real guest carts through the Store API for all 13 provinces × 2 carts (whey; whey + shaker), selects Standard shipping, and compares every tax line with what `ca-tax-data.ts` + `launch.env` predict (rounded half up per line and rate, like Spree's internal tax provider). It also checks the shipping tiers. Rate names carry a category suffix (`· Merchandise`, `· Shipping`) because Spree requires tax rate names to be unique per store; the name is the label customers see.
