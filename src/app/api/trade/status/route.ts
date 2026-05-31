import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const n8nBaseUrl = searchParams.get('n8nBaseUrl') || '';
    const webhookStatusPath = searchParams.get('webhookStatusPath') || '';

    // If query params are provided, act as proxy to n8n
    if (n8nBaseUrl && webhookStatusPath) {
      const n8nWebhookUrl = `${n8nBaseUrl}${webhookStatusPath}`;
      const binanceKey = process.env.BINANCE_API_KEY || '';
      const binanceSecret = process.env.BINANCE_API_SECRET || '';

      const response = await fetch(n8nWebhookUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Binance-API-Key': binanceKey,
          'X-Binance-API-Secret': binanceSecret,
        },
      });

      if (!response.ok) {
        const errorMsg = await response.text();
        return NextResponse.json(
          { error: `n8n status query failed: ${errorMsg || response.statusText}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    }

    // Default: return credentials status check for Settings Panel
    const binanceKey = process.env.BINANCE_API_KEY || '';
    const binanceSecret = process.env.BINANCE_API_SECRET || '';

    return NextResponse.json({
      credentialsConfigured: !!(binanceKey && binanceSecret),
      keyPresent: !!binanceKey,
      secretPresent: !!binanceSecret,
    });
  } catch (err: any) {
    console.error('Error in /api/trade/status GET:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { settings } = body;

    if (!settings) {
      return NextResponse.json({ error: 'Settings payload is missing' }, { status: 400 });
    }

    const { n8nBaseUrl, webhookStatusPath } = settings;
    const n8nWebhookUrl = `${n8nBaseUrl}${webhookStatusPath}`;

    const binanceKey = process.env.BINANCE_API_KEY || '';
    const binanceSecret = process.env.BINANCE_API_SECRET || '';

    // Query n8n for current position status
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Binance-API-Key': binanceKey,
        'X-Binance-API-Secret': binanceSecret,
      },
      body: JSON.stringify({ symbol: 'PAXGUSDT' }),
    });

    if (!response.ok) {
      const errorMsg = await response.text();
      return NextResponse.json(
        { error: `n8n status query failed: ${errorMsg || response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Error querying position status via proxy:', err);
    return NextResponse.json(
      { error: `Status proxy error: ${err.message}` },
      { status: 500 }
    );
  }
}
