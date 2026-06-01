import { NextResponse } from 'next/server';

export async function GET() {
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
      const res = await fetch(`${endpoint}/api/v3/ticker/24hr?symbol=PAXGUSDT`, {
        next: { revalidate: 0 },
        // Use standard timeout in Next.js Fetch
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      lastError = new Error(`Binance HTTP error! Status: ${res.status} on ${endpoint}`);
    } catch (err: any) {
      lastError = err;
      console.warn(`Failed fetching ticker from ${endpoint}:`, err.message || err);
    }
  }

  // Fallback to CoinGecko if all Binance endpoints fail (highly likely on US-hosted Netlify servers)
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd', {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      const price = data['pax-gold']?.usd;
      if (price) {
        return NextResponse.json({
          lastPrice: price.toString(),
          priceChangePercent: '0.00' // Placeholder for 24h change
        });
      }
    }
  } catch (err: any) {
    console.error('Coingecko ticker fallback failed:', err.message || err);
  }

  return NextResponse.json({ error: lastError?.message || 'All ticker APIs failed' }, { status: 500 });
}
