import { Router } from 'express';
import express from 'express';

import multer from 'multer';

import { createUser, getUser, uploadResume, retrieveResume, validateUserMembership } from '../controllers/user_controller.js';

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

router.post('/create', express.json(), createUser);
router.post('/get', express.json(), getUser);
router.post('/validate_membership', express.json(), validateUserMembership);
router.post('/upload_resume', handleResumeUpload, uploadResume);
router.post('/retrieve_resume', express.json(), retrieveResume);

export default router;
