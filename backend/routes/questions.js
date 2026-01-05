const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const questionController = require('../controllers/questionController');
const requireAdmin = require('../middleware/requireAdmin');
const requireUserSession = require('../middleware/requireUserSession');

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
router.post('/', requireAdmin, questionController.createQuestion);

// List and get by id
// Public (authenticated user) read-only view of a single question (no admin role required)
router.get('/view/:id', requireUserSession, questionController.getQuestionById);

router.get('/', requireAdmin, questionController.listQuestions);
// Exists MUST come before the generic :id route to avoid shadowing ('exists' being treated as an id)
router.get('/exists', requireAdmin, questionController.existsQuestion);
router.get('/:id', requireAdmin, questionController.getQuestionById);

// Update question
router.put('/:id', requireAdmin, questionController.updateQuestion);

// Save/update explanation for a specific option (respostaopcao)
router.put('/options/:optionId/explanation', requireAdmin, questionController.saveOptionExplanation);

// Delete (soft-delete) question
router.delete('/:id', requireAdmin, questionController.deleteQuestion);

// Bulk upload: accepts JSON body or multipart/form-data with a file field named "file"
// JSON format:
//  - Either an array of questions [{ descricao, tiposlug, examTypeSlug|examTypeId, options:[{descricao, correta}], ... }]
//  - Or an object { examTypeSlug|examTypeId, iddominio?, codareaconhecimento?, codgrupoprocesso?, dica?, questions:[...] }
// XML format (file upload):
//  <questions examType="pmp">
//    <question>
//      <descricao>...</descricao>
//      <tipo>single|multi|...</tipo>
//      <alternativas>
//        <alternativa correta="true">Texto A</alternativa>
//        <alternativa>Texto B</alternativa>
//      </alternativas>
//      <explicacao>Opcional</explicacao>
//    </question>
//  </questions>
router.post('/bulk', requireAdmin, upload.single('file'), questionController.bulkCreateQuestions);

module.exports = router;
