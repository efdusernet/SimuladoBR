-- Single active session per user
-- Creates a 1:1 mapping of user -> active session id.

CREATE TABLE IF NOT EXISTS public.user_active_session (
  user_id INTEGER PRIMARY KEY REFERENCES public.usuario("Id") ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_active_session_updated_at ON public.user_active_session(updated_at);
