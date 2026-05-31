import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT', {
      next: { revalidate: 0 } // Do not cache ticker to ensure real-time price updates
    });
    if (!res.ok) {
      throw new Error(`Binance responded with status ${res.status}`);
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Error fetching Binance ticker proxy:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
