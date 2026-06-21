import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://pcc-api.openfun.app/api";
const UNIT_ID = "3.76.58";
const PAGE_DELAY_MS = 1200; // gap between page requests to avoid 429
const BURST_COOLDOWN_MS = 12000; // pause all when 429 hits

let cooldownUntil = 0; // shared timestamp, workers check before each request

async function fetchJSON(url, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HsinchuTenderBot/1.0; +https://github.com/Aiden128/hsinchu-tender-map)",
          "Accept": "application/json",
          "Referer": "https://pcc-api.openfun.app/",
        },
      });
      if (res.ok) return res.json();

      if (res.status === 429) {
        const cooldown = Math.min(5000 * 2 ** attempt, 30000);
        console.warn(`  429 on attempt ${attempt}/${retries} — cooling down ${cooldown}ms...`);
        cooldownUntil = Date.now() + cooldown + BURST_COOLDOWN_MS;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, cooldown));
          continue;
        }
      } else if (res.status >= 500) {
        if (attempt < retries) {
          const delay = Math.min(2000 * 2 ** attempt, 15000);
          console.warn(`  HTTP ${res.status} on attempt ${attempt}/${retries}, retry in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      throw new Error(`HTTP ${res.status}: ${url}`);
    } catch (e) {
      if (e.message.startsWith("HTTP ")) throw e;
      if (attempt === retries) throw e;
      const delay = Math.min(2000 * 2 ** attempt, 15000);
      console.warn(`  Network error attempt ${attempt}/${retries}: ${e.message}, retry in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function main() {
  const buildDir = join(__dirname, "..", "..", "build");
  const dataDir = join(buildDir, "data");
  mkdirSync(dataDir, { recursive: true });

  console.log("Fetching page 1...");
  const first = await fetchJSON(`${BASE}/listbyunit?unit_id=${UNIT_ID}&page=1`);
  const total = first.total || 0;
  const totalPages = Math.ceil(total / 1000);

  writeFileSync(join(dataDir, "page-1.json"), JSON.stringify(first));
  console.log(`Page 1/${totalPages}: ${first.records?.length || 0} records`);

  const errors = [];

  // Sequential fetch with rate limiting
  for (let page = 2; page <= totalPages; page++) {
    // Global cooldown check — if another page triggered a 429, we all wait
    const now = Date.now();
    if (now < cooldownUntil) {
      const wait = cooldownUntil - now;
      console.log(`  Cooldown ${Math.round(wait / 1000)}s...`);
      await new Promise((r) => setTimeout(r, wait));
    }

    const url = `${BASE}/listbyunit?unit_id=${UNIT_ID}&page=${page}`;
    try {
      const data = await fetchJSON(url);
      writeFileSync(join(dataDir, `page-${page}.json`), JSON.stringify(data));
      console.log(`Page ${page}/${totalPages}: ${data.records?.length || 0} records`);
    } catch (e) {
      errors.push(`Page ${page}: ${e.message}`);
      console.error(`Page ${page}/${totalPages} FAILED: ${e.message}`);
    }

    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  // ── Count actually written pages ──
  const successfulPages = totalPages - errors.length;

  if (successfulPages === 0) {
    console.error(`\n❌ All ${totalPages} pages failed — not deploying.`);
    process.exit(1);
  }

  // ── Write index metadata (only reflect pages that actually succeeded) ──
  writeFileSync(
    join(dataDir, "index.json"),
    JSON.stringify(
      {
        total,
        totalPages: successfulPages,
        unitId: UNIT_ID,
        unitName: "新竹市政府",
        updatedAt: new Date().toISOString(),
        errors: errors.length,
      },
      null,
      2
    )
  );

  // ── Copy index.html ──
  copyFileSync(join(__dirname, "..", "..", "index.html"), join(buildDir, "index.html"));

  if (errors.length > 0) {
    console.error(`\n⚠ ${errors.length} page(s) failed:`);
    errors.forEach((e) => console.error(`  ${e}`));
  }

  console.log(`\n✅ Done: ${total} records across ${successfulPages}/${totalPages} pages (${errors.length} errors)`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
