'use client';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTrade } from '@/context/TradeContext';
import { Play, RotateCcw, Download, Search, ChevronDown, ChevronUp, TrendingUp, TrendingDown, BarChart3, Target, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Chart } from 'chart.js/auto';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface BacktestTrade {
  openTime: number;
  closeTime: number;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  slHit: boolean;
  tp1Hit: boolean;
  tp2Hit: boolean;
  pnlUsdt: number;
  pnlThb: number;
  result: 'WIN' | 'LOSS';
}

interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

interface BacktestStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnlUsdt: number;
  netPnlThb: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  bestTrade: number;
  worstTrade: number;
  avgDuration: number;
}

interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  stats: BacktestStats;
}

interface BacktestParams {
  direction: 'LONG' | 'SHORT' | 'BOTH';
  slPct: number;
  tp1Pct: number;
  tp2Pct: number;
  positionSizePct: number;
  capitalThb: number;
  exchangeRate: number;
  entrySignal: 'manual' | 'ema' | 'rsi';
  manualEntryPrice: number;
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  usePartialClose: boolean;
  useAutoBreakeven: boolean;
}

interface OptimizerResult {
  sl: number;
  tp1: number;
  tp2: number;
  winRate: number;
  netPnlThb: number;
}

interface WalkForwardResult {
  inSampleStats: BacktestStats;
  outOfSampleStats: BacktestStats;
  inSampleEquity: EquityPoint[];
  outOfSampleEquity: EquityPoint[];
  bestSl: number;
  bestTp1: number;
  bestTp2: number;
}

// ─── Indicator Helpers ───────────────────────────────────────────────────────

function calculateEMA(closes: number[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      sum += closes[i];
      ema.push(0);
    } else if (i === period - 1) {
      sum += closes[i];
      ema.push(sum / period);
    } else {
      const val = closes[i] * k + ema[i - 1] * (1 - k);
      ema.push(val);
    }
  }
  return ema;
}

function calculateRSI(closes: number[], period: number): number[] {
  const rsi: number[] = [];
  if (closes.length < period + 1) {
    return closes.map(() => 50);
  }
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gainSum += change;
    else lossSum += Math.abs(change);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      rsi.push(50);
    } else if (i === period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    } else {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }
  return rsi;
}

// ─── Backtest Engine ─────────────────────────────────────────────────────────

