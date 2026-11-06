/**
 * Free bulk work on Ric's local model (any OpenAI-compatible server: llama.cpp,
 * LM Studio, vLLM). Reads LOCAL_LLM_* from ../launch.env.
 *
 *   pnpm llm ping                      check the server is up
 *   pnpm llm summarize < big.log       ≤15-line summary (uses the small model if set)
 *   pnpm llm translate de es pl        fill storefront strings still identical to English
 *   pnpm llm product-copy              fr descriptions + SEO meta → docs/content/products.fr.md
 *   pnpm llm legal                     draft legal pages → docs/content/legal/*.md
 *
 * Rules: output is DRAFT text for review. Never code. Translations keep ICU
 * placeholders exactly; any string that fails the placeholder check is skipped.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO } from "./lib/demo-catalogue";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MESSAGES = join(ROOT, "storefront/messages");
const LOCALE_NAMES: Record<string, string> = {
  fr: "Canadian French (fr-CA)",
  de: "German",
  es: "Spanish",
  pl: "Polish",
};

type Endpoint = { url: string; model: string };

function endpoint(small = false): Endpoint {
  const url = (small && process.env.LOCAL_LLM_SMALL_URL) || process.env.LOCAL_LLM_URL;
  const model = (small && process.env.LOCAL_LLM_SMALL_MODEL) || process.env.LOCAL_LLM_MODEL;
  if (!url || !model) {
    console.error("LOCAL_LLM_URL / LOCAL_LLM_MODEL not set in launch.env");
    process.exit(2);
  }
  return { url: url.replace(/\/$/, ""), model };
}

async function chat(system: string, user: string, opts: { small?: boolean; json?: boolean } = {}) {
  const { url, model } = endpoint(opts.small);
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  // Strip <think> blocks some local models emit.
  return data.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function parseJson(text: string): Record<string, string> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1));
}

// ── flatten / unflatten next-intl message files ─────────────────────────────
type Tree = { [k: string]: string | Tree };
function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}
function setPath(tree: Tree, path: string, value: string) {
  const parts = path.split(".");
  let node = tree;
  for (const p of parts.slice(0, -1)) node = node[p] as Tree;
  node[parts.at(-1)!] = value;
}
const placeholders = (s: string) =>
  [...s.matchAll(/\{([a-zA-Z0-9_]+)/g)].map((m) => m[1]).sort().join(",");

async function translate(locales: string[]) {
  const en = flatten(JSON.parse(readFileSync(join(MESSAGES, "en.json"), "utf8")));
  const ledgerPath = join(ROOT, "docs/i18n-machine-translated.json");
  let ledger: Record<string, string[]> = {};
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch {}

  for (const locale of locales) {
    const file = join(MESSAGES, `${locale}.json`);
    const tree = JSON.parse(readFileSync(file, "utf8")) as Tree;
    const flat = flatten(tree);
    const todo = Object.entries(flat).filter(([k, v]) => en[k] === v && /[a-zA-Z]{3}/.test(v));
    console.log(`${locale}: ${todo.length} strings to translate`);
    const done: string[] = [];

    for (let i = 0; i < todo.length; i += 40) {
      const batch = Object.fromEntries(todo.slice(i, i + 40));
      const out = parseJson(
        await chat(
          `You translate e-commerce UI strings from English to ${LOCALE_NAMES[locale] ?? locale}. ` +
            "Return ONLY a JSON object with the same keys. Keep ICU syntax ({name}, {count, plural, ...}) " +
            "and placeholder names exactly; translate only the human text. Concise UI register.",
          JSON.stringify(batch),
          { json: true },
        ),
      );
      for (const [key, source] of Object.entries(batch)) {
        const t = out[key];
        if (typeof t !== "string" || !t.trim() || placeholders(t) !== placeholders(source)) {
          console.warn(`  skip ${key} (missing or placeholder mismatch)`);
          continue;
        }
        setPath(tree, key, t);
        done.push(key);
      }
      process.stdout.write(`  ${Math.min(i + 40, todo.length)}/${todo.length}\r`);
    }
    writeFileSync(file, `${JSON.stringify(tree, null, 2)}\n`);
    ledger[locale] = [...new Set([...(ledger[locale] ?? []), ...done])].sort();
    console.log(`\n${locale}: wrote ${done.length}`);
  }
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log("Machine-translated keys are listed in docs/i18n-machine-translated.json for review.");
}

async function productCopy() {
  const parts: string[] = [
    "# Product copy, French (DRAFT: machine-generated, needs human review)\n",
    "Keep claims within each product's NPN licence. Nothing here is applied automatically.\n",
  ];
  for (const p of DEMO) {
    const text = await chat(
      "You write Canadian French (fr-CA) e-commerce copy for a supplement brand. Factual, no health " +
        "claims beyond what's given, no superlatives about efficacy. Output markdown with three sections: " +
        "**Description** (2 short paragraphs), **Titre SEO** (≤60 chars), **Méta description** (≤155 chars).",
      `Product: ${p.name}\nEnglish description: ${p.description}\nFlavours: ${p.flavors.join(", ") || "n/a"}\n` +
        `Dietary: ${p.facts.dietary_tags.join(", ") || "n/a"}`,
    );
    parts.push(`\n## ${p.name}  \n\`${p.slug}\`\n\n${text}\n`);
    console.log(`✓ ${p.slug}`);
  }
  const out = join(ROOT, "docs/content/products.fr.md");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, parts.join(""));
  console.log(`→ ${out}`);
}

async function legal() {
  const biz = {
    name: process.env.BUSINESS_LEGAL_NAME || "[BUSINESS LEGAL NAME]",
    address: process.env.BUSINESS_MAILING_ADDRESS || "[MAILING ADDRESS]",
    email: process.env.SUPPORT_EMAIL || "[SUPPORT EMAIL]",
  };
  const pages: Record<string, string> = {
    privacy:
      "a privacy policy compliant in spirit with PIPEDA and Quebec Law 25: data collected (account, Google sign-in profile, orders, cookies/analytics with consent), purposes, retention, cross-border processing (US hosting providers), the privacy officer contact, access/correction/deletion rights, and the Quebec-specific confidentiality incident and portability rights",
    terms:
      "terms of sale for an online supplement store selling to Canadian consumers: pricing in CAD, taxes, order acceptance, promotions (single-use welcome codes, one per customer), limitation of liability, governing law of British Columbia",
    "shipping-returns":
      "a shipping and returns policy: Canada-only shipping, Standard 5–7 and Expedited 2–3 business days, free Standard over $75, 30-day returns on unopened products (opened supplements not returnable for safety), refunds to the original payment method",
  };
  const dir = join(ROOT, "docs/content/legal");
  mkdirSync(dir, { recursive: true });
  for (const [slug, brief] of Object.entries(pages)) {
    const text = await chat(
      "You draft plain-language website legal pages for a small Canadian business. Output markdown. " +
        "Use the exact business details given. Start with a line: '> DRAFT: needs lawyer review.'",
      `Write ${brief}. Business: ${biz.name}, ${biz.address}. Contact: ${biz.email}. Brand: Vantage Supplements.`,
    );
    writeFileSync(join(dir, `${slug}.md`), `${text}\n`);
    console.log(`✓ docs/content/legal/${slug}.md`);
  }
}

async function summarize() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const input = Buffer.concat(chunks).toString("utf8");
  // Keep the tail. Errors are usually at the end, and it bounds the prompt size.
  const clipped = input.length > 60_000 ? input.slice(-60_000) : input;
  console.log(
    await chat(
      "Summarize this build/runtime log for an engineer in ≤15 lines: the first real error, its file/line, " +
        "and the probable cause. Quote exact error messages. No advice beyond one line of 'likely fix'.",
      clipped,
      { small: true },
    ),
  );
}

const [cmd, ...args] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  ping: async () => console.log(await chat("Reply with exactly: pong", "ping")),
  summarize,
  translate: () => translate(args.length ? args : ["de", "es", "pl"]),
  "product-copy": productCopy,
  legal,
};
if (!cmd || !commands[cmd]) {
  console.error(`usage: pnpm llm <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
commands[cmd]().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
