'use client';

import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useTrade } from '@/context/TradeContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { Chart } from 'chart.js/auto';

interface MiniChartProps {
  label: string;
  data: { time: string; price: number }[];
  isPositive: boolean;
}

function MiniChart({ label, data, isPositive }: MiniChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const prices = data.map(d => d.price);
    const labels = data.map(d => d.time);

    const strokeColor = isPositive ? '#10b981' : '#f43f5e';
    const fillColor = isPositive ? 'rgba(16, 185, 129, 0.05)' : 'rgba(244, 63, 94, 0.05)';

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: prices,
          borderColor: strokeColor,
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          backgroundColor: fillColor,
          tension: 0.15,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(51, 65, 85, 0.8)',
            borderWidth: 1,
            titleColor: '#94a3b8',
            bodyColor: '#fff',
            titleFont: { size: 9 },
            bodyFont: { size: 9 },
          }
        },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data, isPositive]);

  const currentPrice = data.length > 0 ? data[data.length - 1].price : 0;
  const initialPrice = data.length > 0 ? data[0].price : 0;
  const pnlPercent = initialPrice > 0 ? ((currentPrice - initialPrice) / initialPrice) * 100 : 0;

  return (
    <div className="flex-1 rounded-xl border border-slate-800/80 bg-slate-950/20 p-4 transition-all duration-300 hover:border-slate-700/60">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className="text-right">
          <span className="text-xs font-bold text-slate-300">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className={`text-[9px] font-bold block ${pnlPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="h-24 w-full relative">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export default function MarketOverview() {
  const { goldPrice, priceChange24h, klinesData, isLoading, lastUpdatedTime, regimeData } = useTrade();
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');

  const [klines4h, setKlines4h] = useState<any[]>([]);
  const [klines1d, setKlines1d] = useState<any[]>([]);
  const [isLoadingMinis, setIsLoadingMinis] = useState<boolean>(true);

  const fetchMiniChartsData = async () => {
    try {
      const res4h = await fetch('/api/market/klines?interval=4h&limit=30');
      const res1d = await fetch('/api/market/klines?interval=1d&limit=30');
      
      if (res4h.ok) {
        const data = await res4h.json();
        setKlines4h(data.map((item: any) => ({
          time: new Date(item[0]).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' }),
          price: parseFloat(item[4]),
        })));
      }
      if (res1d.ok) {
        const data = await res1d.json();
        setKlines1d(data.map((item: any) => ({
          time: new Date(item[0]).toLocaleDateString([], { month: 'short', day: 'numeric' }),
          price: parseFloat(item[4]),
        })));
      }
    } catch (e) {
      console.error('Error fetching mini charts data:', e);
    } finally {
      setIsLoadingMinis(false);
    }
  };

  useEffect(() => {
    fetchMiniChartsData();
    const interval = setInterval(fetchMiniChartsData, 300000); // 5 minutes refresh
    return () => clearInterval(interval);
  }, []);

  const [secondsElapsed, setSecondsElapsed] = useState<number>(0);

  // Live timer update
  useEffect(() => {
    if (!lastUpdatedTime) return;

    setSecondsElapsed(Math.round((Date.now() - new Date(lastUpdatedTime).getTime()) / 1000));

    const interval = setInterval(() => {
      setSecondsElapsed(Math.round((Date.now() - new Date(lastUpdatedTime).getTime()) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [lastUpdatedTime]);

  const getLastUpdatedText = () => {
    if (!lastUpdatedTime) return 'Never updated';
    if (secondsElapsed < 60) return `${secondsElapsed} seconds ago`;
    const mins = Math.floor(secondsElapsed / 60);
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.floor(mins / 60);
    return `${hours} hours ago`;
  };

  const getTimerColorClass = () => {
    if (!lastUpdatedTime) return 'text-slate-500';
    if (secondsElapsed < 30) return 'text-emerald-400';
    if (secondsElapsed < 60) return 'text-yellow-400';
    return 'text-rose-400';
  };

  const formattedISOTime = useMemo(() => {
    if (!lastUpdatedTime) return '';
    return new Date(lastUpdatedTime).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }) + ' (GMT+7)';
  }, [lastUpdatedTime]);

  // Track price direction flash
  useEffect(() => {
    if (goldPrice === 0) return;
    if (prevPrice === 0) {
      setPrevPrice(goldPrice);
      return;
    }

    if (goldPrice > prevPrice) {
      setPriceDirection('up');
      const timer = setTimeout(() => setPriceDirection('neutral'), 1500);
      setPrevPrice(goldPrice);
      return () => clearTimeout(timer);
    } else if (goldPrice < prevPrice) {
      setPriceDirection('down');
      const timer = setTimeout(() => setPriceDirection('neutral'), 1500);
      setPrevPrice(goldPrice);
      return () => clearTimeout(timer);
    }
  }, [goldPrice, prevPrice]);

  const isPositive = priceChange24h >= 0;

  // Formatting for chart
  const chartData = useMemo(() => {
    if (!klinesData || klinesData.length === 0) return [];
    return klinesData.map((k) => ({
      time: k.time,
      price: k.close,
    }));
  }, [klinesData]);

  // Find min/max for better chart bounds
  const yBounds = useMemo(() => {
    if (chartData.length === 0) return { min: 'auto', max: 'auto' };
    const prices = chartData.map((d) => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.05; // 5% padding
    return {
      min: Math.floor(min - padding),
      max: Math.ceil(max + padding),
    };
  }, [chartData]);

  if (isLoading && goldPrice === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/40 p-6 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-cyan-400" />
          <p className="text-sm text-slate-400">Loading market data...</p>
        </div>
      </div>
    );
  }

  const getRegimeColorClasses = () => {
    if (!regimeData) return { bg: 'bg-slate-500/10', text: 'text-slate-400 border-slate-500/20' };
    switch (regimeData.status) {
      case 'HIGH_VOLATILITY':
        return { bg: 'bg-orange-500/10', text: 'text-orange-400 border-orange-500/20' };
      case 'TRENDING_UP':
        return { bg: 'bg-emerald-500/10', text: 'text-emerald-400 border-emerald-500/20' };
      case 'TRENDING_DOWN':
        return { bg: 'bg-rose-500/10', text: 'text-rose-400 border-rose-500/20' };
      case 'RANGING':
        return { bg: 'bg-yellow-500/10', text: 'text-yellow-400 border-yellow-500/20' };
      default:
        return { bg: 'bg-slate-500/10', text: 'text-slate-400 border-slate-500/20' };
    }
  };

  const regimeColors = getRegimeColorClasses();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      {/* Background radial highlight */}
      <div
        className={`absolute -right-10 -top-10 h-40 w-40 rounded-full blur-[80px] transition-all duration-1000 ${
          isPositive ? 'bg-emerald-500/10' : 'bg-rose-500/10'
        }`}
      />

      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
            Gold (PAXG) / USDT Spot (Binance)
          </span>
          <div className="mt-1 flex items-baseline gap-3">
            <h2
              className={`text-3xl font-bold tracking-tight transition-all duration-300 ${
                priceDirection === 'up'
                  ? 'text-emerald-400 scale-[1.02]'
                  : priceDirection === 'down'
                  ? 'text-rose-400 scale-[1.02]'
                  : 'text-white'
              }`}
            >
              ${goldPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h2>
            <div
              className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isPositive
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-rose-500/10 text-rose-400'
              }`}
            >
              {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>{isPositive ? '+' : ''}{priceChange24h.toFixed(2)}%</span>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-slate-800/50 p-2 text-slate-400 backdrop-blur-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500"></span>
          </span>
        </div>
      </div>

      {/* Mini candlestick-style area chart */}
      <div className="mt-6 h-44 w-full">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="chartColor" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={isPositive ? '#10b981' : '#f43f5e'}
                    stopOpacity={0.2}
                  />
                  <stop
                    offset="95%"
                    stopColor={isPositive ? '#10b981' : '#f43f5e'}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontSize: 10 }}
                minTickGap={20}
              />
              <YAxis
                domain={[yBounds.min, yBounds.max]}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickFormatter={(val) => `$${(val / 1000).toFixed(1)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  borderColor: 'rgba(51, 65, 85, 0.8)',
                  borderRadius: '12px',
                  color: '#fff',
                  fontSize: '12px',
                  backdropFilter: 'blur(8px)',
                }}
                formatter={(value: any) => [`$${parseFloat(value).toLocaleString()}`, 'Price']}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={isPositive ? '#10b981' : '#f43f5e'}
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#chartColor)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            No chart data available
          </div>
        )}
      </div>

      {/* Market Regime Badge & Last Updated Timestamp */}
      <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap gap-4 items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Market Regime:</span>
          {regimeData ? (
            <div 
              className={`cursor-help px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${regimeColors.bg} ${regimeColors.text}`}
              title={`ADX: ${regimeData.adx.toFixed(1)} | ATR: ${regimeData.atr.toFixed(1)} | Signal basis: 1H candles`}
            >
              {regimeData.label}
            </div>
          ) : (
            <div className="px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-slate-500/10 text-slate-400 border-slate-500/20">
              CALCULATING...
            </div>
          )}
          {regimeData && (
            <span className="text-[11px] text-slate-500 hidden sm:inline">{regimeData.description}</span>
          )}
        </div>
        <div className="flex flex-col items-end text-[10px] text-slate-500 leading-normal">
          <span>Data Feed: Binance Live</span>
          <span 
            className={`font-semibold cursor-help select-none transition-colors duration-300 ${getTimerColorClass()}`}
            title={formattedISOTime}
          >
            Last updated: {getLastUpdatedText()}
          </span>
        </div>
      </div>

      {/* Multi-Timeframe Mini Charts */}
      <div className="mt-5 pt-5 border-t border-slate-800/80">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-3">Multi-Timeframe Context</span>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-300">
          {isLoadingMinis ? (
            <div className="col-span-2 py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-cyan-400" />
              Loading mini timeframe charts...
            </div>
          ) : (
            <>
              <MiniChart 
                label="4H Timeframe (30 candles)" 
                data={klines4h} 
                isPositive={klines4h.length > 1 ? klines4h[klines4h.length - 1].price >= klines4h[0].price : true} 
              />
              <MiniChart 
                label="Daily Timeframe (30 candles)" 
                data={klines1d} 
                isPositive={klines1d.length > 1 ? klines1d[klines1d.length - 1].price >= klines1d[0].price : true} 
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
