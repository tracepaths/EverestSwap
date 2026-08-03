import type { OctraRpc } from './octraRpc';

// Minimal wallet surface needed by submitCreatePool. Keeping it minimal (not the
// full WalletService class) lets tests pass a small mock without simulating every
// private field of the singleton.
export interface CreatePoolWallet {
  callContract(params: {
    contract: string;
    method: string;
    params: unknown[];
    amount?: string | number;
    ou?: string | number;
    rpc?: OctraRpc;
  }): Promise<string>;
}

// [FIX-POPUP] Pure, React-free implementation of the create-pool submission
// sequence (grant A → waitForReceipt → grant B → waitForReceipt →
// factory.create() → waitForReceipt). Extracted so it can be unit-tested with
// mocked dependencies without rendering the React component (which would
// require @testing-library/react + happy-dom, neither is installed).
//
// INVARIANT: grants are SEQUENTIAL, never Promise.all. The 0xio/SDK's
// ExtensionCommunicator serializes interactive methods and the second concurrent
// grant raises RATE_LIMIT_EXCEEDED (or worse: silently queues a popup the user
// never sees). This function MUST keep the two grants strictly serialized.

export interface CreatePoolArgs {
  factoryAddr: string;
  tokenA: string;
  tokenB: string;
  feeNum: number;
  feeDen: number;
  maxRatio: number;
  liqA: string | null;
  liqB: string | null;
  minLp: number;
  lockDuration: number;
}

export interface CreatePoolDeps {
  rpc: OctraRpc;
  // Defaulted to the real walletService for production use; tests pass a mock.
  wallet?: CreatePoolWallet;
  // Optional progress hook used by the form to update its step UI.
  onStep?: (step: 'granting_a' | 'granting_b' | 'creating') => void;
}

export async function submitCreatePool(
  args: CreatePoolArgs,
  deps: CreatePoolDeps,
): Promise<{ createHash: string; poolAddress?: string }> {
  const wallet = deps.wallet ?? (await import('./walletService')).walletService as CreatePoolWallet;
  const rpc = deps.rpc;
  const hasLiq = !!(args.liqA && args.liqB && BigInt(args.liqA) > 0n && BigInt(args.liqB) > 0n);

  if (hasLiq && BigInt(args.liqA!) > 0n) {
    deps.onStep?.('granting_a');
    const grantAHash = await wallet.callContract({
      contract: args.tokenA, method: 'grant', params: [args.factoryAddr, args.liqA!], rpc,
    });
    await rpc.waitForReceipt(grantAHash, 120);
  }
  if (hasLiq && BigInt(args.liqB!) > 0n) {
    deps.onStep?.('granting_b');
    const grantBHash = await wallet.callContract({
      contract: args.tokenB, method: 'grant', params: [args.factoryAddr, args.liqB!], rpc,
    });
    await rpc.waitForReceipt(grantBHash, 120);
  }

  deps.onStep?.('creating');
  const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
  const currentEpoch = epochInfo.epoch_id || 0;
  const deadline = currentEpoch + 300;

  const createHash = await wallet.callContract({
    contract: args.factoryAddr,
    method: 'create',
    params: [
      args.tokenA, args.tokenB, args.feeNum, args.feeDen, args.maxRatio,
      args.liqA || '0', args.liqB || '0', args.minLp, deadline, args.lockDuration,
    ],
    // [V12] create() spawns a SwapPool contract and seeds liquidity — measured
    // at ~27k effort on devnet, far above a plain call. The node charges the
    // base call fee regardless, but sending a deploy-sized ou keeps headroom if
    // a node ever enforces the ou ceiling for spawning calls.
    ou: '400000',
    rpc,
  });
  await rpc.waitForReceipt(createHash, 120);

  let poolAddress: string | undefined;
  try {
    poolAddress = await rpc.getPoolAddress(args.factoryAddr, args.tokenA, args.tokenB) || undefined;
  } catch { /* best-effort */ }
  return { createHash, poolAddress };
}
