// [V7-PASS10] Auto-sync compiled contracts from everestswap-dev
// Prevents drift between the contract source used to compile on-chain bytecode
// and the public-facing contract that the frontend compiles via the RPC.
//
// CRITICAL: Without this, the frontend can deploy pools with old bytecode
// (missing security fixes, different interface).
//
// Run: node scripts/sync-contracts.mjs
//      (also called automatically by `npm run dev` and `npm run build` via prebuild hook)
//
// Flags:
//   --check   Only verify sync, don't write. Exits 1 on drift, 0 on OK.
//   --quiet   Suppress OK messages (use --check --quiet for CI).
//
// Failure modes (graceful):
//   - Backend repo missing: WARN, exit 0 (frontend build still works)
//   - Source file missing: ERROR, exit 1 (config issue)
//   - Drift detected (--check mode): ERROR, exit 1 (contract out of sync)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const BACKEND_REPO = process.env.EVERESTSWAP_BACKEND_PATH || join(PROJECT_ROOT, '..', 'everestswap-dev');
const BACKEND_CONTRACTS = join(BACKEND_REPO, 'contracts');
const PUBLIC_CONTRACTS = join(PROJECT_ROOT, 'public', 'contracts');

// Contracts that the frontend compiles on-chain (must stay in sync with backend)
const SYNCED_CONTRACTS = ['SwapPool.aml'];

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const QUIET = args.has('--quiet');

let driftDetected = false;

function log(msg) {
  if (!QUIET) console.log(msg);
}

function warn(msg) {
  console.warn(`\u001b[33m${msg}\u001b[0m`);
}

function err(msg) {
  console.error(`\u001b[31m${msg}\u001b[0m`);
}

function syncFile(name) {
  const src = join(BACKEND_CONTRACTS, name);
  const dst = join(PUBLIC_CONTRACTS, name);

  if (!existsSync(src)) {
    err(`[sync] ERROR: ${src} not found. Is everestswap-dev at ${BACKEND_REPO}?`);
    process.exit(1);
  }

  const srcContent = readFileSync(src, 'utf-8');
  const dstExists = existsSync(dst);
  const dstContent = dstExists ? readFileSync(dst, 'utf-8') : '';

  if (!dstExists || srcContent !== dstContent) {
    if (CHECK_ONLY) {
      err(`[sync] DRIFT DETECTED: ${name}`);
      err(`  src: ${src}`);
      err(`  dst: ${dst}`);
      err(`  Run 'node scripts/sync-contracts.mjs' to sync.`);
      driftDetected = true;
    } else {
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, srcContent, 'utf-8');
      log(`[sync] Synced: ${name} (${srcContent.length} bytes)`);
    }
  } else {
    log(`[sync] OK: ${name}`);
  }
}

function main() {
  log(`[sync] Backend: ${BACKEND_REPO}`);
  log(`[sync] Public:  ${PUBLIC_CONTRACTS}`);
  log(`[sync] Mode:    ${CHECK_ONLY ? 'check-only' : 'sync'}`);
  log(`[sync] Syncing ${SYNCED_CONTRACTS.length} contract(s)...`);

  if (!existsSync(BACKEND_REPO)) {
    // [V7-PASS10] Graceful degradation: if backend is missing, warn and exit 0.
    // This allows `npm run build` to succeed in environments without the backend
    // repo (e.g., CI pipelines, frontend-only dev setups, renamed backend dir).
    warn(`[sync] WARNING: backend repo not found at ${BACKEND_REPO}`);
    warn(`[sync] Skipping contract sync check.`);
    warn(`[sync] Set EVERESTSWAP_BACKEND_PATH env var or clone everestswap-dev next to everestswap-frontend.`);
    process.exit(0);
  }

  for (const name of SYNCED_CONTRACTS) {
    syncFile(name);
  }

  if (driftDetected) {
    err(`[sync] FAIL: contracts out of sync. Run 'node scripts/sync-contracts.mjs' to fix.`);
    process.exit(1);
  }

  log('[sync] All contracts in sync.');
}

main();
