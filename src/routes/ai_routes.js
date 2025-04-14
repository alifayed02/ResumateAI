import { Router } from 'express';

const router = Router();

router.post('/optimize', (req, res) => {
    res.send('Optimize');
});