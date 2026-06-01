/* 
  File: app.js
  Description: JavaScript implementation for Gold AutoTrader Dashboard.
  Handles live prices, n8n webhooks, UI tab switching, active positions, confirm modals,
  Telegram alert configurations, and localStorage settings.
*/

// =====================================================
// ===== SECURITY & UTILS =====
// =====================================================

/**
 * Base64 obfuscates a string value and saves it to local storage.
 */
function secureSet(key, value) {
  try {
    const obfuscated = btoa(encodeURIComponent(value));
    localStorage.setItem(key, obfuscated);
  } catch (e) {
    console.error('Failed to obfuscate and save token:', e);
  }
}

/**
 * Loads a value from local storage and decodes it from Base64.
 */
function secureGet(key) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return '';
    return decodeURIComponent(atob(value));
  } catch (e) {
    console.error('Failed to decode saved token:', e);
    return '';
  }
}

/**
 * Strips HTML/script tags and escapes characters to prevent XSS.
 */
function sanitize(input) {
  if (typeof input !== 'string') return '';
  let clean = input.replace(/<[^>]*>/g, '');
  clean = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
  return clean.trim();
}

/**
 * Helper to show toast messages.
 */
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === 'success' ? 'fa-circle-check text-green' : 'fa-circle-exclamation text-red'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  
  // Animate slide-in
  setTimeout(() => toast.classList.add('visible'), 50);
  
  // Fade out and remove
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// =====================================================
// ===== DEFAULT CONFIGS & STATE =====
// =====================================================

const CAPITAL_THB = 10000;

const defaultSettings = {
  n8nBaseUrl: 'https://n8n.goldautotrader.cloud',
  webhookExecutePath: '/webhook/gold-trade-execute',
  webhookClosePath: '/webhook/gold-trade-close',
  webhookStatusPath: '/webhook/gold-position-status',
  telegramEnabled: false,
  manualExchangeRate: 36.5,
  useManualExchangeRate: false,
  isSimulatedMode: false,
  alertTradeOpened: true,
  alertStopLossHit: true,
  alertTp1Hit: true,
  alertTp2Hit: true,
  alertDailySummary: true,
  alertDisconnection: true,
  maxRiskPercent: 2.0,
  maxOpenPositions: 1,
  dailyLossLimit: 300
};

// Global App State
let STATE = {
  activeTab: 'monitor',
  goldPrice: 0,
  priceChange24h: 0,
  exchangeRate: 36.5,
  settings: { ...defaultSettings },
  tradeLogs: [],
  activePosition: null,
  
  // Connection states
  connectionStatus: 'DISCONNECTED', // CONNECTED, DELAYED, DISCONNECTED
  lastPingTime: null,
  latency: null,
  lastUpdatedTime: null,
  
  // Form variables
  selectedDirection: 'LONG',
  selectedSlType: 'pct',
  posSizePct: 50,
  
  // Cooldowns
  closeCooldown: 0,
  executeCooldown: 0
};

// Chart.js Instances
let priceChartInstance = null;
let equityChartInstance = null;
let winLossChartInstance = null;
let timingBarChartInstance = null;


// =====================================================
// ===== INITIALIZATION & LOAD =====
// =====================================================

window.addEventListener('DOMContentLoaded', () => {
  loadAllSettings();
  loadTradeLogs();
  registerUIListeners();
  
  // Primary network fetches
  fetchExchangeRate();
  fetchBinanceTicker();
  fetchBinanceKlines();
  pingStatus();
  
  // Tickers/Interval timers
  setInterval(tickOneSecond, 1000); // 1s ticker for timestamps, durations
  setInterval(fetchBinanceTicker, 5000); // Poll price every 5s
  setInterval(fetchBinanceKlines, 60000); // Poll chart every 60s
  setInterval(pingStatus, 30000); // Heartbeat status ping every 30s
  
  // Status check webhook loop (every 10s if live)
  setInterval(pollActivePositionWebhook, 10000);
  
  // Render views
  renderActivePosition();
  renderTradeLogsTable();
  updateRiskWarnings();
  renderPerformanceSummary();
  renderMonthlyPerformanceHeatmap();
  renderRiskMetricsPanel();
  renderTimingAnalysis();
  checkPauseConditions();
});

/**
 * Loads dashboard settings from Supabase/LocalStorage
 */
function loadAllSettings() {
  let loaded = {};
  const local = localStorage.getItem('gold_trade_settings');
  if (local) {
    try {
      loaded = JSON.parse(local);
    } catch (e) {
      console.error('Failed to parse settings:', e);
    }
  }
  
  STATE.settings = { ...defaultSettings, ...loaded };
  
  // Load credentials from secure storage
  STATE.settings.webhookSecret = secureGet('webhookSecret');
  STATE.settings.telegramToken = secureGet('telegramToken');
  STATE.settings.telegramChatId = secureGet('telegramChatId');

  // Update Settings UI inputs
  document.getElementById('settingsSimulated').checked = STATE.settings.isSimulatedMode;
  document.getElementById('settingsN8nUrl').value = STATE.settings.n8nBaseUrl;
  document.getElementById('settingsExecPath').value = STATE.settings.webhookExecutePath;
  document.getElementById('settingsClosePath').value = STATE.settings.webhookClosePath;
  document.getElementById('settingsStatusPath').value = STATE.settings.webhookStatusPath;
  
  document.getElementById('settingsWebhookSecret').value = STATE.settings.webhookSecret ? '••••••••' : '';
  document.getElementById('settingsTelegramToken').value = STATE.settings.telegramToken ? '••••••••' : '';
  document.getElementById('settingsTelegramChatId').value = STATE.settings.telegramChatId;
  
  document.getElementById('settingsUseManualRate').checked = STATE.settings.useManualExchangeRate;
  document.getElementById('settingsManualRate').value = STATE.settings.manualExchangeRate;
  document.getElementById('settingsManualRate').disabled = !STATE.settings.useManualExchangeRate;
  
  document.getElementById('settingsMaxRisk').value = STATE.settings.maxRiskPercent;
  document.getElementById('settingsMaxPositions').value = STATE.settings.maxOpenPositions;
  document.getElementById('settingsDailyLossLimit').value = STATE.settings.dailyLossLimit || 300;
  
  // Telegram Prefs
  document.getElementById('prefTradeOpened').checked = STATE.settings.alertTradeOpened;
  document.getElementById('prefStopLossHit').checked = STATE.settings.alertStopLossHit;
  document.getElementById('prefTp1Hit').checked = STATE.settings.alertTp1Hit;
  document.getElementById('prefTp2Hit').checked = STATE.settings.alertTp2Hit;
  document.getElementById('prefDailySummary').checked = STATE.settings.alertDailySummary;
  document.getElementById('prefDisconnection').checked = STATE.settings.alertDisconnection;
  
  // Credentials Indicator (Hardcoded mocks for display)
  const isSecretSet = !!STATE.settings.webhookSecret;
  const isTgSet = !!STATE.settings.telegramToken;
  document.getElementById('apiStatusKey').className = isSecretSet ? 'status-badge-env bg-connected' : 'status-badge-env bg-disconnected';
  document.getElementById('apiStatusKey').textContent = isSecretSet ? 'OBFUSCATED SET' : 'MISSING';
  document.getElementById('apiStatusSecret').className = isTgSet ? 'status-badge-env bg-connected' : 'status-badge-env bg-disconnected';
  document.getElementById('apiStatusSecret').textContent = isTgSet ? 'OBFUSCATED SET' : 'MISSING';
}

/**
 * Loads trade logs from localStorage
 */
function loadTradeLogs() {
  const local = localStorage.getItem('gold_trade_logs');
  if (local) {
    try {
      STATE.tradeLogs = JSON.parse(local);
    } catch (e) {
      console.error('Failed to parse logs:', e);
      STATE.tradeLogs = [];
    }
  }
  
  // Find open position in logs
  const openPos = STATE.tradeLogs.find(log => log.status === 'OPEN' || log.status === 'TP1_HIT');
  STATE.activePosition = openPos || null;
}

/**
 * Saves trade logs to localStorage and triggers renders
 */
function saveTradeLogs() {
  localStorage.setItem('gold_trade_logs', JSON.stringify(STATE.tradeLogs));
  renderTradeLogsTable();
  renderPerformanceSummary();
  updateRiskWarnings();
  renderMonthlyPerformanceHeatmap();
  renderRiskMetricsPanel();
  renderTimingAnalysis();
  checkPauseConditions();
}

/**
 * Registers events listeners for modals, overrides, shortcuts.
 */
function registerUIListeners() {
  // Listen for Escape key on modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeConfirmModal();
      closeDetailModal();
    }
  });
}

// =====================================================
// ===== TAB SWITCHING =====
// =====================================================

function switchTab(tabName) {
  STATE.activeTab = tabName;
  
  // Toggle nav buttons active state
  document.getElementById('tabMonitor').classList.toggle('active', tabName === 'monitor');
  document.getElementById('tabLogs').classList.toggle('active', tabName === 'logs');
  document.getElementById('tabSettings').classList.toggle('active', tabName === 'settings');
  
  // Toggle views
  document.getElementById('viewMonitor').classList.toggle('active', tabName === 'monitor');
  document.getElementById('viewLogs').classList.toggle('active', tabName === 'logs');
  document.getElementById('viewSettings').classList.toggle('active', tabName === 'settings');
  
  // Trigger chart draw adjustments
  if (tabName === 'logs') {
    setTimeout(() => {
      renderLedgerCharts();
      renderTimingAnalysis();
    }, 100);
  }
}

// =====================================================
// ===== PRICE & EXCHANGE RATE LOGIC =====
// =====================================================

/**
 * Fetch USD/THB exchange rate from API or manual settings
 */
async function fetchExchangeRate() {
  if (STATE.settings.useManualExchangeRate) {
    STATE.exchangeRate = parseFloat(STATE.settings.manualExchangeRate) || 36.5;
    updateExchangeRateUI();
    return;
  }
  
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    const rate = data.rates?.THB;
    if (rate) {
      STATE.exchangeRate = rate;
      updateExchangeRateUI();
    }
  } catch (err) {
    console.error('Failed to fetch dynamic exchange rate, using manual:', err);
    STATE.exchangeRate = parseFloat(STATE.settings.manualExchangeRate) || 36.5;
    updateExchangeRateUI();
  }
}

function updateExchangeRateUI() {
  document.getElementById('headerExchangeRate').textContent = `${STATE.exchangeRate.toFixed(2)} THB`;
}

function toggleManualRateInput(checked) {
  document.getElementById('settingsManualRate').disabled = !checked;
}

/**
 * Helper to fetch from Binance with rotation of fallback endpoints to bypass ISP blocks.
 */
