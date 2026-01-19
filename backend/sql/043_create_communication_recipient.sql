-- 043_create_communication_recipient.sql
-- Registry of admins who receive platform communications

CREATE TABLE IF NOT EXISTS public.communication_recipient (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_communication_recipient_user FOREIGN KEY (user_id) REFERENCES "Usuario"("Id")
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_communication_recipient_user
  ON public.communication_recipient (user_id);

CREATE INDEX IF NOT EXISTS idx_communication_recipient_active
  ON public.communication_recipient (active);
