-- Add imagemUrl column to questao table for storing image URLs or base64 data
ALTER TABLE public.questao
  ADD COLUMN IF NOT EXISTS imagem_url TEXT;

COMMENT ON COLUMN public.questao.imagem_url IS 'URL ou dados base64 de imagem associada à questão';
