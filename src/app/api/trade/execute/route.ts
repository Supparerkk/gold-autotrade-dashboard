import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { settings, ...tradeParams } = body;

    if (!settings) {
      return NextResponse.json({ error: 'Settings are required to execute trade' }, { status: 400 });
    }

    const { n8nBaseUrl, webhookExecutePath } = settings;
    const n8nWebhookUrl = `${n8nBaseUrl}${webhookExecutePath}`;

    // Read Binance API credentials from environment variables securely on server-side
    const binanceKey = process.env.BINANCE_API_KEY || '';
    const binanceSecret = process.env.BINANCE_API_SECRET || '';

    // Structure exact payload for n8n
    const executePayload = {
      symbol: tradeParams.symbol || 'PAXGUSDT',
      direction: tradeParams.direction,
      entry_price: Number(tradeParams.entry_price),
      sl_percent: Number(tradeParams.sl_percent),
      tp1_percent: Number(tradeParams.tp1_percent),
      tp2_percent: Number(tradeParams.tp2_percent),
      position_size_usdt: Number(tradeParams.position_size_usdt),
      capital_thb: Number(tradeParams.capital_thb || 10000),
      timestamp: new Date().toISOString(),
    };

    console.log(`Forwarding execute payload to n8n: ${n8nWebhookUrl}`, JSON.stringify(executePayload));

    // Forward request to n8n webhook API
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Binance-API-Key': binanceKey,
        'X-Binance-API-Secret': binanceSecret,
      },
      body: JSON.stringify(executePayload),
    });

    if (!response.ok) {
      const errorMsg = await response.text();
      return NextResponse.json(
        { error: `n8n execution node responded with error: ${errorMsg || response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      message: 'Trade signal sent to n8n ✓',
      ...data,
    });
  } catch (err: any) {
    console.error('Error in /api/trade/execute proxy:', err);
    return NextResponse.json(
      { error: `Webhook failed: ${err.message || 'Check n8n connectivity'}` },
      { status: 500 }
    );
  }
}
