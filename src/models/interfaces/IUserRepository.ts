import { User } from '../../types';

export interface IUserRepository {
  findByEmail(email: string): Promise<(User & { password_hash: string; last_login_at: Date | null; pin_set_at: Date | null }) | null>;
  findByEmailOrPhone(email: string, phoneNumber: string): Promise<{ id: string } | null>;
  findById(id: string): Promise<User | null>;
  findByIdWithPassword(id: string): Promise<(User & { password_hash: string }) | null>;
  create(data: { name: string; email: string; password_hash: string; phone_number: string }): Promise<User>;
  update(id: string, updates: { name?: string; phone_number?: string; username?: string; bio?: string; location?: string; profile_photo?: string }): Promise<User | null>;
  updatePassword(id: string, password_hash: string): Promise<void>;
  updateLastLogin(id: string): Promise<void>;
  updateFcmToken(id: string, token: string | null): Promise<void>;
  isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean>;
  isPhoneNumberTaken(phoneNumber: string, excludeUserId?: string): Promise<boolean>;
  getPinData(id: string): Promise<{ pin_hash: string | null; pin_set_at: Date | null; pin_attempts: number; pin_locked_until: Date | null }>;
  setPin(id: string, pinHash: string): Promise<void>;
  incrementPinAttempts(id: string): Promise<number>;
  resetPinAttempts(id: string): Promise<void>;
  lockPin(id: string, lockedUntil: Date): Promise<void>;
  hashPassword(password: string): Promise<string>;
  comparePassword(password: string, hash: string): Promise<boolean>;
  search(query: string, excludeUserId: string): Promise<User[]>;
  getAllFcmTokens(limit: number, offset: number): Promise<string[]>;
  countWithFcmToken(): Promise<number>;
}