async function fetchFromBinance(path) {
  const endpoints = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
    'https://api-gcp.binance.com',
    'https://data-api.binance.vision'
  ];
  
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const url = `${endpoint}${path}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout per endpoint
      
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (res.ok) {
        return await res.json();
      }
      lastError = new Error(`Binance HTTP error! Status: ${res.status} on ${endpoint}`);
    } catch (err) {
      lastError = err;
      console.warn(`Failed fetching from ${endpoint}:`, err.message || err);
    }
  }
  throw lastError || new Error('All Binance endpoints failed');
}

/**
 * Fetch PAXG/USDT price from Binance Spot API
 */
async function fetchBinanceTicker() {
  try {
    const data = await fetchFromBinance('/api/v3/ticker/24hr?symbol=PAXGUSDT');
    
    STATE.goldPrice = parseFloat(data.lastPrice);
    STATE.priceChange24h = parseFloat(data.priceChangePercent);
    STATE.lastUpdatedTime = new Date();
    
    // Update dashboard values
    document.getElementById('liveGoldPrice').textContent = `$${STATE.goldPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    
    const changeEl = document.getElementById('livePriceChange');
    const isPositive = STATE.priceChange24h >= 0;
    changeEl.className = `price-change ${isPositive ? 'positive' : 'negative'}`;
    changeEl.textContent = `${isPositive ? '+' : ''}${STATE.priceChange24h.toFixed(2)}%`;
    
    // Update live active position calculations (Features 1 & 7)
    tickOneSecond();
    
    // Check Active Position simulated hit triggers
    checkSimulatedTriggers();
  } catch (err) {
    console.error('Binance connection failed, trying Coingecko fallback:', err);
    fetchCoingeckoPriceFallback();
  }
}

/**
 * Coingecko fallback for PAXG price checks
 */
