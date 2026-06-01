'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useTrade, Trade } from '@/context/TradeContext';
import { Download, Search, Check, X, Info, FileText } from 'lucide-react';

export default function TradeHistoryLog() {
  const { tradeLogs, resetAllLogs, updateTradeNotes } = useTrade();

  // Filters state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT' | 'CLOSED'>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Selected trade detail modal state
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [notesText, setNotesText] = useState<string>('');

  // Sync notes text when trade is selected
  useEffect(() => {
    if (selectedTrade) {
      setNotesText(selectedTrade.notes || '');
    }
  }, [selectedTrade]);

  // Escape key listener for modal
  useEffect(() => {
    if (!selectedTrade) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTrade(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTrade]);

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
      if (directionFilter !== 'ALL' && log.direction !== directionFilter) return false;
      if (statusFilter !== 'ALL' && log.status !== statusFilter) return false;

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

  // Export to CSV helper
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

  const handleSaveNotes = async () => {
    if (!selectedTrade) return;
    await updateTradeNotes(selectedTrade.id, notesText);
    setSelectedTrade((prev) => (prev ? { ...prev, notes: notesText } : null));
    alert('Notes saved successfully!');
  };

  const getDuration = (log: Trade) => {
    const openTime = new Date(log.opened_at || log.timestamp).getTime();
    const closeTime = log.closed_at ? new Date(log.closed_at).getTime() : Date.now();
    const diffMs = closeTime - openTime;
    if (diffMs <= 0) return '0m';
    const diffSecs = Math.floor(diffMs / 1000);
    const hours = Math.floor(diffSecs / 3600);
    const minutes = Math.floor((diffSecs % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-200">Trade History Log</h3>
          <p className="text-xs text-slate-500 mt-0.5">Records of executed gold spot trade signals. Click a row to view full details.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* CSV Export Button */}
          <button
            onClick={exportToCSV}
            disabled={filteredLogs.length === 0}
            className="flex h-9 items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 px-4 text-xs font-semibold text-slate-200 border border-slate-700 disabled:opacity-40 transition-colors text-xs cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>

          {/* Delete Logs Button */}
          {tradeLogs.length > 0 && (
            <button
              onClick={handleReset}
              className="flex h-9 items-center gap-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/40 px-4 text-xs font-semibold text-rose-400 border border-rose-900/30 transition-colors text-xs cursor-pointer"
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
                  <tr
                    key={log.id}
                    onClick={() => setSelectedTrade(log)}
                    className="hover:bg-slate-900/40 transition-colors text-slate-300 cursor-pointer"
                  >
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

      {/* FEATURE 5 - Trade Detail Modal */}
      {selectedTrade && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-[4px] p-4"
          onClick={() => setSelectedTrade(null)}
        >
          <div 
            className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl animate-in slide-in-from-bottom duration-300 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Close Button (X) */}
            <button 
              onClick={() => setSelectedTrade(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <h4 className="text-md font-bold text-slate-100 uppercase tracking-wider mb-6 border-b border-slate-800 pb-3 flex items-center gap-2">
              <Info className="h-5 w-5 text-cyan-400" />
              Trade Detail — #{selectedTrade.id.slice(0, 8)}...
            </h4>

            {/* Two-Column Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs leading-relaxed text-slate-300">
              
              {/* Left Column: Trade Info */}
              <div className="space-y-3 bg-slate-900/20 border border-slate-800/60 p-4 rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block border-b border-slate-900 pb-1 mb-2">Trade Details</span>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Symbol:</span>
                  <span className="font-semibold text-slate-200">{selectedTrade.symbol || 'PAXGUSDT'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Direction:</span>
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${selectedTrade.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>{selectedTrade.direction}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Status:</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${getStatusBadgeClass(selectedTrade.status)}`}>{selectedTrade.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Open Time:</span>
                  <span className="text-slate-200 font-medium">{new Date(selectedTrade.opened_at || selectedTrade.timestamp).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Close Time:</span>
                  <span className="text-slate-200 font-medium">{selectedTrade.closed_at ? new Date(selectedTrade.closed_at).toLocaleString() : 'Running...'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Trade Duration:</span>
                  <span className="text-slate-200 font-bold">{getDuration(selectedTrade)}</span>
                </div>
              </div>

              {/* Right Column: Price Info */}
              <div className="space-y-3 bg-slate-900/20 border border-slate-800/60 p-4 rounded-xl">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block border-b border-slate-900 pb-1 mb-2">Price parameters</span>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Entry Price:</span>
                  <span className="font-mono text-slate-200 font-bold">${selectedTrade.entry_price.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Exit Price:</span>
                  <span className="font-mono text-slate-200 font-bold">{selectedTrade.exit_price ? `$${selectedTrade.exit_price.toLocaleString()}` : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Stop Loss Target:</span>
                  <span className="font-mono text-rose-400 font-bold">${selectedTrade.sl_price.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Take Profit 1 Hit:</span>
                  <span className={`font-bold flex items-center gap-1 ${selectedTrade.tp1_hit ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {selectedTrade.tp1_hit ? '✅ TP1 HIT' : '❌ NOT HIT'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Take Profit 2 Hit:</span>
                  <span className={`font-bold flex items-center gap-1 ${selectedTrade.tp2_hit ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {selectedTrade.tp2_hit ? '✅ TP2 HIT' : '❌ NOT HIT'}
                  </span>
                </div>
              </div>
            </div>

            {/* PnL and metrics summary block */}
            <div className="mt-4 bg-slate-900/30 border border-slate-800 p-4 rounded-xl grid grid-cols-3 gap-4 text-center">
              <div>
                <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider">PnL (USDT)</span>
                <span className={`text-base font-extrabold block mt-0.5 tracking-tight ${selectedTrade.pnl_usdt !== undefined && selectedTrade.pnl_usdt > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedTrade.pnl_usdt !== undefined ? `${selectedTrade.pnl_usdt > 0 ? '+' : ''}${selectedTrade.pnl_usdt.toFixed(2)}` : '—'}
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider">PnL (THB)</span>
                <span className={`text-base font-extrabold block mt-0.5 tracking-tight ${selectedTrade.pnl_thb !== undefined && selectedTrade.pnl_thb > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedTrade.pnl_thb !== undefined ? `${selectedTrade.pnl_thb > 0 ? '+' : ''}${Math.round(selectedTrade.pnl_thb).toLocaleString()} THB` : '—'}
                </span>
              </div>
              <div>
                <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider">Return Pct</span>
                <span className={`text-base font-extrabold block mt-0.5 tracking-tight ${selectedTrade.pnl_usdt !== undefined && selectedTrade.pnl_usdt > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedTrade.pnl_usdt !== undefined ? `${selectedTrade.pnl_usdt > 0 ? '+' : ''}${((selectedTrade.pnl_usdt / selectedTrade.position_size_usdt) * 100).toFixed(2)}%` : '—'}
                </span>
              </div>
            </div>

            {/* Notes field */}
            <div className="mt-6 space-y-2">
              <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-slate-500" />
                Notes & Comments
              </label>
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Write trade recap notes, notes are saved to local history..."
                rows={3}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            {/* Bottom buttons */}
            <div className="flex gap-3 mt-6 border-t border-slate-900 pt-4">
              <button
                type="button"
                onClick={() => setSelectedTrade(null)}
                className="flex-1 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 font-bold text-slate-300 border border-slate-800 transition-colors cursor-pointer text-xs"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleSaveNotes}
                className="flex-1 h-9 rounded-xl bg-cyan-500 hover:bg-cyan-400 font-bold text-slate-950 transition-colors cursor-pointer text-xs"
              >
                Save Notes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
