import mongoose from 'mongoose';
import dotenv from 'dotenv'
import { GridFSBucket } from 'mongodb';

dotenv.config();

let resumesBucket;
let optimizedResumesBucket;

export async function connectDB() {
    const db_name = 'resumate';
    try {
        await mongoose.connect(process.env.MONGO_URI, { db_name });
        console.log('MongoDB connected');

        const db = mongoose.connection.db;
        resumesBucket = new GridFSBucket(db, {
            bucketName: 'resumes'
        });
        optimizedResumesBucket = new GridFSBucket(db, {
            bucketName: 'optimized_resumes'
        });
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
};

export { resumesBucket, optimizedResumesBucket };