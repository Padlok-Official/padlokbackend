import { IdempotencyKey } from '../../types';

export interface IIdempotencyKeyRepository {
  find(key: string, userId: string): Promise<IdempotencyKey | null>;
  create(data: {
    key: string;
    user_id: string;
    request_path: string;
    request_body_hash: string;
  }): Promise<IdempotencyKey>;
  updateResponse(key: string, status: number, body: Record<string, unknown>): Promise<void>;
  cleanExpired(): Promise<number>;
}
