// [V7-PASS10] Auto-sync compiled contracts from everestswap-dev
// Prevents drift between the contract source used to compile on-chain bytecode
// and the public-facing contract that the frontend compiles via the RPC.
//
// CRITICAL: Without this, the frontend can deploy pools with old bytecode
// (missing security fixes, different interface).
//
// Run: node scripts/sync-contracts.mjs
//      (also called automatically by `npm run dev` and `npm run build` via prebuild hook)

import { execSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const BACKEND_REPO = process.env.BACKEND_PATH || join(PROJECT_ROOT, '..', 'everestswap-dev');
const BACKEND_CONTRACTS = join(BACKEND_REPO, 'contracts');
const PUBLIC_CONTRACTS = join(PROJECT_ROOT, 'public', 'contracts');

// Contracts that the frontend compiles on-chain (must stay in sync with backend)
const SYNCED_CONTRACTS = ['SwapPool.aml'];

let driftDetected = false;

function syncFile(name) {
  const src = join(BACKEND_CONTRACTS, name);
  const dst = join(PUBLIC_CONTRACTS, name);

  if (!existsSync(src)) {
    console.error(`[sync] ERROR: ${src} not found. Is everestswap-dev at ${BACKEND_REPO}?`);
    process.exit(1);
  }

  const srcContent = readFileSync(src, 'utf-8');
  const dstExists = existsSync(dst);
  const dstContent = dstExists ? readFileSync(dst, 'utf-8') : '';

  if (!dstExists || srcContent !== dstContent) {
    if (process.argv.includes('--check')) {
      console.error(`[sync] DRIFT DETECTED: ${name}`);
      console.error(`  src: ${src}`);
      console.error(`  dst: ${dst}`);
      console.error(`  Run 'node scripts/sync-contracts.mjs' to sync.`);
      driftDetected = true;
    } else {
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, srcContent, 'utf-8');
      console.log(`[sync] Synced: ${name} (${srcContent.length} bytes)`);
    }
  } else {
    console.log(`[sync] OK: ${name}`);
  }
}

function main() {
  console.log(`[sync] Backend: ${BACKEND_REPO}`);
  console.log(`[sync] Public:  ${PUBLIC_CONTRACTS}`);
  console.log(`[sync] Syncing ${SYNCED_CONTRACTS.length} contract(s)...`);

  if (!existsSync(BACKEND_REPO)) {
    console.error(`[sync] Backend repo not found at ${BACKEND_REPO}`);
    console.error(`[sync] Set BACKEND_PATH env var or clone everestswap-dev next to everestswap-frontend`);
    process.exit(1);
  }

  for (const name of SYNCED_CONTRACTS) {
    syncFile(name);
  }

  if (driftDetected) {
    console.error(`[sync] FAIL: contracts out of sync. Run 'node scripts/sync-contracts.mjs' to fix.`);
    process.exit(1);
  }

  console.log('[sync] All contracts in sync.');
}

main();
