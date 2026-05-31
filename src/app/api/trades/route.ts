import { NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const {
      id,
      symbol,
      direction,
      entry_price,
      sl_price,
      tp1_price,
      tp2_price,
      tp1_hit,
      tp2_hit,
      exit_price,
      position_size_usdt,
      capital_thb,
      pnl_usdt,
      pnl_thb,
      status,
      opened_at,
      closed_at,
      notes,
    } = payload;

    // Validate essential fields
    if (!direction || !entry_price || !status) {
      return NextResponse.json(
        { error: 'direction, entry_price, and status are required fields.' },
        { status: 400 }
      );
    }

    console.log(`Syncing completed trade record from n8n. ID: ${id || 'NEW'}. Status: ${status}`);

    const tradeRecord: any = {
      symbol: symbol || 'PAXGUSDT',
      direction,
      entry_price: Number(entry_price),
      sl_price: Number(sl_price),
      tp1_price: Number(tp1_price),
      tp2_price: Number(tp2_price),
      tp1_hit: !!tp1_hit,
      tp2_hit: !!tp2_hit,
      exit_price: exit_price !== undefined ? Number(exit_price) : null,
      position_size_usdt: Number(position_size_usdt),
      capital_thb: Number(capital_thb || 10000),
      pnl_usdt: pnl_usdt !== undefined ? Number(pnl_usdt) : null,
      pnl_thb: pnl_thb !== undefined ? Number(pnl_thb) : null,
      status,
      opened_at: opened_at || new Date().toISOString(),
      closed_at: closed_at || (status === 'CLOSED' || status === 'SL_HIT' || status === 'TP2_HIT' ? new Date().toISOString() : null),
      notes: notes || 'Synced via n8n webhook API',
    };

    if (id) {
      tradeRecord.id = id;
    }

    // Persist to Supabase if configured
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('trades')
        .upsert(tradeRecord)
        .select();

      if (error) {
        console.error('Supabase trades upsert failed:', error);
        return NextResponse.json({ error: `Database error: ${error.message}` }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Trade synced to Supabase trades table successfully ✓',
        data,
      });
    }

    // Fallback: log to console if Supabase is offline
    console.log('Supabase not configured, trade details:', tradeRecord);
    return NextResponse.json({
      success: true,
      message: 'Supabase not configured. Trade details logged on server side.',
      data: tradeRecord,
    });
  } catch (err: any) {
    console.error('Error handling trades webhook POST:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  // Support loading trades list from server if client desires
  try {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .order('opened_at', { ascending: false });

      if (error) throw error;
      return NextResponse.json(data);
    }
    return NextResponse.json({ message: 'Supabase client not connected' }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
