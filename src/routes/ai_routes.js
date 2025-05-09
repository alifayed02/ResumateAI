import { Router } from 'express';
import express from 'express';

import { optimize } from '../controllers/ai_controller.js';

const router = Router();

router.post('/optimize', express.json(), optimize);

export default router;