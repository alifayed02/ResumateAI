import { Router } from 'express';
import express from 'express';

import multer from 'multer';

import { createUser, getUser, uploadResume, retrieveResume, validateUserMembership } from '../controllers/user_controller.js';
import authMiddleware from '../middleware/auth_middleware.js';

const router = Router();
const upload = multer();

// Middleware to handle both file uploads and JSON data
const handleResumeUpload = (req, res, next) => {
    const contentType = req.get('Content-Type');
    
    if (contentType && contentType.includes('multipart/form-data')) {
        // Handle file upload
        upload.single('file')(req, res, next);
    } else {
        // Handle JSON data
        express.json()(req, res, next);
    }
};

router.post('/create', authMiddleware, express.json(), createUser);
router.get('/get', authMiddleware, express.json(), getUser);
router.post('/validate_membership', authMiddleware, express.json(), validateUserMembership);
router.post('/upload_resume', authMiddleware, handleResumeUpload, uploadResume);
router.get('/retrieve_resume', authMiddleware, express.json(), retrieveResume);

export default router;
