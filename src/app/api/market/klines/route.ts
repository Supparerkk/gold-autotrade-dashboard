import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'PAXGUSDT';
  const interval = searchParams.get('interval') || '1h';
  const limit = searchParams.get('limit') || '24';

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
      const res = await fetch(`${endpoint}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
        next: { revalidate: 10 },
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      lastError = new Error(`Binance HTTP error! Status: ${res.status} on ${endpoint}`);
    } catch (err: any) {
      lastError = err;
      console.warn(`Failed fetching klines from ${endpoint}:`, err.message || err);
    }
  }

  // Fallback to CoinGecko if all Binance endpoints fail
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=usd&days=1', {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      const pricesData = data.prices || [];
      const sliced = pricesData.slice(-24);
      
      // Map to Binance klines format: [ [time, open, high, low, close], ... ]
      const mapped = sliced.map((item: any) => {
        const timestamp = item[0];
        const valStr = item[1].toString();
        // Return dummy open/high/low/close matching the price for chart compatibility
        return [
          timestamp,
          valStr, // open
          valStr, // high
          valStr, // low
          valStr, // close
        ];
      });
      return NextResponse.json(mapped);
    }
  } catch (err: any) {
    console.error('Coingecko klines fallback failed:', err.message || err);
  }

  return NextResponse.json({ error: lastError?.message || 'All klines APIs failed' }, { status: 500 });
}
