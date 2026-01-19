const express = require('express');
const router = express.Router();

const requireAdmin = require('../middleware/requireAdmin');
const adminFlashcardController = require('../controllers/adminFlashcardController');

// GET /api/admin/flashcards?versionId=2&q=texto
router.get('/', requireAdmin, adminFlashcardController.listFlashcards);

// GET /api/admin/flashcards/versions
router.get('/versions', requireAdmin, adminFlashcardController.listVersions);

// POST /api/admin/flashcards
router.post('/', requireAdmin, adminFlashcardController.createFlashcard);

// PUT /api/admin/flashcards/:id
router.put('/:id', requireAdmin, adminFlashcardController.updateFlashcard);

// DELETE /api/admin/flashcards/:id
router.delete('/:id', requireAdmin, adminFlashcardController.deleteFlashcard);

module.exports = router;
