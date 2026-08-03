import { describe, it, expect, vi } from 'vitest';
import { raceWithTimeout } from '../services/walletService';

describe('raceWithTimeout', () => {
  it('resolves with the promise value when it settles before the timeout', async () => {
    const p = Promise.resolve('ok');
    const result = await raceWithTimeout(p, 10_000, 'to');
    expect(result).toBe('ok');
  });

  it('rejects with the promise rejection when it rejects before the timeout', async () => {
    const p = Promise.reject(new Error('user-rejected'));
    await expect(raceWithTimeout(p, 10_000, 'to')).rejects.toThrow('user-rejected');
  });

  it('rejects with timeout message when the promise never settles', async ({ expect }) => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => { /* never resolves */ });
    const race = raceWithTimeout(never, 60_000, 'popup timeout');
    // Allow promise microtasks to settle, but the timeout remains pending.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(59_999);
    // Still pending at 59_999ms — the racing promise has not rejected yet.
    let settled = false;
    race.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(race).rejects.toThrow('popup timeout');
    vi.useRealTimers();
  });

  it('does not reject after the racing promise already resolved (no late timeout)', async () => {
    vi.useFakeTimers();
    const p = Promise.resolve('fast');
    const race = raceWithTimeout(p, 60_000, 'to');
    await expect(race).resolves.toBe('fast');
    await vi.advanceTimersByTimeAsync(120_000);
    vi.useRealTimers();
  });

  it('does not reject after the racing promise already rejected (no late timeout)', async () => {
    vi.useFakeTimers();
    const p = Promise.reject(new Error('boom'));
    await expect(raceWithTimeout(p, 60_000, 'to')).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(120_000);
    vi.useRealTimers();
  });
});
