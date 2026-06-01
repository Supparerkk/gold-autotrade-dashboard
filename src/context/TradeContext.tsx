'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { secureGet, secureSet, sanitize } from '@/lib/security';

export interface Trade {
  id: string;
  timestamp: string; // maps to opened_at
  opened_at?: string;
  closed_at?: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  sl_price: number;
  tp1_price: number;
  tp2_price: number;
  exit_price?: number;
  pnl_usdt?: number;
  pnl_thb?: number;
  status: 'OPEN' | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT' | 'CLOSED';
  tp1_hit: boolean;
  tp2_hit: boolean;
  sl_hit: boolean;
  position_size_usdt: number;
  capital_thb: number;
  result?: 'WIN' | 'LOSS';
  notes?: string;
  
  // New Auto-Trade helper fields
  trailing_sl_enabled?: boolean;
  trailing_distance_type?: 'pct' | 'price';
  trailing_distance?: number;
  auto_breakeven_enabled?: boolean;
  partial_close_enabled?: boolean;
  partial_close_pct?: number;
  breakeven_active?: boolean;
}

export interface Settings {
  n8nBaseUrl: string;
  webhookExecutePath: string;
  webhookClosePath: string;
  webhookStatusPath: string;
  telegramEnabled: boolean;
  manualExchangeRate: number;
  useManualExchangeRate: boolean;
  isSimulatedMode: boolean;
  webhookSecret?: string;
  telegramToken?: string;
  telegramChatId?: string;
  alertTradeOpened: boolean;
  alertStopLossHit: boolean;
  alertTp1Hit: boolean;
  alertTp2Hit: boolean;
  alertDailySummary: boolean;
  alertDisconnection: boolean;
  maxRiskPercent: number;
  maxOpenPositions: number;
  dailyLossLimit: number; // New Daily Loss Limit Setting
}

export interface KLine {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RegimeData {
  status: 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'HIGH_VOLATILITY' | 'NEUTRAL';
  label: string;
  description: string;
  adx: number;
  atr: number;
}

export interface FnGData {
  value: number;
  classification: string;
  timestamp: string;
}

interface TradeContextType {
  goldPrice: number;
  priceChange24h: number;
  klinesData: KLine[];
  exchangeRate: number;
  settings: Settings;
  tradeLogs: Trade[];
  activePosition: Trade | null;
  isLoading: boolean;
  connectionStatus: 'CONNECTED' | 'DELAYED' | 'DISCONNECTED';
  lastPingTime: Date | null;
  latency: number | null;
  lastUpdatedTime: Date | null;
  dailyLossLimitReached: boolean; // New context variable
  regimeData: RegimeData | null;
  fngData: FnGData | null;
  botStatus: 'active' | 'paused';
  updateSettings: (newSettings: Partial<Settings>) => Promise<void>;
  updateBotStatus: (status: 'active' | 'paused') => Promise<void>;
  executeTrade: (tradeParams: {
    direction: 'LONG' | 'SHORT';
    entry_price: number;
    sl_price: number;
    tp1_price: number;
    tp2_price: number;
    position_size_usdt: number;
    capital_thb: number;
    trailing_sl_enabled?: boolean;
    trailing_distance_type?: 'pct' | 'price';
    trailing_distance?: number;
    auto_breakeven_enabled?: boolean;
    partial_close_enabled?: boolean;
    partial_close_pct?: number;
  }) => Promise<{ success: boolean; message: string }>;
  closeActivePosition: (reason?: string) => Promise<{ success: boolean; message: string }>;
  refreshTradeLogs: () => Promise<void>;
  triggerNotification: (title: string, body: string) => void;
  resetAllLogs: () => Promise<void>;
  pingStatus: () => Promise<void>;
  updateTradeNotes: (id: string, notes: string) => Promise<void>;
}

const defaultSettings: Settings = {
  n8nBaseUrl: 'https://n8n.goldautotrader.cloud',
  webhookExecutePath: '/webhook/gold-trade-execute',
  webhookClosePath: '/webhook/gold-trade-close',
  webhookStatusPath: '/webhook/gold-position-status',
  telegramEnabled: false,
  manualExchangeRate: 36.5,
  useManualExchangeRate: false,
  isSimulatedMode: false, // Default to false to connect to your live Hostinger n8n instance
  webhookSecret: '',
  telegramToken: '',
  telegramChatId: '',
  alertTradeOpened: true,
  alertStopLossHit: true,
  alertTp1Hit: true,
  alertTp2Hit: true,
  alertDailySummary: true,
  alertDisconnection: true,
  maxRiskPercent: 2,
  maxOpenPositions: 1,
  dailyLossLimit: 300, // Default 300 THB
};

/**
 * Secure fetch wrapper that enforces HTTPS/local endpoints, injects authorization headers,
 * handles request timeouts, and returns safe nullable responses on failure.
 */
export async function secureFetch(url: string, options: RequestInit = {}): Promise<Response | null> {
  // Block execution if bot is paused
  const isExecuteCall = url.includes('/gold-trade-execute') || url.includes('/api/trade/execute');
  if (isExecuteCall && typeof window !== 'undefined' && localStorage.getItem('gold_bot_status') === 'paused') {
    throw new Error('Bot is paused');
  }

  // 1. Validate URL is https:// or relative /api/ path
  if (!url.startsWith('https://') && !url.startsWith('/api/')) {
    console.error(`[Security] Insecure endpoint blocked: ${url}`);
    return null;
  }

  // 2. Add X-Webhook-Secret header automatically from secureGet for internal or n8n calls
  const secret = secureGet('webhookSecret');
  const headers = new Headers(options.headers || {});
  const isInternalOrWebhook = url.startsWith('/api/trade/') || url.includes('n8n.goldautotrader.cloud');
  
  if (secret && isInternalOrWebhook) {
    headers.set('X-Webhook-Secret', secret);
  }
  
  const method = (options.method || 'GET').toUpperCase();
  if (isInternalOrWebhook && method !== 'GET' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // 3. Add AbortController with 15-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    // 4. Validate response status
    if (!response.ok) {
      const errorMsg = await response.text().catch(() => 'Network request failed.');
      throw new Error(errorMsg || `Response status: ${response.status}`);
    }

    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`[Security] API Request timed out: ${url}`);
    } else {
      console.error(`[Security] Fetch error for URL: ${url}`, err.message || err);
    }
    return null;
  }
}

const TradeContext = createContext<TradeContextType | undefined>(undefined);

