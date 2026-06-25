import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { CONTRACTS } from '../types';
import { formatUnits } from '../services/swapService';
import { getTxHistory, type TxRecord } from '../services/txHistory';

interface DashboardStats {
  octBalance: string;
  woctBalance: string;
  oesBalance: string;
  lpBalance: string;
}

function StatCard({ title, value, change, loading }: {
  title: string; value: string; change?: string; loading?: boolean;
}) {
  return (
    <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl p-5 border border-[var(--app-border)]">
      <div className="text-xs text-[var(--app-muted)] mb-1">{title}</div>
      {loading ? (
        <div className="h-7 w-24 bg-[var(--app-panel-soft)] rounded animate-pulse" />
      ) : (
        <>
          <div className="text-xl font-bold">{value}</div>
          {change !== undefined && (
            <div className={`text-xs mt-1 ${Number(change) >= 0 ? 'text-green-400' : 'text-[var(--app-danger)]'}`}>
              {Number(change) >= 0 ? '+' : ''}{change}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TYPE_STYLES: Record<string, { label: string; color: string }> = {
  swap: { label: 'Swap', color: 'text-[var(--app-blue-3)]' },
  add_liquidity: { label: 'Add LP', color: 'text-green-400' },
  remove_liquidity: { label: 'Remove LP', color: 'text-[var(--app-warning)]' },
};

function RecentTxTable({ wallet }: { wallet: string }) {
  const [txs, setTxs] = useState<TxRecord[]>([]);

  useEffect(() => {
    setTxs(getTxHistory());
  }, [wallet]);

  if (txs.length === 0) {
    return (
      <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl p-5 border border-[var(--app-border)]">
        <h3 className="text-base font-semibold mb-4">Recent Transactions</h3>
        <div className="text-center py-8 text-sm text-[var(--app-muted)]">
          No recent transactions
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl p-5 border border-[var(--app-border)]">
      <h3 className="text-base font-semibold mb-4">Recent Transactions</h3>
      <div className="space-y-2">
        {txs.map(tx => {
          const style = TYPE_STYLES[tx.type] ?? { label: tx.type, color: 'text-[var(--app-muted)]' };
          return (
            <div key={tx.hash + tx.timestamp} className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--app-panel-soft)]">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-xs font-semibold ${style.color} whitespace-nowrap`}>{style.label}</span>
                <span className="text-sm text-[var(--app-text)] truncate">{tx.summary}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-[var(--app-muted)] whitespace-nowrap">
                  {new Date(tx.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                {tx.hash && (
                  <a
                    href={`https://devnet.octrascan.io/tx/${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--app-blue-3)] hover:underline"
                  >
                    ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardPage() {
  const { isConnected, walletAddress, rpc } = useApp();

  const [stats, setStats] = useState<DashboardStats>({
    octBalance: '0',
    woctBalance: '0',
    oesBalance: '0',
    lpBalance: '0',
  });
  const [statsLoading, setStatsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!isConnected || !walletAddress) {
      setStats({ octBalance: '0', woctBalance: '0', oesBalance: '0', lpBalance: '0' });
      return;
    }
    setStatsLoading(true);
    try {
      const [balResult, woctResult, oesResult, lpResult] = await Promise.allSettled([
        rpc.getBalance(walletAddress),
        rpc.contractView<{ result: string }>(CONTRACTS.woct, 'balance_of', [walletAddress], walletAddress),
        rpc.contractView<{ result: string }>(CONTRACTS.oes, 'balance_of', [walletAddress], walletAddress),
        rpc.contractView<{ result: string }>(CONTRACTS.pool, 'get_lp_balance', [walletAddress], walletAddress),
      ]);

      const octBal = balResult.status === 'fulfilled' ? balResult.value.balance_raw || balResult.value.balance || '0' : '0';
      const woctBal = woctResult.status === 'fulfilled' ? woctResult.value?.result || '0' : '0';
      const oesBal = oesResult.status === 'fulfilled' ? oesResult.value?.result || '0' : '0';
      const lpBal = lpResult.status === 'fulfilled' ? lpResult.value?.result || '0' : '0';

      setStats({
        octBalance: octBal,
        woctBalance: woctBal,
        oesBalance: oesBal,
        lpBalance: lpBal,
      });
    } catch {
      setStats({ octBalance: '0', woctBalance: '0', oesBalance: '0', lpBalance: '0' });
    } finally {
      setStatsLoading(false);
    }
  }, [isConnected, walletAddress, rpc]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const displayOCT = formatUnits(stats.octBalance, 6);
  const displayWOCT = formatUnits(stats.woctBalance, 6);
  const displayOES = formatUnits(stats.oesBalance, 6);
  const displayLP = formatUnits(stats.lpBalance, 12);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <button
          onClick={fetchStats}
          disabled={statsLoading}
          className="text-xs px-3 py-1.5 rounded-lg bg-[var(--app-panel-soft)] hover:bg-[var(--app-hover)] text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors disabled:opacity-50"
        >
          {statsLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="OCT Balance" value={isConnected ? displayOCT : '-'} loading={statsLoading} />
        <StatCard title="WOCT Balance" value={isConnected ? displayWOCT : '-'} loading={statsLoading} />
        <StatCard title="OES Balance" value={isConnected ? displayOES : '-'} loading={statsLoading} />
        <StatCard title="LP Positions" value={isConnected ? displayLP : '-'} loading={statsLoading} />
      </div>

      <RecentTxTable wallet={walletAddress || ''} />
    </div>
  );
}

export default DashboardPage;
