import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (serviceAccountPath) {
    try {
        const absolutePath = path.isAbsolute(serviceAccountPath)
            ? serviceAccountPath
            : path.join(process.cwd(), serviceAccountPath);

        if (fs.existsSync(absolutePath)) {
            admin.initializeApp({
                credential: admin.credential.cert(absolutePath),
            });
            console.log('Firebase Admin SDK initialized successfully');
        } else {
            console.error(`Firebase service account file not found at: ${absolutePath}`);
        }
    } catch (error) {
        console.error('Firebase Admin SDK initialization failed:', error);
    }
} else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_PATH not found in environment. Firebase notifications will not be sent.');
}

export default admin;
