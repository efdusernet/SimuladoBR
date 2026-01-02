-- Pivot: user -> role (N:N)
CREATE TABLE IF NOT EXISTS public.user_role (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES "Usuario"("Id") ON DELETE CASCADE,
  CONSTRAINT fk_user_role_role FOREIGN KEY (role_id) REFERENCES public.role(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_role_user ON public.user_role(user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_role ON public.user_role(role_id);
