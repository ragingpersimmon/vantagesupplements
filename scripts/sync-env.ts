/**
 * Creates backend/.env, storefront/.env.local and scripts/.env from their
 * .env.example files, generating secrets and copying shared values from
 * ../launch.env. Re-runnable: a value that is already real is never replaced
 * (so secrets and API keys survive), only placeholders and blanks are filled.
 *
 *   pnpm sync-env
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hex = (bytes: number) => () => randomBytes(bytes).toString("hex");

function parse(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const launch = parse(read(resolve(root, "launch.env")));
const fromLaunch = (key: string) => launch.get(key)?.trim() || undefined;

const PLACEHOLDER = /replace|your_|example|^1234567890-abc123|^dev_master_key|^change_me/i;
const isPlaceholder = (v: string | undefined) => !v || PLACEHOLDER.test(v);

interface Target {
  example: string;
  out: string;
  /** Secrets generated once (kept if already real). */
  generate: Record<string, () => string>;
  /** Copied from launch.env whenever it has a non-blank value. */
  fromLaunch: Record<string, string>;
  /** Example placeholders that must not ship; blanked unless launch.env provides them. */
  blank: string[];
}

const targets: Target[] = [
  {
    example: "backend/.env.example",
    out: "backend/.env",
    generate: {
      SECRET_KEY_BASE: hex(64),
      ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY: hex(32),
      ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY: hex(32),
      ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT: hex(32),
      ADMIN_PASSWORD: hex(12),
      POSTGRES_PASSWORD: hex(16),
      MEILISEARCH_MASTER_KEY: hex(16),
    },
    fromLaunch: { GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID" },
    blank: [],
  },
  {
    example: "storefront/.env.example",
    out: "storefront/.env.local",
    generate: { WELCOME_DISCOUNT_SECRET: hex(32), SPREE_WEBHOOK_SECRET: hex(32) },
    fromLaunch: {
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "GOOGLE_CLIENT_ID",
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "STRIPE_PUBLISHABLE_KEY",
      RESEND_API_KEY: "RESEND_API_KEY",
    },
    // API keys come from `pnpm setup-store`; the Sentry/Stripe samples are fake.
    blank: ["SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
  },
  {
    example: "scripts/.env.example",
    out: "scripts/.env",
    generate: {},
    fromLaunch: { SHIP_FROM_PROVINCE: "SHIP_FROM_PROVINCE" },
    blank: [],
  },
];

for (const t of targets) {
  const examplePath = resolve(root, t.example);
  const outPath = resolve(root, t.out);
  const existing = parse(read(outPath));
  const created = !existsSync(outPath);
  const changes: string[] = [];

  const lines = readFileSync(examplePath, "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (!m) return line;
      const [, key, sample] = m;
      const current = existing.get(key);
      let value: string;
      const launchKey = t.fromLaunch[key];
      if (launchKey && fromLaunch(launchKey)) {
        value = fromLaunch(launchKey)!;
      } else if (current !== undefined && !isPlaceholder(current)) {
        value = current;
      } else if (t.generate[key]) {
        value = t.generate[key]();
      } else if (t.blank.includes(key)) {
        value = "";
      } else {
        value = current !== undefined && current !== "" ? current : sample;
      }
      if (value !== (current ?? undefined)) changes.push(key);
      return `${key}=${value}`;
    });

  // Keep keys the user (or setup-store) added that the example does not know.
  const known = new Set(parse(readFileSync(examplePath, "utf8")).keys());
  for (const [key, value] of existing) if (!known.has(key)) lines.push(`${key}=${value}`);

  const next = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  if (next !== read(outPath)) writeFileSync(outPath, next, { mode: 0o600 });
  console.log(
    `${t.out}: ${created ? "created" : changes.length ? "updated" : "unchanged"}${changes.length ? ` (${changes.join(", ")})` : ""}`,
  );
}
