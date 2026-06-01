'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTrade } from '@/context/TradeContext';
import { ShieldAlert, Compass, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

export default function ActivePosition() {
  const { activePosition, goldPrice, exchangeRate, closeActivePosition } = useTrade();
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [confirmCooldown, setConfirmCooldown] = useState<number>(0);
  const [durationStr, setDurationStr] = useState<string>('0m');

  // Open duration calculator
  useEffect(() => {
    if (!activePosition || !activePosition.opened_at) return;

    const calculateDuration = () => {
      const openTime = new Date(activePosition.opened_at!).getTime();
      const now = Date.now();
      const diffMs = now - openTime;
      if (diffMs <= 0) {
        setDurationStr('0m');
        return;
      }
      const diffSecs = Math.floor(diffMs / 1000);
      const hours = Math.floor(diffSecs / 3600);
      const minutes = Math.floor((diffSecs % 3600) / 60);

      if (hours > 0) {
        setDurationStr(`${hours}h ${minutes}m`);
      } else {
        setDurationStr(`${minutes}m`);
      }
    };

    calculateDuration();
    const interval = setInterval(calculateDuration, 60000);
    return () => clearInterval(interval);
  }, [activePosition]);

  // Escape key listener for modal
  useEffect(() => {
    if (!showConfirm) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowConfirm(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showConfirm]);

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

  // Visual Target Line Calculator
  const totalRange = Math.abs(tp2_price - sl_price) || 1;
  const currentDistance = Math.abs(currentPrice - sl_price);
  const dotPosition = Math.max(0, Math.min(100, (currentDistance / totalRange) * 100));

  const entryPct = (Math.abs(entry_price - sl_price) / totalRange) * 100;
  const tp1Pct = (Math.abs(tp1_price - sl_price) / totalRange) * 100;

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

  const handleClose = () => {
    setShowConfirm(true);
  };

  const handleConfirmClose = async () => {
    setShowConfirm(false);
    setIsClosing(true);
    setFeedback(null);
    
    // Start 5-second disable cooldown
    setConfirmCooldown(5);
    const cooldownInterval = setInterval(() => {
      setConfirmCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const res = await closeActivePosition('MANUAL_CLOSE');
    setIsClosing(false);

    if (res.success) {
      setFeedback({ type: 'success', message: res.message });
      // Clear toast after 3s
      setTimeout(() => setFeedback(null), 3000);
    } else {
      setFeedback({ type: 'error', message: res.message });
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

      <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
        <div className="flex items-center flex-wrap gap-2">
          {/* Pulsing indicator */}
          <span className="relative flex h-2 w-2 mr-1">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Position</span>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              isLong
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}
          >
            {direction}
          </span>
          
          {/* Trailing Active Badge */}
          {activePosition.trailing_sl_enabled && (
            <span className="rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider animate-pulse">
              🔄 Trailing Active
            </span>
          )}

          {/* Breakeven Active Badge */}
          {activePosition.breakeven_active && (
            <span className="rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider animate-pulse">
              🛡️ Breakeven Active
            </span>
          )}

          {/* Remaining Position Size Badge */}
          {activePosition.tp1_hit && activePosition.partial_close_enabled && (
            <span className="rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              Remaining: {100 - (activePosition.partial_close_pct || 50)}%
            </span>
          )}
        </div>
        <div>{getStatusBadge()}</div>
      </div>

      {/* Main PnL and Statistics Grid */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-6">
        <div>
          <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Unrealized PnL (USDT)</span>
          <span className={`text-xl font-extrabold block mt-0.5 tracking-tight ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfit ? '+' : ''}{pnlUsdt.toFixed(2)}
            <span className="text-xs font-semibold ml-1.5">({isProfit ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Unrealized PnL (THB)</span>
          <span className={`text-xl font-extrabold block mt-0.5 tracking-tight ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isProfit ? '+' : ''}{Math.round(pnlThb).toLocaleString()} THB
          </span>
        </div>

        <div className="col-span-2 sm:col-span-1">
          <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Open Duration</span>
          <span className="text-xl font-extrabold text-slate-200 block mt-0.5 tracking-tight">
            {durationStr}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Entry Price</span>
          <span className="text-sm font-semibold text-slate-300 block mt-0.5">${entry_price.toLocaleString(undefined, { minimumFractionDigits: 1 })}</span>
        </div>

        <div>
          <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Current Price</span>
          <span className={`text-sm font-semibold block mt-0.5 transition-colors duration-300 ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 1 })}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-slate-500 font-bold block uppercase tracking-wider">Position Size</span>
          <span className="text-sm font-semibold text-slate-300 block mt-0.5">${position_size_usdt.toLocaleString()} USDT</span>
        </div>
      </div>

      {/* Visual SL/TP Progress Range Bar */}
      <div className="mt-8">
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold mb-2">
          <span>Target Progress Scale</span>
          <span>Dot Location: {dotPosition.toFixed(0)}%</span>
        </div>
        
        <div className="relative h-2.5 w-full rounded-full bg-slate-900 border border-slate-800 flex overflow-hidden">
          {/* SL Zone (Red) */}
          <div className="h-full bg-rose-600/35 border-r border-rose-500/20" style={{ width: `${entryPct}%` }} />
          {/* TP1 Zone (Yellow) */}
          <div className="h-full bg-yellow-500/25 border-r border-yellow-500/20" style={{ width: `${tp1Pct - entryPct}%` }} />
          {/* TP2 Zone (Green) */}
          <div className="h-full bg-emerald-500/25" style={{ width: `${100 - tp1Pct}%` }} />

          {/* Absolute Current Price Moving Dot */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -ml-1.5 h-4 w-4 rounded-full border-2 bg-white shadow-lg transition-all duration-300 flex items-center justify-center ${
              isProfit ? 'border-emerald-500 shadow-emerald-500/25' : 'border-rose-500 shadow-rose-500/25'
            }`}
            style={{ left: `${dotPosition}%` }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-slate-950 animate-pulse" />
          </div>
        </div>

        {/* Target levels label underneath */}
        <div className="relative mt-2.5 h-8">
          {/* SL Price Label (Left) */}
          <div className="absolute left-0 flex flex-col">
            <span className="text-[9px] font-bold text-slate-500 uppercase">SL</span>
            <span className="text-[10px] font-semibold text-rose-400">${sl_price.toLocaleString()}</span>
          </div>

          {/* Entry Price Label */}
          <div className="absolute flex flex-col items-center -translate-x-1/2" style={{ left: `${entryPct}%` }}>
            <span className="text-[9px] font-bold text-slate-400 uppercase">Entry</span>
            <span className="text-[10px] font-semibold text-slate-300">${entry_price.toLocaleString()}</span>
          </div>

          {/* TP1 Price Label */}
          <div className="absolute flex flex-col items-center -translate-x-1/2" style={{ left: `${tp1Pct}%` }}>
            <span className="text-[9px] font-bold text-yellow-500 uppercase">TP1 {tp1_hit ? '✅' : ''}</span>
            <span className="text-[10px] font-semibold text-yellow-400">${tp1_price.toLocaleString()}</span>
          </div>

          {/* TP2 Price Label (Right) */}
          <div className="absolute right-0 flex flex-col items-end">
            <span className="text-[9px] font-bold text-emerald-500 uppercase">TP2 {tp2_hit ? '✅' : ''}</span>
            <span className="text-[10px] font-semibold text-emerald-400">${tp2_price.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Action triggers */}
      <div className="mt-4 flex flex-col gap-3">
        <button
          onClick={handleClose}
          disabled={isClosing || confirmCooldown > 0}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 font-bold text-white shadow-lg shadow-rose-950/20 transition-all duration-300 hover:bg-rose-500 disabled:opacity-50 cursor-pointer text-xs"
        >
          {isClosing ? (
            <RefreshCw className="h-4 w-4 animate-spin text-white" />
          ) : confirmCooldown > 0 ? (
            `Close Cooldown (${confirmCooldown}s)`
          ) : (
            '⛔ Close Position'
          )}
        </button>
      </div>

      {feedback && (
        <div className={`mt-4 rounded-xl border p-3 text-xs ${
          feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
        }`}>
          {feedback.message}
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-[4px] p-4"
          onClick={() => setShowConfirm(false)}
        >
          <div 
            className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-bold text-slate-100 uppercase tracking-wider mb-4 border-b border-slate-800 pb-2.5 flex items-center gap-2 text-rose-500">
              <AlertTriangle className="h-5 w-5" />
              ⚠️ Confirm Close Position
            </h4>
            
            <div className="space-y-2 text-xs text-slate-300 my-4 bg-slate-900/40 border border-slate-800/40 p-3.5 rounded-xl">
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Direction:</span>
                <span className={`font-extrabold ${isLong ? 'text-emerald-400' : 'text-rose-400'}`}>{direction}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Entry Price:</span>
                <span className="font-semibold text-slate-200">${entry_price.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">Current Price:</span>
                <span className="font-semibold text-slate-200">${currentPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-900">
                <span className="text-slate-500 font-semibold">Unrealized PnL:</span>
                <span className={`font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isProfit ? '+' : ''}{pnlUsdt.toFixed(2)} USDT
                </span>
              </div>
            </div>

            <p className="text-xs text-rose-400/90 font-medium leading-relaxed mb-6">
              This action will immediately close your position and cannot be undone.
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 font-bold text-slate-300 border border-slate-800 transition-colors cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClose}
                className="flex-1 h-9 rounded-xl bg-rose-600 hover:bg-rose-500 font-bold text-white transition-colors cursor-pointer text-xs"
              >
                Confirm Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
