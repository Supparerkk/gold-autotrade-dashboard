import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { settings, ...payload } = body;

    if (!settings) {
      return NextResponse.json({ error: 'Settings payload is missing' }, { status: 400 });
    }

    const { n8nBaseUrl } = settings;
    const n8nWebhookUrl = `${n8nBaseUrl.replace(/\/$/, '')}/webhook/gold-trade-partial-close`;

    const binanceKey = process.env.BINANCE_API_KEY || '';
    const binanceSecret = process.env.BINANCE_API_SECRET || '';

    // Forward to n8n webhook
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Binance-API-Key': binanceKey,
        'X-Binance-API-Secret': binanceSecret,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorMsg = await response.text();
      return NextResponse.json(
        { error: `n8n partial-close execution failed: ${errorMsg || response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      message: 'Partial close executed successfully via n8n!',
      ...data,
    });
  } catch (err: any) {
    console.error('Error in /api/trade/partial-close proxy:', err);
    return NextResponse.json(
      { error: `Proxy routing error: ${err.message || 'Check n8n URL configuration'}` },
      { status: 500 }
    );
  }
}
