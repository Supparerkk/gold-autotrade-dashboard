import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1h&limit=24', {
      next: { revalidate: 10 } // Cache for 10 seconds to optimize requests
    });
    if (!res.ok) {
      throw new Error(`Binance responded with status ${res.status}`);
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Error fetching Binance klines proxy:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
