// Periodically fetch all Hsinchu City tender data from PCC API
// and save as page-based JSON files for GitHub Pages hosting.

import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://pcc-api.openfun.app/api";
const UNIT_ID = "3.76.58";
const CONCURRENCY = 2; // parallel page fetches (higher causes 429 rate limiting)

async function fetchJSON(url, retries = 3) {
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
      // Retry on 429 (rate limit), 5xx (server error); fail fast on 4xx auth errors
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const delay = Math.min(1000 * 2 ** attempt, 15000);
          console.warn(`  HTTP ${res.status} on attempt ${attempt}/${retries}, retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      throw new Error(`HTTP ${res.status}: ${url}`);
    } catch (e) {
      if (e.message.startsWith("HTTP ")) throw e; // Non-retryable HTTP error
      if (attempt === retries) throw e;
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      console.warn(`  Network error on attempt ${attempt}/${retries}: ${e.message}, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function main() {
  const buildDir = join(__dirname, "..", "..", "build");
  const dataDir = join(buildDir, "data");
  mkdirSync(dataDir, { recursive: true });

  // ── Fetch page 1 to discover total count ──
  console.log("Fetching page 1...");
  const first = await fetchJSON(`${BASE}/listbyunit?unit_id=${UNIT_ID}&page=1`);
  const total = first.total || 0;
  const totalPages = Math.ceil(total / 1000);

  writeFileSync(join(dataDir, "page-1.json"), JSON.stringify(first));
  console.log(`Page 1/${totalPages}: ${first.records?.length || 0} records`);

  // ── Fetch remaining pages with concurrency limit ──
  const pages = [];
  for (let p = 2; p <= totalPages; p++) pages.push(p);

  let idx = 0;
  const errors = [];

  async function worker() {
    while (idx < pages.length) {
      const page = pages[idx++];
      const url = `${BASE}/listbyunit?unit_id=${UNIT_ID}&page=${page}`;
      try {
        const data = await fetchJSON(url);
        writeFileSync(join(dataDir, `page-${page}.json`), JSON.stringify(data));
        console.log(`Page ${page}/${totalPages}: ${data.records?.length || 0} records`);
      } catch (e) {
        errors.push(`Page ${page}: ${e.message}`);
        console.error(`Page ${page}/${totalPages} FAILED: ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

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
