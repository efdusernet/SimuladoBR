-- Create table to register app indicators and their placement
CREATE TABLE IF NOT EXISTS indicator (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NULL,
  pagina TEXT NOT NULL,
  elemento_html TEXT NOT NULL,
  formula_calculo TEXT NULL,
  parametros_entrada JSONB NULL,
  versao_exame TEXT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Basic index to search by page and element
CREATE INDEX IF NOT EXISTS idx_indicator_pagina_elemento
  ON indicator(pagina, elemento_html);