async function fetchCoingeckoPriceFallback() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd');
    if (!res.ok) throw new Error('Coingecko request failed');
    const data = await res.json();
    const price = data['pax-gold']?.usd;
    if (price) {
      STATE.goldPrice = price;
      document.getElementById('liveGoldPrice').textContent = `$${STATE.goldPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      STATE.lastUpdatedTime = new Date();
      tickOneSecond();
    }
  } catch (e) {
    console.error('All price APIs failed:', e);
  }
}

/**
 * Fetch 24 hours of 1h candlestick data from Binance Spot
 */
async function fetchBinanceKlines() {
  try {
    const data = await fetchFromBinance('/api/v3/klines?symbol=PAXGUSDT&interval=1h&limit=24');
    
    const labels = [];
    const prices = [];
    data.forEach(item => {
      const time = new Date(item[0]);
      labels.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      prices.push(parseFloat(item[4])); // Close prices
    });
    
    renderPriceChart(labels, prices);
  } catch (err) {
    console.error('Failed to load Binance klines chart, trying Coingecko fallback:', err);
    fetchCoingeckoKlinesFallback();
  }
}

/**
 * Coingecko fallback for PAXG klines
 */
async function fetchCoingeckoKlinesFallback() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=usd&days=1');
    if (!res.ok) throw new Error('Coingecko market chart failed');
    const data = await res.json();
    
    const pricesData = data.prices || [];
    const sliced = pricesData.slice(-24);
    
    const labels = [];
    const prices = [];
    sliced.forEach(item => {
      const time = new Date(item[0]);
      labels.push(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      prices.push(item[1]); // Close prices
    });
    
    if (prices.length > 0) {
      renderPriceChart(labels, prices);
    }
  } catch (err) {
    console.error('All chart APIs failed:', err);
  }
}

// =====================================================
// ===== PRICE LINE CHART RENDERING =====
// =====================================================

function renderPriceChart(labels, dataPoints) {
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (priceChartInstance) {
    priceChartInstance.destroy();
  }
  
  priceChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'PAXG/USDT Price',
        data: dataPoints,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 1,
        pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f0f11',
          titleColor: '#9ca3af',
          bodyColor: '#f3f4f6',
          borderColor: '#2a2a32',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(42, 42, 50, 0.3)' },
          ticks: { color: '#9ca3af', font: { size: 9 } }
        },
        y: {
          grid: { color: 'rgba(42, 42, 50, 0.3)' },
          ticks: { color: '#9ca3af', font: { size: 9 } }
        }
      }
    }
  });
}

// =====================================================
// ===== CONNECTION STATUS PIN WEBHOOKS (Heartbeat) =====
// =====================================================

/**
 * Pings n8n server status or checks simulation state (Feature 3)
 */
async function pingStatus() {
  if (STATE.settings.isSimulatedMode) {
    updateConnectionUI('CONNECTED', 0);
    return;
  }
  
  const startTime = Date.now();
  const secret = STATE.settings.webhookSecret || '';
  try {
    const url = `${STATE.settings.n8nBaseUrl.replace(/\/$/, '')}${STATE.settings.webhookStatusPath}`;
    
    // Set headers with webhook secret
    const headers = new Headers();
    if (secret) {
      headers.append('X-Webhook-Secret', secret);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    
    const res = await fetch(url, {
      method: 'GET',
      headers: headers,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const endTime = Date.now();
    if (res.ok) {
      updateConnectionUI('CONNECTED', endTime - startTime);
    } else {
      updateConnectionUI('DISCONNECTED', null);
    }
  } catch (e) {
    updateConnectionUI('DISCONNECTED', null);
  }
}

function updateConnectionUI(status, latency) {
  STATE.connectionStatus = status;
  if (latency !== null) {
    STATE.latency = latency;
  }
  if (status === 'CONNECTED') {
    STATE.lastPingTime = new Date();
  }
  
  const badge = document.getElementById('connectionStatusBadge');
  const pulse = document.getElementById('connectionPulse');
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionText');
  
  badge.className = 'connection-badge';
  pulse.className = 'pulse-dot';
  dot.className = 'solid-dot';
  
  if (STATE.settings.isSimulatedMode) {
    badge.classList.add('bg-connected');
    pulse.classList.add('bg-connected');
    dot.classList.add('bg-connected');
    text.textContent = 'SANDBOX MOCK';
  } else if (status === 'CONNECTED') {
    badge.classList.add('bg-connected');
    pulse.classList.add('bg-connected');
    dot.classList.add('bg-connected');
    text.textContent = 'CONNECTED';
  } else if (status === 'DELAYED') {
    badge.classList.add('bg-delayed');
    pulse.classList.add('bg-delayed');
    dot.classList.add('bg-delayed');
    text.textContent = 'DELAYED';
  } else {
    badge.classList.add('bg-disconnected');
    pulse.classList.add('bg-disconnected');
    dot.classList.add('bg-disconnected');
    text.textContent = 'DISCONNECTED';
  }
  
  // Tooltip updates
  document.getElementById('tooltipLatency').textContent = latency !== null ? `${latency}ms` : '—';
  document.getElementById('tooltipEndpoint').textContent = STATE.settings.n8nBaseUrl ? 
    (STATE.settings.n8nBaseUrl.length > 25 ? `${STATE.settings.n8nBaseUrl.slice(0, 22)}...` : STATE.settings.n8nBaseUrl) : '—';
  
  updatePingTimeText();
}

function triggerManualPing() {
  showToast('Re-pinging active hook heartbeat pings...', 'success');
  pingStatus();
}

function updatePingTimeText() {
  if (!STATE.lastPingTime) {
    document.getElementById('tooltipLastPing').textContent = 'Never';
    return;
  }
  const diffSec = Math.round((Date.now() - STATE.lastPingTime.getTime()) / 1000);
  if (diffSec < 60) {
    document.getElementById('tooltipLastPing').textContent = `${diffSec}s ago`;
  } else {
    document.getElementById('tooltipLastPing').textContent = `${Math.floor(diffSec / 60)}m ago`;
  }
}

// =====================================================
// ===== TIMER SECONDS TICKERS =====
// =====================================================

function tickOneSecond() {
  // Update last updated status timer (Feature 7)
  if (STATE.lastUpdatedTime) {
    const elapsedSec = Math.round((Date.now() - STATE.lastUpdatedTime.getTime()) / 1000);
    const labelEl = document.getElementById('lastUpdatedTimestamp');
    
    // Bangkok formatting
    const localBangkokStr = STATE.lastUpdatedTime.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    labelEl.setAttribute('title', `Exact Time (Bangkok): ${localBangkokStr}`);
    
    let timeStr = '';
    if (elapsedSec < 60) {
      timeStr = `${elapsedSec} seconds ago`;
    } else if (elapsedSec < 3600) {
      timeStr = `${Math.floor(elapsedSec / 60)} minutes ago`;
    } else {
      timeStr = `${Math.floor(elapsedSec / 3600)} hours ago`;
    }
    
    labelEl.textContent = `Last updated: ${timeStr}`;
    
    labelEl.className = 'last-updated';
    if (elapsedSec < 30) {
      labelEl.classList.add('text-connected');
    } else if (elapsedSec < 60) {
      labelEl.classList.add('text-delayed');
    } else {
      labelEl.classList.add('text-disconnected');
    }
    
    // Connection status check ages
    const pingElapsed = Math.round((Date.now() - (STATE.lastPingTime || Date.now()).getTime()) / 1000);
    if (!STATE.settings.isSimulatedMode) {
      if (pingElapsed >= 30 && pingElapsed <= 120 && STATE.connectionStatus !== 'DELAYED') {
        updateConnectionUI('DELAYED', STATE.latency);
      } else if (pingElapsed > 120 && STATE.connectionStatus !== 'DISCONNECTED') {
        updateConnectionUI('DISCONNECTED', null);
      }
    }
  }
  
  // Cooldown decrementers
  if (STATE.closeCooldown > 0) {
    STATE.closeCooldown--;
    const btn = document.getElementById('modalConfirmCloseBtn');
    if (btn) {
      btn.textContent = `Confirm Close (${STATE.closeCooldown}s)`;
      if (STATE.closeCooldown === 0) {
        btn.disabled = false;
        btn.textContent = 'Confirm Close';
      }
    }
  }
  
  if (STATE.executeCooldown > 0) {
    STATE.executeCooldown--;
    updateRiskWarnings(); // re-evaluates btn labels
  }
  
  // Update Live Position duration strings (Feature 1)
  updatePositionTimerTick();
  updatePingTimeText();
}

function updatePositionTimerTick() {
  if (!STATE.activePosition) return;
  const timeEl = document.getElementById('posOpenDuration');
  if (!timeEl) return;
  
  const openTime = new Date(STATE.activePosition.opened_at || STATE.activePosition.timestamp).getTime();
  const diffMs = Date.now() - openTime;
  if (diffMs <= 0) {
    timeEl.textContent = '0m 0s';
    return;
  }
  const diffSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  
  if (hours > 0) {
    timeEl.textContent = `${hours}h ${minutes}m ${secs}s`;
  } else {
    timeEl.textContent = `${minutes}m ${secs}s`;
  }
}

// =====================================================
// ===== FEATURE 1: ACTIVE POSITION CARD RENDER =====
// =====================================================

function renderActivePosition() {
  const container = document.getElementById('activePositionCard');
  if (!STATE.activePosition) {
    container.innerHTML = `
      <div class="card-empty-state">
        <div class="empty-icon-wrapper">
          <i class="fa-solid fa-compass empty-icon animate-pulse"></i>
        </div>
        <h3 class="empty-title">No Active Position</h3>
        <p class="empty-desc">
          There are no open orders. Configure settings and use the Control Panel to open a trade.
        </p>
      </div>
    `;
    return;
  }
  
  const pos = STATE.activePosition;
  const isLong = pos.direction === 'LONG';
  const entry = pos.entry_price;
  const current = STATE.goldPrice || entry;
  
  // PnL maths
  const priceDiff = current - entry;
  const priceDiffPct = (priceDiff / entry) * 100;
  const rawPnL = pos.position_size_usdt * (priceDiff / entry);
  const pnlUsdt = isLong ? rawPnL : -rawPnL;
  const pnlThb = pnlUsdt * STATE.exchangeRate;
  const pnlPct = isLong ? priceDiffPct : -priceDiffPct;
  const isProfit = pnlUsdt >= 0;
  
  // Progress Bar Range Calculations
  const sl = pos.sl_price;
  const tp1 = pos.tp1_price;
  const tp2 = pos.tp2_price;
  
  const totalRange = Math.abs(tp2 - sl) || 1;
  const currentDistance = Math.abs(current - sl);
  const dotPosition = Math.max(0, Math.min(100, (currentDistance / totalRange) * 100));
  
  const entryPct = (Math.abs(entry - sl) / totalRange) * 100;
  const tp1Pct = (Math.abs(tp1 - sl) / totalRange) * 100;
  
  let statusBadge = '';
  if (pos.status === 'TP1_HIT') {
    statusBadge = `<span class="status-badge-inline text-yellow">TP1 HIT (50% Out)</span>`;
  } else if (pos.status === 'TP2_HIT') {
    statusBadge = `<span class="status-badge-inline text-green">TP2 HIT</span>`;
  } else if (pos.status === 'SL_HIT') {
    statusBadge = `<span class="status-badge-inline text-red">SL HIT</span>`;
  } else {
    statusBadge = `<span class="status-badge-inline text-blue">OPEN ACTIVE</span>`;
  }
  
  container.innerHTML = `
    <!-- Top info bar -->
    <div class="pos-card-header">
      <div class="pos-card-title-group">
        <span class="active-pulse-dot"></span>
        <span class="pos-title-label">Active Position</span>
        <span class="pos-dir-badge ${isLong ? 'bg-green' : 'bg-red'}">${pos.direction}</span>
      </div>
      <div>${statusBadge}</div>
    </div>
    
    <!-- Metrics Panel -->
    <div class="pos-metrics-grid">
      <div>
        <span class="pos-metric-label">Unrealized PnL (USDT)</span>
        <span class="pos-pnl-value ${isProfit ? 'text-green' : 'text-red'}">
          ${isProfit ? '+' : ''}${pnlUsdt.toFixed(2)}
          <span class="pos-pnl-pct">(${isProfit ? '+' : ''}${pnlPct.toFixed(2)}%)</span>
        </span>
      </div>
      <div>
        <span class="pos-metric-label">Unrealized PnL (THB)</span>
        <span class="pos-pnl-value ${isProfit ? 'text-green' : 'text-red'}">
          ${isProfit ? '+' : ''}${Math.round(pnlThb).toLocaleString()} THB
        </span>
      </div>
      <div>
        <span class="pos-metric-label">Open Duration</span>
        <span id="posOpenDuration" class="pos-pnl-value text-white">Calculating...</span>
      </div>
      
      <div>
        <span class="pos-metric-label">Entry Price</span>
        <span class="pos-price-val">$${entry.toLocaleString()}</span>
      </div>
      <div>
        <span class="pos-metric-label">Current Price</span>
        <span class="pos-price-val ${isProfit ? 'text-green' : 'text-red'}">$${current.toLocaleString()}</span>
      </div>
      <div>
        <span class="pos-metric-label">Position Size</span>
        <span class="pos-price-val">$${pos.position_size_usdt.toLocaleString()} USDT</span>
      </div>
    </div>

    <!-- Progress range scale -->
    <div class="progress-bar-wrapper">
      <div class="progress-labels">
        <span>Target Progress Scale</span>
        <span>Dot Location: ${dotPosition.toFixed(0)}%</span>
      </div>
      
      <div class="progress-track-bar">
        <!-- Zones representation -->
        <div class="track-zone bg-red-opacity" style="width: ${entryPct}%"></div>
        <div class="track-zone bg-yellow-opacity" style="width: ${tp1Pct - entryPct}%"></div>
        <div class="track-zone bg-green-opacity" style="width: ${100 - tp1Pct}%"></div>
        
        <!-- Target Markers dots -->
        <div class="scale-marker" style="left: ${entryPct}%" title="Entry Price"></div>
        <div class="scale-marker" style="left: ${tp1Pct}%" title="TP1 Target"></div>
        
        <!-- Live position moving node dot -->
        <div class="track-node-dot ${isProfit ? 'border-green' : 'border-red'}" style="left: ${dotPosition}%">
          <span class="inner-core animate-pulse"></span>
        </div>
      </div>
      
      <!-- Scale price tags -->
      <div class="track-price-levels">
        <div class="price-tag align-left">
          <span class="tag-title text-red">SL</span>
          <span class="tag-price text-red-light">$${sl.toLocaleString()}</span>
        </div>
        <div class="price-tag align-center" style="left: ${entryPct}%">
          <span class="tag-title">Entry</span>
          <span class="tag-price">$${entry.toLocaleString()}</span>
        </div>
        <div class="price-tag align-center" style="left: ${tp1Pct}%">
          <span class="tag-title text-yellow">TP1</span>
          <span class="tag-price text-yellow-light">$${tp1.toLocaleString()}</span>
        </div>
        <div class="price-tag align-right">
          <span class="tag-title text-green">TP2</span>
          <span class="tag-price text-green-light">$${tp2.toLocaleString()}</span>
        </div>
      </div>
    </div>

    <!-- Close button action -->
    <div class="pos-card-actions">
      <button type="button" class="btn btn-danger w-full h-10" onclick="triggerCloseConfirmModal()">
        <span>⛔ Close Position</span>
      </button>
    </div>
  `;
}

// =====================================================
// ===== FEATURE 2: CLOSE POSITION CONFIRM MODAL =====
// =====================================================

function triggerCloseConfirmModal() {
  if (!STATE.activePosition) return;
  
  const pos = STATE.activePosition;
  const isLong = pos.direction === 'LONG';
  const entry = pos.entry_price;
  const current = STATE.goldPrice || entry;
  const priceDiff = current - entry;
  const rawPnL = pos.position_size_usdt * (priceDiff / entry);
  const pnlUsdt = isLong ? rawPnL : -rawPnL;
  const isProfit = pnlUsdt >= 0;
  
  const container = document.getElementById('modalTradeSummary');
  container.innerHTML = `
    <div class="modal-summary-row">
      <span class="summary-lbl">Direction:</span>
      <span class="summary-val font-bold ${isLong ? 'text-green' : 'text-red'}">${pos.direction}</span>
    </div>
    <div class="modal-summary-row">
      <span class="summary-lbl">Entry Price:</span>
      <span class="summary-val">$${entry.toLocaleString()} USDT</span>
    </div>
    <div class="modal-summary-row">
      <span class="summary-lbl">Current Price:</span>
      <span class="summary-val">$${current.toLocaleString()} USDT</span>
    </div>
    <div class="modal-summary-row border-top-dash">
      <span class="summary-lbl font-bold">Unrealized PnL:</span>
      <span class="summary-val font-bold ${isProfit ? 'text-green' : 'text-red'}">
        ${isProfit ? '+' : ''}${pnlUsdt.toFixed(2)} USDT
      </span>
    </div>
  `;
  
  const modal = document.getElementById('closePositionModal');
  modal.classList.remove('hidden');
}

function closeConfirmModal() {
  const modal = document.getElementById('closePositionModal');
  modal.classList.add('hidden');
}

/**
 * Handles Webhook manual close trigger executions (Feature 2)
 */
async function confirmCloseActivePosition() {
  closeConfirmModal();
  if (!STATE.activePosition) return;
  
  const pos = STATE.activePosition;
  const current = STATE.goldPrice || pos.entry_price;
  const isLong = pos.direction === 'LONG';
  const diffPercent = (current - pos.entry_price) / pos.entry_price;
  const rawPnL = pos.position_size_usdt * diffPercent;
  const pnlUsdt = isLong ? rawPnL : -rawPnL;
  const pnlThb = pnlUsdt * STATE.exchangeRate;
  
  // Set button close cooldown status
  STATE.closeCooldown = 5;
  
  // Payload n8n
  const payload = {
    action: 'CLOSE',
    symbol: 'PAXGUSDT',
    direction: pos.direction,
    entry_price: pos.entry_price,
    exit_price: current,
    pnl_usdt: pnlUsdt,
    pnl_thb: pnlThb,
    timestamp: new Date().toISOString(),
    trade_id: pos.id,
    reason: 'MANUAL_CLOSE'
  };

  if (STATE.settings.isSimulatedMode) {
    executeLocalPositionClose(current, pnlUsdt, pnlThb);
    showToast('Simulated position closed successfully.', 'success');
    return;
  }
  
  // Live fetch
  try {
    const url = `${STATE.settings.n8nBaseUrl.replace(/\/$/, '')}${STATE.settings.webhookClosePath}`;
    const secret = STATE.settings.webhookSecret || '';
    
    const headers = new Headers({
      'Content-Type': 'application/json'
    });
    if (secret) {
      headers.append('X-Webhook-Secret', secret);
    }
    
    const res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) throw new Error('Close position request failed');
    const data = await res.json();
    
    executeLocalPositionClose(
      data.exit_price || current,
      data.pnl_usdt !== undefined ? data.pnl_usdt : pnlUsdt,
      data.pnl_thb !== undefined ? data.pnl_thb : pnlThb
    );
    showToast(data.message || 'Position closed successfully via n8n webhook!', 'success');
  } catch (err) {
    console.error('Failed to close trade:', err);
    showToast(`Failed to close position: ${err.message}`, 'error');
  }
}

function executeLocalPositionClose(exitPrice, pnlUsdt, pnlThb) {
  if (!STATE.activePosition) return;
  
  const closedId = STATE.activePosition.id;
  const updatedLogs = STATE.tradeLogs.map(log => {
    if (log.id === closedId) {
      return {
        ...log,
        status: 'CLOSED',
        exit_price: exitPrice,
        pnl_usdt: pnlUsdt,
        pnl_thb: pnlThb,
        result: pnlUsdt > 0 ? 'WIN' : 'LOSS',
        closed_at: new Date().toISOString()
      };
    }
    return log;
  });
  
  STATE.tradeLogs = updatedLogs;
  STATE.activePosition = null;
  saveTradeLogs();
  renderActivePosition();
}

/**
 * Poll live positions webhook from server (Feature 1 status polling)
 */
async function pollActivePositionWebhook() {
  if (STATE.settings.isSimulatedMode || STATE.activeTab !== 'monitor') return;
  
  try {
    const baseUrl = STATE.settings.n8nBaseUrl.replace(/\/$/, '');
    const path = STATE.settings.webhookStatusPath;
    const url = `${baseUrl}${path}`;
    const secret = STATE.settings.webhookSecret || '';
    
    const headers = new Headers();
    if (secret) {
      headers.append('X-Webhook-Secret', secret);
    }
    
    const res = await fetch(url, { method: 'GET', headers: headers });
    if (!res.ok) throw new Error('Status polling error');
    
    const data = await res.json();
    
    if (data.has_position) {
      const parsed = {
        id: data.id || 'live-active-position',
        timestamp: data.opened_at || new Date().toISOString(),
        opened_at: data.opened_at || new Date().toISOString(),
        symbol: data.symbol || 'PAXGUSDT',
        direction: data.direction || 'LONG',
        entry_price: parseFloat(data.entry_price),
        sl_price: parseFloat(data.sl_price),
        tp1_price: parseFloat(data.tp1_price),
        tp2_price: parseFloat(data.tp2_price),
        exit_price: data.exit_price ? parseFloat(data.exit_price) : undefined,
        pnl_usdt: parseFloat(data.pnl_usdt || 0),
        pnl_thb: parseFloat(data.pnl_thb || 0),
        status: data.tp2_hit ? 'CLOSED' : data.tp1_hit ? 'TP1_HIT' : 'OPEN',
        tp1_hit: !!data.tp1_hit,
        tp2_hit: !!data.tp2_hit,
        sl_hit: !!data.sl_hit,
        position_size_usdt: parseFloat(data.position_size_usdt || 0)
      };
      
      // Update state
      STATE.activePosition = parsed;
    } else {
      // position closed externally
      if (STATE.activePosition) {
        showToast('Active position closed externally on exchange.', 'info');
        STATE.activePosition = null;
      }
    }
    renderActivePosition();
  } catch (err) {
    console.error('Failed to sync position status from n8n webhooks:', err);
  }
}

// =====================================================
// ===== SIMULATED MARKET ALERTS / TRIGGERS =====
// =====================================================

function checkSimulatedTriggers() {
  if (!STATE.settings.isSimulatedMode || !STATE.activePosition || STATE.goldPrice === 0) return;
  
  const pos = STATE.activePosition;
  const current = STATE.goldPrice;
  const isLong = pos.direction === 'LONG';
  let isHit = false;
  let hitStatus = pos.status;
  let pnlUsdt = 0;
  
  // Stop loss triggers
  if (isLong ? current <= pos.sl_price : current >= pos.sl_price) {
    isHit = true;
    hitStatus = 'SL_HIT';
    showToast(`🔔 Stop Loss Hit at $${current}! Position closed.`, 'error');
  }
  // TP2 Complete triggers
  else if (isLong ? current >= pos.tp2_price : current <= pos.tp2_price) {
    isHit = true;
    hitStatus = 'TP2_HIT';
    showToast(`🔔 Take Profit 2 Hit at $${current}! Position complete.`, 'success');
  }
  // TP1 Partial exit triggers
  else if (pos.status === 'OPEN' && (isLong ? current >= pos.tp1_price : current <= pos.tp1_price)) {
    isHit = true;
    hitStatus = 'TP1_HIT';
    showToast(`🔔 Take Profit 1 Hit at $${current}! 50% partial profits secured.`, 'success');
  }
  
  if (isHit) {
    const isExit = hitStatus === 'SL_HIT' || hitStatus === 'TP2_HIT';
    const exitPrice = isExit ? current : undefined;
    
    if (isExit) {
      const diffPercent = (current - pos.entry_price) / pos.entry_price;
      const rawPnL = pos.position_size_usdt * diffPercent;
      pnlUsdt = isLong ? rawPnL : -rawPnL;
      const pnlThb = pnlUsdt * STATE.exchangeRate;
      
      executeLocalPositionClose(current, pnlUsdt, pnlThb);
    } else {
      // Partial updates
      const updated = {
        ...pos,
        status: hitStatus,
        tp1_hit: true
      };
      
      STATE.tradeLogs = STATE.tradeLogs.map(log => log.id === pos.id ? updated : log);
      STATE.activePosition = updated;
      saveTradeLogs();
      renderActivePosition();
    }
  }
}

// =====================================================
// ===== TRADING CONTROL PANEL =====
// =====================================================

function setDirection(dir) {
  STATE.selectedDirection = dir;
  document.getElementById('dirLong').className = `dir-btn ${dir === 'LONG' ? 'active bg-green' : ''}`;
  document.getElementById('dirShort').className = `dir-btn ${dir === 'SHORT' ? 'active bg-red' : ''}`;
  calculateProjections();
  updateRiskWarnings();
}

function setSlType(type) {
  STATE.selectedSlType = type;
  document.getElementById('slTypePct').classList.toggle('active', type === 'pct');
  document.getElementById('slTypePrice').classList.toggle('active', type === 'price');
  
  const suffix = document.getElementById('slSuffix');
  const input = document.getElementById('slValue');
  
  if (type === 'pct') {
    suffix.textContent = '%';
    input.value = '2.00';
  } else {
    suffix.textContent = 'USDT';
    input.value = Math.round(STATE.goldPrice || 2300).toString();
  }
  calculateProjections();
  updateRiskWarnings();
}

function fillLiveEntryPrice() {
  if (STATE.goldPrice > 0) {
    document.getElementById('entryPrice').value = STATE.goldPrice.toFixed(2);
    calculateProjections();
    updateRiskWarnings();
  }
}

function updatePosSizeSlider(val) {
  STATE.posSizePct = parseInt(val);
  document.getElementById('posSizeLabel').textContent = `${val}%`;
  calculateProjections();
  updateRiskWarnings();
}

/**
 * Perform control panel projection calculations on input events
 */
function calculateProjections() {
  const entry = parseFloat(document.getElementById('entryPrice').value) || 0;
  const slVal = parseFloat(document.getElementById('slValue').value) || 0;
  const tp1 = parseFloat(document.getElementById('tp1Pct').value) || 0;
  const tp2 = parseFloat(document.getElementById('tp2Pct').value) || 0;
  
  const isLong = STATE.selectedDirection === 'LONG';
  const capitalUsdt = CAPITAL_THB / STATE.exchangeRate;
  const sizeUsdt = (capitalUsdt * STATE.posSizePct) / 100;
  
  document.getElementById('projCapitalUsdt').textContent = `Capital: $${capitalUsdt.toFixed(2)} USDT`;
  
  if (entry <= 0) return;
  
  // Calculate Target prices
  let slPrice = 0;
  if (STATE.selectedSlType === 'price') {
    slPrice = slVal;
  } else {
    slPrice = isLong ? entry * (1 - slVal / 100) : entry * (1 + slVal / 100);
  }
  
  const tp1Price = isLong ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
  const tp2Price = isLong ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100);
  
  // Loss at SL
  const slDiff = Math.abs(slPrice - entry) / entry;
  const slLoss = sizeUsdt * slDiff;
  const slLossThb = slLoss * STATE.exchangeRate;
  
  // TP1 50% profit
  const tp1Diff = Math.abs(tp1Price - entry) / entry;
  const tp1Profit = (sizeUsdt * 0.5) * tp1Diff;
  const tp1ProfitThb = tp1Profit * STATE.exchangeRate;
  
  // TP2 50% profit
  const tp2Diff = Math.abs(tp2Price - entry) / entry;
  const tp2Profit = (sizeUsdt * 0.5) * tp2Diff;
  const tp2ProfitThb = tp2Profit * STATE.exchangeRate;
  
  const totalProfit = tp1Profit + tp2Profit;
  const totalProfitThb = totalProfit * STATE.exchangeRate;
  
  // Update HTML projection summary values
  document.getElementById('projSlLoss').textContent = `-$${slLoss.toFixed(2)} USDT (-${Math.round(slLossThb).toLocaleString()} THB)`;
  
  document.getElementById('projTp1Label').textContent = `TP1 Target ($${tp1Price.toFixed(1)})`;
  document.getElementById('projTp1Profit').textContent = `+$${tp1Profit.toFixed(2)} USDT (+${Math.round(tp1ProfitThb).toLocaleString()} THB)`;
  
  document.getElementById('projTp2Label').textContent = `TP2 Target ($${tp2Price.toFixed(1)})`;
  document.getElementById('projTp2Profit').textContent = `+$${tp2Profit.toFixed(2)} USDT (+${Math.round(tp2ProfitThb).toLocaleString()} THB)`;
  
  document.getElementById('projTotalProfit').textContent = `+$${totalProfit.toFixed(2)} USDT (+${Math.round(totalProfitThb).toLocaleString()} THB)`;
  
  // R:R levels
  const rrTp1 = slLoss > 0 ? (tp1Profit / slLoss) : 0;
  const rrTp2 = slLoss > 0 ? (totalProfit / slLoss) : 0;
  document.getElementById('projRiskReward').textContent = `TP1 R:R = ${rrTp1.toFixed(1)}x | TP2 Total R:R = ${rrTp2.toFixed(1)}x`;
}

// =====================================================
// ===== FEATURE 6 & 8: RISK MANAGEMENT LIMITS =====
// =====================================================

function updateRiskWarnings() {
  const entry = parseFloat(document.getElementById('entryPrice').value) || 0;
  const slVal = parseFloat(document.getElementById('slValue').value) || 0;
  const isLong = STATE.selectedDirection === 'LONG';
  
  let slPrice = 0;
  if (STATE.selectedSlType === 'price') {
    slPrice = slVal;
  } else {
    slPrice = isLong ? entry * (1 - slVal / 100) : entry * (1 + slVal / 100);
  }
  
  let riskPercent = 0;
  if (entry > 0 && slPrice > 0) {
    riskPercent = (Math.abs(entry - slPrice) / entry) * 100;
  }
  
  const limitRisk = parseFloat(STATE.settings.maxRiskPercent) || 2.0;
  const limitOpenPos = parseInt(STATE.settings.maxOpenPositions) || 1;
  const isRiskExceeded = riskPercent > limitRisk;
  const hasActivePos = !!STATE.activePosition;
  
  const warningBanner = document.getElementById('riskWarningBanner');
  const submitBtn = document.getElementById('executeTradeBtn');
  
  // 1. Reset warning banner UI
  warningBanner.classList.add('hidden');
  warningBanner.innerHTML = '';
  
  // Check override input checkbox status
  const checkboxEl = document.getElementById('chkRiskOverride');
  const isOverridden = checkboxEl ? checkboxEl.checked : false;
  
  // 2. Risk exceeded limits warning banner
  if (isRiskExceeded) {
    warningBanner.classList.remove('hidden');
    warningBanner.innerHTML = `
      <div class="warning-title-row">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>⚠️ Risk ${riskPercent.toFixed(1)}% exceeds your limit of ${limitRisk}%. Adjust position size or increase SL.</span>
      </div>
      <label class="override-checkbox-wrap">
        <input type="checkbox" id="chkRiskOverride" ${isOverridden ? 'checked' : ''} onchange="updateRiskWarnings()">
        <span>I understand the risk — allow this trade</span>
      </label>
    `;
  }
  
  // 3. Configure button text & states
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const bangkokTime = new Date(utcMs + (3600000 * 7));
  const bkkDateStr = bangkokTime.toISOString().split('T')[0];
  const isDailyLossPaused = localStorage.getItem(`daily_loss_paused_${bkkDateStr}`) === 'true';
  const isStreakPaused = localStorage.getItem('loss_streak_paused') === 'true';

  let isBtnDisabled = false;
  let btnText = 'Execute Trade Signal';
  let btnColorClass = 'btn-execute';
  
  if (isDailyLossPaused) {
    isBtnDisabled = true;
    btnText = 'Auto-trade Paused (Daily Loss)';
    btnColorClass = 'btn-disabled';
  } else if (isStreakPaused) {
    isBtnDisabled = true;
    btnText = 'Auto-trade Paused (Streak Alert)';
    btnColorClass = 'btn-disabled';
  } else if (STATE.executeCooldown > 0) {
    isBtnDisabled = true;
    btnText = `Cooldown Active (${STATE.executeCooldown}s)`;
    btnColorClass = 'btn-disabled';
  } else if (hasActivePos) {
    isBtnDisabled = true;
    btnText = `Max positions reached (${limitOpenPos}/${limitOpenPos})`;
    btnColorClass = 'btn-disabled';
    submitBtn.setAttribute('title', 'Max positions reached');
  } else if (isRiskExceeded && !isOverridden) {
    isBtnDisabled = true;
    btnText = 'Execute Blocked (Risk High)';
    btnColorClass = 'btn-disabled';
  } else if (isRiskExceeded && isOverridden) {
    isBtnDisabled = false;
    btnText = 'Execute (Override) ⚡';
    btnColorClass = 'bg-orange';
  } else {
    isBtnDisabled = false;
    btnText = 'Execute Trade Signal';
    btnColorClass = 'btn-execute';
  }
  
  submitBtn.disabled = isBtnDisabled;
  submitBtn.className = `btn w-full h-11 ${btnColorClass}`;
  submitBtn.querySelector('span').textContent = btnText;
}

/**
 * Handle new trade trigger submission
 */
async function handleTradeSubmit(e) {
  e.preventDefault();
  if (STATE.activePosition) {
    showToast('Close active position before executing a new trade.', 'error');
    return;
  }
  
  const entry = parseFloat(document.getElementById('entryPrice').value) || 0;
  const slVal = parseFloat(document.getElementById('slValue').value) || 0;
  const tp1 = parseFloat(document.getElementById('tp1Pct').value) || 0;
  const tp2 = parseFloat(document.getElementById('tp2Pct').value) || 0;
  
  const isLong = STATE.selectedDirection === 'LONG';
  
  let slPrice = 0;
  if (STATE.selectedSlType === 'price') {
    slPrice = slVal;
  } else {
    slPrice = isLong ? entry * (1 - slVal / 100) : entry * (1 + slVal / 100);
  }
  
  const tp1Price = isLong ? entry * (1 + tp1 / 100) : entry * (1 - tp1 / 100);
  const tp2Price = isLong ? entry * (1 + tp2 / 100) : entry * (1 - tp2 / 100);
  const capitalUsdt = CAPITAL_THB / STATE.exchangeRate;
  const positionSizeUsdt = (capitalUsdt * STATE.posSizePct) / 100;
  
  // Parameters check
  if (isLong) {
    if (slPrice >= entry) {
      showToast('Stop Loss must be BELOW entry price for LONG trades.', 'error');
      return;
    }
    if (tp1Price <= entry || tp2Price <= tp1Price) {
      showToast('Take Profits must be ABOVE entry price, and TP2 > TP1.', 'error');
      return;
    }
  } else {
    if (slPrice <= entry) {
      showToast('Stop Loss must be ABOVE entry price for SHORT trades.', 'error');
      return;
    }
    if (tp1Price >= entry || tp2Price >= tp1Price) {
      showToast('Take Profits must be BELOW entry price, and TP2 < TP1.', 'error');
      return;
    }
  }
  
  const payload = {
    symbol: 'PAXGUSDT',
    direction: STATE.selectedDirection,
    entry_price: entry,
    sl_percent: parseFloat(((Math.abs(entry - slPrice) / entry) * 100).toFixed(2)),
    tp1_percent: tp1,
    tp2_percent: tp2,
    position_size_usdt: positionSizeUsdt,
    capital_thb: CAPITAL_THB,
    timestamp: new Date().toISOString()
  };
  
  // Set Cooldown
  STATE.executeCooldown = 3;
  
  if (STATE.settings.isSimulatedMode) {
    executeLocalPositionOpen(payload, slPrice, tp1Price, tp2Price);
    showToast('Simulated sandbox trade opened successfully!', 'success');
    return;
  }
  
  try {
    const url = `${STATE.settings.n8nBaseUrl.replace(/\/$/, '')}${STATE.settings.webhookExecutePath}`;
    const secret = STATE.settings.webhookSecret || '';
    
    const headers = new Headers({
      'Content-Type': 'application/json'
    });
    if (secret) {
      headers.append('X-Webhook-Secret', secret);
    }
    
    const res = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) throw new Error('n8n execute trade returned error status');
    const data = await res.json();
    
    executeLocalPositionOpen({
      ...payload,
      id: data.id
    }, slPrice, tp1Price, tp2Price);
    
    showToast(data.message || 'Trade executed successfully via n8n!', 'success');
  } catch (err) {
    console.error('Failed to execute trade webhook:', err);
    showToast(`Trade execution failed: ${err.message}`, 'error');
  }
}

function executeLocalPositionOpen(payload, slPrice, tp1Price, tp2Price) {
  const newTrade = {
    id: payload.id || crypto.randomUUID(),
    timestamp: payload.timestamp,
    opened_at: payload.timestamp,
    symbol: payload.symbol,
    direction: payload.direction,
    entry_price: payload.entry_price,
    sl_price: slPrice,
    tp1_price: tp1Price,
    tp2_price: tp2Price,
    position_size_usdt: payload.position_size_usdt,
    capital_thb: payload.capital_thb,
    status: 'OPEN',
    tp1_hit: false,
    tp2_hit: false,
    sl_hit: false
  };
  
  STATE.tradeLogs = [newTrade, ...STATE.tradeLogs];
  STATE.activePosition = newTrade;
  
  saveTradeLogs();
  renderActivePosition();
}

// =====================================================
// ===== SETTINGS FORM ACTIONS =====
// =====================================================

async function handleSettingsSave(e) {
  e.preventDefault();
  
  const secret = document.getElementById('settingsWebhookSecret').value;
  const tgToken = document.getElementById('settingsTelegramToken').value;
  
  // Obfuscate secret credentials ONLY if they were newly configured (not masked dots)
  if (secret && secret !== '••••••••') {
    secureSet('webhookSecret', secret);
  }
  if (tgToken && tgToken !== '••••••••') {
    secureSet('telegramToken', tgToken);
  }
  
  const tgChatId = document.getElementById('settingsTelegramChatId').value;
  secureSet('telegramChatId', tgChatId);
  
  const updated = {
    n8nBaseUrl: document.getElementById('settingsN8nUrl').value.trim(),
    webhookExecutePath: document.getElementById('settingsExecPath').value.trim(),
    webhookClosePath: document.getElementById('settingsClosePath').value.trim(),
    webhookStatusPath: document.getElementById('settingsStatusPath').value.trim(),
    isSimulatedMode: document.getElementById('settingsSimulated').checked,
    useManualExchangeRate: document.getElementById('settingsUseManualRate').checked,
    manualExchangeRate: parseFloat(document.getElementById('settingsManualRate').value) || 36.5,
    maxRiskPercent: parseFloat(document.getElementById('settingsMaxRisk').value) || 2.0,
    maxOpenPositions: parseInt(document.getElementById('settingsMaxPositions').value) || 1,
    dailyLossLimit: parseFloat(document.getElementById('settingsDailyLossLimit').value) || 300,
    
    // Notification Preferences Toggles (Feature 4)
    alertTradeOpened: document.getElementById('prefTradeOpened').checked,
    alertStopLossHit: document.getElementById('prefStopLossHit').checked,
    alertTp1Hit: document.getElementById('prefTp1Hit').checked,
    alertTp2Hit: document.getElementById('prefTp2Hit').checked,
    alertDailySummary: document.getElementById('prefDailySummary').checked,
    alertDisconnection: document.getElementById('prefDisconnection').checked
  };
  
  // Save plain keys
  localStorage.setItem('gold_trade_settings', JSON.stringify(updated));
  
  // Sync core memory
  STATE.settings = { ...STATE.settings, ...updated };
  
  // Reload pricing / rate updates
  fetchExchangeRate();
  pingStatus();
  updateRiskWarnings();
  
  showToast('Settings configuration saved successfully!', 'success');
}

/**
 * Checks connection directly to the n8n VPS
 */
async function testN8nConnection() {
  const btn = document.getElementById('testN8nBtn');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  
  const n8nUrl = document.getElementById('settingsN8nUrl').value.trim();
  const secretInput = document.getElementById('settingsWebhookSecret').value;
  let secret = STATE.settings.webhookSecret || '';
  if (secretInput && secretInput !== '••••••••') {
    secret = secretInput;
  }
  
  try {
    const url = `${n8nUrl.replace(/\/$/, '')}/healthz`; // using simple health path if supported or ping status
    const headers = new Headers();
    if (secret) {
      headers.append('X-Webhook-Secret', secret);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // Fallback status check ping
    const testUrl = `${n8nUrl.replace(/\/$/, '')}${document.getElementById('settingsStatusPath').value.trim()}`;
    const res = await fetch(testUrl, { method: 'GET', headers: headers, signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (res.ok) {
      showToast('n8n connection test successful ✓', 'success');
    } else {
      throw new Error(`Status: ${res.status}`);
    }
  } catch (err) {
    showToast(`n8n connection test failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}

