import dotenv from 'dotenv';
import multer from 'multer';
import { Readable } from 'stream';

import UserModel from '../models/user_model.js';
import { resumesBucket } from '../config/mongo_connect.js';

dotenv.config();

const upload = multer();

export async function createUser(req, res) {
    const firebase_id = req.body.firebase_id;
    const email = req.body.email;

    try {
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'User already exists' });
        }
        const user = new UserModel({
            firebase_id,
            email
        });
        await user.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Failed to create user:', error);
        res.status(500).json({ message: 'Failed to create user' });
    }
}

export async function uploadResume(req, res) {
    const firebase_id = req.body.firebase_id;

    try {
        const user = await UserModel.findOne({ firebase_id });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const resume = req.file;
        if (!resume) {
            return res.status(400).json({ message: 'No resume uploaded' });
        }

        const readableResumeStream = new Readable();
        readableResumeStream.push(resume.buffer);
        readableResumeStream.push(null);

        const uploadStream = resumesBucket.openUploadStream(`${user._id}-${resume.originalname}`, {
            contentType: resume.mimetype,
            metadata: {
                userId: user._id,
                email: user.email,
                originalFilename: resume.originalname
            }
        });

        user.resumeFileId = uploadStream.id;

        readableResumeStream.pipe(uploadStream);

        uploadStream.on('finish', async () => {
            try {
                await user.save();
                res.status(200).json({ 
                    message: 'Resume uploaded successfully',
                    resumeId: uploadStream.id
                });
            } catch (error) {
                console.error('Failed to save user after resume upload:', error);
                res.status(500).json({ message: 'Failed to update user with resume information' });
            }
        });
        
        uploadStream.on('error', (error) => {
            console.error('Error uploading to GridFS:', error);
            res.status(500).json({ message: 'Failed to store resume' });
        });
    } catch (error) {
        console.error('Failed to upload resume:', error);
        res.status(500).json({ message: 'Failed to upload resume' });
    }
}

export async function retrieveResume(req, res) {
    const email = req.body.email;

    
}