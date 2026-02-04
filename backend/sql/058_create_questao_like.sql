-- 058_create_questao_like.sql
-- Registra voto (like/dislike) por usuário por questão.

CREATE TABLE IF NOT EXISTS public.questao_like
(
    idquestao integer NOT NULL,
    idusario integer NOT NULL,
    "like" integer NOT NULL DEFAULT 0,
    dislike integer NOT NULL DEFAULT 0,
    CONSTRAINT questao_like_pk PRIMARY KEY (idquestao, idusario),
    CONSTRAINT questao_like_questao_fk FOREIGN KEY (idquestao)
        REFERENCES public.questao (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
        NOT VALID,
    CONSTRAINT questao_like_usuario_fk FOREIGN KEY (idusario)
        REFERENCES public.usuario ("Id") MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

-- Fallback (caso a tabela exista sem PK por algum motivo):
-- o índice único permite o ON CONFLICT (idquestao, idusario)
CREATE UNIQUE INDEX IF NOT EXISTS questao_like_uq
  ON public.questao_like (idquestao, idusario);
