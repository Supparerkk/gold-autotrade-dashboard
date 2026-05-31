'use client';

import React, { useState, useEffect } from 'react';
import { useTrade, Settings } from '@/context/TradeContext';
import { Settings as SettingsIcon, Link2, Shield, Coins, AlertCircle, CheckCircle2, Terminal } from 'lucide-react';

export default function SettingsPanel() {
  const { settings, updateSettings, exchangeRate } = useTrade();
  
  // Local form state
  const [n8nUrl, setN8nUrl] = useState(settings.n8nBaseUrl);
  const [execPath, setExecPath] = useState(settings.webhookExecutePath);
  const [closePath, setClosePath] = useState(settings.webhookClosePath);
  const [statusPath, setStatusPath] = useState(settings.webhookStatusPath);
  
  const [useManualRate, setUseManualRate] = useState(settings.useManualExchangeRate);
  const [manualRate, setManualRate] = useState(settings.manualExchangeRate.toString());
  
  const [isSimulated, setIsSimulated] = useState(settings.isSimulatedMode);
  
  // API credentials configuration state checked from server
  const [binanceStatus, setBinanceStatus] = useState<{ configured: boolean; keyPresent: boolean; secretPresent: boolean }>({
    configured: false,
    keyPresent: false,
    secretPresent: false,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setSaveStatus(null);

    try {
      const queryParams = new URLSearchParams({
        n8nBaseUrl: n8nUrl.trim().replace(/\/$/, ''),
      });

      const res = await fetch(`/api/trade/health?${queryParams.toString()}`);
      if (!res.ok) throw new Error('Health check request failed');
      const data = await res.json();
      
      if (data.success) {
        setTestResult({ success: true, message: data.message || 'Connection successful ✓' });
      } else {
        setTestResult({ success: false, message: data.message || 'Connection failed' });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `Failed to connect: ${err.message}` });
    } finally {
      setIsTesting(false);
    }
  };

  // Load API credentials configuration status from server API on mount
  useEffect(() => {
    const checkCredentials = async () => {
      try {
        const res = await fetch('/api/trade/status');
        // If the API status endpoint returns a schema, we check credentials
        if (res.ok) {
          const data = await res.json();
          setBinanceStatus({
            configured: data.credentialsConfigured || false,
            keyPresent: data.keyPresent || false,
            secretPresent: data.secretPresent || false,
          });
        }
      } catch (err) {
        console.error('Failed to check credentials status:', err);
      }
    };
    checkCredentials();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus(null);

    try {
      const parsedRate = parseFloat(manualRate);
      if (useManualRate && (isNaN(parsedRate) || parsedRate <= 0)) {
        throw new Error('Please enter a valid positive exchange rate.');
      }

      await updateSettings({
        n8nBaseUrl: n8nUrl.trim().replace(/\/$/, ''), // remove trailing slash
        webhookExecutePath: execPath.trim(),
        webhookClosePath: closePath.trim(),
        webhookStatusPath: statusPath.trim(),
        useManualExchangeRate: useManualRate,
        manualExchangeRate: isNaN(parsedRate) ? settings.manualExchangeRate : parsedRate,
        isSimulatedMode: isSimulated,
      });

      setSaveStatus({ type: 'success', message: 'Settings saved successfully!' });
      
      // Auto-clear success message after 3 seconds
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setSaveStatus({ type: 'error', message: err.message || 'Failed to save settings.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-950/60 to-slate-900/60 p-6 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-slate-700/80">
      <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2 mb-6 border-b border-slate-800 pb-4">
        <SettingsIcon className="h-5 w-5 text-cyan-400" />
        n8n & Broker Core Settings
      </h3>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Simulation Toggle */}
        <div className="rounded-xl border border-dashed border-cyan-800/50 bg-cyan-950/10 p-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider block">Simulated Sandbox Mode</span>
              <p className="text-xs text-slate-400 mt-1 max-w-md">
                When enabled, trades are executed inside the browser storage without making calls to n8n or executing orders on the exchange. **Recommended for offline testing and sandbox verification.**
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={isSimulated}
                onChange={(e) => setIsSimulated(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:bg-slate-950" />
            </label>
          </div>
        </div>

        {/* n8n configuration section */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-slate-400" />
            n8n Webhook Settings
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">n8n Base URL</label>
              <input
                type="text"
                value={n8nUrl}
                onChange={(e) => setN8nUrl(e.target.value)}
                disabled={isSimulated}
                placeholder="http://localhost:5678"
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
              <span className="text-[10px] text-slate-500 block mt-1">Enter your n8n workspace or instance URL.</span>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">Execute Trade Webhook Path</label>
              <input
                type="text"
                value={execPath}
                onChange={(e) => setExecPath(e.target.value)}
                disabled={isSimulated}
                placeholder="/webhook/gold-trade-execute"
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">Close Trade Webhook Path</label>
              <input
                type="text"
                value={execPath ? closePath : ''}
                onChange={(e) => setClosePath(e.target.value)}
                disabled={isSimulated}
                placeholder="/webhook/gold-trade-close"
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">Fetch Position Webhook Path</label>
              <input
                type="text"
                value={statusPath}
                onChange={(e) => setStatusPath(e.target.value)}
                disabled={isSimulated}
                placeholder="/webhook/gold-position-status"
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Currency Override */}
        <div className="space-y-4 pt-2 border-t border-slate-900">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <Coins className="h-4 w-4 text-slate-400" />
            Exchange Rate Settings
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-950/20">
              <div>
                <span className="text-xs font-semibold text-slate-300 block">Manual Exchange Rate Override</span>
                <span className="text-[10px] text-slate-500 mt-0.5">Use custom rate instead of automated fetching.</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useManualRate}
                  onChange={(e) => setUseManualRate(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500" />
              </label>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-semibold block mb-1">THB per 1 USDT</label>
              <input
                type="number"
                step="0.01"
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
                disabled={!useManualRate}
                className="h-10 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-30"
              />
            </div>
          </div>
          
          <div className="text-xs text-slate-500">
            Current dynamic USD/THB exchange rate: <span className="font-semibold text-slate-300">{exchangeRate.toFixed(2)} THB</span>.
          </div>
        </div>

        {/* Exchange credentials environment indicator */}
        <div className="space-y-4 pt-4 border-t border-slate-900">
          <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-slate-400" />
            Exchange Security status (Server environment)
          </h4>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold">API Key:</span>
              {binanceStatus.keyPresent ? (
                <span className="flex items-center gap-1 text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  <CheckCircle2 className="h-3 w-3" /> SET IN ENV
                </span>
              ) : (
                <span className="flex items-center gap-1 text-slate-500 font-semibold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  MISSING
                </span>
              )}
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold">API Secret:</span>
              {binanceStatus.secretPresent ? (
                <span className="flex items-center gap-1 text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  <CheckCircle2 className="h-3 w-3" /> SET IN ENV
                </span>
              ) : (
                <span className="flex items-center gap-1 text-slate-500 font-semibold bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  MISSING
                </span>
              )}
            </div>
            
            <div className="flex gap-2 text-[11px] text-slate-500 items-start border-t border-slate-900 pt-2.5 mt-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-cyan-500" />
              <span>
                To execute live orders on the exchange, define `BINANCE_API_KEY` and `BINANCE_API_SECRET` in your `.env.local` file. They are masked and handled strictly on the server layer.
              </span>
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center justify-between border-t border-slate-900 pt-4">
          <div>
            {saveStatus && (
              <span className={`text-xs font-semibold flex items-center gap-1.5 ${
                saveStatus.type === 'success' ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {saveStatus.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {saveStatus.message}
              </span>
            )}
            {testResult && (
              <span className={`text-xs font-semibold flex items-center gap-1.5 ${
                testResult.success ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {testResult.message}
              </span>
            )}
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || isSimulated}
              className="flex h-10 items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 px-5 font-bold text-slate-200 border border-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="flex h-10 items-center justify-center rounded-xl bg-cyan-500 hover:bg-cyan-400 px-6 font-bold text-slate-950 transition-colors cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