/**
 * Sends a test notification to Telegram Chat ID (Feature 4)
 */
async function sendTestTelegramMessage() {
  const btn = document.getElementById('testTelegramBtn');
  btn.disabled = true;
  btn.textContent = 'Sending Test...';
  
  const tokenInput = document.getElementById('settingsTelegramToken').value;
  let token = STATE.settings.telegramToken || '';
  if (tokenInput && tokenInput !== '••••••••') {
    token = tokenInput;
  }
  
  const chatId = document.getElementById('settingsTelegramChatId').value.trim();
  
  if (!token || !chatId) {
    showToast('Telegram Bot Token and Chat ID are required.', 'error');
    btn.disabled = false;
    btn.textContent = 'Test Notification';
    return;
  }
  
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🔔 Gold AutoTrader Dashboard: Test Notification Succeeded ✓'
      })
    });
    const data = await res.json();
    if (data.ok) {
      showToast('Test notification sent successfully to Telegram Chat ID!', 'success');
    } else {
      throw new Error(data.description || 'API Telegram error');
    }
  } catch (err) {
    showToast(`Telegram send error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Notification';
  }
}

// =====================================================
// ===== LEDGER LOGS VIEW RENDERING =====
// =====================================================

function renderPerformanceSummary() {
  let realizedPnl = 0;
  let wins = 0;
  let losses = 0;
  let totalVolume = 0;
  let maxLossStreak = 0;
  let currentStreak = 0;
  
  STATE.tradeLogs.forEach(log => {
    if (log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT') {
      const pnl = parseFloat(log.pnl_usdt) || 0;
      realizedPnl += pnl;
      totalVolume += parseFloat(log.position_size_usdt) || 0;
      
      if (pnl > 0) {
        wins++;
        currentStreak = 0;
      } else {
        losses++;
        currentStreak++;
        maxLossStreak = Math.max(maxLossStreak, currentStreak);
      }
    }
  });
  
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  
  document.getElementById('perfRealizedPnl').textContent = `${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`;
  document.getElementById('perfRealizedPnl').className = `perf-value ${realizedPnl >= 0 ? 'text-green' : 'text-red'}`;
  
  const pnlThb = realizedPnl * STATE.exchangeRate;
  document.getElementById('perfRealizedPnlThb').textContent = `${pnlThb >= 0 ? '+' : ''}${Math.round(pnlThb).toLocaleString()} THB`;
  
  document.getElementById('perfVolume').textContent = `$${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  
  document.getElementById('perfWins').textContent = wins;
  document.getElementById('perfWinsSub').textContent = `Win rate: ${winRate}%`;
  
  document.getElementById('perfLosses').textContent = losses;
  document.getElementById('perfLossesSub').textContent = `Max consec loss: ${maxLossStreak}`;
  
  const streaks = calculateStreakMetrics();
  const streakVal = streaks.currentStreak;
  const streakEl = document.getElementById('perfCurrentStreak');
  if (streakEl) {
    if (streakVal > 0) {
      streakEl.textContent = `🟢 +${streakVal}`;
      streakEl.className = 'perf-value text-green';
    } else if (streakVal < 0) {
      streakEl.textContent = `🔴 ${streakVal}`;
      streakEl.className = 'perf-value text-red';
    } else {
      streakEl.textContent = '0';
      streakEl.className = 'perf-value text-slate';
    }
  }
  
  // Active/Disable Log actions
  document.getElementById('csvExportBtn').disabled = STATE.tradeLogs.length === 0;
  
  // Risk stats updates
  document.getElementById('metricWinRate').textContent = `${winRate}%`;
  const profitFactor = wins > 0 && losses > 0 ? (wins / losses).toFixed(2) : '1.00';
  document.getElementById('metricProfitFactor').textContent = `${profitFactor}x`;
}

/**
 * Populate Trade history log table with filter support (Feature 5)
 */
function renderTradeLogsTable() {
  const body = document.getElementById('tradeLogsTableBody');
  body.innerHTML = '';
  
  const logs = filterLogsArray(STATE.tradeLogs);
  
  if (logs.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="10" class="table-empty">No trade history records matching current parameters.</td>
      </tr>
    `;
    return;
  }
  
  logs.forEach(log => {
    const isLong = log.direction === 'LONG';
    const isClosed = log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT';
    const pnl = parseFloat(log.pnl_usdt) || 0;
    const isWin = pnl > 0;
    
    const tr = document.createElement('tr');
    tr.className = 'table-row-interactive';
    tr.onclick = () => openTradeDetailModal(log.id);
    
    // Status Badge classes
    let statusClass = 'status-badge-table';
    if (log.status === 'OPEN') statusClass += ' bg-blue-opacity text-blue';
    else if (log.status === 'TP1_HIT') statusClass += ' bg-yellow-opacity text-yellow';
    else if (log.status === 'TP2_HIT') statusClass += ' bg-green-opacity text-green';
    else if (log.status === 'SL_HIT') statusClass += ' bg-red-opacity text-red';
    else statusClass += ' bg-slate-opacity text-slate';
    
    tr.innerHTML = `
      <td>${new Date(log.opened_at || log.timestamp).toLocaleString()}</td>
      <td class="font-mono text-slate-400">${log.symbol || 'PAXGUSDT'}</td>
      <td>
        <span class="pos-dir-badge ${isLong ? 'bg-green' : 'bg-red'}">${log.direction}</span>
      </td>
      <td class="text-right font-mono font-bold">$${log.entry_price.toLocaleString(undefined, { minimumFractionDigits: 1 })}</td>
      <td class="text-right font-mono text-red-light">$${log.sl_price.toLocaleString(undefined, { minimumFractionDigits: 1 })}</td>
      <td class="text-center">${log.tp1_hit ? '✅' : '❌'}</td>
      <td class="text-center">${log.tp2_hit ? '✅' : '❌'}</td>
      <td class="text-right font-mono">${log.exit_price ? `$${log.exit_price.toLocaleString(undefined, { minimumFractionDigits: 1 })}` : '—'}</td>
      <td class="text-right font-mono font-bold">
        ${isClosed ? `
          <span class="${isWin ? 'text-green' : 'text-red'}">
            ${isWin ? '+' : ''}${pnl.toFixed(2)} USDT
          </span>
          <span class="block text-9px text-slate-500 font-normal">
            ${isWin ? '+' : ''}${Math.round(log.pnl_thb).toLocaleString()} THB
          </span>
        ` : `
          <span class="text-cyan animate-pulse">Running...</span>
        `}
      </td>
      <td class="text-center">
        <span class="${statusClass}">${log.status}</span>
      </td>
    `;
    body.appendChild(tr);
  });
}

function filterLogsArray(logs) {
  const query = document.getElementById('logSearch').value.toLowerCase();
  const dir = document.getElementById('filterDirection').value;
  const status = document.getElementById('filterStatus').value;
  const startStr = document.getElementById('filterStartDate').value;
  const endStr = document.getElementById('filterEndDate').value;
  
  return logs.filter(log => {
    if (dir !== 'ALL' && log.direction !== dir) return false;
    if (status !== 'ALL' && log.status !== status) return false;
    
    const time = new Date(log.opened_at || log.timestamp);
    if (startStr) {
      const d = new Date(startStr);
      d.setHours(0,0,0,0);
      if (time < d) return false;
    }
    if (endStr) {
      const d = new Date(endStr);
      d.setHours(23,59,59,999);
      if (time > d) return false;
    }
    
    if (query) {
      const matchSymbol = log.symbol?.toLowerCase().includes(query);
      const matchId = log.id.toLowerCase().includes(query);
      const matchNotes = log.notes?.toLowerCase().includes(query);
      return matchSymbol || matchId || matchNotes;
    }
    
    return true;
  });
}

function filterTradeLogs() {
  renderTradeLogsTable();
}

function handleClearLogs() {
  if (confirm('WARNING: Are you sure you want to delete all trade records? This action is permanent and cannot be undone.')) {
    STATE.tradeLogs = [];
    STATE.activePosition = null;
    saveTradeLogs();
    renderActivePosition();
    renderPerformanceSummary();
    showToast('All trade history records cleared.', 'info');
  }
}

// =====================================================
// ===== FEATURE 5: TRADE DETAIL MODAL =====
// =====================================================

let activeDetailTradeId = null;

function openTradeDetailModal(tradeId) {
  const log = STATE.tradeLogs.find(l => l.id === tradeId);
  if (!log) return;
  
  activeDetailTradeId = tradeId;
  
  document.getElementById('detailModalTitle').textContent = `Trade Detail — #${log.id.slice(0, 8)}...`;
  document.getElementById('detailSymbol').textContent = log.symbol || 'PAXGUSDT';
  
  const dirEl = document.getElementById('detailDirection');
  dirEl.textContent = log.direction;
  dirEl.className = `val-badge ${log.direction === 'LONG' ? 'bg-green' : 'bg-red'}`;
  
  const statusEl = document.getElementById('detailStatus');
  statusEl.textContent = log.status;
  statusEl.className = `val-badge bg-slate-opacity text-slate`;
  if (log.status === 'OPEN') statusEl.className = 'val-badge bg-blue-opacity text-blue';
  else if (log.status === 'TP1_HIT') statusEl.className = 'val-badge bg-yellow-opacity text-yellow';
  else if (log.status === 'TP2_HIT') statusEl.className = 'val-badge bg-green-opacity text-green';
  else if (log.status === 'SL_HIT') statusEl.className = 'val-badge bg-red-opacity text-red';
  
  document.getElementById('detailOpenTime').textContent = new Date(log.opened_at || log.timestamp).toLocaleString();
  document.getElementById('detailCloseTime').textContent = log.closed_at ? new Date(log.closed_at).toLocaleString() : 'Running...';
  
  // Calculate Duration
  const openTime = new Date(log.opened_at || log.timestamp).getTime();
  const closeTime = log.closed_at ? new Date(log.closed_at).getTime() : Date.now();
  const diffSec = Math.floor((closeTime - openTime) / 1000);
  let durStr = '0m';
  if (diffSec > 0) {
    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    durStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }
  document.getElementById('detailDuration').textContent = durStr;
  
  // Price values
  document.getElementById('detailEntryPrice').textContent = `$${log.entry_price.toLocaleString()}`;
  document.getElementById('detailExitPrice').textContent = log.exit_price ? `$${log.exit_price.toLocaleString()}` : '—';
  document.getElementById('detailSlPrice').textContent = `$${log.sl_price.toLocaleString()}`;
  
  const tp1HitEl = document.getElementById('detailTp1Hit');
  tp1HitEl.textContent = log.tp1_hit ? '✅ HIT' : '❌ NOT HIT';
  tp1HitEl.className = log.tp1_hit ? 'text-green font-bold' : 'text-slate-500 font-bold';
  
  const tp2HitEl = document.getElementById('detailTp2Hit');
  tp2HitEl.textContent = log.tp2_hit ? '✅ HIT' : '❌ NOT HIT';
  tp2HitEl.className = log.tp2_hit ? 'text-green font-bold' : 'text-slate-500 font-bold';
  
  // PnL details
  const pnl = parseFloat(log.pnl_usdt) || 0;
  const isClosed = log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT';
  const retPct = isClosed ? ((pnl / log.position_size_usdt) * 100) : 0;
  
  const pnlUsdtEl = document.getElementById('detailPnlUsdt');
  const pnlThbEl = document.getElementById('detailPnlThb');
  const returnEl = document.getElementById('detailReturnPct');
  
  if (isClosed) {
    pnlUsdtEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnl >= 0 ? '+' : ''}${retPct.toFixed(2)}%)`;
    pnlUsdtEl.className = `tile-body ${pnl >= 0 ? 'text-green' : 'text-red'}`;
    
    const thb = log.pnl_thb || (pnl * STATE.exchangeRate);
    pnlThbEl.textContent = `${thb >= 0 ? '+' : ''}${Math.round(thb).toLocaleString()} THB`;
    pnlThbEl.className = `tile-body ${thb >= 0 ? 'text-green' : 'text-red'}`;
    
    // Capital ROI
    const capPct = (pnl / (log.position_size_usdt)) * 100;
    returnEl.textContent = `${capPct >= 0 ? '+' : ''}${capPct.toFixed(2)}%`;
    returnEl.className = `tile-body ${capPct >= 0 ? 'text-green' : 'text-red'}`;
  } else {
    pnlUsdtEl.textContent = '—';
    pnlUsdtEl.className = 'tile-body text-cyan';
    pnlThbEl.textContent = '—';
    pnlThbEl.className = 'tile-body text-cyan';
    returnEl.textContent = '—';
    returnEl.className = 'tile-body text-cyan';
  }
  
  // Load Notes
  document.getElementById('detailNotes').value = log.notes || '';
  
  // Display Modal
  const modal = document.getElementById('tradeDetailModal');
  modal.classList.remove('hidden');
}

function closeDetailModal() {
  const modal = document.getElementById('tradeDetailModal');
  modal.classList.add('hidden');
}

function saveSelectedTradeNotes() {
  if (!activeDetailTradeId) return;
  const txt = document.getElementById('detailNotes').value;
  
  STATE.tradeLogs = STATE.tradeLogs.map(log => {
    if (log.id === activeDetailTradeId) {
      return { ...log, notes: sanitize(txt) };
    }
    return log;
  });
  
  saveTradeLogs();
  showToast('Recap notes updated successfully.', 'success');
  closeDetailModal();
}

// =====================================================
// ===== CSV EXPORTER =====
// =====================================================

function exportToCSV() {
  const logs = filterLogsArray(STATE.tradeLogs);
  if (logs.length === 0) return;
  
  const headers = [
    'Trade ID', 'Symbol', 'Direction', 'Entry Price', 'Stop Loss', 'TP1 target', 'TP1 Hit',
    'TP2 target', 'TP2 Hit', 'Exit Price', 'PnL (USDT)', 'PnL (THB)', 'Status', 'Open Date', 'Close Date', 'Notes'
  ];
  
  const rows = logs.map(log => [
    log.id, log.symbol || 'PAXGUSDT', log.direction, log.entry_price, log.sl_price, log.tp1_price, log.tp1_hit ? 'YES' : 'NO',
    log.tp2_price, log.tp2_hit ? 'YES' : 'NO', log.exit_price || '', log.pnl_usdt || '', log.pnl_thb || '', log.status,
    log.opened_at || log.timestamp || '', log.closed_at || '', log.notes || ''
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `gold_trader_logs_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('CSV report downloaded successfully.', 'success');
}

// =====================================================
// ===== CHARTS DRAW (Equity & Win Rate) =====
// =====================================================

function renderLedgerCharts() {
  // 1. Prepare Equity Curve chart points
  let balance = CAPITAL_THB / STATE.exchangeRate; // initial capital in USDT
  const chartLabels = ['Start'];
  const chartPoints = [balance];
  
  // Sort logs chronological (oldest to newest)
  const closedLogs = [...STATE.tradeLogs]
    .filter(log => log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT')
    .reverse();
    
  let winsCount = 0;
  let lossCount = 0;
  
  closedLogs.forEach((log, index) => {
    const pnl = parseFloat(log.pnl_usdt) || 0;
    balance += pnl;
    chartLabels.push(`Trade ${index + 1}`);
    chartPoints.push(balance);
    
    if (pnl > 0) winsCount++;
    else lossCount++;
  });
  
  // 2. Render Equity line chart
  const equityCtx = document.getElementById('equityChart').getContext('2d');
  if (equityChartInstance) equityChartInstance.destroy();
  equityChartInstance = new Chart(equityCtx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Account Equity (USDT)',
        data: chartPoints,
        borderColor: '#00ff88',
        backgroundColor: 'rgba(0, 255, 136, 0.05)',
        borderWidth: 2,
        fill: true,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(42, 42, 50, 0.2)' }, ticks: { color: '#9ca3af', font: { size: 9 } } },
        y: { grid: { color: 'rgba(42, 42, 50, 0.2)' }, ticks: { color: '#9ca3af', font: { size: 9 } } }
      }
    }
  });
  
  // 3. Render Win/Loss Pie chart
  const winLossCtx = document.getElementById('winLossChart').getContext('2d');
  if (winLossChartInstance) winLossChartInstance.destroy();
  
  const hasData = winsCount > 0 || lossCount > 0;
  winLossChartInstance = new Chart(winLossCtx, {
    type: 'doughnut',
    data: {
      labels: ['Wins', 'Losses'],
      datasets: [{
        data: hasData ? [winsCount, lossCount] : [1, 0],
        backgroundColor: hasData ? ['#00ff88', '#ff4444'] : ['#2a2a32', '#2a2a32'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#f3f4f6', font: { size: 10 } }
        }
      },
      cutout: '65%'
    }
  });
}

// =====================================================
// ===== NEW ANALYTICS FEATURES HELPER FUNCTIONS =====
// =====================================================

function calculateStreakMetrics() {
  const closedLogs = [...STATE.tradeLogs]
    .filter(log => log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT')
    .reverse(); // oldest to newest
    
  let currentStreakVal = 0;
  let currentLossStreak = 0;
  let currentWinStreak = 0;
  let maxLossStreak = 0;
  let maxWinStreak = 0;
  
  closedLogs.forEach(log => {
    const pnl = parseFloat(log.pnl_usdt) || 0;
    if (pnl > 0) {
      if (currentStreakVal > 0) {
        currentStreakVal++;
      } else {
        currentStreakVal = 1;
      }
      currentWinStreak++;
      currentLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    } else {
      if (currentStreakVal < 0) {
        currentStreakVal--;
      } else {
        currentStreakVal = -1;
      }
      currentLossStreak++;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }
  });
  
  return {
    currentStreak: currentStreakVal,
    currentLossStreak,
    currentWinStreak,
    maxLossStreak,
    maxWinStreak
  };
}

function getBangkokDayAndHour(dateStringOrTimestamp) {
  const date = new Date(dateStringOrTimestamp);
  const utcMs = date.getTime() + (date.getTimezoneOffset() * 60000);
  const bangkokDate = new Date(utcMs + (3600000 * 7));
  
  let day = bangkokDate.getDay();
  day = day === 0 ? 6 : day - 1; // Mon = 0, Sun = 6
  
  const hour = bangkokDate.getHours();
  const month = bangkokDate.getMonth();
  const year = bangkokDate.getFullYear();
  
  return { day, hour, month, year, dateObj: bangkokDate };
}

function renderMonthlyPerformanceHeatmap() {
  const body = document.getElementById('monthlyPerformanceBody');
  if (!body) return;
  body.innerHTML = '';
  
  const closedLogs = STATE.tradeLogs.filter(log => 
    (log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT') && log.closed_at
  );
  
  const currentYear = new Date().getFullYear();
  let minYear = currentYear;
  let maxYear = currentYear;
  
  const data = {};
  
  closedLogs.forEach(log => {
    const { month, year } = getBangkokDayAndHour(log.closed_at);
    if (year < minYear) minYear = year;
    if (year > maxYear) maxYear = year;
    
    if (!data[year]) {
      data[year] = Array.from({ length: 12 }, () => ({ pnl: 0, trades: 0, wins: 0 }));
    }
    
    const pnlUsdt = parseFloat(log.pnl_usdt) || 0;
    const pnlThb = parseFloat(log.pnl_thb) || (pnlUsdt * STATE.exchangeRate);
    const isWin = pnlUsdt > 0;
    
    data[year][month].pnl += pnlThb;
    data[year][month].trades += 1;
    if (isWin) data[year][month].wins += 1;
  });
  
  for (let year = maxYear; year >= minYear; year--) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--card-border)';
    
    const tdYear = document.createElement('td');
    tdYear.className = 'font-bold text-white';
    tdYear.style.padding = '10px';
    tdYear.textContent = year;
    tr.appendChild(tdYear);
    
    const yearData = data[year] || Array.from({ length: 12 }, () => ({ pnl: 0, trades: 0, wins: 0 }));
    
    for (let month = 0; month < 12; month++) {
      const td = document.createElement('td');
      td.style.padding = '10px';
      const monthData = yearData[month];
      
      if (monthData.trades === 0) {
        td.textContent = '—';
        td.className = 'text-center text-muted';
        td.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
      } else {
        const pnl = monthData.pnl;
        const count = monthData.trades;
        const winRate = Math.round((monthData.wins / count) * 100);
        
        td.textContent = `${pnl >= 0 ? '+' : ''}${Math.round(pnl).toLocaleString()} THB`;
        td.className = 'text-center font-bold text-xs';
        td.setAttribute('title', `${count} trades, ${winRate}% win rate`);
        td.style.cursor = 'pointer';
        
        if (pnl > 0) {
          const intensity = Math.min(0.8, 0.15 + pnl / 5000);
          td.style.backgroundColor = `rgba(0, 255, 136, ${intensity})`;
          td.style.color = '#0c0c0e';
        } else {
          const intensity = Math.min(0.8, 0.15 + Math.abs(pnl) / 5000);
          td.style.backgroundColor = `rgba(255, 68, 68, ${intensity})`;
          td.style.color = '#ffffff';
        }
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function renderTimingAnalysis() {
  const headers = document.getElementById('hourlyHeatmapHeaders');
  const body = document.getElementById('hourlyHeatmapBody');
  if (!headers || !body) return;
  
  headers.innerHTML = '<th style="padding: 6px; text-align: left;">Day</th>';
  for (let h = 0; h < 24; h++) {
    const th = document.createElement('th');
    th.textContent = String(h).padStart(2, '0');
    th.className = 'text-center font-mono';
    th.style.fontSize = '8px';
    th.style.padding = '4px';
    headers.appendChild(th);
  }
  
  const closedLogs = STATE.tradeLogs.filter(log => 
    (log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT') && (log.opened_at || log.timestamp)
  );
  
  const grid = Array.from({ length: 7 }, () => 
    Array.from({ length: 24 }, () => ({ pnl: 0, warm: 0, trades: 0 }))
  );
  
  const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  const dayPnlSum = Array(7).fill(0);
  const dayTradesCount = Array(7).fill(0);
  
  closedLogs.forEach(log => {
    const timeToUse = log.opened_at || log.timestamp;
    const { day, hour } = getBangkokDayAndHour(timeToUse);
    
    const pnlUsdt = parseFloat(log.pnl_usdt) || 0;
    const pnlThb = parseFloat(log.pnl_thb) || (pnlUsdt * STATE.exchangeRate);
    
    grid[day][hour].pnl += pnlThb;
    grid[day][hour].trades += 1;
    
    dayPnlSum[day] += pnlThb;
    dayTradesCount[day] += 1;
  });
  
  body.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.02)';
    
    const tdDay = document.createElement('td');
    tdDay.className = 'font-bold text-slate-400';
    tdDay.textContent = daysOfWeek[d];
    tdDay.style.padding = '6px';
    tr.appendChild(tdDay);
    
    for (let h = 0; h < 24; h++) {
      const td = document.createElement('td');
      const cell = grid[d][h];
      
      td.style.padding = '0';
      td.style.width = '20px';
      td.style.height = '20px';
      td.style.border = '1px solid var(--card-border)';
      
      if (cell.trades === 0) {
        td.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
        td.setAttribute('title', `${daysOfWeek[d]} ${String(h).padStart(2, '0')}:00 — No trades`);
      } else {
        const avgPnl = cell.pnl / cell.trades;
        td.setAttribute('title', `${daysOfWeek[d]} ${String(h).padStart(2, '0')}:00 — ${cell.trades} trades, avg ${avgPnl >= 0 ? '+' : ''}${Math.round(avgPnl)} THB`);
        td.style.cursor = 'pointer';
        
        if (avgPnl > 0) {
          const intensity = Math.min(0.9, 0.15 + avgPnl / 2000);
          td.style.backgroundColor = `rgba(0, 255, 136, ${intensity})`;
        } else if (avgPnl < 0) {
          const intensity = Math.min(0.9, 0.15 + Math.abs(avgPnl) / 2000);
          td.style.backgroundColor = `rgba(255, 68, 68, ${intensity})`;
        } else {
          td.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        }
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  
  renderTimingBarChart(dayPnlSum, dayTradesCount, daysOfWeek);
}

function renderTimingBarChart(dayPnlSum, dayTradesCount, daysOfWeek) {
  const ctx = document.getElementById('timingBarChart').getContext('2d');
  if (timingBarChartInstance) {
    timingBarChartInstance.destroy();
  }
  
  const avgPnlData = dayPnlSum.map((sum, i) => {
    const count = dayTradesCount[i];
    return count > 0 ? Math.round(sum / count) : 0;
  });
  
  const backgroundColors = avgPnlData.map(val => val >= 0 ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 68, 68, 0.6)');
  const borderColors = avgPnlData.map(val => val >= 0 ? '#00ff88' : '#ff4444');
  
  timingBarChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: daysOfWeek,
      datasets: [{
        label: 'Avg PnL (THB)',
        data: avgPnlData,
        backgroundColor: backgroundColors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f0f11',
          titleColor: '#9ca3af',
          bodyColor: '#f3f4f6',
          borderColor: '#2a2a32',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const dayIndex = context.dataIndex;
              const count = dayTradesCount[dayIndex];
              return `Avg PnL: ${context.raw >= 0 ? '+' : ''}${context.raw} THB (${count} trades)`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(42, 42, 50, 0.2)' },
          ticks: { color: '#9ca3af', font: { size: 9 } }
        },
        y: {
          grid: { color: 'rgba(42, 42, 50, 0.2)' },
          ticks: { color: '#9ca3af', font: { size: 9 } }
        }
      }
    }
  });
}

function renderRiskMetricsPanel() {
  const closedLogs = [...STATE.tradeLogs]
    .filter(log => log.status === 'CLOSED' || log.status === 'SL_HIT' || log.status === 'TP2_HIT')
    .reverse(); // oldest to newest
  
  const N = closedLogs.length;
  
  if (N === 0) {
    document.getElementById('metricPanelProfitFactor').textContent = '—';
    document.getElementById('metricPanelProfitFactor').className = 'panel-tile-value text-slate';
    document.getElementById('metricPanelSharpe').textContent = '—';
    document.getElementById('metricPanelSharpe').className = 'panel-tile-value text-slate';
    document.getElementById('metricPanelMaxDrawdown').textContent = '—';
    document.getElementById('metricPanelMaxDrawdown').className = 'panel-tile-value text-slate';
    document.getElementById('metricPanelWinStreak').textContent = '—';
    document.getElementById('metricPanelWinStreak').className = 'panel-tile-value text-slate';
    document.getElementById('metricPanelLossStreak').textContent = '—';
    document.getElementById('metricPanelLossStreak').className = 'panel-tile-value text-slate';
    document.getElementById('metricPanelAvgDuration').textContent = '—';
    document.getElementById('metricPanelAvgDuration').className = 'panel-tile-value text-slate';
    return;
  }
  
  let grossProfit = 0;
  let grossLoss = 0;
  let totalDurationMs = 0;
  let returns = [];
  
  let baseline = CAPITAL_THB / STATE.exchangeRate;
  let equity = baseline;
  let peak = baseline;
  let maxDd = 0;
  
  closedLogs.forEach(log => {
    const pnl = parseFloat(log.pnl_usdt) || 0;
    if (pnl > 0) {
      grossProfit += pnl;
    } else {
      grossLoss += Math.abs(pnl);
    }
    
    const size = parseFloat(log.position_size_usdt) || 100;
    const retPct = (pnl / size) * 100;
    returns.push(retPct);
    
    equity += pnl;
    if (equity > peak) {
      peak = equity;
    }
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDd) {
      maxDd = dd;
    }
    
    const openTime = new Date(log.opened_at || log.timestamp).getTime();
    const closeTime = log.closed_at ? new Date(log.closed_at).getTime() : Date.now();
    totalDurationMs += Math.max(0, closeTime - openTime);
  });
  
  let pf = 1.0;
  let pfColor = 'text-slate';
  if (grossLoss === 0) {
    pf = grossProfit > 0 ? 99.9 : 1.0;
  } else {
    pf = grossProfit / grossLoss;
  }
  if (pf > 1.5) pfColor = 'text-green';
  else if (pf < 1.0) pfColor = 'text-red';
  else pfColor = 'text-yellow';
  
  document.getElementById('metricPanelProfitFactor').textContent = `${pf.toFixed(2)}x`;
  document.getElementById('metricPanelProfitFactor').className = `panel-tile-value ${pfColor}`;
  
  const mean = returns.reduce((a, b) => a + b, 0) / N;
  let variance = 0;
  if (N > 1) {
    variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (N - 1);
  }
  const stdDev = Math.sqrt(variance);
  let sharpe = 0;
  if (stdDev > 0) {
    sharpe = (mean / stdDev) * Math.sqrt(N);
  }
  
  let sharpeColor = 'text-slate';
  if (sharpe > 1.0) sharpeColor = 'text-green';
  else if (sharpe < 0) sharpeColor = 'text-red';
  else sharpeColor = 'text-yellow';
  
  document.getElementById('metricPanelSharpe').textContent = sharpe.toFixed(2);
  document.getElementById('metricPanelSharpe').className = `panel-tile-value ${sharpeColor}`;
  
  let ddColor = 'text-green';
  if (maxDd > 15) ddColor = 'text-red';
  else if (maxDd > 8) ddColor = 'text-yellow';
  
  document.getElementById('metricPanelMaxDrawdown').textContent = `${maxDd.toFixed(2)}%`;
  document.getElementById('metricPanelMaxDrawdown').className = `panel-tile-value ${ddColor}`;
  
  const streaks = calculateStreakMetrics();
  document.getElementById('metricPanelWinStreak').textContent = streaks.maxWinStreak;
  document.getElementById('metricPanelWinStreak').className = 'panel-tile-value text-green';
  document.getElementById('metricPanelLossStreak').textContent = streaks.maxLossStreak;
  document.getElementById('metricPanelLossStreak').className = 'panel-tile-value text-red';
  
  const avgDurMs = totalDurationMs / N;
  const avgSec = Math.floor(avgDurMs / 1000);
  let avgDurStr = '0m';
  if (avgSec > 0) {
    const days = Math.floor(avgSec / 86400);
    const hours = Math.floor((avgSec % 86400) / 3600);
    const mins = Math.floor((avgSec % 3600) / 60);
    
    if (days > 0) avgDurStr = `${days}d ${hours}h`;
    else if (hours > 0) avgDurStr = `${hours}h ${mins}m`;
    else avgDurStr = `${mins}m`;
  }
  
  document.getElementById('metricPanelAvgDuration').textContent = avgDurStr;
  document.getElementById('metricPanelAvgDuration').className = 'panel-tile-value text-blue';
}

async function sendTelegramAlert(message) {
  const token = STATE.settings.telegramToken || '';
  const chatId = STATE.settings.telegramChatId || '';
  if (!token || !chatId) return;
  
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message
      })
    });
  } catch (err) {
    console.error('Telegram notification failed:', err);
  }
}

