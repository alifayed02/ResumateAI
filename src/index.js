import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';

import aiRoutes from './routes/ai_routes.js';
import userRoutes from './routes/user_routes.js';
import paymentRoutes from './routes/payment_route.js';
import webhookRoute from './routes/webhook_route.js';
import { connectDB } from './config/mongo_connect.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

await connectDB();

app.use(helmet());

let frontendUrl;

if(process.env.NODE_ENV === 'production') {
    frontendUrl = process.env.PROD_FRONTEND_URL;
} else {
    frontendUrl = process.env.DEV_FRONTEND_URL;
}

console.log("[Debug]: ", frontendUrl);

app.use(cors({
    origin: frontendUrl,
    credentials: true,
}));

app.use('/api/v1/payment', webhookRoute);

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

app.get('/', (req, res) => {
    res.send('Hello, world!');
});

app.use(express.json());

app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/payment', paymentRoutes);

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