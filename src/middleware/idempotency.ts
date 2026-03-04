import crypto from 'crypto';
import { Response, NextFunction } from 'express';
import { IdempotencyKeyModel } from '../models';
import { AuthenticatedRequest } from '../types';

export const requireIdempotencyKey = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const key = req.headers['idempotency-key'] as string;

    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Idempotency-Key header is required for this operation',
      });
    }

    if (key.length > 255) {
      return res.status(400).json({
        success: false,
        message: 'Idempotency-Key must be 255 characters or fewer',
      });
    }

    const bodyHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(req.body || {}))
      .digest('hex');

    const existing = await IdempotencyKeyModel.find(key, req.user!.id);

    if (existing) {
      // Same key with different body = misuse
      if (existing.request_body_hash !== bodyHash) {
        return res.status(422).json({
          success: false,
          message: 'Idempotency key already used with a different request body',
        });
      }

      // Already has a response = return cached
      if (existing.response_status && existing.response_body) {
        return res.status(existing.response_status).json(existing.response_body);
      }

      // Still processing
      return res.status(409).json({
        success: false,
        message: 'A request with this idempotency key is already being processed',
      });
    }

    // Create idempotency record
    await IdempotencyKeyModel.create({
      key,
      user_id: req.user!.id,
      request_path: req.path,
      request_body_hash: bodyHash,
    });

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      IdempotencyKeyModel.updateResponse(
        key,
        res.statusCode,
        body as Record<string, unknown>
      ).catch(() => {
        // Silently fail — idempotency cache miss is acceptable
      });
      return originalJson(body);
    };

    next();
  } catch (err) {
    next(err);
  }
};
