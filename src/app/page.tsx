'use client';

import React, { useState, useEffect } from 'react';
import { TradeProvider, useTrade } from '@/context/TradeContext';
import MarketOverview from '@/components/MarketOverview';
import ActivePosition from '@/components/ActivePosition';
import TradingControlPanel from '@/components/TradingControlPanel';
import RiskMetrics from '@/components/RiskMetrics';
import PerformanceSummary from '@/components/PerformanceSummary';
import TradeHistoryLog from '@/components/TradeHistoryLog';
import SettingsPanel from '@/components/SettingsPanel';
import { Bot, LineChart, History, Settings, Cpu, ShieldCheck } from 'lucide-react';

function DashboardContent() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'settings'>('dashboard');
  const { settings, exchangeRate, connectionStatus, lastPingTime, latency, pingStatus } = useTrade();
  const [pingAge, setPingAge] = useState<string>('Never');

  useEffect(() => {
    const updatePingAge = () => {
      if (!lastPingTime) {
        setPingAge('Never');
        return;
      }
      const secs = Math.round((Date.now() - new Date(lastPingTime).getTime()) / 1000);
      if (secs < 60) {
        setPingAge(`${secs}s ago`);
      } else {
        setPingAge(`${Math.floor(secs / 60)}m ago`);
      }
    };
    updatePingAge();
    const interval = setInterval(updatePingAge, 1000);
    return () => clearInterval(interval);
  }, [lastPingTime]);

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Background gradients */}
      <div className="absolute top-0 left-1/4 h-[500px] w-[500px] rounded-full bg-cyan-950/20 blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 h-[400px] w-[400px] rounded-full bg-indigo-950/20 blur-[100px] pointer-events-none" />

      {/* Header Layout */}
      <header className="sticky top-0 z-40 border-b border-slate-900/80 bg-slate-950/70 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 p-2 shadow-lg shadow-cyan-950/30">
              <Bot className="h-5 w-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-md font-black tracking-wider uppercase text-white">Gold AutoTrader</h1>
              <p className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase">PAXG/USDT Spot</p>
            </div>
          </div>

          {/* Center Navigation Tabs */}
          <nav className="flex items-center gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-slate-800/40">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                activeTab === 'dashboard'
                  ? 'bg-slate-800 text-cyan-400 shadow-md shadow-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LineChart className="h-3.5 w-3.5" />
              Monitor
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                activeTab === 'history'
                  ? 'bg-slate-800 text-cyan-400 shadow-md shadow-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              Ledger Logs
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 ${
                activeTab === 'settings'
                  ? 'bg-slate-800 text-cyan-400 shadow-md shadow-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </button>
          </nav>

          {/* Right Status Panel */}
          <div className="hidden sm:flex items-center gap-4">
            <div className="text-right">
              <span className="text-[9px] text-slate-500 font-bold block uppercase tracking-wider">USD/THB RATE</span>
              <span className="text-xs font-bold text-slate-300">{exchangeRate.toFixed(2)} THB</span>
            </div>
            
            <div className="relative group cursor-pointer animate-in fade-in duration-300" onClick={() => pingStatus()}>
              <div className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all duration-300 ${
                connectionStatus === 'CONNECTED'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : connectionStatus === 'DELAYED'
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}>
                {/* Pulsing indicator dot */}
                <span className="relative flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    connectionStatus === 'CONNECTED'
                      ? 'animate-ping bg-emerald-400'
                      : connectionStatus === 'DELAYED'
                      ? 'animate-ping bg-amber-400'
                      : 'bg-rose-400'
                  }`}></span>
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${
                    connectionStatus === 'CONNECTED'
                      ? 'bg-emerald-500'
                      : connectionStatus === 'DELAYED'
                      ? 'bg-amber-500'
                      : 'bg-rose-500'
                  }`}></span>
                </span>
                
                {settings.isSimulatedMode ? (
                  <span>SANDBOX MOCK</span>
                ) : (
                  <span>{connectionStatus}</span>
                )}
              </div>

              {/* Custom Tooltip */}
              <div className="absolute top-full right-0 mt-2 hidden group-hover:block bg-slate-950 border border-slate-800 text-[10px] text-slate-400 p-2.5 rounded-lg shadow-xl z-50 whitespace-nowrap leading-relaxed pointer-events-none animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="space-y-1">
                  <p className="flex justify-between gap-4">Last successful ping: <span className="text-slate-200 font-bold">{pingAge}</span></p>
                  <p className="flex justify-between gap-4">Latency: <span className="text-slate-200 font-bold">{latency !== null ? `${latency}ms` : '—'}</span></p>
                  <p className="flex justify-between gap-4">Endpoint: <span className="text-slate-200 font-bold">{settings.n8nBaseUrl ? (settings.n8nBaseUrl.length > 30 ? `${settings.n8nBaseUrl.slice(0, 27)}...` : settings.n8nBaseUrl) : '—'}</span></p>
                  <p className="text-[8px] text-slate-500 italic mt-1 border-t border-slate-900 pt-1 text-center">Click badge to manual ping</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column (8 cols): Market statistics, active trade, risk */}
            <div className="lg:col-span-7 space-y-8">
              <MarketOverview />
              <ActivePosition />
              <RiskMetrics />
            </div>

            {/* Right Column (5 cols): Trading controls */}
            <div className="lg:col-span-5">
              <TradingControlPanel />
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-8">
            <PerformanceSummary />
            <TradeHistoryLog />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-3xl mx-auto">
            <SettingsPanel />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-slate-900/60 py-6 text-center text-xs text-slate-600">
        <p>© 2026 Gold Auto Trading Dashboard. Built securely with Next.js 15, TypeScript & Tailwind.</p>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <TradeProvider>
      <DashboardContent />
    </TradeProvider>
  );
}
