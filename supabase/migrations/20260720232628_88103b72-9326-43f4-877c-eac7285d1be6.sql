
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Updated-at trigger helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Tracked X accounts
CREATE TABLE public.tracked_x_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT NOT NULL UNIQUE,
  last_post_url TEXT,
  last_post_text TEXT,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_x_accounts TO anon, authenticated;
GRANT ALL ON public.tracked_x_accounts TO service_role;
ALTER TABLE public.tracked_x_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read tracked_x_accounts" ON public.tracked_x_accounts FOR SELECT USING (true);
CREATE POLICY "Public write tracked_x_accounts" ON public.tracked_x_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update tracked_x_accounts" ON public.tracked_x_accounts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete tracked_x_accounts" ON public.tracked_x_accounts FOR DELETE USING (true);
CREATE TRIGGER trg_tracked_x_accounts_updated_at BEFORE UPDATE ON public.tracked_x_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tracked products (Eldorado.gg listings)
CREATE TABLE public.tracked_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  last_price NUMERIC,
  currency TEXT,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracked_products TO anon, authenticated;
GRANT ALL ON public.tracked_products TO service_role;
ALTER TABLE public.tracked_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read tracked_products" ON public.tracked_products FOR SELECT USING (true);
CREATE POLICY "Public write tracked_products" ON public.tracked_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update tracked_products" ON public.tracked_products FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete tracked_products" ON public.tracked_products FOR DELETE USING (true);
CREATE TRIGGER trg_tracked_products_updated_at BEFORE UPDATE ON public.tracked_products
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Price history
CREATE TABLE public.price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.tracked_products(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  currency TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX price_history_product_id_checked_at_idx ON public.price_history(product_id, checked_at DESC);
GRANT SELECT ON public.price_history TO anon, authenticated;
GRANT ALL ON public.price_history TO service_role;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read price_history" ON public.price_history FOR SELECT USING (true);

-- Hourly cron: call the run-checks endpoint
SELECT cron.schedule(
  'tracker-run-checks-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--4643c934-856e-487c-b22f-b0ba8a7abd8c.lovable.app/api/public/run-checks',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZ212bHh6Z3B4dGtxc2xjem1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1ODAzNTAsImV4cCI6MjEwMDE1NjM1MH0.GYy64C87bODxnhkbDNJrPVaOb93PKyltV_hryLXoqZI"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
