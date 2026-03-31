import { IOTP, CreateOTPData } from '../../types/otp';

export interface IOtpRepository {
  findValidOTP(email: string): Promise<IOTP | undefined>;
  findVerifiedOTP(email: string): Promise<IOTP | undefined>;
  create(data: CreateOTPData): Promise<IOTP>;
  update(id: string, data: Partial<CreateOTPData>): Promise<IOTP | undefined>;
  findById(id: string): Promise<IOTP | undefined>;
  deleteUnverified(email: string): Promise<void>;
  delete(id: string): Promise<boolean>;
}
