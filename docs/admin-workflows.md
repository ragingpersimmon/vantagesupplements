# Spree Admin workflows — Vantage Supplements

Spree Admin is at `http://localhost:4000/admin` locally (your API host + `/admin` in production). Menu labels below match Spree 6. If a label has moved in a later release, use the admin search.

---

## 1. Create a supplement product

**Before your first product:** run `pnpm seed` in `scripts/` once. It creates the tax categories, the shipping methods, the `vantage.*` custom fields and the **Flavour** option type.

1. **Products → Add product**
2. **Basics**
   - **Name**: e.g. `Vantage Whey Isolate — 2 lb`. The slug is generated from it. Keep it stable once live, since URLs and SEO depend on it.
   - **Description**: marketing copy. Keep health claims within what your Natural Product Number (NPN) licence allows (see §4).
   - **Status**: `Draft` until photos and pricing are final, then `Active`.
3. **Pricing**: enter the **CAD** price. A **Compare-at** price shows a strikethrough "sale" badge on the card.
4. **Tax category**: pick from the table below. This is the most important setting for compliance.

   | Product | Tax category | Result |
   |---|---|---|
   | Protein powder, pre-workout, creatine, BCAAs, vitamins (any form) | **Dietary Supplements** *(default)* | GST/HST + QST + MB RST + SK PST. **No BC PST** |
   | Shakers, apparel, accessories | **General Merchandise** | Taxable everywhere, including BC PST |
   | Only products that legally qualify as a *meal replacement* or *nutritional supplement* under the Food and Drug Regulations | **Zero-Rated Food** | No tax. **Get your accountant's sign-off first.** Misclassifying a protein powder here under-collects 5–15% |

5. **Variants**: add the **Flavour** option and tick each flavour you sell. Each flavour becomes a variant with its own SKU, stock and (optionally) price.
6. **Custom fields** (*Vantage* section). These drive the product cards and the Compare table:

   | Field | Example | Notes |
   |---|---|---|
   | Protein per serving (g) | `25` | Leave blank for non-protein products |
   | Servings per container | `30` | Used for the "price per serving" figure |
   | Flavours | `["Chocolate","Vanilla"]` | JSON list, the summary shown on cards. Keep it in sync with the Flavour variants |
   | Dietary tags | `["Vegan","Gluten-free"]` | First 3 show as chips on the card |
   | NPN | `80012345` | Health Canada Natural Product Number. Shown on the product page. **Don't activate a supplement without one** |

7. **Shipping**: give each variant a **weight**. The current methods are flat-rate, but weight lets you switch to carrier rates (Canada Post, etc.) without re-entering data.
8. **Stock**: set the count on hand per stock location.
9. **Categories**: assign to the catalogue category (e.g. *Protein → Whey*). Categories drive navigation and faceted filters.
10. **SEO**: set meta title and description (≤ 155 chars).
11. **Save**, then view it on the storefront at `/ca/en/products/<slug>`.

### Shipping categories / delivery methods

Spree 6 replaces "shipping categories" with **delivery methods + rules**. The seed creates four records that show to shoppers as **two** options:

| Shopper sees | Cart subtotal | Price |
|---|---|---|
| Standard (5–7 business days) | under $75 | $12.99 |
| Standard (5–7 business days) | $75 and up | **Free** |
| Expedited (2–3 business days) | under $150 | $24.99 |
| Expedited (2–3 business days) | $150 and up | $14.99 |

Change prices or thresholds in `scripts/seed-ca-tax.ts` (`SHIPPING`) and re-run `pnpm seed:tax`, or edit them under **Settings → Delivery methods**. All four carry the **Shipping** tax category, which is how tax on shipping is controlled per province. Don't remove it.

---

## 2. The welcome discount

### How it works (no admin action needed)

When a new shopper signs up with Google, the storefront automatically:

1. creates a **one-customer promotion** named `Welcome 15% — <email>` with code `VANTAGE-WELCOME-XXXXXXXX`
2. restricts it with two rules: **Customer** = that shopper only, and **First order**
3. sets the **usage limit** to 1 and the **expiry** to 30 days
4. emails the code and shows it in an on-screen toast
5. marks the customer (`metadata.welcome_discount_issued = true`) so it is never issued twice

Spree does **not** enforce unique promotion codes. Never hand-create a promotion whose code starts with `VANTAGE-WELCOME-`, because the storefront treats an existing code as already issued.

Settings live in the storefront env: `WELCOME_DISCOUNT_PERCENT`, `WELCOME_DISCOUNT_TTL_DAYS`, `WELCOME_DISCOUNT_ENABLED`.

**Why one promotion per customer?** Spree's Admin API can't create one extra code on an existing promotion on demand. Codes are only generated in batches (see below). A per-customer promotion is the only way to give a code that works for one customer only. Set `WELCOME_PROMOTION_CATEGORY_ID` to a "Welcome" promotion category to keep these promotions grouped and filterable.

### Common tasks

- **Find a customer's code**: **Customers → (customer) → Metadata** shows `welcome_discount_code`. Or search **Promotions** for their email.
- **Resend the email**: copy the code from the customer record and send it manually. (A "resend" button is a good follow-up feature.)
- **Extend or void a code**: **Promotions → (promotion)** → change *Expires at*, or deactivate it.
- **Change the offer for new sign-ups**: change `WELCOME_DISCOUNT_PERCENT` and redeploy. Codes already issued keep their original terms.

### Batch unique codes (influencers, newsletter, events)

For campaigns where you want N unique single-use codes that **aren't** tied to a customer:

1. **Promotions → New promotion**
2. **Kind**: *Coupon code*. Turn on **Multiple codes**. **Code prefix**: e.g. `VANTAGE-IG-`. **Number of codes**: e.g. 500
3. **Usage limit**: leave blank (each generated code is single-use)
4. **Rules**: add **First order** if it's an acquisition offer
5. **Actions**: *Create adjustment* → *Flat percent item total* → `15`
6. Save, then export the generated codes from the promotion's **Coupon codes** tab

---

## 3. Orders and fulfilment

- **Orders**: new orders arrive as *Complete / Ready*. Open one → **Fulfil** → enter the carrier and tracking number. The storefront's `shipment.shipped` webhook sends the shipping email.
- **Tax on an order** is shown per line as separate GST/HST, PST/RST/QST adjustments. That's what your remittance reports need.
- **Refunds/returns**: **Order → Returns**. Tax is reversed proportionally.

---

## 4. Compliance reminders

- **Health Canada**: supplements sold in Canada need a **Natural Product Number (NPN)** and bilingual labelling. Enter it in the product's **NPN** custom field.
- **Quebec**: Charter of the French Language rules apply to product information. The storefront ships with `fr` messages; translate product content too.
- **Tax registration**: you must be registered to collect BC PST, MB RST, SK PST and QST before charging them. See `docs/tax-compliance.md`.
