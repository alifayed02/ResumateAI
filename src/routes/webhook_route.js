import express from 'express';

import { webhook } from '../controllers/payment_controller.js';

const router = express.Router();

router.post('/webhook', express.raw({type: 'application/json'}), webhook);

export default router; 