function checkPauseConditions() {
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const bangkokTime = new Date(utcMs + (3600000 * 7));
  const bkkDateStr = bangkokTime.toISOString().split('T')[0];
  
  const limit = parseFloat(STATE.settings.dailyLossLimit) || 300;
  let dailyPnl = 0;
  
  STATE.tradeLogs.forEach(log => {
    if (log.closed_at) {
      const closedDate = new Date(log.closed_at);
      const utcClosedMs = closedDate.getTime() + (closedDate.getTimezoneOffset() * 60000);
      const bkkClosed = new Date(utcClosedMs + (3600000 * 7));
      const closedDateStr = bkkClosed.toISOString().split('T')[0];
      
      if (closedDateStr === bkkDateStr) {
        dailyPnl += parseFloat(log.pnl_thb) || ((parseFloat(log.pnl_usdt) || 0) * STATE.exchangeRate);
      }
    }
  });
  
  let isDailyLossLimitReached = false;
  if (dailyPnl < 0 && Math.abs(dailyPnl) >= limit) {
    isDailyLossLimitReached = true;
    localStorage.setItem(`daily_loss_paused_${bkkDateStr}`, 'true');
    
    const notifyKey = `daily_loss_notified_${bkkDateStr}`;
    if (localStorage.getItem(notifyKey) !== 'true') {
      localStorage.setItem(notifyKey, 'true');
      sendTelegramAlert(`⛔ Daily loss limit of ${limit} THB reached. Bot paused.`);
    }
  }
  
  const streaks = calculateStreakMetrics();
  let isStreakPaused = localStorage.getItem('loss_streak_paused') === 'true';
  
  if (streaks.currentLossStreak >= 5 && !isStreakPaused) {
    isStreakPaused = true;
    localStorage.setItem('loss_streak_paused', 'true');
    sendTelegramAlert(`🚨 5 consecutive losses. Bot auto-paused. Review required.`);
  }
  
  if (streaks.currentLossStreak === 3) {
    const notifyStreakKey = `loss_streak_3_notified_${STATE.tradeLogs[0]?.id}`;
    if (localStorage.getItem(notifyStreakKey) !== 'true' && STATE.tradeLogs.length > 0) {
      localStorage.setItem(notifyStreakKey, 'true');
      sendTelegramAlert(`⚠️ 3 consecutive losses. Consider reviewing strategy.`);
    }
  }
  
  renderStatusBanners(isDailyLossLimitReached, bkkDateStr, streaks.currentLossStreak, isStreakPaused);
}

