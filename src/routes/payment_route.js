import { Router } from 'express';
import express from 'express';

import { createPaymentIntent, webhook } from '../controllers/payment_controller.js';

const router = Router();

router.post('/create', express.json(), createPaymentIntent);
router.post('/webhook', express.raw({ type: "application/json" }), webhook);

export default router;
