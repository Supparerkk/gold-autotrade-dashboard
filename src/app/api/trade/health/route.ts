import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const n8nBaseUrl = searchParams.get('n8nBaseUrl') || '';

    if (!n8nBaseUrl) {
      return NextResponse.json({ error: 'n8nBaseUrl query parameter is required' }, { status: 400 });
    }

    const healthCheckUrl = `${n8nBaseUrl}/webhook/health-check`;
    console.log(`Pinging n8n health-check endpoint: ${healthCheckUrl}`);

    // Fetch GET request to n8n health check
    const response = await fetch(healthCheckUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({
        success: false,
        message: `n8n responded with status ${response.status}: ${text || response.statusText}`
      });
    }

    const data = await response.json().catch(() => ({}));
    return NextResponse.json({
      success: true,
      message: 'Connection successful ✓',
      ...data
    });
  } catch (err: any) {
    console.error('Error in n8n health-check proxy:', err);
    return NextResponse.json({
      success: false,
      message: `Failed to connect: ${err.message || 'Check URL and CORS configuration'}`
    });
  }
}

export async function POST(req: Request) {
  // Support POST health-checks as alternative
  try {
    const body = await req.json();
    const { n8nBaseUrl } = body;

    if (!n8nBaseUrl) {
      return NextResponse.json({ error: 'n8nBaseUrl is required' }, { status: 400 });
    }

    const healthCheckUrl = `${n8nBaseUrl}/webhook/health-check`;

    const response = await fetch(healthCheckUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ping: 'pong' })
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({
        success: false,
        message: `n8n responded with status ${response.status}: ${text || response.statusText}`
      });
    }

    const data = await response.json().catch(() => ({}));
    return NextResponse.json({
      success: true,
      message: 'Connection successful ✓',
      ...data
    });
  } catch (err: any) {
    console.error('Error in n8n health-check proxy (POST):', err);
    return NextResponse.json({
      success: false,
      message: `Failed to connect: ${err.message || 'Check URL configuration'}`
    });
  }
}
