import { Router } from 'express';
import express from 'express';

import multer from 'multer';

import { createUser, getUser, uploadResume, retrieveResume, validateUserMembership } from '../controllers/user_controller.js';

const router = Router();
const upload = multer();

router.post('/create', express.json(), createUser);
router.post('/get', express.json(), getUser);
router.post('/validate_membership', express.json(), validateUserMembership);
router.post('/upload_resume', upload.single('file'), uploadResume);
router.post('/retrieve_resume', express.json(), retrieveResume);

export default router;
