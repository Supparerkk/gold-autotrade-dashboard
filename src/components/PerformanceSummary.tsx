'use client';

import React, { useMemo } from 'react';
import { useTrade } from '@/context/TradeContext';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, AreaChart, Area } from 'recharts';
import { Award, TrendingUp, TrendingDown, Target, ShieldAlert } from 'lucide-react';

export default function PerformanceSummary() {
  const { tradeLogs } = useTrade();

  // Filter out only closed trades with calculated PnL
  const closedTrades = useMemo(() => {
    return [...tradeLogs]
      .filter((log) => log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT')
      .reverse(); // reverse to get chronological order (oldest first)
  }, [tradeLogs]);

  // Calculations
  const stats = useMemo(() => {
    const totalTrades = closedTrades.length;
    if (totalTrades === 0) {
      return {
        total: 0,
        winRate: 0,
        netPnLThb: 0,
        netPnLUsdt: 0,
        bestTradeThb: 0,
        worstTradeThb: 0,
        wins: 0,
        losses: 0,
      };
    }

    const wins = closedTrades.filter((t) => t.result === 'WIN').length;
    const losses = totalTrades - wins;
    const winRate = (wins / totalTrades) * 100;
    
    let netPnLThb = 0;
    let netPnLUsdt = 0;
    let bestTradeThb = -Infinity;
    let worstTradeThb = Infinity;

    closedTrades.forEach((t) => {
      const pnlThb = t.pnl_thb || 0;
      const pnlUsdt = t.pnl_usdt || 0;
      
      netPnLThb += pnlThb;
      netPnLUsdt += pnlUsdt;
      
      if (pnlThb > bestTradeThb) bestTradeThb = pnlThb;
      if (pnlThb < worstTradeThb) worstTradeThb = pnlThb;
    });

    return {
      total: totalTrades,
      winRate,
      netPnLThb,
      netPnLUsdt,
      bestTradeThb: bestTradeThb === -Infinity ? 0 : bestTradeThb,
      worstTradeThb: worstTradeThb === Infinity ? 0 : worstTradeThb,
      wins,
      losses,
    };
  }, [closedTrades]);

  // Donut chart data
  const donutData = useMemo(() => {
    return [
      { name: 'Wins', value: stats.wins, color: '#10b981' },
      { name: 'Losses', value: stats.losses, color: '#f43f5e' },
    ].filter(d => d.value > 0);
  }, [stats]);

  // Equity Curve Data (starts at 10,000 THB capital base)
  const equityData = useMemo(() => {
    let currentBalance = 10000;
    const data = [{ name: 'Start', balance: currentBalance }];
    
    closedTrades.forEach((trade, index) => {
      currentBalance += trade.pnl_thb || 0;
      const dateStr = new Date(trade.opened_at || trade.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
      data.push({
        name: `${dateStr} (#${index + 1})`,
        balance: Math.round(currentBalance),
      });
    });

    return data;
  }, [closedTrades]);

  const isNetPositive = stats.netPnLThb >= 0;

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-6">
        <Target className="h-5 w-5 text-emerald-400" />
        Performance Summary
      </h3>

      {/* Grid statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="rounded-xl bg-slate-900/40 p-4 border border-slate-800/50">
          <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block">Total Trades</span>
          <span className="text-2xl font-extrabold text-slate-200 mt-1 block">{stats.total}</span>
        </div>

        <div className="rounded-xl bg-slate-900/40 p-4 border border-slate-800/50">
          <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block">Win Rate</span>
          <span className="text-2xl font-extrabold text-emerald-400 mt-1 block">{stats.winRate.toFixed(1)}%</span>
        </div>

        <div className="rounded-xl bg-slate-900/40 p-4 border border-slate-800/50 col-span-2 md:col-span-1">
          <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block">Net Profit</span>
          <span className={`text-2xl font-extrabold mt-1 block ${isNetPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {isNetPositive ? '+' : ''}{Math.round(stats.netPnLThb).toLocaleString()} THB
            <span className="text-[10px] font-semibold block text-slate-500">
              {isNetPositive ? '+' : ''}${stats.netPnLUsdt.toFixed(2)} USDT
            </span>
          </span>
        </div>

        <div className="rounded-xl bg-slate-900/40 p-4 border border-slate-800/50">
          <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block">Best Trade</span>
          <span className="text-sm font-bold text-emerald-400 mt-2 block">
            +{Math.round(stats.bestTradeThb).toLocaleString()} THB
          </span>
        </div>

        <div className="rounded-xl bg-slate-900/40 p-4 border border-slate-800/50">
          <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block">Worst Trade</span>
          <span className="text-sm font-bold text-rose-400 mt-2 block">
            {Math.round(stats.worstTradeThb).toLocaleString()} THB
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Equity curve */}
        <div className="lg:col-span-2 rounded-xl bg-slate-950/40 border border-slate-800/60 p-4 flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Equity Curve (THB)</span>
            <p className="text-[10px] text-slate-500 mt-0.5">Cumulative account balance growth starting at 10,000 THB.</p>
          </div>

          <div className="h-48 w-full mt-4">
            {equityData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="equityColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    domain={['dataMin - 100', 'dataMax + 100']}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.9)',
                      borderColor: 'rgba(51, 65, 85, 0.8)',
                      borderRadius: '12px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    formatter={(val) => [`${val ? val.toLocaleString() : '0'} THB`, 'Balance']}
                  />
                  <Area type="monotone" dataKey="balance" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#equityColor)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                Execute and close trades to populate equity growth curve
              </div>
            )}
          </div>
        </div>

        {/* Win/Loss Donut Chart */}
        <div className="rounded-xl bg-slate-950/40 border border-slate-800/60 p-4 flex flex-col justify-between items-center text-center">
          <div className="self-start text-left w-full">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Win/Loss Distribution</span>
            <p className="text-[10px] text-slate-500 mt-0.5">Ratio of winning to losing closed positions.</p>
          </div>

          <div className="h-44 w-full relative flex items-center justify-center">
            {donutData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                {/* Center Text */}
                <div className="absolute flex flex-col items-center">
                  <span className="text-xl font-black text-white">{stats.winRate.toFixed(0)}%</span>
                  <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Win Rate</span>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                No ratio statistics available
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex gap-4 text-xs font-bold w-full justify-center">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>Wins ({stats.wins})</span>
            </div>
            <div className="flex items-center gap-1.5 text-rose-400">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              <span>Losses ({stats.losses})</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
