import { Router } from 'express';
import express from 'express';

import { createOneTimePaymentSession, createSubscriptionSession, cancelSubscription } from '../controllers/payment_controller.js';
import authMiddleware from '../middleware/auth_middleware.js';

const router = Router();

router.post('/create_payment', authMiddleware, express.json(), createOneTimePaymentSession);
router.post('/create_subscription', authMiddleware, express.json(), createSubscriptionSession);
router.post('/cancel_subscription', authMiddleware, express.json(), cancelSubscription);

export default router;
