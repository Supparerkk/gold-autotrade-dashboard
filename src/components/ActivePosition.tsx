'use client';

import React, { useState } from 'react';
import { useTrade } from '@/context/TradeContext';
import { ShieldAlert, Compass, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';

export default function ActivePosition() {
  const { activePosition, goldPrice, exchangeRate, closeActivePosition } = useTrade();
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!activePosition) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/20 p-8 text-center backdrop-blur-xl">
        <div className="rounded-full bg-slate-900/80 p-4 text-slate-500 ring-1 ring-slate-800">
          <Compass className="h-8 w-8 animate-pulse text-slate-400" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-slate-200">No Active Position</h3>
        <p className="mt-2 max-w-xs text-sm text-slate-500">
          There are no open orders. Configure settings and use the Control Panel to open a trade.
        </p>
      </div>
    );
  }

  const { direction, entry_price, sl_price, tp1_price, tp2_price, position_size_usdt, status, tp1_hit, tp2_hit, sl_hit } = activePosition;
  const isLong = direction === 'LONG';
  
  // Real-time calculations
  const currentPrice = goldPrice || entry_price;
  const priceDiff = currentPrice - entry_price;
  const priceDiffPct = (priceDiff / entry_price) * 100;
  
  const rawPnL = position_size_usdt * (priceDiff / entry_price);
  const pnlUsdt = isLong ? rawPnL : -rawPnL;
  const pnlThb = pnlUsdt * exchangeRate;
  
  const pnlPct = isLong ? priceDiffPct : -priceDiffPct;
  const isProfit = pnlUsdt >= 0;

  // Progress from entry to TP2
  let progressPct = 0;
  if (isLong) {
    if (currentPrice > entry_price) {
      progressPct = ((currentPrice - entry_price) / (tp2_price - entry_price)) * 100;
    }
  } else {
    if (currentPrice < entry_price) {
      progressPct = ((entry_price - currentPrice) / (entry_price - tp2_price)) * 100;
    }
  }
  progressPct = Math.max(0, Math.min(100, progressPct));

  // Determine status color/text
  const getStatusBadge = () => {
    switch (status) {
      case 'TP1_HIT':
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs font-semibold text-yellow-400 border border-yellow-500/20">TP1 HIT (50% Out)</span>;
      case 'TP2_HIT':
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">TP2 HIT</span>;
      case 'SL_HIT':
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-400 border border-rose-500/20">SL HIT</span>;
      default:
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold text-cyan-400 border border-cyan-500/20">OPEN ACTIVE</span>;
    }
  };

  const handleClose = async () => {
    if (confirm('Are you sure you want to close this position at market price?')) {
      setIsClosing(true);
      setFeedback(null);
      const res = await closeActivePosition();
      setIsClosing(false);
      if (res.success) {
        setFeedback({ type: 'success', message: res.message });
      } else {
        setFeedback({ type: 'error', message: res.message });
      }
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      {/* Background highlight */}
      <div
        className={`absolute -left-10 -bottom-10 h-32 w-32 rounded-full blur-[70px] transition-all duration-1000 ${
          isProfit ? 'bg-emerald-500/5' : 'bg-rose-500/5'
        }`}
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={`rounded-lg px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              isLong
                ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-gradient-to-r from-rose-500/20 to-pink-500/20 text-rose-400 border border-rose-500/30'
            }`}
          >
            {direction}
          </span>
          <span className="text-sm font-medium text-slate-300">PAXGUSDT</span>
        </div>
        <div>{getStatusBadge()}</div>
      </div>

      {/* Main PnL Stats */}
      <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Current Unrealized PnL</span>
          <div className="mt-1 flex items-baseline gap-2">
            <h3
              className={`text-4xl font-extrabold tracking-tight ${
                isProfit ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isProfit ? '+' : ''}
              {pnlUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
            </h3>
            <span className={`text-sm font-semibold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              ({isProfit ? '+' : ''}{pnlPct.toFixed(2)}%)
            </span>
          </div>
          <p className={`mt-0.5 text-sm font-medium ${isProfit ? 'text-emerald-500/90' : 'text-rose-500/90'}`}>
            ≈ {isProfit ? '+' : ''}
            {pnlThb.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} THB
          </p>
        </div>

        <button
          onClick={handleClose}
          disabled={isClosing}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-6 font-semibold text-white shadow-lg transition-all duration-300 hover:from-rose-500 hover:to-pink-500 hover:shadow-rose-950/20 active:scale-95 disabled:opacity-50"
        >
          {isClosing ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Close Position'}
        </button>
      </div>

      {/* Execution details */}
      <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-slate-900/50 p-4 border border-slate-800/50">
        <div>
          <span className="text-xs text-slate-500 block">Entry Price</span>
          <span className="text-sm font-semibold text-slate-200">${entry_price.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-xs text-slate-500 block">Position Size</span>
          <span className="text-sm font-semibold text-slate-200">${position_size_usdt.toLocaleString()} USDT</span>
        </div>
      </div>

      {/* Progress bar to TP2 */}
      <div className="mt-6">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span>Target Progress</span>
          <span>{progressPct.toFixed(0)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              isProfit ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : 'bg-gradient-to-r from-slate-600 to-slate-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Targets scale */}
      <div className="mt-8 relative">
        <div className="absolute top-1/2 left-0 w-full h-[2px] bg-slate-800 -translate-y-1/2" />
        
        <div className="relative flex justify-between items-center">
          {/* SL level */}
          <div className="flex flex-col items-center">
            <div className={`z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-slate-950 ${sl_hit ? 'border-rose-500 text-rose-500' : 'border-slate-800 text-slate-500'}`}>
              <ShieldAlert className="h-3.5 w-3.5" />
            </div>
            <span className="mt-2 text-[10px] font-semibold text-slate-500">SL</span>
            <span className="text-[10px] font-bold text-rose-400/90">${sl_price.toLocaleString()}</span>
          </div>

          {/* Entry level */}
          <div className="flex flex-col items-center">
            <div className="z-10 flex h-7 w-7 items-center justify-center rounded-full border border-cyan-500/40 bg-slate-950 text-cyan-400 shadow-md shadow-cyan-950/20">
              <span className="text-[10px] font-bold">E</span>
            </div>
            <span className="mt-2 text-[10px] font-semibold text-slate-400">Entry</span>
            <span className="text-[10px] font-bold text-slate-300">${entry_price.toLocaleString()}</span>
          </div>

          {/* Current Price */}
          <div className="flex flex-col items-center">
            <div className={`z-10 flex h-7 w-7 items-center justify-center rounded-full border ${isProfit ? 'border-emerald-500 text-emerald-400 shadow-emerald-950/20' : 'border-rose-500 text-rose-400 shadow-rose-950/20'} bg-slate-950 shadow-md`}>
              <span className="text-[9px] font-bold">NOW</span>
            </div>
            <span className="mt-2 text-[10px] font-semibold text-slate-400">Live</span>
            <span className={`text-[10px] font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 1 })}
            </span>
          </div>

          {/* TP1 level */}
          <div className="flex flex-col items-center">
            <div className={`z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-slate-950 ${tp1_hit ? 'border-yellow-500 text-yellow-500 shadow-md shadow-yellow-950/20' : 'border-slate-800 text-slate-500'}`}>
              {tp1_hit ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            </div>
            <span className="mt-2 text-[10px] font-semibold text-slate-500">TP1 (50%)</span>
            <span className="text-[10px] font-bold text-yellow-400/90">${tp1_price.toLocaleString()}</span>
          </div>

          {/* TP2 level */}
          <div className="flex flex-col items-center">
            <div className={`z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-slate-950 ${tp2_hit ? 'border-emerald-500 text-emerald-500 shadow-md shadow-emerald-950/20' : 'border-slate-800 text-slate-500'}`}>
              {tp2_hit ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </div>
            <span className="mt-2 text-[10px] font-semibold text-slate-500">TP2 (100%)</span>
            <span className="text-[10px] font-bold text-emerald-400/90">${tp2_price.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {feedback && (
        <div className={`mt-4 rounded-xl border p-3.5 text-sm ${
          feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
        }`}>
          {feedback.message}
        </div>
      )}
    </div>
  );
}
