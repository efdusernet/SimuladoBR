-- Pivot: role -> permission (N:N)
CREATE TABLE IF NOT EXISTS public.role_permission (
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_id) REFERENCES public.role(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permission_perm FOREIGN KEY (permission_id) REFERENCES public.permission(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_role_permission_role ON public.role_permission(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permission_perm ON public.role_permission(permission_id);
