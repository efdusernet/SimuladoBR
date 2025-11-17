const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const questionController = require('../controllers/questionController');
const requireAdmin = require('../middleware/requireAdmin');

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
router.get('/', requireAdmin, questionController.listQuestions);
router.get('/:id', requireAdmin, questionController.getQuestionById);

// Update question
router.put('/:id', requireAdmin, questionController.updateQuestion);

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
