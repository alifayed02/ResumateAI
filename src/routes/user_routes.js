import { Router } from 'express';
import express from 'express';

import multer from 'multer';

import { createUser, uploadResume } from '../controllers/user_controller.js';

const router = Router();
const upload = multer();

router.post('/create', express.json(), createUser);
router.post('/upload-resume', upload.single('file'), uploadResume);

export default router;
