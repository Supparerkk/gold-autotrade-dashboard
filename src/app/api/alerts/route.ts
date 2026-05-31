import { NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const { trade_id, status, exit_price, pnl_usdt, pnl_thb, message } = payload;

    if (!trade_id || !status) {
      return NextResponse.json({ error: 'trade_id and status are required' }, { status: 400 });
    }

    console.log(`Alert received for trade ${trade_id}. Status: ${status}. Message: ${message}`);

    // If Supabase is configured, persist the status change
    if (isSupabaseConfigured && supabase) {
      const updateData: any = {
        status,
        updated_at: new Date().toISOString(),
      };

      if (exit_price !== undefined) updateData.exit_price = exit_price;
      if (pnl_usdt !== undefined) updateData.pnl_usdt = pnl_usdt;
      if (pnl_thb !== undefined) updateData.pnl_thb = pnl_thb;
      
      if (status === 'SL_HIT') {
        updateData.sl_hit = true;
        updateData.result = 'LOSS';
      } else if (status === 'TP1_HIT') {
        updateData.tp1_hit = true;
      } else if (status === 'TP2_HIT') {
        updateData.tp2_hit = true;
        updateData.result = 'WIN';
        updateData.status = 'CLOSED'; // Set status to CLOSED if TP2 hit completes the trade
      } else if (status === 'CLOSED') {
        updateData.result = pnl_usdt > 0 ? 'WIN' : 'LOSS';
      }

      const { error } = await supabase
        .from('trade_logs')
        .update(updateData)
        .eq('id', trade_id);

      if (error) {
        console.error('Failed to update trade in Supabase on alert:', error);
        return NextResponse.json({ error: `Supabase update failed: ${error.message}` }, { status: 500 });
      }
    }

    // Success response
    return NextResponse.json({
      success: true,
      message: `Alert processed successfully. State updated to ${status}.`,
    });
  } catch (err: any) {
    console.error('Error handling alert webhook:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
