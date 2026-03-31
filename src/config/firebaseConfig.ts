import logger from '../utils/logger';
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
            logger.info('Firebase Admin SDK initialized successfully');
        } else {
            logger.error(`Firebase service account file not found at: ${absolutePath}`);
        }
    } catch (error) {
        logger.error({ data: error }, 'Firebase Admin SDK initialization failed');
    }
} else {
    logger.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_PATH not found in environment. Firebase notifications will not be sent.');
}

export default admin;
