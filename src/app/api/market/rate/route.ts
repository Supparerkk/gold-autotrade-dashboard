import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      next: { revalidate: 60 } // Cache for 60 seconds
    });
    if (!res.ok) {
      throw new Error(`Exchange rate API responded with status ${res.status}`);
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Error fetching exchange rate proxy:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
