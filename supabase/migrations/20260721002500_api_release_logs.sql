CREATE TABLE IF NOT EXISTS public.tracker_api_releases (
  version TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.tracker_api_releases TO service_role;
ALTER TABLE public.tracker_api_releases ENABLE ROW LEVEL SECURITY;
