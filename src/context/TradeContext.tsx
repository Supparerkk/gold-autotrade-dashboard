'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

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
}

export interface KLine {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
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
  updateSettings: (newSettings: Partial<Settings>) => Promise<void>;
  executeTrade: (tradeParams: {
    direction: 'LONG' | 'SHORT';
    entry_price: number;
    sl_price: number;
    tp1_price: number;
    tp2_price: number;
    position_size_usdt: number;
    capital_thb: number;
  }) => Promise<{ success: boolean; message: string }>;
  closeActivePosition: () => Promise<{ success: boolean; message: string }>;
  refreshTradeLogs: () => Promise<void>;
  triggerNotification: (title: string, body: string) => void;
  resetAllLogs: () => Promise<void>;
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
};

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
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!res.ok) throw new Error('Failed to fetch exchange rate');
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
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase
          .from('dashboard_settings')
          .select('key, value');
        
        if (!error && data && data.length > 0) {
          const loaded: Partial<Settings> = {};
          data.forEach((item) => {
            try {
              loaded[item.key as keyof Settings] = JSON.parse(item.value);
            } catch {
              loaded[item.key as keyof Settings] = item.value as any;
            }
          });
          setSettings((prev) => ({ ...prev, ...loaded }));
          return;
        }
      }

      // Local Storage fallback
      const local = localStorage.getItem('gold_trade_settings');
      if (local) {
        setSettings(JSON.parse(local));
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }, []);

  // Update Settings
  const updateSettings = async (newSettings: Partial<Settings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    try {
      localStorage.setItem('gold_trade_settings', JSON.stringify(updated));

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
            symbol: d.symbol || 'BTCUSDT',
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
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
      if (!res.ok) throw new Error('Binance API response error');
      const data = await res.json();
      setGoldPrice(parseFloat(data.lastPrice));
      setPriceChange24h(parseFloat(data.priceChangePercent));
    } catch (err) {
      console.error('Failed to fetch Binance ticker:', err);
    }
  }, []);

  // Fetch Binance Candlestick Klines (24h of 1h candles)
  const fetchBinanceKlines = useCallback(async () => {
    try {
      const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24');
      if (!res.ok) throw new Error('Binance Klines API error');
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
      setKlinesData(formatted);
    } catch (err) {
      console.error('Failed to fetch Binance klines:', err);
    }
  }, []);

  // Set up Polling Intervals
  useEffect(() => {
    const init = async () => {
      await loadSettings();
      await fetchExchangeRate();
      await fetchBinanceTicker();
      await fetchBinanceKlines();
      setIsLoading(false);
    };
    init();

    // Poll ticker every 5 seconds
    const tickerInterval = setInterval(fetchBinanceTicker, 5000);
    // Poll klines every 1 minute
    const klinesInterval = setInterval(fetchBinanceKlines, 60000);
    // Refresh exchange rate every 10 minutes
    const rateInterval = setInterval(fetchExchangeRate, 600000);

    return () => {
      clearInterval(tickerInterval);
      clearInterval(klinesInterval);
      clearInterval(rateInterval);
    };
  }, [loadSettings, fetchExchangeRate, fetchBinanceTicker, fetchBinanceKlines]);

  // Load trade logs once settings are loaded
  useEffect(() => {
    refreshTradeLogs();
  }, [refreshTradeLogs]);

  // Live Position monitor for simulated mode SL/TP triggers
  useEffect(() => {
    if (!settings.isSimulatedMode || !activePosition || goldPrice === 0) return;

    const currentPrice = goldPrice;
    const isLong = activePosition.direction === 'LONG';
    let updatedStatus: Trade['status'] = activePosition.status;
    let didTrigger = false;
    let triggerMsg = '';

    // Check Stop Loss
    if (isLong ? currentPrice <= activePosition.sl_price : currentPrice >= activePosition.sl_price) {
      updatedStatus = 'SL_HIT';
      didTrigger = true;
      triggerMsg = `Stop Loss Hit at ${currentPrice} USDT!`;
    } 
    // Check Take Profit 2 (Close position entirely)
    else if (isLong ? currentPrice >= activePosition.tp2_price : currentPrice <= activePosition.tp2_price) {
      updatedStatus = 'TP2_HIT';
      didTrigger = true;
      triggerMsg = `Take Profit 2 Hit at ${currentPrice} USDT! Position complete.`;
    }
    // Check Take Profit 1 (Partial exits)
    else if (activePosition.status === 'OPEN' && (isLong ? currentPrice >= activePosition.tp1_price : currentPrice <= activePosition.tp1_price)) {
      updatedStatus = 'TP1_HIT';
      didTrigger = true;
      triggerMsg = `Take Profit 1 Hit at ${currentPrice} USDT! 50% partial exit secured.`;
    }

    if (didTrigger) {
      triggerNotification('Trade Signal Alert', triggerMsg);

      const isExit = updatedStatus === 'SL_HIT' || updatedStatus === 'TP2_HIT';
      const exitPrice = isExit ? currentPrice : undefined;

      let pnlUsdt = 0;
      let pnlThb = 0;
      let result: Trade['result'] = undefined;

      if (isExit) {
        // Calculate dynamic PnL
        const diffPercent = (currentPrice - activePosition.entry_price) / activePosition.entry_price;
        const rawPnL = activePosition.position_size_usdt * diffPercent;
        pnlUsdt = isLong ? rawPnL : -rawPnL;
        pnlThb = pnlUsdt * exchangeRate;
        result = pnlUsdt > 0 ? 'WIN' : 'LOSS';
      }

      const updatedTrade: Trade = {
        ...activePosition,
        status: isExit ? 'CLOSED' : updatedStatus,
        tp1_hit: activePosition.tp1_hit || updatedStatus === 'TP1_HIT',
        tp2_hit: activePosition.tp2_hit || updatedStatus === 'TP2_HIT',
        sl_hit: activePosition.sl_hit || updatedStatus === 'SL_HIT',
        exit_price: exitPrice || activePosition.exit_price,
        pnl_usdt: isExit ? pnlUsdt : activePosition.pnl_usdt,
        pnl_thb: isExit ? pnlThb : activePosition.pnl_thb,
        result: result || activePosition.result,
        closed_at: isExit ? new Date().toISOString() : activePosition.closed_at,
      };

      const updatedLogs = tradeLogs.map((log) => (log.id === activePosition.id ? updatedTrade : log));
      saveTradeLogs(updatedLogs);
      
      // Update Supabase if configured
      if (isSupabaseConfigured && supabase) {
        supabase
          .from('trades')
          .update({
            status: updatedTrade.status,
            tp1_hit: updatedTrade.tp1_hit,
            tp2_hit: updatedTrade.tp2_hit,
            sl_hit: updatedTrade.sl_hit,
            exit_price: updatedTrade.exit_price || null,
            pnl_usdt: updatedTrade.pnl_usdt || null,
            pnl_thb: updatedTrade.pnl_thb || null,
            closed_at: updatedTrade.closed_at || null,
          })
          .eq('id', activePosition.id)
          .then(({ error }) => {
            if (error) console.error('Error updating trade auto-close in Supabase:', error);
          });
      }
      
      if (isExit) {
        setActivePosition(null);
      } else {
        setActivePosition(updatedTrade);
      }
    }
  }, [goldPrice, activePosition, settings.isSimulatedMode, tradeLogs, exchangeRate, triggerNotification]);

  // Execute Trade
  const executeTrade = async (params: {
    direction: 'LONG' | 'SHORT';
    entry_price: number;
    sl_price: number;
    tp1_price: number;
    tp2_price: number;
    position_size_usdt: number;
    capital_thb: number;
  }) => {
    if (activePosition) {
      return { success: false, message: 'An active position is already open.' };
    }

    const sl_percent = Math.abs(params.sl_price - params.entry_price) / params.entry_price * 100;
    const tp1_percent = Math.abs(params.tp1_price - params.entry_price) / params.entry_price * 100;
    const tp2_percent = Math.abs(params.tp2_price - params.entry_price) / params.entry_price * 100;

    const payload = {
      symbol: 'BTCUSDT',
      direction: params.direction,
      entry_price: params.entry_price,
      sl_percent: parseFloat(sl_percent.toFixed(2)),
      tp1_percent: parseFloat(tp1_percent.toFixed(2)),
      tp2_percent: parseFloat(tp2_percent.toFixed(2)),
      position_size_usdt: params.position_size_usdt,
      capital_thb: params.capital_thb,
      timestamp: new Date().toISOString(),
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
      const response = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          settings, // pass current settings to proxy server
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Server responded with an error');
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
  const closeActivePosition = async () => {
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
      symbol: 'BTCUSDT',
      direction: activePosition.direction,
      entry_price: activePosition.entry_price,
      exit_price: currentPrice,
      pnl_usdt: pnlUsdt,
      pnl_thb: pnlThb,
      timestamp: new Date().toISOString(),
      trade_id: activePosition.id,
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
      const response = await fetch('/api/trade/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          settings,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Server responded with an error');
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
        
        const res = await fetch(`/api/trade/status?${queryParams.toString()}`);
        if (!res.ok) throw new Error('Status polling request failed');
        
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
        updateSettings,
        executeTrade,
        closeActivePosition,
        refreshTradeLogs,
        triggerNotification,
        resetAllLogs,
      }}
    >
      {children}
    </TradeContext.Provider>
  );
};
