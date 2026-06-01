'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useTrade } from '@/context/TradeContext';
import { Play, Calculator, AlertCircle } from 'lucide-react';

export default function TradingControlPanel() {
  const { goldPrice, exchangeRate, executeTrade, activePosition, settings } = useTrade();

  const CAPITAL_THB = 10000;

  // Form state
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [positionSizePct, setPositionSizePct] = useState<number>(50); // default 50%
  const [slType, setSlType] = useState<'pct' | 'price'>('pct');
  const [slValue, setSlValue] = useState<string>('2'); // default 2%
  const [tp1Pct, setTp1Pct] = useState<string>('4'); // default 4% (2:1 R:R from 2% SL)
  const [tp2Pct, setTp2Pct] = useState<string>('8'); // default 8% (4:1 R:R)

  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [cooldown, setCooldown] = useState<boolean>(false);
  const [riskOverride, setRiskOverride] = useState<boolean>(false);

  // Sync entry price to live price if not touched
  useEffect(() => {
    if (goldPrice > 0 && !entryPrice) {
      setEntryPrice(Math.round(goldPrice).toString());
    }
  }, [goldPrice, entryPrice]);

  const useLivePrice = () => {
    if (goldPrice > 0) {
      setEntryPrice(Math.round(goldPrice).toString());
    }
  };

  // Convert capital to USDT equivalent
  const capitalUsdt = useMemo(() => {
    return CAPITAL_THB / exchangeRate;
  }, [exchangeRate]);

  // Position Size in USDT
  const positionSizeUsdt = useMemo(() => {
    return (capitalUsdt * positionSizePct) / 100;
  }, [capitalUsdt, positionSizePct]);

  // Convert string inputs safely
  const numericEntry = parseFloat(entryPrice) || 0;
  const numericSlVal = parseFloat(slValue) || 0;
  const numericTp1 = parseFloat(tp1Pct) || 0;
  const numericTp2 = parseFloat(tp2Pct) || 0;

  // Reset override if parameters change
  useEffect(() => {
    setRiskOverride(false);
  }, [direction, entryPrice, slValue, slType, positionSizePct]);

  // Calculate SL/TP target prices
  const slPrice = useMemo(() => {
    if (numericEntry <= 0 || numericSlVal <= 0) return 0;
    if (slType === 'price') return numericSlVal;

    // Percentage basis
    const multiplier = numericSlVal / 100;
    if (direction === 'LONG') {
      return numericEntry * (1 - multiplier);
    } else {
      return numericEntry * (1 + multiplier);
    }
  }, [direction, numericEntry, slType, numericSlVal]);

  const tp1Price = useMemo(() => {
    if (numericEntry <= 0 || numericTp1 <= 0) return 0;
    const multiplier = numericTp1 / 100;
    if (direction === 'LONG') {
      return numericEntry * (1 + multiplier);
    } else {
      return numericEntry * (1 - multiplier);
    }
  }, [direction, numericEntry, numericTp1]);

  const tp2Price = useMemo(() => {
    if (numericEntry <= 0 || numericTp2 <= 0) return 0;
    const multiplier = numericTp2 / 100;
    if (direction === 'LONG') {
      return numericEntry * (1 + multiplier);
    } else {
      return numericEntry * (1 - multiplier);
    }
  }, [direction, numericEntry, numericTp2]);

  // Calculate risk percent
  const riskPercent = useMemo(() => {
    if (numericEntry <= 0 || slPrice <= 0) return 0;
    return (Math.abs(numericEntry - slPrice) / numericEntry) * 100;
  }, [numericEntry, slPrice]);

  const isRiskExceeded = riskPercent > settings.maxRiskPercent;

  // Visual Calculator Metrics (Projections)
  const calculations = useMemo(() => {
    if (numericEntry <= 0 || slPrice <= 0 || tp1Price <= 0 || tp2Price <= 0) {
      return { slLossUsdt: 0, slLossThb: 0, tp1ProfitUsdt: 0, tp1ProfitThb: 0, tp2ProfitUsdt: 0, tp2ProfitThb: 0, totalProfitUsdt: 0, totalProfitThb: 0 };
    }

    const isLong = direction === 'LONG';

    // Stop Loss calculation (full position exit)
    const slDiff = Math.abs(slPrice - numericEntry) / numericEntry;
    const slLossUsdt = positionSizeUsdt * slDiff;
    const slLossThb = slLossUsdt * exchangeRate;

    // TP1 calculation (50% partial exit)
    const tp1Diff = Math.abs(tp1Price - numericEntry) / numericEntry;
    const tp1ProfitUsdt = (positionSizeUsdt * 0.5) * tp1Diff;
    const tp1ProfitThb = tp1ProfitUsdt * exchangeRate;

    // TP2 calculation (remaining 50% exit)
    const tp2Diff = Math.abs(tp2Price - numericEntry) / numericEntry;
    const tp2ProfitUsdt = (positionSizeUsdt * 0.5) * tp2Diff;
    const tp2ProfitThb = tp2ProfitUsdt * exchangeRate;

    const totalProfitUsdt = tp1ProfitUsdt + tp2ProfitUsdt;
    const totalProfitThb = totalProfitUsdt * exchangeRate;

    return {
      slLossUsdt,
      slLossThb,
      tp1ProfitUsdt,
      tp1ProfitThb,
      tp2ProfitUsdt,
      tp2ProfitThb,
      totalProfitUsdt,
      totalProfitThb,
    };
  }, [direction, numericEntry, slPrice, tp1Price, tp2Price, positionSizeUsdt, exchangeRate]);

  // Risk to reward ratios
  const riskRewardTp1 = useMemo(() => {
    if (calculations.slLossUsdt === 0) return 0;
    return calculations.tp1ProfitUsdt / calculations.slLossUsdt;
  }, [calculations]);

  const riskRewardTp2 = useMemo(() => {
    if (calculations.slLossUsdt === 0) return 0;
    return calculations.totalProfitUsdt / calculations.slLossUsdt;
  }, [calculations]);

  const handleConfirmTrade = async () => {
    setShowConfirm(false);
    setIsExecuting(true);
    setFeedback(null);

    const res = await executeTrade({
      direction,
      entry_price: numericEntry,
      sl_price: slPrice,
      tp1_price: tp1Price,
      tp2_price: tp2Price,
      position_size_usdt: positionSizeUsdt,
      capital_thb: CAPITAL_THB,
    });

    setIsExecuting(false);

    // 3-second button cooldown guard
    setCooldown(true);
    setTimeout(() => setCooldown(false), 3000);

    if (res.success) {
      setFeedback({ type: 'success', message: res.message });
    } else {
      setFeedback({ type: 'error', message: res.message });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activePosition) {
      setFeedback({ type: 'error', message: 'Close active position before executing a new trade.' });
      return;
    }

    if (numericEntry <= 0 || slPrice <= 0 || tp1Price <= 0 || tp2Price <= 0) {
      setFeedback({ type: 'error', message: 'Please configure valid Entry, SL, TP1, and TP2 targets.' });
      return;
    }

    // Safety checks
    if (direction === 'LONG') {
      if (slPrice >= numericEntry) {
        setFeedback({ type: 'error', message: 'Stop Loss must be BELOW entry price for LONG trades.' });
        return;
      }
      if (tp1Price <= numericEntry || tp2Price <= tp1Price) {
        setFeedback({ type: 'error', message: 'Take Profits must be ABOVE entry price, and TP2 > TP1.' });
        return;
      }
    } else {
      if (slPrice <= numericEntry) {
        setFeedback({ type: 'error', message: 'Stop Loss must be ABOVE entry price for SHORT trades.' });
        return;
      }
      if (tp1Price >= numericEntry || tp2Price >= tp1Price) {
        setFeedback({ type: 'error', message: 'Take Profits must be BELOW entry price, and TP2 < TP1.' });
        return;
      }
    }

    // Risk override validation
    if (isRiskExceeded && !riskOverride) {
      setFeedback({ type: 'error', message: 'Risk exceeds settings limits. Please adjust parameters or override.' });
      return;
    }

    setShowConfirm(true);
  };

  const isExecuteDisabled = isExecuting || cooldown || !!activePosition || (isRiskExceeded && !riskOverride);

  const getButtonText = () => {
    if (isExecuting) return 'Executing trade...';
    if (cooldown) return 'Cooldown Active (3s)...';
    if (activePosition) return 'Max positions reached (1/1)';
    if (isRiskExceeded && !riskOverride) return 'Execute Blocked (Risk High)';
    if (isRiskExceeded && riskOverride) return 'Execute (Override) ⚡';
    return 'Execute Trade Signal';
  };

  const getButtonColorClass = () => {
    if (isExecuteDisabled) return 'bg-slate-800 text-slate-500 cursor-not-allowed';
    if (isRiskExceeded && riskOverride) return 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 font-bold text-white shadow-lg shadow-orange-950/20';
    return 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 font-bold text-white shadow-lg shadow-cyan-950/20';
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-4">
        <Calculator className="h-5 w-5 text-cyan-400" />
        Trading Control Panel
      </h3>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Direction Switch */}
        <div className="grid grid-cols-2 gap-3 p-1 rounded-xl bg-slate-900/80 border border-slate-800/80">
          <button
            type="button"
            onClick={() => setDirection('LONG')}
            className={`py-2 px-4 rounded-lg font-bold text-sm tracking-wider uppercase transition-all duration-300 ${
              direction === 'LONG'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-950/40'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            LONG (Buy)
          </button>
          <button
            type="button"
            onClick={() => setDirection('SHORT')}
            className={`py-2 px-4 rounded-lg font-bold text-sm tracking-wider uppercase transition-all duration-300 ${
              direction === 'SHORT'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-lg shadow-rose-950/40'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            SHORT (Sell)
          </button>
        </div>

        {/* Capital Stat */}
        <div className="flex justify-between items-center rounded-xl bg-slate-900/30 p-3.5 border border-slate-800/40 text-xs">
          <div>
            <span className="text-slate-500 font-semibold block uppercase">Total Capital Base</span>
            <span className="text-sm font-bold text-slate-200">{CAPITAL_THB.toLocaleString()} THB</span>
          </div>
          <div className="text-right">
            <span className="text-slate-500 font-semibold block uppercase">USDT Equivalent</span>
            <span className="text-sm font-bold text-cyan-400">≈ ${capitalUsdt.toFixed(2)} USDT</span>
          </div>
        </div>

        {/* Entry Price & Position Size */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
              Entry Price (USDT)
            </label>
            <div className="relative">
              <input
                type="number"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="Entry Price"
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none animate-in fade-in"
              />
              <button
                type="button"
                onClick={useLivePrice}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-700"
              >
                LIVE
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
              Position Size ({positionSizePct}%)
            </label>
            <div className="flex flex-col gap-2">
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={positionSizePct}
                onChange={(e) => setPositionSizePct(parseInt(e.target.value))}
                className="h-2 w-full cursor-pointer accent-cyan-400 bg-slate-800 rounded-lg appearance-none"
              />
              <div className="flex justify-between items-center text-[10px] text-slate-500">
                <span>1,000 THB</span>
                <span className="font-bold text-slate-300">${positionSizeUsdt.toFixed(2)} USDT</span>
                <span>10,000 THB</span>
              </div>
            </div>
          </div>
        </div>

        {/* SL and TP Settings */}
        <div className="space-y-4 rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            SL & TP Configuration
          </span>

          {/* Stop Loss Input */}
          <div className="grid grid-cols-3 gap-2 items-end">
            <div className="col-span-2">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Stop Loss (SL)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={slValue}
                  onChange={(e) => setSlValue(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-medium">
                  {slType === 'pct' ? '%' : 'USDT'}
                </span>
              </div>
            </div>

            {/* SL type selection */}
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800 h-9">
              <button
                type="button"
                onClick={() => setSlType('pct')}
                className={`flex items-center justify-center rounded text-[10px] font-bold ${
                  slType === 'pct' ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'
                }`}
              >
                %
              </button>
              <button
                type="button"
                onClick={() => setSlType('price')}
                className={`flex items-center justify-center rounded text-[10px] font-bold ${
                  slType === 'price' ? 'bg-slate-800 text-cyan-400' : 'text-slate-500'
                }`}
              >
                Price
              </button>
            </div>
          </div>

          {/* Take Profit Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Take Profit 1 (% TP1)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={tp1Pct}
                  onChange={(e) => setTp1Pct(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
                  % Above
                </span>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                Take Profit 2 (% TP2)
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={tp2Pct}
                  onChange={(e) => setTp2Pct(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
                  % Above
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Visual Estimator Outputs */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
          <div className="flex justify-between items-center text-xs border-b border-slate-800 pb-2">
            <span className="font-semibold text-slate-400">Projection Summary</span>
            <span className="text-[10px] text-slate-500">Position: ${positionSizeUsdt.toFixed(2)} USDT</span>
          </div>

          <div className="space-y-2 text-xs">
            {/* SL projection */}
            <div className="flex justify-between items-center text-rose-400">
              <span>Estimated Loss (at SL)</span>
              <span className="font-semibold">
                -${calculations.slLossUsdt.toFixed(2)} USDT (-{calculations.slLossThb.toFixed(0)} THB)
              </span>
            </div>

            {/* TP1 projection */}
            <div className="flex justify-between items-center text-yellow-400">
              <span>TP1 Target (${tp1Price.toLocaleString(undefined, { maximumFractionDigits: 1 })})</span>
              <span className="font-semibold">
                +{calculations.tp1ProfitUsdt.toFixed(2)} USDT (+{calculations.tp1ProfitThb.toFixed(0)} THB)
              </span>
            </div>

            {/* TP2 projection */}
            <div className="flex justify-between items-center text-emerald-400">
              <span>TP2 Target (${tp2Price.toLocaleString(undefined, { maximumFractionDigits: 1 })})</span>
              <span className="font-semibold">
                +{calculations.tp2ProfitUsdt.toFixed(2)} USDT (+{calculations.tp2ProfitThb.toFixed(0)} THB)
              </span>
            </div>

            {/* Full targets hit */}
            <div className="flex justify-between items-center text-white border-t border-slate-800 pt-2 font-bold text-xs">
              <span className="text-cyan-400">Max Profit (Both TPs Hit)</span>
              <span>
                +{calculations.totalProfitUsdt.toFixed(2)} USDT (+{calculations.totalProfitThb.toFixed(0)} THB)
              </span>
            </div>

            {/* Risk reward display */}
            <div className="flex justify-between items-center text-[10px] text-slate-500">
              <span>Risk/Reward Ratios:</span>
              <span>TP1 R:R = {riskRewardTp1.toFixed(1)}x | TP2 Total R:R = {riskRewardTp2.toFixed(1)}x</span>
            </div>
          </div>
        </div>

        {/* FEATURE 8 - Risk Warning Banner */}
        {isRiskExceeded && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-rose-400 text-xs flex flex-col gap-2">
            <div className="flex gap-2 items-start">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>⚠️ Risk {riskPercent.toFixed(1)}% exceeds your limit of {settings.maxRiskPercent}%. Adjust position size or increase SL.</span>
            </div>
            <label className="flex items-center gap-2.5 mt-1 cursor-pointer font-bold select-none text-slate-300 hover:text-white">
              <input
                type="checkbox"
                checked={riskOverride}
                onChange={(e) => setRiskOverride(e.target.checked)}
                className="rounded border-slate-800 bg-slate-950 text-orange-500 focus:ring-0 focus:ring-offset-0 h-4 w-4"
              />
              <span>I understand the risk — allow this trade</span>
            </label>
          </div>
        )}

        {/* Execute Button */}
        <button
          type="submit"
          disabled={isExecuteDisabled}
          className={`flex w-full h-11 items-center justify-center gap-2 rounded-xl transition-all duration-300 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer text-xs ${getButtonColorClass()}`}
        >
          {isExecuting ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Executing trade...
            </span>
          ) : cooldown ? (
            'Cooldown Active (3s)...'
          ) : activePosition ? (
            'Max positions reached (1/1)'
          ) : (
            <>
              <Play className="h-4 w-4 fill-current" />
              <span>{getButtonText()}</span>
            </>
          )}
        </button>
      </form>

      {feedback && (
        <div className={`mt-4 rounded-xl border p-3 text-xs flex gap-2 items-start ${
          feedback.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
        }`}>
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h4 className="text-sm font-bold text-slate-100 uppercase tracking-wider mb-4 border-b border-slate-800 pb-2 flex items-center gap-2 text-cyan-400">
              <AlertCircle className="h-5 w-5" />
              Confirm Trade Execution
            </h4>

            <div className="space-y-3.5 text-xs text-slate-300 my-4">
              <div className="flex justify-between border-b border-slate-900 pb-1.5">
                <span className="text-slate-500 font-semibold">Direction</span>
                <span className={`font-bold ${direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {direction}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1.5">
                <span className="text-slate-500 font-semibold">Entry Price</span>
                <span className="font-bold text-slate-200">${numericEntry.toLocaleString()} USDT</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1.5">
                <span className="text-slate-500 font-semibold">Stop Loss Target</span>
                <span className="font-bold text-rose-400">${slPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1.5">
                <span className="text-slate-500 font-semibold">Take Profit 1 (50%)</span>
                <span className="font-bold text-yellow-400">${tp1Price.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1.5">
                <span className="text-slate-500 font-semibold">Take Profit 2 (100%)</span>
                <span className="font-bold text-emerald-400">${tp2Price.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</span>
              </div>
              <div className="flex justify-between border-b border-slate-900 pb-1.5">
                <span className="text-slate-500 font-semibold">Position Size</span>
                <span className="font-bold text-cyan-400">${positionSizeUsdt.toFixed(2)} USDT</span>
              </div>
              {isRiskExceeded && (
                <div className="flex justify-between border-b border-slate-900 pb-1.5 text-orange-400">
                  <span className="font-semibold">Risk Level (Override)</span>
                  <span className="font-bold">{riskPercent.toFixed(1)}% (ALLOWED)</span>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 h-10 rounded-xl bg-slate-900 hover:bg-slate-800 font-semibold text-slate-300 border border-slate-800 transition-colors cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmTrade}
                className="flex-1 h-10 rounded-xl bg-cyan-500 hover:bg-cyan-400 font-bold text-slate-950 transition-colors cursor-pointer text-xs"
              >
                Confirm Trade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
