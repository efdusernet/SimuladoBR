-- 046_create_user_daily_snapshot.sql
-- Daily snapshot of AI/Insights KPIs for temporal risk modeling.
-- Only recorded for paying users (Usuario.BloqueioAtivado = false) at application level.

CREATE TABLE IF NOT EXISTS public.user_daily_snapshot (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public."Usuario"("Id") ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  period_days INTEGER NOT NULL,
  exam_date_raw TEXT NULL,
  days_to_exam INTEGER NULL,

  readiness_score INTEGER NULL,
  consistency_score INTEGER NULL,
  avg_score_percent NUMERIC(5,2) NULL,
  completion_rate NUMERIC(6,4) NULL,
  abandon_rate NUMERIC(6,4) NULL,
  trend_delta_score7d NUMERIC(6,2) NULL,

  pass_probability_percent NUMERIC(5,2) NULL,
  pass_probability_overall_percent NUMERIC(5,2) NULL,
  pass_probability_threshold_percent NUMERIC(5,2) NULL,

  ind13_dominio_id INTEGER NULL,
  ind13_min_total INTEGER NULL,

  payload JSONB NULL,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_user_daily_snapshot_user_date UNIQUE (user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_snapshot_user_date ON public.user_daily_snapshot (user_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_daily_snapshot_date ON public.user_daily_snapshot (snapshot_date DESC);
