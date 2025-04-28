import mongoose from 'mongoose';
import dotenv from 'dotenv'
import { GridFSBucket } from 'mongodb';

dotenv.config();

let resumesBucket;

export async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');

        const db = mongoose.connection.db;
        resumesBucket = new GridFSBucket(db, {
            bucketName: 'resumes'
        });
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
};

export { resumesBucket };