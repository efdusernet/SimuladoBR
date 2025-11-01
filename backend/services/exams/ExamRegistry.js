// Simple in-memory registry of exam types and their strategies (initial version)
// Later this can read from DB (ExamType table) or config files.

const TYPES = [
  {
    id: 'pmp',
    nome: 'PMP',
    numeroQuestoes: 180,
    duracaoMinutos: 230,
    opcoesPorQuestao: 4,
    multiplaSelecao: false,
    pontuacaoMinima: null, // define when grading thresholds are known
    pausas: { permitido: true, checkpoints: [60, 120], duracaoMinutosPorPausa: 10 },
  },
];

function getTypes() {
  return TYPES.map(t => ({
    id: t.id,
    nome: t.nome,
    numeroQuestoes: t.numeroQuestoes,
    duracaoMinutos: t.duracaoMinutos,
    opcoesPorQuestao: t.opcoesPorQuestao,
    multiplaSelecao: t.multiplaSelecao,
    pontuacaoMinima: t.pontuacaoMinima,
    pausas: t.pausas,
  }));
}

function getTypeById(id) {
  return TYPES.find(t => t.id === id) || TYPES[0]; // default to first (pmp)
}

function getPausePolicy(examTypeId) {
  const t = getTypeById(examTypeId);
  return t && t.pausas ? t.pausas : { permitido: false, checkpoints: [], duracaoMinutosPorPausa: 0 };
}

module.exports = { getTypes, getTypeById, getPausePolicy };
