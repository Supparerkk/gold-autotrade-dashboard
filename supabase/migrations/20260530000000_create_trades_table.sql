-- Create trades table for Gold Auto Trading Dashboard
CREATE TABLE IF NOT EXISTS trades (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT DEFAULT 'PAXGUSDT',
  direction TEXT CHECK (direction IN ('LONG', 'SHORT')),
  entry_price NUMERIC,
  sl_price NUMERIC,
  tp1_price NUMERIC,
  tp2_price NUMERIC,
  tp1_hit BOOLEAN DEFAULT false,
  tp2_hit BOOLEAN DEFAULT false,
  exit_price NUMERIC,
  position_size_usdt NUMERIC,
  capital_thb NUMERIC DEFAULT 10000,
  pnl_usdt NUMERIC,
  pnl_thb NUMERIC,
  status TEXT CHECK (status IN ('OPEN','TP1_HIT','TP2_HIT','SL_HIT','CLOSED')),
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  notes TEXT
);

-- Enable RLS (Row Level Security) if desired, or allow public anon access for this dashboard
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all actions for anonymous public access (appropriate for local solo-trader dashboard)
CREATE POLICY "Allow public read access" ON trades FOR SELECT USING (true);
CREATE POLICY "Allow public insert access" ON trades FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access" ON trades FOR UPDATE USING (true);
CREATE POLICY "Allow public delete access" ON trades FOR DELETE USING (true);