export const useTrade = () => {
  const context = useContext(TradeContext);
  if (!context) {
    throw new Error('useTrade must be used within a TradeProvider');
  }
  return context;
};

export const TradeProvider = ({ children }: { children: ReactNode }) => {
  const [goldPrice, setGoldPrice] = useState<number>(0);
  const [priceChange24h, setPriceChange24h] = useState<number>(0);
  const [klinesData, setKlinesData] = useState<KLine[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(36.5);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [tradeLogs, setTradeLogs] = useState<Trade[]>([]);
  const [activePosition, setActivePosition] = useState<Trade | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const [connectionStatus, setConnectionStatus] = useState<'CONNECTED' | 'DELAYED' | 'DISCONNECTED'>('DISCONNECTED');
  const [lastPingTime, setLastPingTime] = useState<Date | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastUpdatedTime, setLastUpdatedTime] = useState<Date | null>(null);
  const [dailyLossLimitReached, setDailyLossLimitReached] = useState<boolean>(false);

  // New market intelligence and bot status states
  const [regimeData, setRegimeData] = useState<RegimeData | null>(null);
  const [fngData, setFngData] = useState<FnGData | null>(null);
  const [botStatus, setBotStatus] = useState<'active' | 'paused'>('active');

  // Auto-save active trade config to localStorage
  useEffect(() => {
    if (activePosition) {
      localStorage.setItem('active_position_config', JSON.stringify({
        trailing_sl_enabled: activePosition.trailing_sl_enabled,
        trailing_distance_type: activePosition.trailing_distance_type,
        trailing_distance: activePosition.trailing_distance,
        auto_breakeven_enabled: activePosition.auto_breakeven_enabled,
        partial_close_enabled: activePosition.partial_close_enabled,
        partial_close_pct: activePosition.partial_close_pct,
        breakeven_active: activePosition.breakeven_active,
      }));
    } else {
      localStorage.removeItem('active_position_config');
    }
  }, [activePosition]);

  // Check Daily Loss Limit (Bangkok Time GMT+7)
  useEffect(() => {
    if (isLoading) return;
    
    const getBangkokDateKey = () => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const bangkokTime = new Date(utc + (3600000 * 7));
      return bangkokTime.toISOString().split('T')[0];
    };

    const dateKey = getBangkokDateKey();
    const pauseKey = `daily_loss_paused_${dateKey}`;
    
    if (localStorage.getItem(pauseKey) === 'true') {
      setDailyLossLimitReached(true);
      return;
    }

    const limit = settings.dailyLossLimit || 300;
    const todayClosedTrades = tradeLogs.filter(trade => {
      if (trade.status !== 'CLOSED' && trade.status !== 'SL_HIT' && trade.status !== 'TP2_HIT') {
        if (!trade.closed_at) return false;
      }
      if (!trade.closed_at) return false;
      
      const closedDate = new Date(trade.closed_at);
      const utcClosed = closedDate.getTime() + (closedDate.getTimezoneOffset() * 60000);
      const bkkClosed = new Date(utcClosed + (3600000 * 7));
      const closedDateStr = bkkClosed.toISOString().split('T')[0];
      
      return closedDateStr === dateKey;
    });

    let totalPnlThb = 0;
    todayClosedTrades.forEach(trade => {
      if (trade.pnl_thb) {
        totalPnlThb += trade.pnl_thb;
      }
    });

    const totalLossThb = totalPnlThb < 0 ? -totalPnlThb : 0;

    if (totalLossThb >= limit) {
      setDailyLossLimitReached(true);
      localStorage.setItem(pauseKey, 'true');
      
      const notifyKey = `daily_loss_notified_${dateKey}`;
      if (settings.telegramEnabled && localStorage.getItem(notifyKey) !== 'true') {
        localStorage.setItem(notifyKey, 'true');
        // Standard Telegram API trigger through context
        const token = secureGet('telegramToken') || settings.telegramToken || '';
        const chatId = secureGet('telegramChatId') || settings.telegramChatId || '';
        if (token && chatId) {
          const url = `https://api.telegram.org/bot${token}/sendMessage`;
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: `⛔ Daily loss limit of ${limit} THB reached. Bot paused.` })
          }).catch(e => console.error('Telegram notification error:', e));
        }
      }
    } else {
      setDailyLossLimitReached(false);
    }
  }, [tradeLogs, settings.dailyLossLimit, settings.telegramEnabled, isLoading, settings.telegramToken, settings.telegramChatId]);

  // Ask for notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  const triggerNotification = useCallback((title: string, body: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.ico' });
      }
    }
  }, []);

  // Fetch Exchange Rate (USD/THB)
  const fetchExchangeRate = useCallback(async () => {
    if (settings.useManualExchangeRate) {
      setExchangeRate(settings.manualExchangeRate);
      return;
    }
    try {
      const res = await secureFetch('/api/market/rate');
      if (!res) throw new Error('Failed to fetch exchange rate');
      const data = await res.json();
      const rate = data.rates?.THB;
      if (rate) {
        setExchangeRate(rate);
      }
    } catch (err) {
      console.error('Error fetching exchange rate, falling back to setting:', err);
      setExchangeRate(settings.manualExchangeRate);
    }
  }, [settings.useManualExchangeRate, settings.manualExchangeRate]);

  // Load Settings
  const loadSettings = useCallback(async () => {
    try {
      let loadedSettings: Partial<Settings> = {};

      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase
          .from('dashboard_settings')
          .select('key, value');
        
        if (!error && data && data.length > 0) {
          data.forEach((item) => {
            try {
              loadedSettings[item.key as keyof Settings] = JSON.parse(item.value);
            } catch {
              loadedSettings[item.key as keyof Settings] = item.value as any;
            }
          });
        }
      } else {
        // Local Storage fallback
        const local = localStorage.getItem('gold_trade_settings');
        if (local) {
          try {
            loadedSettings = JSON.parse(local);
          } catch (e) {
            console.error('Failed to parse local settings:', e);
          }
        }
      }

      // Merge and sanitize any legacy BTC settings to Gold
      const merged = { ...defaultSettings, ...loadedSettings };
      
      if (typeof merged.webhookExecutePath === 'string' && merged.webhookExecutePath.includes('btc')) {
        merged.webhookExecutePath = merged.webhookExecutePath.replace('btc', 'gold');
      }
      if (typeof merged.webhookClosePath === 'string' && merged.webhookClosePath.includes('btc')) {
        merged.webhookClosePath = merged.webhookClosePath.replace('btc', 'gold');
      }
      if (typeof merged.webhookStatusPath === 'string' && merged.webhookStatusPath.includes('btc')) {
        merged.webhookStatusPath = merged.webhookStatusPath.replace('btc', 'gold');
      }

      // Load sensitive configurations obfuscated
      merged.webhookSecret = secureGet('webhookSecret');
      merged.telegramToken = secureGet('telegramToken');
      merged.telegramChatId = secureGet('telegramChatId');

      setSettings(merged);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, []);

  // Update Settings
  const updateSettings = async (newSettings: Partial<Settings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    try {
      // ⚠️ SECURITY: Exclude sensitive credentials from plain-text gold_trade_settings storage
      const { webhookSecret, telegramToken, telegramChatId, ...plainSettings } = updated;
      localStorage.setItem('gold_trade_settings', JSON.stringify(plainSettings));

      if (webhookSecret !== undefined) {
        secureSet('webhookSecret', webhookSecret);
      }
      if (telegramToken !== undefined) {
        secureSet('telegramToken', telegramToken);
      }
      if (telegramChatId !== undefined) {
        secureSet('telegramChatId', telegramChatId);
      }

      if (isSupabaseConfigured && supabase) {
        const updates = Object.entries(newSettings).map(([key, val]) => ({
          key,
          value: JSON.stringify(val),
          updated_at: new Date().toISOString()
        }));

        for (const update of updates) {
          await supabase.from('dashboard_settings').upsert(update);
        }
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  // Bot Status initialization and updater
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('gold_bot_status');
      if (stored === 'paused') {
        setBotStatus('paused');
      } else {
        setBotStatus('active');
        localStorage.setItem('gold_bot_status', 'active');
      }
    }
  }, []);

  const updateBotStatus = async (status: 'active' | 'paused') => {
    setBotStatus(status);
    localStorage.setItem('gold_bot_status', status);

    if (!settings.isSimulatedMode) {
      try {
        await secureFetch(`${settings.n8nBaseUrl}/webhook/gold-bot-status`, {
          method: 'POST',
          body: JSON.stringify({ status }),
        });
      } catch (err) {
        console.error('Failed to notify status webhook:', err);
      }
    }
  };

  // Load Trade Logs & Active Position
  const refreshTradeLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      let logs: Trade[] = [];
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase
          .from('trades')
          .select('*')
          .order('opened_at', { ascending: false });

        if (!error && data) {
          logs = data.map((d: any) => ({
            id: d.id,
            timestamp: d.opened_at,
            opened_at: d.opened_at,
            closed_at: d.closed_at,
            symbol: d.symbol || 'PAXGUSDT',
            direction: d.direction,
            entry_price: Number(d.entry_price),
            sl_price: Number(d.sl_price),
            tp1_price: Number(d.tp1_price),
            tp2_price: Number(d.tp2_price),
            exit_price: d.exit_price ? Number(d.exit_price) : undefined,
            pnl_usdt: d.pnl_usdt ? Number(d.pnl_usdt) : undefined,
            pnl_thb: d.pnl_thb ? Number(d.pnl_thb) : undefined,
            status: d.status,
            tp1_hit: d.tp1_hit,
            tp2_hit: d.tp2_hit,
            sl_hit: d.sl_hit,
            position_size_usdt: Number(d.position_size_usdt),
            capital_thb: Number(d.capital_thb),
            result: d.pnl_usdt !== null ? (d.pnl_usdt > 0 ? 'WIN' : 'LOSS') : undefined,
            notes: d.notes,
          }));
        }
      } else {
        const local = localStorage.getItem('gold_trade_logs');
        if (local) {
          logs = JSON.parse(local);
        }
      }

      setTradeLogs(logs);
      
      // Active position is the latest one with state not CLOSED/SL_HIT/TP2_HIT or explicitly marked as OPEN
      const active = logs.find(log => log.status === 'OPEN' || log.status === 'TP1_HIT');
      if (active) {
        const configStr = localStorage.getItem('active_position_config');
        if (configStr) {
          try {
            const config = JSON.parse(configStr);
            Object.assign(active, config);
          } catch (e) {
            console.error('Failed to parse active position config:', e);
          }
        }
      }
      setActivePosition(active || null);
    } catch (err) {
      console.error('Failed to load trade logs:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveTradeLogs = async (updatedLogs: Trade[]) => {
    setTradeLogs(updatedLogs);
    localStorage.setItem('gold_trade_logs', JSON.stringify(updatedLogs));

    // If Supabase is set up, it is updated during execute/close/webhook,
    // but we write here as fallback or primary data store check.
  };

  // Reset Logs
  const resetAllLogs = async () => {
    try {
      if (isSupabaseConfigured && supabase) {
        await supabase.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }
      saveTradeLogs([]);
      setActivePosition(null);
    } catch (err) {
      console.error('Error resetting logs:', err);
    }
  };

  // Fetch Binance PAXG/USDT price and stats
  const fetchBinanceTicker = useCallback(async () => {
    const startTime = Date.now();
    try {
      const res = await secureFetch('/api/market/ticker');
      const endTime = Date.now();
      if (!res) throw new Error('Binance API response error');
      const data = await res.json();
      setGoldPrice(parseFloat(data.lastPrice));
      setPriceChange24h(parseFloat(data.priceChangePercent));
      setLastUpdatedTime(new Date());
      setConnectionStatus('CONNECTED');
      setLastPingTime(new Date());
      setLatency(endTime - startTime);
    } catch (err) {
      console.error('Failed to fetch Binance ticker:', err);
      setConnectionStatus('DISCONNECTED');
    }
  }, []);

  // Fetch Binance Candlestick Klines (50 of 1h candles for regime, slice 24 for chart)
  const fetchBinanceKlines = useCallback(async () => {
    try {
      const res = await secureFetch('/api/market/klines?limit=50');
      if (!res) throw new Error('Binance Klines API error');
      const data = await res.json();
      
      const formatted: KLine[] = data.map((item: any) => {
        // time is index 0 (ms), open 1, high 2, low 3, close 4
        const date = new Date(item[0]);
        return {
          time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          open: parseFloat(item[1]),
          high: parseFloat(item[2]),
          low: parseFloat(item[3]),
          close: parseFloat(item[4]),
        };
      });

      // Calculate Market Regime Indicators using 50 candles
      if (formatted.length >= 50) {
        const closes = formatted.map(k => k.close);
        const highs = formatted.map(k => k.high);
        const lows = formatted.map(k => k.low);
        const n = formatted.length;

        // 1. Calculate EMA-20 of closes
        const kCoeff = 2 / 21;
        const ema20List: number[] = [];
        let initialSum = 0;
        for (let i = 0; i < 20; i++) {
          initialSum += closes[i];
        }
        let currentEma = initialSum / 20;
        for (let i = 0; i < n; i++) {
          if (i < 19) {
            ema20List.push(0);
          } else if (i === 19) {
            ema20List.push(currentEma);
          } else {
            currentEma = closes[i] * kCoeff + currentEma * (1 - kCoeff);
            ema20List.push(currentEma);
          }
        }
        const ema20_current = ema20List[n - 1];

        // 2. Calculate TR (True Range)
        const tr: number[] = [];
        for (let i = 0; i < n; i++) {
          if (i === 0) {
            tr.push(highs[0] - lows[0]);
          } else {
            tr.push(Math.max(
              highs[i] - lows[i],
              Math.abs(highs[i] - closes[i - 1]),
              Math.abs(lows[i] - closes[i - 1])
            ));
          }
        }

        // 3. Calculate ATR-14 with Wilder's smoothing
        const atr: number[] = [];
        let trSum = 0;
        for (let i = 0; i < 14; i++) {
          trSum += tr[i];
        }
        let currentAtr = trSum / 14;
        for (let i = 0; i < n; i++) {
          if (i < 13) {
            atr.push(0);
          } else if (i === 13) {
            atr.push(currentAtr);
          } else {
            currentAtr = (currentAtr * 13 + tr[i]) / 14;
            atr.push(currentAtr);
          }
        }

        // 4. Calculate 20-period ATR average of ATR-14 (over last 20 periods)
        let atrSum = 0;
        for (let i = n - 20; i < n; i++) {
          atrSum += atr[i];
        }
        const atrAverage20 = atrSum / 20;
        const atrCurrent = atr[n - 1];

        // 5. Calculate +DM and -DM
        const plusDM: number[] = [];
        const minusDM: number[] = [];
        for (let i = 0; i < n; i++) {
          if (i === 0) {
            plusDM.push(0);
            minusDM.push(0);
          } else {
            const upMove = highs[i] - highs[i - 1];
            const downMove = lows[i - 1] - lows[i];
            plusDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
            minusDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
          }
        }

        // 6. Smoothed TR, +DM, -DM over 14 periods (Wilder's smoothing)
        const smoothedTR: number[] = [];
        const smoothedPlusDM: number[] = [];
        const smoothedMinusDM: number[] = [];

        let trSum14 = 0;
        let plusDmSum14 = 0;
        let minusDmSum14 = 0;
        for (let i = 0; i < 14; i++) {
          trSum14 += tr[i];
          plusDmSum14 += plusDM[i];
          minusDmSum14 += minusDM[i];
        }

        let curSmoothedTR = trSum14;
        let curSmoothedPlusDM = plusDmSum14;
        let curSmoothedMinusDM = minusDmSum14;

        for (let i = 0; i < n; i++) {
          if (i < 13) {
            smoothedTR.push(0);
            smoothedPlusDM.push(0);
            smoothedMinusDM.push(0);
          } else if (i === 13) {
            smoothedTR.push(curSmoothedTR);
            smoothedPlusDM.push(curSmoothedPlusDM);
            smoothedMinusDM.push(curSmoothedMinusDM);
          } else {
            curSmoothedTR = curSmoothedTR - (curSmoothedTR / 14) + tr[i];
            curSmoothedPlusDM = curSmoothedPlusDM - (curSmoothedPlusDM / 14) + plusDM[i];
            curSmoothedMinusDM = curSmoothedMinusDM - (curSmoothedMinusDM / 14) + minusDM[i];
            smoothedTR.push(curSmoothedTR);
            smoothedPlusDM.push(curSmoothedPlusDM);
            smoothedMinusDM.push(curSmoothedMinusDM);
          }
        }

        // 7. Calculate +DI, -DI, and DX
        const dx: number[] = [];
        for (let i = 0; i < n; i++) {
          if (i < 13) {
            dx.push(0);
          } else {
            const trS = smoothedTR[i];
            const plusS = smoothedPlusDM[i];
            const minusS = smoothedMinusDM[i];
            
            if (trS === 0) {
              dx.push(0);
            } else {
              const plusDI = 100 * (plusS / trS);
              const minusDI = 100 * (minusS / trS);
              const diff = Math.abs(plusDI - minusDI);
              const sumDI = plusDI + minusDI;
              dx.push(sumDI === 0 ? 0 : 100 * (diff / sumDI));
            }
          }
        }

        // 8. Calculate ADX-14 (Wilder's Smoothing of DX)
        const adx: number[] = [];
        let dxSum = 0;
        for (let i = 13; i < 27; i++) {
          dxSum += dx[i];
        }
        let currentAdx = dxSum / 14;
        for (let i = 0; i < n; i++) {
          if (i < 26) {
            adx.push(0);
          } else if (i === 26) {
            adx.push(currentAdx);
          } else {
            currentAdx = (currentAdx * 13 + dx[i]) / 14;
            adx.push(currentAdx);
          }
        }
        const adxCurrent = adx[n - 1];
        const price = closes[n - 1];

        // Regime Logic Rules
        if (atrCurrent > 2 * atrAverage20) {
          setRegimeData({
            status: 'HIGH_VOLATILITY',
            label: 'HIGH VOLATILITY',
            description: 'Extreme volatility detected. Expect large swings.',
            adx: adxCurrent,
            atr: atrCurrent
          });
        } else if (adxCurrent > 25 && price > ema20_current) {
          setRegimeData({
            status: 'TRENDING_UP',
            label: 'TRENDING UP',
            description: 'Strong upward momentum. Bullish trend active.',
            adx: adxCurrent,
            atr: atrCurrent
          });
        } else if (adxCurrent > 25 && price < ema20_current) {
          setRegimeData({
            status: 'TRENDING_DOWN',
            label: 'TRENDING DOWN',
            description: 'Strong downward momentum. Bearish trend active.',
            adx: adxCurrent,
            atr: atrCurrent
          });
        } else if (adxCurrent < 20) {
          setRegimeData({
            status: 'RANGING',
            label: 'RANGING / CHOPPY',
            description: 'Consolidation phase. Range-bound trading behavior.',
            adx: adxCurrent,
            atr: atrCurrent
          });
        } else {
          setRegimeData({
            status: 'NEUTRAL',
            label: 'NEUTRAL',
            description: 'Market regime is transitional or neutral.',
            adx: adxCurrent,
            atr: atrCurrent
          });
        }
      } else {
        setRegimeData({
          status: 'NEUTRAL',
          label: 'NEUTRAL',
          description: 'Insufficient candles to calculate indicators.',
          adx: 0,
          atr: 0
        });
      }

      // Slice the last 24 candles to populate klinesData state (maintaining AreaChart width)
      const sliced = formatted.slice(-24);
      setKlinesData(sliced);
      setLastUpdatedTime(new Date());
    } catch (err) {
      console.error('Failed to fetch Binance klines:', err);
    }
  }, []);

  // Fetch Fear & Greed Index (Alternative.me)
  const fetchFearAndGreed = useCallback(async () => {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=1');
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data[0]) {
          const item = json.data[0];
          setFngData({
            value: parseInt(item.value),
            classification: item.value_classification,
            timestamp: item.timestamp
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch Fear & Greed Index:', e);
    }
  }, []);

  // Heartbeat ping status check
  const pingStatus = useCallback(async () => {
    if (settings.isSimulatedMode) {
      setConnectionStatus('CONNECTED');
      setLastPingTime(new Date());
      setLatency(15);
      return;
    }
    const startTime = Date.now();
    try {
      const queryParams = new URLSearchParams({
        n8nBaseUrl: settings.n8nBaseUrl,
        webhookStatusPath: settings.webhookStatusPath,
      });
      const res = await secureFetch(`/api/trade/status?${queryParams.toString()}`);
      const endTime = Date.now();
      if (res) {
        setConnectionStatus('CONNECTED');
        setLastPingTime(new Date());
        setLatency(endTime - startTime);
      } else {
        setConnectionStatus('DISCONNECTED');
        setLatency(null);
      }
    } catch (e) {
      setConnectionStatus('DISCONNECTED');
      setLatency(null);
    }
  }, [settings.isSimulatedMode, settings.n8nBaseUrl, settings.webhookStatusPath]);

  // Update notes of a specific trade log
  const updateTradeNotes = async (id: string, notes: string) => {
    const updated = tradeLogs.map((log) => (log.id === id ? { ...log, notes } : log));
    await saveTradeLogs(updated);

    if (isSupabaseConfigured && supabase) {
      await supabase.from('trades').update({ notes }).eq('id', id);
    }
  };

  // Set up Polling Intervals
  useEffect(() => {
    const init = async () => {
      await loadSettings();
      await fetchExchangeRate();
      await fetchBinanceTicker();
      await fetchBinanceKlines();
      await fetchFearAndGreed();
      await pingStatus();
      setIsLoading(false);
    };
    init();

    // Poll ticker every 5 seconds
    const tickerInterval = setInterval(fetchBinanceTicker, 5000);
    // Poll klines every 5 minutes (same interval as chart data refresh)
    const klinesInterval = setInterval(fetchBinanceKlines, 300000);
    // Poll Fear & Greed every 15 minutes
    const fngInterval = setInterval(fetchFearAndGreed, 900000);
    // Refresh exchange rate every 10 minutes
    const rateInterval = setInterval(fetchExchangeRate, 600000);
    // Heartbeat status check every 30 seconds
    const heartbeatInterval = setInterval(pingStatus, 30000);

    return () => {
      clearInterval(tickerInterval);
      clearInterval(klinesInterval);
      clearInterval(fngInterval);
      clearInterval(rateInterval);
      clearInterval(heartbeatInterval);
    };
  }, [loadSettings, fetchExchangeRate, fetchBinanceTicker, fetchBinanceKlines, fetchFearAndGreed, pingStatus]);

  // Load trade logs once settings are loaded
  useEffect(() => {
    refreshTradeLogs();
  }, [refreshTradeLogs]);

  // Send Telegram message helper
  const sendTelegramNotification = useCallback(async (message: string) => {
    if (!settings.telegramEnabled || !settings.telegramToken || !settings.telegramChatId) {
      return;
    }
    try {
      const url = `https://api.telegram.org/bot${settings.telegramToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: message,
        }),
      });
    } catch (err) {
      console.error('Failed to send Telegram message:', err);
    }
  }, [settings.telegramEnabled, settings.telegramToken, settings.telegramChatId]);

  // Live Position monitor for Trailing Stop, Breakeven, Partial Close and Simulated Hits
  useEffect(() => {
    if (!activePosition || goldPrice === 0) return;

    const currentPrice = goldPrice;
    const isLong = activePosition.direction === 'LONG';
    let newSl = activePosition.sl_price;
    let slChanged = false;
    let updatedStatus: Trade['status'] = activePosition.status;
    let didTriggerSimClose = false;
    let triggerMsg = '';
    
    // 1. Trailing Stop Loss Logic
    if (activePosition.trailing_sl_enabled && activePosition.trailing_distance) {
      let distUsdt = activePosition.trailing_distance;
      if (activePosition.trailing_distance_type === 'pct') {
        distUsdt = activePosition.entry_price * (activePosition.trailing_distance / 100);
      }
      
      const calculatedSl = isLong ? currentPrice - distUsdt : currentPrice + distUsdt;
      if (isLong) {
        if (calculatedSl > newSl) {
          newSl = parseFloat(calculatedSl.toFixed(2));
          slChanged = true;
        }
      } else {
        if (calculatedSl < newSl) {
          newSl = parseFloat(calculatedSl.toFixed(2));
          slChanged = true;
        }
      }
    }

    // 2. Auto Breakeven at TP1 Logic
    const bkKey = `breakeven_triggered_${activePosition.id}`;
    let bkTriggered = localStorage.getItem(bkKey) === 'true' || !!activePosition.breakeven_active;
    const hitTp1 = isLong ? currentPrice >= activePosition.tp1_price : currentPrice <= activePosition.tp1_price;
    
    if (activePosition.auto_breakeven_enabled && hitTp1 && !bkTriggered) {
      localStorage.setItem(bkKey, 'true');
      bkTriggered = true;
      newSl = activePosition.entry_price;
      slChanged = true;
      activePosition.breakeven_active = true;
      
      triggerNotification('Breakeven Active', `✅ SL moved to Breakeven (Entry: $${activePosition.entry_price})`);
      
      if (settings.telegramEnabled) {
        sendTelegramNotification(`🛡️ Auto Breakeven Active for Trade #${activePosition.id}. SL moved to Entry: $${activePosition.entry_price}`);
      }
    }

    // 3. Partial Close at TP1 Logic
    const pcKey = `partial_close_triggered_${activePosition.id}`;
    let pcTriggered = localStorage.getItem(pcKey) === 'true' || !!activePosition.tp1_hit;
    
    if (activePosition.partial_close_enabled && hitTp1 && !pcTriggered) {
      localStorage.setItem(pcKey, 'true');
      pcTriggered = true;
      activePosition.tp1_hit = true;
      updatedStatus = 'TP1_HIT';
      
      const closePct = activePosition.partial_close_pct || 50;
      const closedAmount = (activePosition.position_size_usdt * (closePct / 100)).toFixed(2);
      
      // Update position size locally
      activePosition.position_size_usdt = parseFloat((activePosition.position_size_usdt * ((100 - closePct) / 100)).toFixed(2));
      activePosition.status = 'TP1_HIT';
      
      triggerNotification('Partial Close executed', `📤 Closed ${closePct}% at TP1 (+$${closedAmount} USDT)`);
      
      if (settings.telegramEnabled) {
        sendTelegramNotification(`📤 Partial Close executed for Trade #${activePosition.id}: Closed ${closePct}% at TP1 (+$${closedAmount} USDT). Remaining position: ${100 - closePct}%`);
      }

      // POST to /api/trade/partial-close proxy
      if (!settings.isSimulatedMode) {
        secureFetch('/api/trade/partial-close', {
          method: 'POST',
          body: JSON.stringify({
            trade_id: activePosition.id,
            close_percent: closePct,
            reason: 'TP1_PARTIAL',
            settings
          })
        });
      }
    }

    // 4. Simulated Close Triggers (SL or TP2)
    if (settings.isSimulatedMode) {
      if (isLong ? currentPrice <= newSl : currentPrice >= newSl) {
        updatedStatus = 'SL_HIT';
        didTriggerSimClose = true;
        triggerMsg = `Stop Loss Hit at ${currentPrice} USDT!`;
      } else if (isLong ? currentPrice >= activePosition.tp2_price : currentPrice <= activePosition.tp2_price) {
        updatedStatus = 'TP2_HIT';
        didTriggerSimClose = true;
        triggerMsg = `Take Profit 2 Hit at ${currentPrice} USDT! Position complete.`;
      }
    }

    // Handle SL change (Trailing stop update or Breakeven trigger)
    if (slChanged && newSl !== activePosition.sl_price && !didTriggerSimClose) {
      activePosition.sl_price = newSl;
      
      if (!settings.isSimulatedMode) {
        secureFetch('/api/trade/update-sl', {
          method: 'POST',
          body: JSON.stringify({
            trade_id: activePosition.id,
            new_sl: newSl,
            reason: bkTriggered && newSl === activePosition.entry_price ? 'AUTO_BREAKEVEN' : 'TRAILING_SL',
            settings
          })
        });
      }

      const updatedTrade = { ...activePosition, sl_price: newSl, status: updatedStatus };
      const updatedLogs = tradeLogs.map((log) => (log.id === activePosition.id ? updatedTrade : log));
      saveTradeLogs(updatedLogs);
      setActivePosition(updatedTrade);

      if (isSupabaseConfigured && supabase) {
        supabase
          .from('trades')
          .update({
            sl_price: newSl,
            status: updatedTrade.status,
            tp1_hit: updatedTrade.tp1_hit,
            position_size_usdt: updatedTrade.position_size_usdt
          })
          .eq('id', activePosition.id);
      }
    } else if (didTriggerSimClose && settings.isSimulatedMode) {
      // Execute simulated closure
      triggerNotification('Trade Signal Alert', triggerMsg);
      
      const exitPrice = currentPrice;
      const diffPercent = (exitPrice - activePosition.entry_price) / activePosition.entry_price;
      const rawPnL = activePosition.position_size_usdt * diffPercent;
      const pnlUsdt = isLong ? rawPnL : -rawPnL;
      const pnlThb = pnlUsdt * exchangeRate;
      const result = pnlUsdt > 0 ? 'WIN' : 'LOSS';

      const closedTrade: Trade = {
        ...activePosition,
        status: 'CLOSED',
        tp1_hit: activePosition.tp1_hit || updatedStatus === 'TP1_HIT',
        tp2_hit: activePosition.tp2_hit || updatedStatus === 'TP2_HIT',
        sl_hit: activePosition.sl_hit || updatedStatus === 'SL_HIT',
        exit_price: exitPrice,
        pnl_usdt: pnlUsdt,
        pnl_thb: pnlThb,
        result: result,
        closed_at: new Date().toISOString(),
      };

      const updatedLogs = tradeLogs.map((log) => (log.id === activePosition.id ? closedTrade : log));
      saveTradeLogs(updatedLogs);
      setActivePosition(null);

      if (isSupabaseConfigured && supabase) {
        supabase
          .from('trades')
          .update({
            status: closedTrade.status,
            tp1_hit: closedTrade.tp1_hit,
            tp2_hit: closedTrade.tp2_hit,
            sl_hit: closedTrade.sl_hit,
            exit_price: closedTrade.exit_price,
            pnl_usdt: closedTrade.pnl_usdt,
            pnl_thb: closedTrade.pnl_thb,
            closed_at: closedTrade.closed_at,
          })
          .eq('id', activePosition.id);
      }
    } else if (updatedStatus !== activePosition.status) {
      // Just status changed (e.g. TP1 Hit)
      const updatedTrade = { ...activePosition, status: updatedStatus };
      const updatedLogs = tradeLogs.map((log) => (log.id === activePosition.id ? updatedTrade : log));
      saveTradeLogs(updatedLogs);
      setActivePosition(updatedTrade);

      if (isSupabaseConfigured && supabase) {
        supabase
          .from('trades')
          .update({
            status: updatedStatus,
            tp1_hit: updatedTrade.tp1_hit,
            position_size_usdt: updatedTrade.position_size_usdt
          })
          .eq('id', activePosition.id);
      }
    }
  }, [goldPrice, activePosition, settings, settings.isSimulatedMode, settings.telegramEnabled, tradeLogs, exchangeRate, triggerNotification, sendTelegramNotification]);

  // Execute Trade
  const executeTrade = async (params: {
    direction: 'LONG' | 'SHORT';
    entry_price: number;
    sl_price: number;
    tp1_price: number;
    tp2_price: number;
    position_size_usdt: number;
    capital_thb: number;
    trailing_sl_enabled?: boolean;
    trailing_distance_type?: 'pct' | 'price';
    trailing_distance?: number;
    auto_breakeven_enabled?: boolean;
    partial_close_enabled?: boolean;
    partial_close_pct?: number;
  }) => {
    if (activePosition) {
      return { success: false, message: 'An active position is already open.' };
    }

    const sl_percent = Math.abs(params.sl_price - params.entry_price) / params.entry_price * 100;
    const tp1_percent = Math.abs(params.tp1_price - params.entry_price) / params.entry_price * 100;
    const tp2_percent = Math.abs(params.tp2_price - params.entry_price) / params.entry_price * 100;

    const payload = {
      symbol: 'PAXGUSDT',
      direction: params.direction,
      entry_price: params.entry_price,
      sl_percent: parseFloat(sl_percent.toFixed(2)),
      tp1_percent: parseFloat(tp1_percent.toFixed(2)),
      tp2_percent: parseFloat(tp2_percent.toFixed(2)),
      position_size_usdt: params.position_size_usdt,
      capital_thb: params.capital_thb,
      timestamp: new Date().toISOString(),
      
      // Auto-trade parameters
      trailing_sl_enabled: params.trailing_sl_enabled,
      trailing_distance_type: params.trailing_distance_type,
      trailing_distance: params.trailing_distance,
      auto_breakeven_enabled: params.auto_breakeven_enabled,
      partial_close_enabled: params.partial_close_enabled,
      partial_close_pct: params.partial_close_pct,
    };

    if (settings.isSimulatedMode) {
      // Simulate execution in client browser
      const newTrade: Trade = {
        id: crypto.randomUUID(),
        timestamp: payload.timestamp,
        opened_at: payload.timestamp,
        symbol: payload.symbol,
        direction: params.direction,
        entry_price: params.entry_price,
        sl_price: params.sl_price,
        tp1_price: params.tp1_price,
        tp2_price: params.tp2_price,
        status: 'OPEN',
        tp1_hit: false,
        tp2_hit: false,
        sl_hit: false,
        position_size_usdt: params.position_size_usdt,
        capital_thb: params.capital_thb,
        trailing_sl_enabled: params.trailing_sl_enabled,
        trailing_distance_type: params.trailing_distance_type,
        trailing_distance: params.trailing_distance,
        auto_breakeven_enabled: params.auto_breakeven_enabled,
        partial_close_enabled: params.partial_close_enabled,
        partial_close_pct: params.partial_close_pct,
      };

      const updatedLogs = [newTrade, ...tradeLogs];
      await saveTradeLogs(updatedLogs);
      setActivePosition(newTrade);
      triggerNotification('Simulated Position Opened', `${params.direction} at ${params.entry_price} USDT`);

      // Persist to Supabase if configured
      if (isSupabaseConfigured && supabase) {
        await supabase.from('trades').insert([{
          id: newTrade.id,
          opened_at: newTrade.timestamp,
          symbol: newTrade.symbol,
          direction: newTrade.direction,
          entry_price: newTrade.entry_price,
          sl_price: newTrade.sl_price,
          tp1_price: newTrade.tp1_price,
          tp2_price: newTrade.tp2_price,
          status: newTrade.status,
          tp1_hit: newTrade.tp1_hit,
          tp2_hit: newTrade.tp2_hit,
          sl_hit: newTrade.sl_hit,
          position_size_usdt: newTrade.position_size_usdt,
          capital_thb: newTrade.capital_thb,
          notes: 'Simulated sandbox trade signal',
        }]);
      }

      return { success: true, message: 'Simulated trade opened successfully!' };
    }

    // Call live n8n webhook API through proxy
    try {
      const response = await secureFetch('/api/trade/execute', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          settings,
        }),
      });

      if (!response) {
        throw new Error('Server responded with an error or request timed out.');
      }

      const responseData = await response.json();
      
      // Retrieve trade record returned by n8n or create one
      const newTrade: Trade = {
        id: responseData.id || crypto.randomUUID(),
        timestamp: payload.timestamp,
        opened_at: payload.timestamp,
        symbol: payload.symbol,
        direction: params.direction,
        entry_price: params.entry_price,
        sl_price: params.sl_price,
        tp1_price: params.tp1_price,
        tp2_price: params.tp2_price,
        status: 'OPEN',
        tp1_hit: false,
        tp2_hit: false,
        sl_hit: false,
        position_size_usdt: params.position_size_usdt,
        capital_thb: params.capital_thb,
        trailing_sl_enabled: params.trailing_sl_enabled,
        trailing_distance_type: params.trailing_distance_type,
        trailing_distance: params.trailing_distance,
        auto_breakeven_enabled: params.auto_breakeven_enabled,
        partial_close_enabled: params.partial_close_enabled,
        partial_close_pct: params.partial_close_pct,
      };

      // Add to local state (Supabase will also be updated via n8n directly, but we write locally to be safe)
      const updatedLogs = [newTrade, ...tradeLogs];
      await saveTradeLogs(updatedLogs);
      setActivePosition(newTrade);
      
      // Save to Supabase
      if (isSupabaseConfigured && supabase) {
        await supabase.from('trades').insert([{
          id: newTrade.id,
          opened_at: newTrade.timestamp,
          symbol: newTrade.symbol,
          direction: newTrade.direction,
          entry_price: newTrade.entry_price,
          sl_price: newTrade.sl_price,
          tp1_price: newTrade.tp1_price,
          tp2_price: newTrade.tp2_price,
          status: newTrade.status,
          tp1_hit: newTrade.tp1_hit,
          tp2_hit: newTrade.tp2_hit,
          sl_hit: newTrade.sl_hit,
          position_size_usdt: newTrade.position_size_usdt,
          capital_thb: newTrade.capital_thb,
        }]);
      }

      triggerNotification('Position Opened via n8n', `${params.direction} order executed successfully!`);
      return { success: true, message: responseData.message || 'Trade executed successfully via n8n!' };
    } catch (err: any) {
      console.error('Error executing trade:', err);
      return { success: false, message: `Trade execution failed: ${err.message}` };
    }
  };



  // Close Active Position
  const closeActivePosition = async (reason: string = 'MANUAL_CLOSE') => {
    if (!activePosition) {
      return { success: false, message: 'No active position to close.' };
    }

    const currentPrice = goldPrice || activePosition.entry_price;
    const isLong = activePosition.direction === 'LONG';
    const diffPercent = (currentPrice - activePosition.entry_price) / activePosition.entry_price;
    const rawPnL = activePosition.position_size_usdt * diffPercent;
    const pnlUsdt = isLong ? rawPnL : -rawPnL;
    const pnlThb = pnlUsdt * exchangeRate;
    const result = pnlUsdt > 0 ? 'WIN' : 'LOSS';

    const payload = {
      action: 'CLOSE',
      symbol: 'PAXGUSDT',
      direction: activePosition.direction,
      entry_price: activePosition.entry_price,
      exit_price: currentPrice,
      pnl_usdt: pnlUsdt,
      pnl_thb: pnlThb,
      timestamp: new Date().toISOString(),
      trade_id: activePosition.id,
      reason,
    };

    if (settings.isSimulatedMode) {
      const closedTrade: Trade = {
        ...activePosition,
        status: 'CLOSED',
        exit_price: currentPrice,
        pnl_usdt: pnlUsdt,
        pnl_thb: pnlThb,
        result: result,
        closed_at: new Date().toISOString(),
      };

      const updatedLogs = tradeLogs.map((log) => (log.id === activePosition.id ? closedTrade : log));
      await saveTradeLogs(updatedLogs);
      setActivePosition(null);
      triggerNotification('Simulated Position Closed', `Closed at ${currentPrice} USDT (PnL: $${pnlUsdt.toFixed(2)})`);

      // Update Supabase if configured
      if (isSupabaseConfigured && supabase) {
        await supabase
          .from('trades')
          .update({
            status: 'CLOSED',
            exit_price: currentPrice,
            pnl_usdt: pnlUsdt,
            pnl_thb: pnlThb,
            closed_at: closedTrade.closed_at,
          })
          .eq('id', activePosition.id);
      }

      return { success: true, message: 'Simulated position closed successfully.' };
    }

    // Call live n8n webhook API
    try {
      const response = await secureFetch('/api/trade/close', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          settings,
        }),
      });

      if (!response) {
        throw new Error('Server responded with an error or request timed out.');
      }

      const responseData = await response.json();

      const closedTrade: Trade = {
        ...activePosition,
        status: 'CLOSED',
        exit_price: responseData.exit_price || currentPrice,
        pnl_usdt: responseData.pnl_usdt !== undefined ? responseData.pnl_usdt : pnlUsdt,
        pnl_thb: responseData.pnl_thb !== undefined ? responseData.pnl_thb : pnlThb,
        result: (responseData.pnl_usdt || pnlUsdt) > 0 ? 'WIN' : 'LOSS',
        closed_at: new Date().toISOString(),
      };

      const updatedLogs = tradeLogs.map((log) => (log.id === activePosition.id ? closedTrade : log));
      await saveTradeLogs(updatedLogs);
      setActivePosition(null);

      // Update Supabase
      if (isSupabaseConfigured && supabase) {
        await supabase
          .from('trades')
          .update({
            status: 'CLOSED',
            exit_price: closedTrade.exit_price,
            pnl_usdt: closedTrade.pnl_usdt,
            pnl_thb: closedTrade.pnl_thb,
            closed_at: closedTrade.closed_at,
          })
          .eq('id', activePosition.id);
      }

      triggerNotification('Position Closed via n8n', `Closed successfully at ${closedTrade.exit_price} USDT`);
      return { success: true, message: responseData.message || 'Position closed successfully via n8n!' };
    } catch (err: any) {
      console.error('Error closing trade:', err);
      return { success: false, message: `Failed to close position: ${err.message}` };
    }
  };

  // Poll n8n for position status in Live Mode (every 10 seconds)
  useEffect(() => {
    if (settings.isSimulatedMode) return;

    const pollStatus = async () => {
      try {
        const queryParams = new URLSearchParams({
          n8nBaseUrl: settings.n8nBaseUrl,
          webhookStatusPath: settings.webhookStatusPath,
        });
        
        const res = await secureFetch(`/api/trade/status?${queryParams.toString()}`);
        if (!res) throw new Error('Status polling request failed');
        
        const data = await res.json();
        
        if (data.has_position) {
          const parsedPosition: Trade = {
            id: data.id || activePosition?.id || 'live-active-position',
            timestamp: data.opened_at || new Date().toISOString(),
            symbol: data.symbol || 'PAXGUSDT',
            direction: data.direction || 'LONG',
            entry_price: Number(data.entry_price),
            sl_price: Number(data.sl_price),
            tp1_price: Number(data.tp1_price),
            tp2_price: Number(data.tp2_price),
            exit_price: data.exit_price ? Number(data.exit_price) : undefined,
            pnl_usdt: Number(data.pnl_usdt),
            pnl_thb: Number(data.pnl_thb),
            status: data.tp2_hit ? 'CLOSED' : data.tp1_hit ? 'TP1_HIT' : 'OPEN',
            tp1_hit: !!data.tp1_hit,
            tp2_hit: !!data.tp2_hit,
            sl_hit: !!data.sl_hit,
            position_size_usdt: Number(data.position_size_usdt),
            capital_thb: 10000,
          };
          
          setActivePosition(parsedPosition);
        } else {
          setActivePosition(null);
        }
      } catch (err) {
        console.error('Failed to poll active position status:', err);
      }
    };

    pollStatus(); // execute on mount
    const interval = setInterval(pollStatus, 10000); // poll every 10s
    return () => clearInterval(interval);
  }, [settings.isSimulatedMode, settings.n8nBaseUrl, settings.webhookStatusPath, activePosition?.id]);

  return (
    <TradeContext.Provider
      value={{
        goldPrice,
        priceChange24h,
        klinesData,
        exchangeRate,
        settings,
        tradeLogs,
        activePosition,
        isLoading,
        connectionStatus,
        lastPingTime,
        latency,
        lastUpdatedTime,
        dailyLossLimitReached,
        regimeData,
        fngData,
        botStatus,
        updateSettings,
        updateBotStatus,
        executeTrade,
        closeActivePosition,
        refreshTradeLogs,
        triggerNotification,
        resetAllLogs,
        pingStatus,
        updateTradeNotes,
      }}
    >
      {children}
    </TradeContext.Provider>
  );
};
