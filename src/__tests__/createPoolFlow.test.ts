import { describe, it, expect, vi } from 'vitest';
import { submitCreatePool } from '../services/createPool';

// [FIX-POPUP] These tests pin the create-pool submission invariant:
//   1. Grants must be STRICTLY sequential (grant A, then waitForReceipt, then
//      grant B, then waitForReceipt, then create). The 0xio/SDK raises
//      RATE_LIMIT_EXCEEDED for two concurrent interactive requests; before this
//      fix the second grant's popup never appeared and the modal hung forever
//      on "1. Granting allowances".
//   2. The order of operations (grant → receipt → grant → receipt → create) is
//      exactly what submitCreatePool implements.
//   3. Empty pool (no liquidity) skips grants entirely.
//
// Mocks: rpc + wallet. The real walletService is replaced by a mock.

function makeMocks() {
  const calls: string[] = [];
  const wallet = {
    callContract: vi.fn(async (req: { method: string; params: unknown[] }) => {
      const label = `${req.method}(${(req.params as (string | number | bigint)[]).map(p => String(p).slice(0, 12)).join(',')})`;
      calls.push(label);
      return `hash-${req.method}-${calls.length}`;
    }),
  };
  const rpc = {
    waitForReceipt: vi.fn(async (hash: string, max = 120) => {
      void max;
      calls.push(`receipt(${hash})`);
    }),
    call: vi.fn(async <T,>(method: string, _params?: unknown): Promise<T> => {
      void _params;
      calls.push(`call:${method}`);
      return { epoch_id: 100 } as unknown as T;
    }),
    getPoolAddress: vi.fn(async () => 'octPoolAddr'),
  } as unknown as import('../services/octraRpc').OctraRpc;
  return { wallet, rpc, calls };
}

describe('submitCreatePool — grant sequencing invariants', () => {
  it('issues grants sequentially (A → receipt → B → receipt → create → receipt) when liquidity provided', async () => {
    const { wallet, rpc, calls } = makeMocks();
    await submitCreatePool(
      {
        factoryAddr: 'octFactory',
        tokenA: 'octTokenA',
        tokenB: 'octTokenB',
        feeNum: 3, feeDen: 1000, maxRatio: 0,
        liqA: '1000000', liqB: '5000000', minLp: 1, lockDuration: 0,
      },
      { rpc, wallet },
    );
    // Exact order (pinned) — grant A → receipt → grant B → receipt → create → receipt.
    const callsSansEpoch = calls.filter(c => c !== 'call:epoch_current');
    expect(callsSansEpoch.length).toBe(6);
    expect(callsSansEpoch[0]).toBe('grant(octFactory,1000000)');
    expect(callsSansEpoch[1]).toMatch(/^receipt\(hash-grant-\d+\)$/);
    expect(callsSansEpoch[2]).toBe('grant(octFactory,5000000)');
    expect(callsSansEpoch[3]).toMatch(/^receipt\(hash-grant-\d+\)$/);
    expect(callsSansEpoch[4]).toBe('create(octTokenA,octTokenB,3,1000,0,1000000,5000000,1,400,0)');
    expect(callsSansEpoch[5]).toMatch(/^receipt\(hash-create-\d+\)$/);
    // grant A and grant B were BOTH called (the original bug never reached B)
    const grants = calls.filter(c => c.startsWith('grant('));
    expect(grants).toHaveLength(2);
    // Between the two grants, exactly one receipt settles — i.e. no Promise.all.
    const firstGrantIdx = calls.indexOf('grant(octFactory,1000000)');
    const secondGrantIdx = calls.indexOf('grant(octFactory,5000000)');
    const receiptsBetween = calls.slice(firstGrantIdx, secondGrantIdx).filter(c => c.startsWith('receipt('));
    expect(receiptsBetween).toHaveLength(1);
  });

  it('skips grants entirely for empty pool (no liquidity)', async () => {
    const { wallet, rpc, calls } = makeMocks();
    await submitCreatePool(
      {
        factoryAddr: 'octFactory',
        tokenA: 'octTokenA',
        tokenB: 'octTokenB',
        feeNum: 3, feeDen: 1000, maxRatio: 0,
        liqA: null, liqB: null, minLp: 0, lockDuration: 0,
      },
      { rpc, wallet },
    );
    const grants = calls.filter(c => c.startsWith('grant('));
    expect(grants).toHaveLength(0);
    expect(calls.some(c => c.startsWith('create('))).toBe(true);
  });

  it('aborts before grant B if grant A rejects (no silent fallthrough)', async () => {
    const calls: string[] = [];
    const wallet = {
      callContract: vi.fn(async (req: { method: string }) => {
        calls.push(req.method);
        if (req.method === 'grant') throw new Error('user rejected');
        return 'hash';
      }),
    };
    const rpc = {
      waitForReceipt: vi.fn(async () => { calls.push('receipt'); }),
      call: vi.fn(async <T,>(): Promise<T> => ({ epoch_id: 100 } as unknown as T)),
      getPoolAddress: vi.fn(async () => 'octPool'),
    } as unknown as import('../services/octraRpc').OctraRpc;
    await expect(submitCreatePool(
      {
        factoryAddr: 'octFactory', tokenA: 'octTokenA', tokenB: 'octTokenB',
        feeNum: 3, feeDen: 1000, maxRatio: 0,
        liqA: '100', liqB: '200', minLp: 1, lockDuration: 0,
      },
      { rpc, wallet },
    )).rejects.toThrow('user rejected');
    // Exact: one grant attempt, no receipt, no create
    expect(calls).toEqual(['grant']);
  });

  it('emits onStep callbacks in the expected order', async () => {
    const { wallet, rpc } = makeMocks();
    const steps: string[] = [];
    await submitCreatePool(
      {
        factoryAddr: 'octFactory', tokenA: 'octTokenA', tokenB: 'octTokenB',
        feeNum: 3, feeDen: 1000, maxRatio: 0,
        liqA: '100', liqB: '200', minLp: 1, lockDuration: 0,
      },
      { rpc, wallet, onStep: s => steps.push(s) },
    );
    // granting_a fires for the first grant, granting_b for the second, creating
    // before the create() call. Critically, when both grants exist the step for
    // A and the step for B both fire — the form's progress UI must reach B.
    expect(steps).toEqual(['granting_a', 'granting_b', 'creating']);
  });
});
