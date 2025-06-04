import { Router } from 'express';
import express from 'express';

import { optimize, calculateATS } from '../controllers/ai_controller.js';
const router = Router();

router.post('/optimize', express.json(), optimize);
router.post('/ats', express.json(), calculateATS);

export default router;