function renderStatusBanners(isDailyLossLimitReached, bkkDateStr, currentLossStreak, isStreakPaused) {
  const container = document.getElementById('monitorBanners');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (isDailyLossLimitReached || localStorage.getItem(`daily_loss_paused_${bkkDateStr}`) === 'true') {
    const banner = document.createElement('div');
    banner.className = 'warning-banner warning-banner-red';
    banner.innerHTML = `
      <div class="warning-title-row" style="font-size: 0.8rem; font-weight: 700; display: flex; gap: 8px; align-items: center;">
        <i class="fa-solid fa-ban"></i>
        <span>🚫 Daily Loss Limit Reached. Auto-trade paused for today.</span>
      </div>
    `;
    container.appendChild(banner);
  }
  
  if (isStreakPaused || localStorage.getItem('loss_streak_paused') === 'true') {
    const banner = document.createElement('div');
    banner.className = 'warning-banner warning-banner-red';
    banner.innerHTML = `
      <div class="warning-title-row" style="font-size: 0.8rem; font-weight: 700; display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>🚨 5 consecutive losses. Bot auto-paused. Review required.</span>
        </div>
        <button onclick="resumeStreakPause(event)" class="btn btn-secondary-soft text-xs" style="padding: 4px 10px; border-radius: 6px; cursor: pointer; height: auto;">Resume Bot</button>
      </div>
    `;
    container.appendChild(banner);
  } else if (currentLossStreak >= 3) {
    const banner = document.createElement('div');
    banner.className = 'warning-banner warning-banner-orange';
    banner.innerHTML = `
      <div class="warning-title-row" style="font-size: 0.8rem; font-weight: 700; display: flex; gap: 8px; align-items: center;">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>⚠️ 3 consecutive losses. Consider reviewing strategy.</span>
      </div>
    `;
    container.appendChild(banner);
  }
}

function resumeStreakPause(e) {
  e.preventDefault();
  localStorage.removeItem('loss_streak_paused');
  showToast('Streak auto-pause cleared. Bot resumed.', 'success');
  checkPauseConditions();
  updateRiskWarnings();
}
