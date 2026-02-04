# Snapshots diários de Insights (modelo temporal)

Este documento descreve a persistência diária dos KPIs/indicadores do endpoint de insights, usada como base para um modelo temporal de risco (tendência real por usuário).

## Visão geral

- Fonte: `GET /api/ai/insights`
- Frequência: **no máximo 1 registro por usuário por dia** (upsert por `(user_id, snapshot_date)`)
- Público-alvo: **somente usuários pagantes**
  - Regra atual: `usuario.BloqueioAtivado = false`
- Tabela: `public.user_daily_snapshot`
- Migração/DDL: `backend/sql/046_create_user_daily_snapshot.sql`

Importante:
- A gravação é **best-effort**: falhas ao gravar snapshot não quebram o retorno do `/api/ai/insights` (erro só é logado).
- Para existir snapshot do dia, o usuário precisa ter gerado insights pelo menos uma vez naquele dia.

## Campos (alto nível)

A tabela armazena:
- Identificação/tempo: `user_id`, `snapshot_date`, `period_days`, `created_at`, `updated_at`
- Contexto de exame (quando disponível): `exam_date_raw`, `days_to_exam`
- KPIs principais: `readiness_score`, `consistency_score`, `avg_score_percent`, `completion_rate`, `abandon_rate`, `trend_delta_score7d`
- Probabilidade (derivada de IND12): `pass_probability_percent`, `pass_probability_overall_percent`, `pass_probability_threshold_percent`
- Contexto do IND13 (filtros): `ind13_dominio_id`, `ind13_min_total`
- `payload` (JSONB): payload adicional para auditoria/depuração (opcional na consulta admin)

## Consulta via Admin API

Endpoint:
- `GET /api/admin/users/:id/insights-snapshots?days=90&includePayload=0`

Notas:
- Requer papel admin (middleware `requireAdmin`).
- `includePayload=1` retorna o campo JSONB `payload` (maior e mais pesado).

## UI Admin (modal)

A interface administrativa exibe os snapshots no modal Admin do frontend, na seção:
- “🕒 Snapshots de Insights (pagantes)”

Ela consulta o endpoint admin acima e renderiza uma tabela com os valores diários.
