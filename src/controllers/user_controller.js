import dotenv from 'dotenv';
import multer from 'multer';
import { Readable } from 'stream';
import { ObjectId } from 'mongodb';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import mongoose from 'mongoose';

import UserModel from '../models/user_model.js';
import { resumesBucket, optimizedResumesBucket } from '../config/mongo_connect.js';
import admin from '../config/firebase_config.js';

dotenv.config();

const client = new OpenAI();

export async function createUser(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'We encountered an unexpected problem. Please refresh and try again.' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const firebase_id = decodedToken.uid;
        const email = req.body.email;
        
        if (email !== decodedToken.email) {
            return res.status(403).json({ message: 'We encountered a problem optimizing your resume. Please refresh and try again.' });
        }
        const existingUser = await UserModel.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'An account with this email already exists. Please sign in.' });
        }
        const user = new UserModel({
            firebase_id,
            email,
            credits: 1
        });
        await user.save();
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Failed to create user:', error);
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ message: 'Token expired' });
        } else if (error.code && error.code.startsWith('auth/')) {
            return res.status(401).json({ message: 'Invalid token' });
        }
        res.status(500).json({ message: 'Failed to create user' });
    }
}

export async function getUser(req, res) {
    const firebase_id = req.body.firebase_id;
    const user = await UserModel.findOne({ firebase_id });
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json(user);
}

export async function validateUserMembership(req, res) {
    const firebase_id = req.body.firebase_id;
    
    try {
        const user = await UserModel.findOne({ firebase_id });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if(user.subscription === "active") {
            return res.status(200).json({ message: 'Membership status validated'});
        }

        if (user.subscription_end && user.subscription_end < new Date()) {
            if (user.membership !== 'free' || user.subscription !== 'inactive') {
                user.membership = 'free';
                user.subscription = 'inactive';
                await user.save();
            }
        }

        res.status(200).json({ message: 'Membership status validated'});

    } catch (error) {
        console.error('Failed to update user membership:', error);
        res.status(500).json({ message: 'Failed to update user membership', error: error.message });
    }
}

export async function uploadResume(req, res) {
    if(!req.file && !req.body.text) {
        console.error("Missing resume file or text");
        return res.status(400).json({ message: 'Missing resume or firebase_id' });
    }

    if(req.file && req.body.text) {
        console.error("Can't upload both file and text");
        return res.status(400).json({ message: 'Can\'t upload both file and text' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log("No token provided or invalid format");
        return res.status(401).json({ message: 'No token provided or invalid format' });
    }
    
    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const firebase_id = decodedToken.uid;
        
        const user = await UserModel.findOne({ firebase_id });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if(req.file) {
            const resume = req.file;

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

            user.resumeText = null;
            user.resumeFileId = uploadStream.id;

            readableResumeStream.pipe(uploadStream);

            uploadStream.on('finish', async () => {
                try {
                    // Create OpenAI file from the uploaded PDF
                    const fileId = uploadStream.id;
                    const filesColl = mongoose.connection.db.collection('resumes.files');
                    const fileDoc = await filesColl.findOne({ _id: fileId });
                    if (!fileDoc) {
                        throw new Error('File not found in GridFS');
                    }
                    const tmpPath = path.join(os.tmpdir(), `${fileId}-${fileDoc.filename}`);
                    
                    await pipeline(
                        resumesBucket.openDownloadStream(fileId),
                        fs.createWriteStream(tmpPath)
                    );
                    
                    const openaiFile = await client.files.create({
                        file: fs.createReadStream(tmpPath), 
                        purpose: "user_data"
                    });

                    // Clean up temporary file
                    fs.unlink(tmpPath, (err) => {
                        if (err) {
                            console.error(`Error deleting temporary file ${tmpPath}:`, err);
                        } else {
                            console.log(`Temporary file ${tmpPath} deleted successfully`);
                        }
                    });

                    // Store OpenAI file ID in user document
                    user.resumeOpenAIFileId = openaiFile.id;
                    console.log(`OpenAI file created successfully with ID: ${openaiFile.id}`);
                    
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
        } else if(req.body.text) {
            const resume = req.body.text;

            user.resumeText = resume;
            user.resumeFileId = null;
            user.resumeOpenAIFileId = null;

            await user.save();
            res.status(200).json({ message: 'Resume uploaded successfully' });
        }

    } catch (error) {
        console.error('Failed to upload resume:', error);
        res.status(500).json({ message: 'Failed to upload resume' });
    }
}

export async function retrieveResume(req, res) {
    const firebase_id = req.body.firebase_id;
    if (!firebase_id) {
        return res.status(400).json({ message: 'Firebase ID is required' });
    }

    try {
        const user = await UserModel.findOne({ firebase_id });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const optimizedResumeIdString = user.optimizedResumeFileId;
        if (!optimizedResumeIdString) {
            return res.status(404).json({ message: 'No optimized resume found for this user' });
        }

        const optimizedResumeId = new ObjectId(optimizedResumeIdString);

        // Optional: Check if file exists in GridFS metadata before attempting to stream
        const filesColl = optimizedResumesBucket.s.db.collection('optimized_resumes.files');
        const fileDoc = await filesColl.findOne({ _id: optimizedResumeId });

        if (!fileDoc) {
            console.error(`Optimized resume file not found in GridFS for ID: ${optimizedResumeIdString}`);
            return res.status(404).json({ message: 'Optimized resume file not found in storage' });
        }

        // Set headers for PDF download
        // Using a generic filename, or you can use fileDoc.filename if available and preferred
        const downloadFileName = fileDoc.filename || `${user._id}_optimized_resume.pdf`; 
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);

        const downloadStream = optimizedResumesBucket.openDownloadStream(optimizedResumeId);

        downloadStream.on('error', (error) => {
            console.error('Error streaming optimized resume from GridFS:', error);
            // Important: Check if headers have already been sent
            if (!res.headersSent) {
                res.status(500).json({ message: 'Failed to retrieve optimized resume' });
            } else {
                // If headers are sent, the connection will likely be terminated by the client or hang
                // It's good practice to end the response if possible, though it might be too late.
                res.end(); 
            }
        });

        downloadStream.pipe(res);

    } catch (error) {
        console.error('Error in retrieveResume function:', error);
        if (!res.headersSent) {
            if (error instanceof mongoose.Error.CastError || error.name === 'BSONTypeError') {
                 return res.status(400).json({ message: 'Invalid optimized resume file ID format' });
            }
            res.status(500).json({ message: 'Server error while retrieving resume' });
        }
    }
}