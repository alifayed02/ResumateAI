import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';

import aiRoutes from './routes/ai_routes.js';
import userRoutes from './routes/user_routes.js';

import { connectDB } from './config/mongo_connect.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

await connectDB();

app.use(helmet());

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
}));

app.use(express.json());

// Log requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

app.get('/', (req, res) => {
    res.send('Hello, world!');
});

app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/user', userRoutes);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({ msg: err.message || 'Server Error' });
});

app.listen(PORT, (err) => {
    if (err) {
        console.error(`Failed to start server: ${err.message}`);
        process.exit(1);
    }
    console.log(`Running on Port ${PORT}`);
});