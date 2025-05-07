import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serviceAccount = JSON.parse(
  await readFile("resumate-9896b-firebase-adminsdk-fbsvc-48c23515fd.json", 'utf8')
);

dotenv.config();

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

export default admin;