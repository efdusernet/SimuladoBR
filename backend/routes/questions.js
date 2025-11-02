const express = require('express');
const router = express.Router();

const questionController = require('../controllers/questionController');

// Create a new question (with optional options)
// Body: {
//   descricao: string,
//   tiposlug?: 'single'|'multi'|string,
//   multiplaescolha?: boolean,
//   iddominio?: number,
//   codareaconhecimento?: number,
//   codgrupoprocesso?: number,
//   dica?: string,
//   options?: [{ descricao: string, correta?: boolean }]
// }
router.post('/', questionController.createQuestion);

module.exports = router;
