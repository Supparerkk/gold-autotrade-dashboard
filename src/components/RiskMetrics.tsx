'use client';

import React, { useState, useEffect } from 'react';
import { useTrade } from '@/context/TradeContext';
import { Shield, ShieldAlert, Award, TrendingDown, HelpCircle } from 'lucide-react';

export default function RiskMetrics() {
  const { activePosition, goldPrice, exchangeRate } = useTrade();
  const [maxDrawdown, setMaxDrawdown] = useState<number>(0);

  // Track max drawdown during active position
  useEffect(() => {
    if (!activePosition) {
      setMaxDrawdown(0);
      return;
    }

    const { entry_price, sl_price, direction, position_size_usdt } = activePosition;
    const currentPrice = goldPrice || entry_price;
    const isLong = direction === 'LONG';
    
    // Current price difference
    const priceDiff = currentPrice - entry_price;
    const rawPnL = position_size_usdt * (priceDiff / entry_price);
    const currentPnLUsdt = isLong ? rawPnL : -rawPnL;
    
    // Drawdown occurs when PnL is negative
    if (currentPnLUsdt < 0) {
      const drawdownPct = Math.abs(currentPnLUsdt) / position_size_usdt * 100;
      setMaxDrawdown((prev) => Math.max(prev, drawdownPct));
    }
  }, [goldPrice, activePosition]);

  const CAPITAL_THB = 10000;
  
  // Calculate metrics
  const riskMetrics = React.useMemo(() => {
    if (!activePosition) {
      return {
        capitalAtRiskThb: 0,
        capitalAtRiskPct: 0,
        riskRewardTp1: 0,
        riskRewardTp2: 0,
        maxLossUsdt: 0,
      };
    }

    const { entry_price, sl_price, tp1_price, tp2_price, position_size_usdt } = activePosition;
    const isLong = activePosition.direction === 'LONG';
    
    // SL Risk (Maximum Loss in USDT)
    const slDiff = Math.abs(sl_price - entry_price) / entry_price;
    const maxLossUsdt = position_size_usdt * slDiff;
    const capitalAtRiskThb = maxLossUsdt * exchangeRate;
    const capitalAtRiskPct = (capitalAtRiskThb / CAPITAL_THB) * 100;

    // TP1 Reward
    const tp1Diff = Math.abs(tp1_price - entry_price) / entry_price;
    const tp1ProfitUsdt = (position_size_usdt * 0.5) * tp1Diff;

    // TP2 Reward
    const tp2Diff = Math.abs(tp2_price - entry_price) / entry_price;
    const tp2ProfitUsdt = (position_size_usdt * 0.5) * tp2Diff;
    const totalProfitUsdt = tp1ProfitUsdt + tp2ProfitUsdt;

    const riskRewardTp1 = maxLossUsdt > 0 ? tp1ProfitUsdt / maxLossUsdt : 0;
    const riskRewardTp2 = maxLossUsdt > 0 ? totalProfitUsdt / maxLossUsdt : 0;

    return {
      capitalAtRiskThb,
      capitalAtRiskPct,
      riskRewardTp1,
      riskRewardTp2,
      maxLossUsdt,
    };
  }, [activePosition, exchangeRate]);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-4">
        <Shield className="h-5 w-5 text-cyan-400" />
        Risk Metrics
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Metric 1: Capital at Risk */}
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Capital at Risk</span>
            <ShieldAlert className={`h-4 w-4 ${riskMetrics.capitalAtRiskPct > 5 ? 'text-rose-400' : 'text-cyan-400'}`} />
          </div>
          <div className="mt-3">
            <h4 className="text-2xl font-bold text-slate-200">
              {riskMetrics.capitalAtRiskPct.toFixed(2)}%
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              ≈ {riskMetrics.capitalAtRiskThb.toLocaleString(undefined, { maximumFractionDigits: 0 })} THB
              {activePosition && ` ($${riskMetrics.maxLossUsdt.toFixed(2)} USDT)`}
            </p>
          </div>
          <div className="mt-3 text-[10px] text-slate-600 font-medium">
            {activePosition ? 'Calculated from active Stop Loss.' : 'No active trade risk.'}
          </div>
        </div>

        {/* Metric 2: Risk Reward Ratios */}
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Risk / Reward (R:R)</span>
            <Award className="h-4 w-4 text-yellow-400" />
          </div>
          <div className="mt-3 space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-slate-500">TP1 Ratio</span>
              <span className="text-sm font-bold text-yellow-400">{riskMetrics.riskRewardTp1.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between items-baseline border-t border-slate-900 pt-1">
              <span className="text-xs text-slate-500">TP2 Total Ratio</span>
              <span className="text-sm font-bold text-emerald-400">{riskMetrics.riskRewardTp2.toFixed(2)}x</span>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-slate-600 font-medium">
            Targets hit reward / Stop loss risk.
          </div>
        </div>

        {/* Metric 3: Max Drawdown */}
        <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Max Drawdown</span>
            <TrendingDown className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-3">
            <h4 className="text-2xl font-bold text-rose-400">
              {activePosition ? `-${maxDrawdown.toFixed(2)}%` : '0.00%'}
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              {activePosition
                ? `Max negative dip during current trade.`
                : 'No open position drawdown.'}
            </p>
          </div>
          <div className="mt-3 text-[10px] text-slate-600 font-medium">
            Tracks worst price drop since entry.
          </div>
        </div>
      </div>
    </div>
  );
}
