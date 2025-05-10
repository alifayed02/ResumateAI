import { Router } from 'express';
import express from 'express';

import { createOneTimePaymentSession, createSubscriptionSession, webhook } from '../controllers/payment_controller.js';

const router = Router();

router.post('/create_payment', express.json(), createOneTimePaymentSession);
router.post('/create_subscription', express.json(), createSubscriptionSession);
router.post('/webhook', express.raw({ type: "application/json" }), webhook);

export default router;
