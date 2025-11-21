// Políticas centralizadas do ciclo de vida das tentativas de exame.
// Cada valor pode ser sobrescrito por variável de ambiente (ideal para ajuste sem deploy).
// Unidades:
//  - Horas: timeouts e limiares de inatividade
//  - Dias: janela para expurgo definitivo
// Significado de cada política:
//  INACTIVITY_TIMEOUT_FULL_HOURS: número de horas sem atividade (LastActivityAt) para exames completos (full) serem marcados por timeout de inatividade.
//  INACTIVITY_TIMEOUT_DEFAULT_HOURS: número de horas sem atividade para exames não full (quiz ou modos menores) sofrerem timeout.
//  ABANDON_THRESHOLD_PERCENT: porcentagem mínima respondida abaixo da qual, combinado com inatividade prolongada, marcamos como "abandoned".
//  ABANDON_THRESHOLD_INACTIVITY_HOURS: quantidade de horas de inatividade necessária (para qualquer modo) para aplicar a regra de abandono por baixo progresso.
//  PURGE_AFTER_DAYS: idade mínima (em dias desde StartedAt) para que tentativas abandonadas possam ser consideradas para expurgo.
//  PURGE_LOW_PROGRESS_PERCENT: porcentagem máxima de progresso (respondido) para que a tentativa abandonada seja realmente expurgada (se igual ou acima mantemos para análise futura).
//  BATCH_LIMIT: número máximo de tentativas processadas por execução de scripts/endpoint para evitar operações muito longas ou locks extensos.

function envNumber(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const examPolicies = {
  INACTIVITY_TIMEOUT_FULL_HOURS: envNumber('EXAM_INACTIVITY_TIMEOUT_FULL_HOURS', 4), // Horas sem atividade para timeout em modo full.
  INACTIVITY_TIMEOUT_DEFAULT_HOURS: envNumber('EXAM_INACTIVITY_TIMEOUT_DEFAULT_HOURS', 24), // Horas sem atividade para timeout em modos não full.
  ABANDON_THRESHOLD_PERCENT: envNumber('EXAM_ABANDON_THRESHOLD_PERCENT', 30), // Percentual respondido abaixo do qual pode ser marcado como abandonado (com inatividade >= limite).
  ABANDON_THRESHOLD_INACTIVITY_HOURS: envNumber('EXAM_ABANDON_THRESHOLD_INACTIVITY_HOURS', 6), // Horas de inatividade usadas na regra de abandono por baixo progresso.
  PURGE_AFTER_DAYS: envNumber('EXAM_PURGE_AFTER_DAYS', 7), // Dias após início para considerar expurgo.
  PURGE_LOW_PROGRESS_PERCENT: envNumber('EXAM_PURGE_LOW_PROGRESS_PERCENT', 20), // Percentual máximo respondido para permitir expurgo; >= mantém registro.
  BATCH_LIMIT: envNumber('EXAM_POLICY_BATCH_LIMIT', 250), // Limite de processamento por execução (scripts/endpoints).
};

module.exports = examPolicies;
