'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, FileText } from 'lucide-react';

interface PaperTrade {
  id: string;
  timestamp: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  exit_price: number;
  pnl_usdt: number;
  pnl_thb: number;
  result: 'WIN' | 'LOSS';
  status: 'CLOSED';
}

export default function PaperTradingCard() {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [showModal, setShowModal] = useState(false);

  // Load paper trades from localStorage
  useEffect(() => {
    const loadTrades = () => {
      try {
        const raw = localStorage.getItem('paperTrades');
        if (raw) {
          const parsed: PaperTrade[] = JSON.parse(raw);
          setTrades(parsed);
        }
      } catch (err) {
        console.error('Failed to parse paperTrades from localStorage:', err);
      }
    };

    loadTrades();

    // Listen for storage changes from other tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'paperTrades') {
        loadTrades();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Calculate today's stats in Bangkok timezone (GMT+7)
  const todayStats = useMemo(() => {
    const nowBangkok = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
    );
    const todayStr = `${nowBangkok.getFullYear()}-${String(nowBangkok.getMonth() + 1).padStart(2, '0')}-${String(nowBangkok.getDate()).padStart(2, '0')}`;

    const todayTrades = trades.filter((t) => {
      const tradeDateBangkok = new Date(
        new Date(t.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })
      );
      const tradeStr = `${tradeDateBangkok.getFullYear()}-${String(tradeDateBangkok.getMonth() + 1).padStart(2, '0')}-${String(tradeDateBangkok.getDate()).padStart(2, '0')}`;
      return tradeStr === todayStr;
    });

    const totalPnl = todayTrades.reduce((sum, t) => sum + t.pnl_thb, 0);
    const wins = todayTrades.filter((t) => t.result === 'WIN').length;
    const winRate = todayTrades.length > 0 ? (wins / todayTrades.length) * 100 : 0;

    return {
      count: todayTrades.length,
      pnl: totalPnl,
      winRate,
    };
  }, [trades]);

  return (
    <>
      {/* Compact Paper Trading Card */}
      <div className="rounded-2xl border border-dashed border-orange-800/50 bg-orange-950/10 p-5 transition-all duration-300 hover:border-orange-700/60">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            📋 Paper Trading P&L
          </h4>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <span className="text-xs font-bold text-slate-200 block">
              {todayStats.count}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              Paper Trades Today
            </span>
          </div>

          <div className="text-center">
            <span
              className={`text-xs font-bold block ${
                todayStats.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {todayStats.pnl >= 0 ? '+' : ''}
              {todayStats.pnl.toFixed(2)} ฿
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              Paper PnL Today
            </span>
          </div>

          <div className="text-center">
            <span
              className={`text-xs font-bold block ${
                todayStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {todayStats.winRate.toFixed(1)}%
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              Paper Win Rate
            </span>
          </div>
        </div>

        {/* View History Link */}
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="mt-3 text-[11px] text-orange-400 hover:text-orange-300 font-semibold transition-colors cursor-pointer"
        >
          View Paper History →
        </button>
      </div>

      {/* Paper Trade History Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[80vh] rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-4 w-4" />
                📋 Paper Trade History
              </h4>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            {/* Trade Table */}
            <div className="overflow-auto flex-1">
              {trades.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-xs text-slate-500">
                  No paper trades recorded yet.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="text-left py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Direction
                      </th>
                      <th className="text-right py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Entry
                      </th>
                      <th className="text-right py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Exit
                      </th>
                      <th className="text-right py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        PnL THB
                      </th>
                      <th className="text-center py-2 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades
                      .slice()
                      .sort(
                        (a, b) =>
                          new Date(b.timestamp).getTime() -
                          new Date(a.timestamp).getTime()
                      )
                      .map((trade) => (
                        <tr
                          key={trade.id}
                          className="border-b border-slate-900 hover:bg-slate-900/40 transition-colors"
                        >
                          <td className="py-2 px-3 text-slate-400">
                            {new Date(trade.timestamp).toLocaleString('en-GB', {
                              timeZone: 'Asia/Bangkok',
                              day: '2-digit',
                              month: 'short',
                              year: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                trade.direction === 'LONG'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {trade.direction}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300 font-mono">
                            {trade.entry_price.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-300 font-mono">
                            {trade.exit_price.toFixed(2)}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-bold font-mono ${
                              trade.pnl_thb >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {trade.pnl_thb >= 0 ? '+' : ''}
                            {trade.pnl_thb.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                                trade.result === 'WIN'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {trade.result}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
