-- 059_create_user_password_change_log.sql
-- Audit log for password changes.
-- Stores: who changed (actor), whose password was changed (target), when, and request metadata.

CREATE TABLE IF NOT EXISTS public.user_password_change_log (
  id BIGSERIAL PRIMARY KEY,
  target_user_id INT NOT NULL,
  actor_user_id INT NULL,
  origin TEXT NULL,
  ip TEXT NULL,
  user_agent TEXT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_user_password_change_log_target_user
    FOREIGN KEY (target_user_id) REFERENCES public.usuario("Id") ON DELETE CASCADE,
  CONSTRAINT fk_user_password_change_log_actor_user
    FOREIGN KEY (actor_user_id) REFERENCES public.usuario("Id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_password_change_log_target_changed
  ON public.user_password_change_log (target_user_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_password_change_log_actor_changed
  ON public.user_password_change_log (actor_user_id, changed_at DESC);
