import { Router } from 'express';

import { optimize } from '../controllers/ai_controller.js';

const router = Router();

router.post('/optimize', optimize);

export default router;