'use client';

import React, { useState, useMemo } from 'react';
import { useTrade, Trade } from '@/context/TradeContext';
import { Download, Search, Check, X } from 'lucide-react';

export default function TradeHistoryLog() {
  const { tradeLogs, resetAllLogs } = useTrade();
  
  // Filters state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT' | 'CLOSED'>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Helper for status badge styling
  const getStatusBadgeClass = (status: Trade['status']) => {
    switch (status) {
      case 'OPEN':
        return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case 'TP1_HIT':
        return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
      case 'TP2_HIT':
        return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case 'SL_HIT':
        return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
      case 'CLOSED':
      default:
        return 'bg-slate-500/10 text-slate-400 border border-slate-500/20';
    }
  };

  // Filter logs
  const filteredLogs = useMemo(() => {
    return tradeLogs.filter((log) => {
      // Direction filter
      if (directionFilter !== 'ALL' && log.direction !== directionFilter) return false;
      
      // Status filter
      if (statusFilter !== 'ALL' && log.status !== statusFilter) return false;

      // Date range filter
      const tradeDate = new Date(log.opened_at || log.timestamp);
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (tradeDate < start) return false;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (tradeDate > end) return false;
      }

      // Search query (matches id, entry, exit, notes, symbol)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesDate = tradeDate.toLocaleString().toLowerCase().includes(query);
        const matchesId = log.id.toLowerCase().includes(query);
        const matchesNotes = log.notes?.toLowerCase().includes(query) || false;
        const matchesSymbol = log.symbol.toLowerCase().includes(query);
        return matchesDate || matchesId || matchesNotes || matchesSymbol;
      }

      return true;
    });
  }, [tradeLogs, directionFilter, statusFilter, startDate, endDate, searchQuery]);

  // Export to CSV helper using Blob for reliable download
  const exportToCSV = () => {
    if (filteredLogs.length === 0) return;

    const headers = [
      'ID',
      'Symbol',
      'Direction',
      'Entry Price (USDT)',
      'Stop Loss (USDT)',
      'TP1 (USDT)',
      'TP1 Hit',
      'TP2 (USDT)',
      'TP2 Hit',
      'Exit Price (USDT)',
      'PnL (USDT)',
      'PnL (THB)',
      'Status',
      'Opened At',
      'Closed At',
      'Notes',
    ];

    const rows = filteredLogs.map((log) => [
      log.id,
      log.symbol || 'PAXGUSDT',
      log.direction,
      log.entry_price,
      log.sl_price,
      log.tp1_price,
      log.tp1_hit ? 'YES' : 'NO',
      log.tp2_price,
      log.tp2_hit ? 'YES' : 'NO',
      log.exit_price || '',
      log.pnl_usdt || '',
      log.pnl_thb || '',
      log.status,
      log.opened_at || log.timestamp || '',
      log.closed_at || '',
      log.notes || '',
    ]);

    const csvString = [headers.join(','), ...rows.map((e) => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `gold_trade_history_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    if (confirm('WARNING: Are you sure you want to delete all trade logs? This action is permanent and cannot be undone.')) {
      resetAllLogs();
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">Trade History Log</h3>
          <p className="text-xs text-slate-500 mt-0.5">Records of executed gold spot trade signals.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* CSV Export Button */}
          <button
            onClick={exportToCSV}
            disabled={filteredLogs.length === 0}
            className="flex h-9 items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-4 text-xs font-semibold text-slate-200 border border-slate-700 disabled:opacity-40 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          
          {/* Delete Logs Button */}
          {tradeLogs.length > 0 && (
            <button
              onClick={handleReset}
              className="flex h-9 items-center gap-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/40 px-4 text-xs font-semibold text-rose-400 border border-rose-900/30 transition-colors"
            >
              Clear Logs
            </button>
          )}
        </div>
      </div>

      {/* Filter and search bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search notes, IDs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 text-xs text-slate-300 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {/* Direction filter */}
        <div className="relative">
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value as any)}
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23cbd5e1%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:0.65rem_auto] bg-[right_0.75rem_center] bg-no-repeat pr-8"
          >
            <option value="ALL">All Directions</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23cbd5e1%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:0.65rem_auto] bg-[right_0.75rem_center] bg-no-repeat pr-8"
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">OPEN</option>
            <option value="TP1_HIT">TP1_HIT</option>
            <option value="TP2_HIT">TP2_HIT</option>
            <option value="SL_HIT">SL_HIT</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>

        {/* Date Start */}
        <div className="relative flex items-center">
          <span className="absolute left-3 text-[9px] font-bold text-slate-500 uppercase pointer-events-none">From</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 pl-11 pr-2 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer"
          />
        </div>

        {/* Date End */}
        <div className="relative flex items-center">
          <span className="absolute left-3 text-[9px] font-bold text-slate-500 uppercase pointer-events-none">To</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-2 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none cursor-pointer"
          />
        </div>
      </div>

      {/* Trade Log Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/20">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-900/60 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
              <th className="p-3.5">Date / Time</th>
              <th className="p-3.5">Symbol</th>
              <th className="p-3.5">Direction</th>
              <th className="p-3.5 text-right">Entry (USDT)</th>
              <th className="p-3.5 text-right">SL (USDT)</th>
              <th className="p-3.5 text-center">TP1 Hit</th>
              <th className="p-3.5 text-center">TP2 Hit</th>
              <th className="p-3.5 text-right">Exit Price</th>
              <th className="p-3.5 text-right">PnL (USDT / THB)</th>
              <th className="p-3.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => {
                const isLong = log.direction === 'LONG';
                const isWin = log.pnl_usdt !== undefined && log.pnl_usdt > 0;
                const isClosed = log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT';
                
                return (
                  <tr key={log.id} className="hover:bg-slate-900/20 transition-colors text-slate-300">
                    <td className="p-3.5 font-medium whitespace-nowrap">
                      {new Date(log.opened_at || log.timestamp).toLocaleString()}
                    </td>
                    <td className="p-3.5 font-mono text-slate-400">
                      {log.symbol || 'PAXGUSDT'}
                    </td>
                    <td className="p-3.5">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider ${
                        isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {log.direction}
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-mono font-semibold">
                      ${log.entry_price.toLocaleString(undefined, { minimumFractionDigits: 1 })}
                    </td>
                    <td className="p-3.5 text-right font-mono text-rose-400/90 font-medium">
                      ${log.sl_price.toLocaleString(undefined, { minimumFractionDigits: 1 })}
                    </td>
                    <td className="p-3.5 text-center">
                      <div className="flex justify-center">
                        {log.tp1_hit ? (
                          <span className="rounded bg-yellow-500/10 p-0.5 text-yellow-400 border border-yellow-500/20">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="rounded bg-slate-900 p-0.5 text-slate-600">
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-center">
                      <div className="flex justify-center">
                        {log.tp2_hit ? (
                          <span className="rounded bg-emerald-500/10 p-0.5 text-emerald-400 border border-emerald-500/20">
                            <Check className="h-3 w-3 stroke-[3]" />
                          </span>
                        ) : (
                          <span className="rounded bg-slate-900 p-0.5 text-slate-600">
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-right font-mono font-medium">
                      {log.exit_price ? `$${log.exit_price.toLocaleString(undefined, { minimumFractionDigits: 1 })}` : '—'}
                    </td>
                    <td className="p-3.5 text-right whitespace-nowrap">
                      {isClosed && log.pnl_usdt !== undefined && log.pnl_thb !== undefined ? (
                        <div className="font-mono">
                          <span className={`font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isWin ? '+' : ''}{log.pnl_usdt.toFixed(2)} USDT
                          </span>
                          <span className="block text-[10px] text-slate-500">
                            {isWin ? '+' : ''}{Math.round(log.pnl_thb).toLocaleString()} THB
                          </span>
                        </div>
                      ) : (
                        <span className="text-cyan-400 font-semibold animate-pulse">Running...</span>
                      )}
                    </td>
                    <td className="p-3.5 text-center">
                      <div className="flex justify-center">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold border uppercase tracking-wider ${getStatusBadgeClass(log.status)}`}>
                          {log.status}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-500">
                  No records found matching filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