function runBacktest(candles: Candle[], params: BacktestParams): BacktestResult {
  const {
    direction,
    slPct,
    tp1Pct,
    tp2Pct,
    positionSizePct,
    capitalThb,
    exchangeRate,
    entrySignal,
    manualEntryPrice,
    emaFast,
    emaSlow,
    rsiPeriod,
    rsiOversold,
    rsiOverbought,
    usePartialClose,
    useAutoBreakeven,
  } = params;

  const rate = exchangeRate || 36.5;
  const capitalUsdt = capitalThb / rate;
  const sizeUsdt = capitalUsdt * (positionSizePct / 100);

  const closes = candles.map((c) => c.close);

  // Pre-compute indicators
  let emaFastArr: number[] = [];
  let emaSlowArr: number[] = [];
  let rsiArr: number[] = [];

  if (entrySignal === 'ema') {
    emaFastArr = calculateEMA(closes, emaFast);
    emaSlowArr = calculateEMA(closes, emaSlow);
  } else if (entrySignal === 'rsi') {
    rsiArr = calculateRSI(closes, rsiPeriod);
  }

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  let position: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    slPrice: number;
    tp1Price: number;
    tp2Price: number;
    currentSizeUsdt: number;
    openTime: number;
    tp1Hit: boolean;
  } | null = null;

  let cumulativePnlThb = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // ─── Check for entry signals ─────────────────────────────────────
    if (!position) {
      let longSignal = false;
      let shortSignal = false;

      if (entrySignal === 'ema' && i >= emaSlow) {
        const prevFast = emaFastArr[i - 1];
        const prevSlow = emaSlowArr[i - 1];
        const currFast = emaFastArr[i];
        const currSlow = emaSlowArr[i];
        if (prevFast > 0 && prevSlow > 0 && currFast > 0 && currSlow > 0) {
          if (prevFast <= prevSlow && currFast > currSlow) longSignal = true;
          if (prevFast >= prevSlow && currFast < currSlow) shortSignal = true;
        }
      } else if (entrySignal === 'rsi' && i >= rsiPeriod + 1) {
        const prevRsi = rsiArr[i - 1];
        const currRsi = rsiArr[i];
        if (prevRsi >= rsiOversold && currRsi < rsiOversold) longSignal = true;
        if (prevRsi <= rsiOverbought && currRsi > rsiOverbought) shortSignal = true;
      } else if (entrySignal === 'manual') {
        if (manualEntryPrice > 0) {
          if (candle.low <= manualEntryPrice && candle.high >= manualEntryPrice) {
            if (direction === 'LONG' || direction === 'BOTH') longSignal = true;
            else shortSignal = true;
          }
        }
      }

      // Filter by direction preference
      if (direction === 'LONG') shortSignal = false;
      if (direction === 'SHORT') longSignal = false;

      const openDir: 'LONG' | 'SHORT' | null = longSignal ? 'LONG' : shortSignal ? 'SHORT' : null;

      if (openDir) {
        const entryPrice = entrySignal === 'manual' ? manualEntryPrice : candle.close;

        let sl: number, tp1: number, tp2: number;
        if (openDir === 'LONG') {
          sl = entryPrice * (1 - slPct / 100);
          tp1 = entryPrice * (1 + tp1Pct / 100);
          tp2 = entryPrice * (1 + tp2Pct / 100);
        } else {
          sl = entryPrice * (1 + slPct / 100);
          tp1 = entryPrice * (1 - tp1Pct / 100);
          tp2 = entryPrice * (1 - tp2Pct / 100);
        }

        position = {
          direction: openDir,
          entryPrice,
          slPrice: sl,
          tp1Price: tp1,
          tp2Price: tp2,
          currentSizeUsdt: sizeUsdt,
          openTime: candle.time,
          tp1Hit: false,
        };
      }
    }

    // ─── Manage open position ────────────────────────────────────────
    if (position) {
      let closed = false;
      let exitPrice = 0;
      let slHit = false;
      let tp1Hit = position.tp1Hit;
      let tp2Hit = false;

      if (position.direction === 'LONG') {
        // Check SL
        if (candle.low <= position.slPrice) {
          closed = true;
          exitPrice = position.slPrice;
          slHit = true;
        }
        // Check TP1
        if (!closed && !position.tp1Hit && candle.high >= position.tp1Price) {
          tp1Hit = true;
          position.tp1Hit = true;
          if (usePartialClose) {
            // Close 50% at TP1 — realize partial profit
            const partialSize = position.currentSizeUsdt * 0.5;
            const partialPnlUsdt = (position.tp1Price - position.entryPrice) / position.entryPrice * partialSize;
            const partialPnlThb = partialPnlUsdt * rate;
            cumulativePnlThb += partialPnlThb;
            position.currentSizeUsdt -= partialSize;
          }
          if (useAutoBreakeven) {
            position.slPrice = position.entryPrice;
          }
        }
        // Check TP2
        if (!closed && candle.high >= position.tp2Price) {
          closed = true;
          exitPrice = position.tp2Price;
          tp2Hit = true;
        }
      } else {
        // SHORT logic
        // Check SL
        if (candle.high >= position.slPrice) {
          closed = true;
          exitPrice = position.slPrice;
          slHit = true;
        }
        // Check TP1
        if (!closed && !position.tp1Hit && candle.low <= position.tp1Price) {
          tp1Hit = true;
          position.tp1Hit = true;
          if (usePartialClose) {
            const partialSize = position.currentSizeUsdt * 0.5;
            const partialPnlUsdt = (position.entryPrice - position.tp1Price) / position.entryPrice * partialSize;
            const partialPnlThb = partialPnlUsdt * rate;
            cumulativePnlThb += partialPnlThb;
            position.currentSizeUsdt -= partialSize;
          }
          if (useAutoBreakeven) {
            position.slPrice = position.entryPrice;
          }
        }
        // Check TP2
        if (!closed && candle.low <= position.tp2Price) {
          closed = true;
          exitPrice = position.tp2Price;
          tp2Hit = true;
        }
      }

      if (closed) {
        let pnlUsdt: number;
        if (position.direction === 'LONG') {
          pnlUsdt = (exitPrice - position.entryPrice) / position.entryPrice * position.currentSizeUsdt;
        } else {
          pnlUsdt = (position.entryPrice - exitPrice) / position.entryPrice * position.currentSizeUsdt;
        }
        const pnlThb = pnlUsdt * rate;
        cumulativePnlThb += pnlThb;

        trades.push({
          openTime: position.openTime,
          closeTime: candle.time,
          direction: position.direction,
          entryPrice: position.entryPrice,
          exitPrice,
          slHit,
          tp1Hit,
          tp2Hit,
          pnlUsdt,
          pnlThb,
          result: pnlUsdt >= 0 ? 'WIN' : 'LOSS',
        });

        position = null;
      }
    }

    // Track equity curve
    if (peakEquity < cumulativePnlThb) peakEquity = cumulativePnlThb;
    const dd = peakEquity > 0 ? ((peakEquity - cumulativePnlThb) / peakEquity) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;

    equityCurve.push({
      time: candle.time,
      equity: cumulativePnlThb,
      drawdown: -dd,
    });
  }

  // ─── Calculate Stats ────────────────────────────────────────────────
  const wins = trades.filter((t) => t.result === 'WIN').length;
  const losses = trades.filter((t) => t.result === 'LOSS').length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const netPnlUsdt = trades.reduce((s, t) => s + t.pnlUsdt, 0);
  const netPnlThb = trades.reduce((s, t) => s + t.pnlThb, 0);

  const grossProfit = trades.filter((t) => t.pnlThb > 0).reduce((s, t) => s + t.pnlThb, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnlThb < 0).reduce((s, t) => s + t.pnlThb, 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;

  // Sharpe Ratio (simplified daily)
  const returns = trades.map((t) => t.pnlThb);
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1) : 0;
  const stdReturn = Math.sqrt(variance);
  const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : 0;

  const bestTrade = trades.length > 0 ? Math.max(...trades.map((t) => t.pnlThb)) : 0;
  const worstTrade = trades.length > 0 ? Math.min(...trades.map((t) => t.pnlThb)) : 0;

  const totalDurationMs = trades.reduce((s, t) => s + (t.closeTime - t.openTime), 0);
  const avgDuration = trades.length > 0 ? totalDurationMs / trades.length / 3600000 : 0;

  const stats: BacktestStats = {
    totalTrades,
    wins,
    losses,
    winRate,
    netPnlUsdt,
    netPnlThb,
    profitFactor,
    maxDrawdownPct: maxDrawdown,
    sharpeRatio,
    bestTrade,
    worstTrade,
    avgDuration,
  };

  return { trades, equityCurve, stats };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BacktestPanel() {
  const { exchangeRate: ctxRate, goldPrice, settings } = useTrade();
  const rate = ctxRate || 36.5;

  // ─── Input State ─────────────────────────────────────────────────────
  const [timeframe, setTimeframe] = useState('1h');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [entrySignal, setEntrySignal] = useState<'manual' | 'ema' | 'rsi'>('ema');
  const [manualEntryPrice, setManualEntryPrice] = useState(goldPrice || 2600);
  const [emaFast, setEmaFast] = useState(9);
  const [emaSlow, setEmaSlow] = useState(21);
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [rsiOversold, setRsiOversold] = useState(30);
  const [rsiOverbought, setRsiOverbought] = useState(70);
  const [direction, setDirection] = useState<'LONG' | 'SHORT' | 'BOTH'>('BOTH');
  const [slPct, setSlPct] = useState(2);
  const [tp1Pct, setTp1Pct] = useState(4);
  const [tp2Pct, setTp2Pct] = useState(8);
  const [positionSizePct, setPositionSizePct] = useState(50);
  const [capitalThb, setCapitalThb] = useState(10000);
  const [usePartialClose, setUsePartialClose] = useState(true);
  const [useAutoBreakeven, setUseAutoBreakeven] = useState(true);

  // ─── Backtest State ──────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [fetchProgress, setFetchProgress] = useState('');
  const [fetchProgressPct, setFetchProgressPct] = useState(0);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);

  // ─── Optimizer State ─────────────────────────────────────────────────
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizerProgress, setOptimizerProgress] = useState('');
  const [optimizerResults, setOptimizerResults] = useState<OptimizerResult[]>([]);
  const [bestOptResult, setBestOptResult] = useState<OptimizerResult | null>(null);

  // ─── Walk-Forward State ──────────────────────────────────────────────
  const [wfExpanded, setWfExpanded] = useState(false);
  const [isWfRunning, setIsWfRunning] = useState(false);
  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);

  // ─── Chart Refs ──────────────────────────────────────────────────────
  const equityChartRef = useRef<HTMLCanvasElement | null>(null);
  const equityChartInstance = useRef<Chart | null>(null);
  const wfChartRef = useRef<HTMLCanvasElement | null>(null);
  const wfChartInstance = useRef<Chart | null>(null);

  // ─── Data Fetching ───────────────────────────────────────────────────
  const fetchCandles = useCallback(async (): Promise<Candle[]> => {
    const startMs = new Date(dateFrom).getTime();
    const endMs = new Date(dateTo).getTime() + 86400000 - 1;
    const allCandles: Candle[] = [];
    let currentStart = startMs;
    const batchLimit = 1000;

    // Estimate total candles needed
    const intervalMs: Record<string, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    const candleMs = intervalMs[timeframe] || 3600000;
    const estimatedTotal = Math.ceil((endMs - startMs) / candleMs);

    while (currentStart < endMs) {
      setFetchProgress(`Fetching data... ${allCandles.length}/${estimatedTotal} candles`);
      setFetchProgressPct(Math.min(100, Math.round((allCandles.length / Math.max(estimatedTotal, 1)) * 100)));

      try {
        const url = `/api/market/klines?symbol=PAXGUSDT&interval=${timeframe}&startTime=${currentStart}&endTime=${endMs}&limit=${batchLimit}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) break;

        for (const k of data) {
          allCandles.push({
            time: Number(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
          });
        }

        const lastTime = Number(data[data.length - 1][0]);
        if (lastTime <= currentStart) break;
        currentStart = lastTime + 1;

        if (data.length < batchLimit) break;
      } catch (err) {
        console.error('Error fetching candles:', err);
        break;
      }
    }

    setFetchProgress(`Fetched ${allCandles.length} candles`);
    setFetchProgressPct(100);
    return allCandles;
  }, [dateFrom, dateTo, timeframe]);

  // ─── Run Backtest ────────────────────────────────────────────────────
  const handleRunBacktest = useCallback(async () => {
    setIsRunning(true);
    setResult(null);
    setOptimizerResults([]);
    setBestOptResult(null);
    setWfResult(null);

    try {
      const fetchedCandles = await fetchCandles();
      setCandles(fetchedCandles);

      if (fetchedCandles.length < 2) {
        setFetchProgress('Not enough candle data for backtest.');
        setIsRunning(false);
        return;
      }

      const params: BacktestParams = {
        direction,
        slPct,
        tp1Pct,
        tp2Pct,
        positionSizePct,
        capitalThb,
        exchangeRate: rate,
        entrySignal,
        manualEntryPrice,
        emaFast,
        emaSlow,
        rsiPeriod,
        rsiOversold,
        rsiOverbought,
        usePartialClose,
        useAutoBreakeven,
      };

      const res = runBacktest(fetchedCandles, params);
      setResult(res);
      setFetchProgress(`Backtest complete. ${res.stats.totalTrades} trades found.`);
    } catch (err) {
      console.error('Backtest error:', err);
      setFetchProgress('Backtest failed. Check console.');
    } finally {
      setIsRunning(false);
    }
  }, [fetchCandles, direction, slPct, tp1Pct, tp2Pct, positionSizePct, capitalThb, rate, entrySignal, manualEntryPrice, emaFast, emaSlow, rsiPeriod, rsiOversold, rsiOverbought, usePartialClose, useAutoBreakeven]);

  // ─── Reset ───────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setResult(null);
    setCandles([]);
    setFetchProgress('');
    setFetchProgressPct(0);
    setOptimizerResults([]);
    setBestOptResult(null);
    setWfResult(null);
    setSlPct(2);
    setTp1Pct(4);
    setTp2Pct(8);
    setPositionSizePct(50);
    setCapitalThb(10000);
    setEmaFast(9);
    setEmaSlow(21);
    setRsiPeriod(14);
    setRsiOversold(30);
    setRsiOverbought(70);
    setManualEntryPrice(goldPrice || 2600);
    setEntrySignal('ema');
    setDirection('BOTH');
    setUsePartialClose(true);
    setUseAutoBreakeven(true);
    const d = new Date();
    d.setDate(d.getDate() - 90);
    setDateFrom(d.toISOString().slice(0, 10));
    setDateTo(new Date().toISOString().slice(0, 10));
    setTimeframe('1h');
  }, [goldPrice]);

  // ─── Equity Curve Chart ──────────────────────────────────────────────
  useEffect(() => {
    if (!equityChartRef.current || !result) return;

    if (equityChartInstance.current) {
      equityChartInstance.current.destroy();
      equityChartInstance.current = null;
    }

    const ctx = equityChartRef.current.getContext('2d');
    if (!ctx) return;

    const labels = result.equityCurve.map((p) => {
      const d = new Date(p.time);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });

    // Downsample if too many points (keep every Nth)
    const maxPoints = 500;
    let displayLabels = labels;
    let displayEquity = result.equityCurve.map((p) => p.equity);
    let displayDrawdown = result.equityCurve.map((p) => p.drawdown);

    if (labels.length > maxPoints) {
      const step = Math.ceil(labels.length / maxPoints);
      displayLabels = labels.filter((_, i) => i % step === 0);
      displayEquity = displayEquity.filter((_, i) => i % step === 0);
      displayDrawdown = displayDrawdown.filter((_, i) => i % step === 0);
    }

    equityChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: displayLabels,
        datasets: [
          {
            label: 'Cumulative PnL (THB)',
            data: displayEquity,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.2,
          },
          {
            label: 'Drawdown %',
            data: displayDrawdown,
            borderColor: '#f43f5e',
            backgroundColor: 'rgba(244, 63, 94, 0.08)',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#94a3b8',
              font: { size: 11 },
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(51, 65, 85, 0.8)',
            borderWidth: 1,
            titleColor: '#94a3b8',
            bodyColor: '#fff',
            titleFont: { size: 10 },
            bodyFont: { size: 10 },
          },
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 15 },
            grid: { color: '#1e293b' },
          },
          y: {
            ticks: { color: '#64748b', font: { size: 9 } },
            grid: { color: '#1e293b' },
          },
        },
      },
    });

    return () => {
      if (equityChartInstance.current) {
        equityChartInstance.current.destroy();
        equityChartInstance.current = null;
      }
    };
  }, [result]);

  // ─── Walk-Forward Chart ──────────────────────────────────────────────
  useEffect(() => {
    if (!wfChartRef.current || !wfResult) return;

    if (wfChartInstance.current) {
      wfChartInstance.current.destroy();
      wfChartInstance.current = null;
    }

    const ctx = wfChartRef.current.getContext('2d');
    if (!ctx) return;

    const maxPoints = 400;

    const downsample = (arr: EquityPoint[]) => {
      if (arr.length <= maxPoints) return arr;
      const step = Math.ceil(arr.length / maxPoints);
      return arr.filter((_, i) => i % step === 0);
    };

    const isData = downsample(wfResult.inSampleEquity);
    const oosData = downsample(wfResult.outOfSampleEquity);

    const isLabels = isData.map((p) => new Date(p.time).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    const oosLabels = oosData.map((p) => new Date(p.time).toLocaleDateString([], { month: 'short', day: 'numeric' }));
    const allLabels = [...isLabels, ...oosLabels];

    const isEquity = isData.map((p) => p.equity);
    const oosEquity = oosData.map((p) => p.equity);

    const isDataset = [...isEquity, ...new Array(oosEquity.length).fill(null)];
    const oosDataset = [...new Array(isEquity.length).fill(null), ...oosEquity];

    wfChartInstance.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets: [
          {
            label: 'In-Sample',
            data: isDataset,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.2,
          },
          {
            label: 'Out-of-Sample',
            data: oosDataset,
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.05)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#94a3b8', font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: 'rgba(51, 65, 85, 0.8)',
            borderWidth: 1,
            titleColor: '#94a3b8',
            bodyColor: '#fff',
          },
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 9 }, maxTicksLimit: 15 },
            grid: { color: '#1e293b' },
          },
          y: {
            ticks: { color: '#64748b', font: { size: 9 } },
            grid: { color: '#1e293b' },
          },
        },
      },
    });

    return () => {
      if (wfChartInstance.current) {
        wfChartInstance.current.destroy();
        wfChartInstance.current = null;
      }
    };
  }, [wfResult]);

  // ─── SL/TP Optimizer ─────────────────────────────────────────────────
  const handleOptimize = useCallback(async () => {
    if (candles.length < 2) return;
    setIsOptimizing(true);
    setOptimizerResults([]);
    setBestOptResult(null);

    const slValues = [1, 1.5, 2, 2.5, 3];
    const tp1Values = [2, 3, 4, 5, 6];
    const tp2Values = [4, 6, 8, 10, 12];
    const totalCombos = slValues.length * tp1Values.length * tp2Values.length;

    const results: OptimizerResult[] = [];
    let counter = 0;

    for (const sl of slValues) {
      for (const tp1 of tp1Values) {
        for (const tp2 of tp2Values) {
          counter++;
          if (counter % 5 === 0 || counter === totalCombos) {
            setOptimizerProgress(`Optimizing... ${counter}/${totalCombos}`);
          }

          const params: BacktestParams = {
            direction,
            slPct: sl,
            tp1Pct: tp1,
            tp2Pct: tp2,
            positionSizePct,
            capitalThb,
            exchangeRate: rate,
            entrySignal,
            manualEntryPrice,
            emaFast,
            emaSlow,
            rsiPeriod,
            rsiOversold,
            rsiOverbought,
            usePartialClose,
            useAutoBreakeven,
          };

          const res = runBacktest(candles, params);
          results.push({
            sl,
            tp1,
            tp2,
            winRate: res.stats.winRate,
            netPnlThb: res.stats.netPnlThb,
          });

          // Yield to UI thread periodically
          if (counter % 25 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      }
    }

    setOptimizerResults(results);

    const best = results.reduce((best, r) => (r.netPnlThb > best.netPnlThb ? r : best), results[0]);
    setBestOptResult(best);
    setIsOptimizing(false);
    setOptimizerProgress('');
  }, [candles, direction, positionSizePct, capitalThb, rate, entrySignal, manualEntryPrice, emaFast, emaSlow, rsiPeriod, rsiOversold, rsiOverbought, usePartialClose, useAutoBreakeven]);

  const applyBestSettings = useCallback(() => {
    if (!bestOptResult) return;
    setSlPct(bestOptResult.sl);
    setTp1Pct(bestOptResult.tp1);
    setTp2Pct(bestOptResult.tp2);
  }, [bestOptResult]);

  // ─── Optimizer Grid Data ─────────────────────────────────────────────
  const optimizerGrid = useMemo(() => {
    if (optimizerResults.length === 0) return null;

    const slValues = [1, 1.5, 2, 2.5, 3];
    const tp1Values = [2, 3, 4, 5, 6];

    const grid: { winRate: number; tp2: number; netPnlThb: number }[][] = [];
    for (const sl of slValues) {
      const row: { winRate: number; tp2: number; netPnlThb: number }[] = [];
      for (const tp1 of tp1Values) {
        const combos = optimizerResults.filter((r) => r.sl === sl && r.tp1 === tp1);
        const bestCombo = combos.reduce((b, c) => (c.netPnlThb > b.netPnlThb ? c : b), combos[0]);
        row.push({
          winRate: bestCombo ? bestCombo.winRate : 0,
          tp2: bestCombo ? bestCombo.tp2 : 0,
          netPnlThb: bestCombo ? bestCombo.netPnlThb : 0,
        });
      }
      grid.push(row);
    }

    return { slValues, tp1Values, grid };
  }, [optimizerResults]);

  // ─── Walk-Forward Validation ─────────────────────────────────────────
  const handleWalkForward = useCallback(async () => {
    if (candles.length < 20) return;
    setIsWfRunning(true);
    setWfResult(null);

    try {
      const splitIdx = Math.floor(candles.length * 0.7);
      const inSample = candles.slice(0, splitIdx);
      const outOfSample = candles.slice(splitIdx);

      // Run optimizer on in-sample
      const slValues = [1, 1.5, 2, 2.5, 3];
      const tp1Values = [2, 3, 4, 5, 6];
      const tp2Values = [4, 6, 8, 10, 12];

      let bestPnl = -Infinity;
      let bestSl = 2;
      let bestTp1 = 4;
      let bestTp2 = 8;

      for (const sl of slValues) {
        for (const tp1 of tp1Values) {
          for (const tp2 of tp2Values) {
            const params: BacktestParams = {
              direction,
              slPct: sl,
              tp1Pct: tp1,
              tp2Pct: tp2,
              positionSizePct,
              capitalThb,
              exchangeRate: rate,
              entrySignal,
              manualEntryPrice,
              emaFast,
              emaSlow,
              rsiPeriod,
              rsiOversold,
              rsiOverbought,
              usePartialClose,
              useAutoBreakeven,
            };
            const res = runBacktest(inSample, params);
            if (res.stats.netPnlThb > bestPnl) {
              bestPnl = res.stats.netPnlThb;
              bestSl = sl;
              bestTp1 = tp1;
              bestTp2 = tp2;
            }
          }
        }
      }

      // Yield
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Run backtest on in-sample with best params
      const isParams: BacktestParams = {
        direction,
        slPct: bestSl,
        tp1Pct: bestTp1,
        tp2Pct: bestTp2,
        positionSizePct,
        capitalThb,
        exchangeRate: rate,
        entrySignal,
        manualEntryPrice,
        emaFast,
        emaSlow,
        rsiPeriod,
        rsiOversold,
        rsiOverbought,
        usePartialClose,
        useAutoBreakeven,
      };

      const isResult = runBacktest(inSample, isParams);
      const oosResult = runBacktest(outOfSample, isParams);

      setWfResult({
        inSampleStats: isResult.stats,
        outOfSampleStats: oosResult.stats,
        inSampleEquity: isResult.equityCurve,
        outOfSampleEquity: oosResult.equityCurve,
        bestSl,
        bestTp1,
        bestTp2,
      });
    } catch (err) {
      console.error('Walk-forward error:', err);
    } finally {
      setIsWfRunning(false);
    }
  }, [candles, direction, positionSizePct, capitalThb, rate, entrySignal, manualEntryPrice, emaFast, emaSlow, rsiPeriod, rsiOversold, rsiOverbought, usePartialClose, useAutoBreakeven]);

  // ─── CSV Export ──────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    if (!result || result.trades.length === 0) return;

    const header = '#,DateTime,Direction,Entry,Exit,SL Hit,TP1 Hit,TP2 Hit,PnL USDT,PnL THB,Result\n';
    const rows = result.trades
      .map((t, i) => {
        const dt = new Date(t.openTime).toISOString();
        return `${i + 1},${dt},${t.direction},${t.entryPrice.toFixed(2)},${t.exitPrice.toFixed(2)},${t.slHit},${t.tp1Hit},${t.tp2Hit},${t.pnlUsdt.toFixed(2)},${t.pnlThb.toFixed(2)},${t.result}`;
      })
      .join('\n');

    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_${dateFrom}_${dateTo}_${timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, dateFrom, dateTo, timeframe]);

  // ─── Helper: format number ───────────────────────────────────────────
  const fmt = (n: number, decimals = 2) => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const fmtShort = (n: number) => {
    if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(2);
  };

  // ─── Walk-Forward Verdict ────────────────────────────────────────────
  const wfVerdict = useMemo(() => {
    if (!wfResult) return null;
    const oos = wfResult.outOfSampleStats;
    if (oos.netPnlThb < 0) return { label: '❌ Strategy Failed', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
    if (oos.winRate < 40) return { label: '⚠️ Overfitted', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
    if (oos.winRate > 50 && oos.profitFactor > 1) return { label: '✅ Strategy Robust', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    return { label: '⚠️ Inconclusive', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
  }, [wfResult]);

  // ─── JSX ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════════════════
          MAIN 2-COLUMN GRID: Input Panel + Results Panel
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── LEFT: Input Panel ────────────────────────────────────────── */}
        <div className="lg:col-span-1 rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-6">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
            Backtest Configuration
          </h2>

          <div className="space-y-4">
            {/* Symbol */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Symbol</label>
              <div className="h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 flex items-center font-mono">
                PAXG/USDT
              </div>
            </div>

            {/* Timeframe */}
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
              >
                <option value="15m">15 Minutes</option>
                <option value="1h">1 Hour</option>
                <option value="4h">4 Hours</option>
                <option value="1d">1 Day</option>
              </select>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                />
              </div>
            </div>

            {/* ─── Strategy Parameters ───────────────────────────────────── */}
            <div className="pt-3 border-t border-slate-800/60">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Strategy Parameters</label>

              {/* Entry Signal */}
              <div className="mb-3">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Entry Signal</label>
                <select
                  value={entrySignal}
                  onChange={(e) => setEntrySignal(e.target.value as 'manual' | 'ema' | 'rsi')}
                  className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="manual">Manual Entry Price</option>
                  <option value="ema">EMA Crossover</option>
                  <option value="rsi">RSI Oversold/Overbought</option>
                </select>
              </div>

              {/* Signal-specific inputs */}
              {entrySignal === 'manual' && (
                <div className="mb-3">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Entry Price (USD)</label>
                  <input
                    type="number"
                    value={manualEntryPrice}
                    onChange={(e) => setManualEntryPrice(parseFloat(e.target.value) || 0)}
                    className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                    step="0.01"
                  />
                </div>
              )}

              {entrySignal === 'ema' && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">Fast EMA</label>
                    <input
                      type="number"
                      value={emaFast}
                      onChange={(e) => setEmaFast(parseInt(e.target.value) || 9)}
                      className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                      min={1}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">Slow EMA</label>
                    <input
                      type="number"
                      value={emaSlow}
                      onChange={(e) => setEmaSlow(parseInt(e.target.value) || 21)}
                      className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                      min={1}
                    />
                  </div>
                </div>
              )}

              {entrySignal === 'rsi' && (
                <div className="space-y-3 mb-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1">RSI Period</label>
                    <input
                      type="number"
                      value={rsiPeriod}
                      onChange={(e) => setRsiPeriod(parseInt(e.target.value) || 14)}
                      className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                      min={2}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 block mb-1">Oversold</label>
                      <input
                        type="number"
                        value={rsiOversold}
                        onChange={(e) => setRsiOversold(parseInt(e.target.value) || 30)}
                        className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                        min={0}
                        max={100}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 block mb-1">Overbought</label>
                      <input
                        type="number"
                        value={rsiOverbought}
                        onChange={(e) => setRsiOverbought(parseInt(e.target.value) || 70)}
                        className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                        min={0}
                        max={100}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Direction Toggle */}
              <div className="mb-3">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Direction</label>
                <div className="flex gap-1">
                  {(['LONG', 'SHORT', 'BOTH'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDirection(d)}
                      className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all duration-200 ${
                        direction === d
                          ? d === 'LONG'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : d === 'SHORT'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                          : 'bg-slate-900 text-slate-500 border border-slate-800 hover:text-slate-300'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* SL / TP Inputs */}
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Stop Loss %</label>
                  <input
                    type="number"
                    value={slPct}
                    onChange={(e) => setSlPct(parseFloat(e.target.value) || 0)}
                    className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                    step="0.5"
                    min={0}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">TP1 %</label>
                  <input
                    type="number"
                    value={tp1Pct}
                    onChange={(e) => setTp1Pct(parseFloat(e.target.value) || 0)}
                    className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                    step="0.5"
                    min={0}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">TP2 %</label>
                  <input
                    type="number"
                    value={tp2Pct}
                    onChange={(e) => setTp2Pct(parseFloat(e.target.value) || 0)}
                    className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                    step="0.5"
                    min={0}
                  />
                </div>
              </div>

              {/* Position Size & Capital */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Position Size %</label>
                  <input
                    type="number"
                    value={positionSizePct}
                    onChange={(e) => setPositionSizePct(parseFloat(e.target.value) || 0)}
                    className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                    min={1}
                    max={100}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Capital (THB)</label>
                  <input
                    type="number"
                    value={capitalThb}
                    onChange={(e) => setCapitalThb(parseFloat(e.target.value) || 0)}
                    className="w-full h-9 rounded-lg border border-slate-800 bg-slate-950 px-3 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
                    step="1000"
                    min={0}
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={usePartialClose}
                    onChange={(e) => setUsePartialClose(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">
                    Partial Close at TP1 (50%)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={useAutoBreakeven}
                    onChange={(e) => setUseAutoBreakeven(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/30"
                  />
                  <span className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors">
                    Auto Breakeven after TP1
                  </span>
                </label>
              </div>
            </div>

            {/* ─── Action Buttons ────────────────────────────────────────── */}
            <div className="flex gap-3 pt-3 border-t border-slate-800/60">
              <button
                onClick={handleRunBacktest}
                disabled={isRunning}
                className="flex-1 h-10 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-xs font-bold flex items-center justify-center gap-2 hover:from-cyan-500 hover:to-blue-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/10"
              >
                {isRunning ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isRunning ? 'Running...' : 'Run Backtest'}
              </button>
              <button
                onClick={handleReset}
                className="h-10 px-4 rounded-xl bg-slate-800/60 text-slate-400 text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-700/60 hover:text-slate-200 transition-all duration-200 border border-slate-700/40"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </div>

            {/* Progress */}
            {fetchProgress && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-slate-400">{fetchProgress}</p>
                {fetchProgressPct > 0 && fetchProgressPct < 100 && (
                  <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                      style={{ width: `${fetchProgressPct}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT: Results Panel ─────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* ═══ Summary Cards ═══ */}
          {result && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Total Trades */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Trades</div>
                <div className="text-xl font-bold text-slate-200">{result.stats.totalTrades}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{result.stats.wins}W / {result.stats.losses}L</div>
              </div>

              {/* Win Rate */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Win Rate</div>
                <div className={`text-xl font-bold ${result.stats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {fmt(result.stats.winRate, 1)}%
                </div>
              </div>

              {/* Net PnL THB */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Net PnL THB</div>
                <div className={`text-xl font-bold ${result.stats.netPnlThb >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {result.stats.netPnlThb >= 0 ? '+' : ''}{fmtShort(result.stats.netPnlThb)}
                </div>
              </div>

              {/* Net PnL USDT */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Net PnL USDT</div>
                <div className={`text-xl font-bold ${result.stats.netPnlUsdt >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {result.stats.netPnlUsdt >= 0 ? '+' : ''}{fmtShort(result.stats.netPnlUsdt)}
                </div>
              </div>

              {/* Profit Factor */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Profit Factor</div>
                <div className={`text-xl font-bold ${result.stats.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {result.stats.profitFactor === Infinity ? '∞' : fmt(result.stats.profitFactor, 2)}
                </div>
              </div>

              {/* Max Drawdown */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Max Drawdown</div>
                <div className="text-xl font-bold text-rose-400">
                  -{fmt(result.stats.maxDrawdownPct, 1)}%
                </div>
              </div>

              {/* Sharpe Ratio */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Sharpe Ratio</div>
                <div className={`text-xl font-bold ${result.stats.sharpeRatio >= 1 ? 'text-emerald-400' : result.stats.sharpeRatio >= 0 ? 'text-yellow-400' : 'text-rose-400'}`}>
                  {fmt(result.stats.sharpeRatio, 2)}
                </div>
              </div>

              {/* Best Trade */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Best Trade</div>
                <div className="text-xl font-bold text-emerald-400">
                  +{fmt(result.stats.bestTrade)}
                </div>
                <div className="text-[10px] text-slate-500">THB</div>
              </div>

              {/* Worst Trade */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Worst Trade</div>
                <div className="text-xl font-bold text-rose-400">
                  {fmt(result.stats.worstTrade)}
                </div>
                <div className="text-[10px] text-slate-500">THB</div>
              </div>

              {/* Avg Duration */}
              <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-4 shadow-lg backdrop-blur-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Avg Duration</div>
                <div className="text-xl font-bold text-slate-300">
                  {fmt(result.stats.avgDuration, 1)}h
                </div>
              </div>
            </div>
          )}

          {/* ═══ Equity Curve Chart ═══ */}
          {result && (
            <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl">
              <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5 text-blue-400" />
                Equity Curve
              </h3>
              <div className="h-64 w-full">
                <canvas ref={equityChartRef} />
              </div>
            </div>
          )}

          {/* ═══ Trade List Table ═══ */}
          <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <Target className="h-5 w-5 text-cyan-400" />
                Trade List
              </h3>
              {result && result.trades.length > 0 && (
                <button
                  onClick={exportCSV}
                  className="h-8 px-3 rounded-lg bg-slate-800/60 text-slate-400 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-700/60 hover:text-slate-200 transition-all duration-200 border border-slate-700/40"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </button>
              )}
            </div>

            {!result || result.trades.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <BarChart3 className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">No results yet</p>
                <p className="text-xs mt-1">Configure parameters and run a backtest to see trade results.</p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto scrollbar-thin scrollbar-track-slate-900 scrollbar-thumb-slate-700">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-900/90 backdrop-blur text-slate-400 uppercase tracking-wider">
                      <th className="px-3 py-2 text-left font-semibold">#</th>
                      <th className="px-3 py-2 text-left font-semibold">Date/Time</th>
                      <th className="px-3 py-2 text-left font-semibold">Dir</th>
                      <th className="px-3 py-2 text-right font-semibold">Entry</th>
                      <th className="px-3 py-2 text-right font-semibold">Exit</th>
                      <th className="px-3 py-2 text-center font-semibold">SL</th>
                      <th className="px-3 py-2 text-center font-semibold">TP1</th>
                      <th className="px-3 py-2 text-center font-semibold">TP2</th>
                      <th className="px-3 py-2 text-right font-semibold">PnL THB</th>
                      <th className="px-3 py-2 text-center font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-slate-800/40 transition-colors hover:bg-slate-800/30 ${
                          t.result === 'WIN' ? 'bg-emerald-500/5' : 'bg-rose-500/5'
                        }`}
                      >
                        <td className="px-3 py-2 text-slate-500 font-mono">{idx + 1}</td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                          {new Date(t.openTime).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              t.direction === 'LONG'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {t.direction === 'LONG' ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {t.direction}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300 font-mono">${fmt(t.entryPrice)}</td>
                        <td className="px-3 py-2 text-right text-slate-300 font-mono">${fmt(t.exitPrice)}</td>
                        <td className="px-3 py-2 text-center">
                          {t.slHit ? (
                            <XCircle className="h-4 w-4 text-rose-400 mx-auto" />
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {t.tp1Hit ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {t.tp2Hit ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto" />
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right font-bold font-mono ${t.pnlThb >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.pnlThb >= 0 ? '+' : ''}{fmt(t.pnlThb)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              t.result === 'WIN'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {t.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SL/TP OPTIMIZER
         ═══════════════════════════════════════════════════════════════════ */}
      {candles.length > 0 && (
        <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <Search className="h-5 w-5 text-amber-400" />
              SL/TP Optimizer
            </h3>
            <div className="flex items-center gap-3">
              {optimizerProgress && (
                <span className="text-xs text-slate-400">{optimizerProgress}</span>
              )}
              <button
                onClick={handleOptimize}
                disabled={isOptimizing || candles.length < 2}
                className="h-9 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 text-white text-xs font-bold flex items-center justify-center gap-2 hover:from-amber-500 hover:to-orange-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/10"
              >
                {isOptimizing ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span>🔍</span>
                )}
                {isOptimizing ? 'Optimizing...' : 'Optimize SL/TP'}
              </button>
            </div>
          </div>

          {/* Optimizer Grid */}
          {optimizerGrid && (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-900/60">
                      <th className="px-3 py-2 text-left text-slate-400 font-semibold uppercase tracking-wider">SL% \ TP1%</th>
                      {optimizerGrid.tp1Values.map((tp1) => (
                        <th key={tp1} className="px-3 py-2 text-center text-slate-400 font-semibold uppercase tracking-wider">
                          {tp1}%
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {optimizerGrid.slValues.map((sl, ri) => (
                      <tr key={sl} className="border-b border-slate-800/40">
                        <td className="px-3 py-2 text-slate-400 font-bold">{sl}%</td>
                        {optimizerGrid.grid[ri].map((cell, ci) => {
                          const isBest =
                            bestOptResult &&
                            bestOptResult.sl === sl &&
                            bestOptResult.tp1 === optimizerGrid.tp1Values[ci];
                          return (
                            <td
                              key={ci}
                              className={`px-3 py-2 text-center transition-colors ${
                                isBest
                                  ? 'bg-amber-500/20 border border-amber-400 rounded-lg'
                                  : cell.netPnlThb > 0
                                  ? 'bg-emerald-500/5'
                                  : cell.netPnlThb < 0
                                  ? 'bg-rose-500/5'
                                  : ''
                              }`}
                            >
                              <div className={`font-bold ${cell.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {fmt(cell.winRate, 0)}%
                              </div>
                              <div className="text-[9px] text-slate-500 mt-0.5">
                                TP2:{cell.tp2}%
                              </div>
                              <div className={`text-[9px] font-medium ${cell.netPnlThb >= 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                                {cell.netPnlThb >= 0 ? '+' : ''}{fmtShort(cell.netPnlThb)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {bestOptResult && (
                <div className="flex items-center justify-between p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-amber-400">🏆 Best Combo</span>
                    <span className="text-xs text-slate-300">
                      SL: {bestOptResult.sl}% | TP1: {bestOptResult.tp1}% | TP2: {bestOptResult.tp2}%
                    </span>
                    <span className="text-xs text-slate-400">
                      Win: {fmt(bestOptResult.winRate, 1)}% | PnL: {fmt(bestOptResult.netPnlThb)} THB
                    </span>
                  </div>
                  <button
                    onClick={applyBestSettings}
                    className="h-8 px-4 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 text-white text-xs font-bold hover:from-amber-500 hover:to-orange-500 transition-all duration-200 shadow-lg shadow-amber-500/10"
                  >
                    Apply Best Settings
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          WALK-FORWARD VALIDATION
         ═══════════════════════════════════════════════════════════════════ */}
      {candles.length > 0 && (
        <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Header (collapsible) */}
          <button
            onClick={() => setWfExpanded((p) => !p)}
            className="w-full flex items-center justify-between p-6 hover:bg-slate-800/20 transition-colors"
          >
            <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-400" />
              Walk-Forward Validation
            </h3>
            {wfExpanded ? (
              <ChevronUp className="h-5 w-5 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-400" />
            )}
          </button>

          {/* Content */}
          {wfExpanded && (
            <div className="px-6 pb-6 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                Splits your data into 70% in-sample and 30% out-of-sample. Optimizes SL/TP on in-sample data,
                then validates with the best parameters on out-of-sample data to detect overfitting.
              </p>

              <button
                onClick={handleWalkForward}
                disabled={isWfRunning || candles.length < 20}
                className="h-10 px-6 rounded-xl bg-gradient-to-r from-orange-600 to-red-600 text-white text-xs font-bold flex items-center justify-center gap-2 hover:from-orange-500 hover:to-red-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/10"
              >
                {isWfRunning ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isWfRunning ? 'Running Walk-Forward...' : 'Run Walk-Forward'}
              </button>

              {wfResult && (
                <div className="space-y-4">
                  {/* Verdict Badge */}
                  {wfVerdict && (
                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold ${wfVerdict.color}`}>
                      {wfVerdict.label}
                    </div>
                  )}

                  {/* Best params found */}
                  <div className="text-xs text-slate-400">
                    <span className="text-slate-500">Optimized params:</span>{' '}
                    SL: {wfResult.bestSl}% | TP1: {wfResult.bestTp1}% | TP2: {wfResult.bestTp2}%
                  </div>

                  {/* IS vs OOS Stats Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* In-Sample */}
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                      <h4 className="text-sm font-bold text-blue-400 mb-3 flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-blue-400" />
                        In-Sample (70%)
                      </h4>
                      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Trades</span>
                          <span className="text-slate-300 font-mono">{wfResult.inSampleStats.totalTrades}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Win Rate</span>
                          <span className={`font-mono font-bold ${wfResult.inSampleStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {fmt(wfResult.inSampleStats.winRate, 1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Net PnL</span>
                          <span className={`font-mono font-bold ${wfResult.inSampleStats.netPnlThb >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {wfResult.inSampleStats.netPnlThb >= 0 ? '+' : ''}{fmt(wfResult.inSampleStats.netPnlThb)} ฿
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Profit Factor</span>
                          <span className="text-slate-300 font-mono">
                            {wfResult.inSampleStats.profitFactor === Infinity ? '∞' : fmt(wfResult.inSampleStats.profitFactor)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Max DD</span>
                          <span className="text-rose-400 font-mono">-{fmt(wfResult.inSampleStats.maxDrawdownPct, 1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Sharpe</span>
                          <span className="text-slate-300 font-mono">{fmt(wfResult.inSampleStats.sharpeRatio)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Out-of-Sample */}
                    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
                      <h4 className="text-sm font-bold text-orange-400 mb-3 flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-orange-400" />
                        Out-of-Sample (30%)
                      </h4>
                      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Trades</span>
                          <span className="text-slate-300 font-mono">{wfResult.outOfSampleStats.totalTrades}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Win Rate</span>
                          <span className={`font-mono font-bold ${wfResult.outOfSampleStats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {fmt(wfResult.outOfSampleStats.winRate, 1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Net PnL</span>
                          <span className={`font-mono font-bold ${wfResult.outOfSampleStats.netPnlThb >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {wfResult.outOfSampleStats.netPnlThb >= 0 ? '+' : ''}{fmt(wfResult.outOfSampleStats.netPnlThb)} ฿
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Profit Factor</span>
                          <span className="text-slate-300 font-mono">
                            {wfResult.outOfSampleStats.profitFactor === Infinity ? '∞' : fmt(wfResult.outOfSampleStats.profitFactor)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Max DD</span>
                          <span className="text-rose-400 font-mono">-{fmt(wfResult.outOfSampleStats.maxDrawdownPct, 1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Sharpe</span>
                          <span className="text-slate-300 font-mono">{fmt(wfResult.outOfSampleStats.sharpeRatio)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Walk-Forward Equity Chart */}
                  <div className="rounded-xl border border-slate-800/60 bg-slate-950/40 p-4">
                    <h4 className="text-sm font-semibold text-slate-300 mb-3">Equity Curves: In-Sample vs Out-of-Sample</h4>
                    <div className="h-56 w-full">
                      <canvas ref={wfChartRef} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
