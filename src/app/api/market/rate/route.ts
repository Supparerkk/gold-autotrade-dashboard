import { NextResponse } from 'next/server';

export async function GET() {
  const apis = [
    'https://open.er-api.com/v6/latest/USD',
    'https://api.exchangerate-api.com/v4/latest/USD'
  ];

  let lastError = null;
  for (const api of apis) {
    try {
      const res = await fetch(api, {
        next: { revalidate: 60 }, // Cache for 60 seconds
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
      lastError = new Error(`Exchange rate API responded with status ${res.status} on ${api}`);
    } catch (err: any) {
      lastError = err;
      console.warn(`Failed fetching rate from ${api}:`, err.message || err);
    }
  }

  return NextResponse.json({ error: lastError?.message || 'All exchange rate APIs failed' }, { status: 500 });
}
