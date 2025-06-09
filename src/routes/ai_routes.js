import { Router } from 'express';
import express from 'express';

import { optimize, calculateATS } from '../controllers/ai_controller.js';
import authMiddleware from '../middleware/auth_middleware.js';
const router = Router();

router.post('/optimize', authMiddleware, express.json(), optimize);
router.post('/ats', authMiddleware, express.json(), calculateATS);

export default router;