import otpModel from '../../models/otpModel';
import { UserModel } from '../../models/User';
import { sendEmail } from '../../infrastructure/email/emailService';
import { AppError } from '../../utils/AppError';

const OTP_EXPIRY_MINUTES = 30;
const MAX_OTP_ATTEMPTS = 5;

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email: string, otpCode: string): Promise<void> {
  const appName = process.env.APP_NAME || 'Padlok';
  const html = `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f5f5; margin:0; padding:0; color:#333; }
  .wrap { max-width:600px; margin:0 auto; background:#fff; border:1px solid #e0e0e0; }
  .header { padding:30px 20px; text-align:center; border-bottom:2px solid #000; }
  .header h1 { font-size:24px; font-weight:600; margin:0; color:#000; letter-spacing:1px; }
  .body { padding:40px 30px; }
  .body p { font-size:16px; margin:0 0 20px; }
  .otp-box { background:#f9f9f9; border:1px solid #d0d0d0; padding:30px; margin:30px 0; text-align:center; }
  .otp-code { font-size:32px; font-weight:600; color:#000; letter-spacing:6px; font-family:'Courier New',monospace; }
  .warning { background:#f9f9f9; border-left:3px solid #666; padding:15px; margin:25px 0; font-size:14px; }
  .footer { background:#f9f9f9; padding:25px; text-align:center; border-top:1px solid #e0e0e0; font-size:12px; color:#666; }
</style></head>
<body><div class="wrap">
  <div class="header"><h1>Email Verification</h1></div>
  <div class="body">
    <p>Hello,</p>
    <p>Thank you for choosing Padlok! Please use the following OTP to verify your email address:</p>
    <div class="otp-box"><div class="otp-code">${otpCode}</div></div>
    <div class="warning"><strong>Important:</strong> This OTP will expire in ${OTP_EXPIRY_MINUTES} minutes. Do not share this code with anyone.</div>
    <p>If you didn't request this verification code, please ignore this email.</p>
  </div>
  <div class="footer"><p>This is an automated email. Please do not reply.</p><p>&copy; ${new Date().getFullYear()} ${appName}</p></div>
</div></body></html>`;

  const text = `Email Verification OTP\n\nYour OTP: ${otpCode}\n\nThis OTP expires in ${OTP_EXPIRY_MINUTES} minutes. Do not share it.`;

  const { error } = await sendEmail({
    from: process.env.BREVO_SENDER_EMAIL || 'noreply@padlok.com',
    to: email,
    subject: 'Email Verification OTP',
    html,
    text,
  });

  if (error) throw new Error(`Failed to send OTP email: ${error.message}`);
}

export const otpService = {
  async sendOTP(email: string) {
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) throw new AppError('User already exists', 400);

    const existingOTP = await otpModel.findValidOTP(email);
    let otpCode: string;
    let otpDocument;

    if (existingOTP && new Date() < existingOTP.expiresAt && !existingOTP.verified && existingOTP.attempts < MAX_OTP_ATTEMPTS) {
      otpCode = existingOTP.otp;
      otpDocument = existingOTP;
    } else {
      otpCode = generateOTP();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);
      await otpModel.deleteUnverified(email);
      otpDocument = await otpModel.create({ email, otp: otpCode, expiresAt, verified: false, attempts: 0 });
    }

    try {
      await sendOTPEmail(email, otpCode);
    } catch (err) {
      await otpModel.delete(otpDocument.id);
      throw new AppError('Failed to send OTP email. Please try again.', 500);
    }
  },

  async verifyOTP(email: string, otp: string) {
    const otpDocument = await otpModel.findValidOTP(email);
    if (!otpDocument) throw new AppError('Invalid or expired OTP. Please request a new one.', 400);

    if (otpDocument.attempts >= MAX_OTP_ATTEMPTS) {
      await otpModel.delete(otpDocument.id);
      throw new AppError('Maximum verification attempts exceeded. Please request a new OTP.', 400);
    }

    if (new Date() > otpDocument.expiresAt) {
      await otpModel.delete(otpDocument.id);
      throw new AppError('OTP has expired. Please request a new one.', 400);
    }

    if (otpDocument.otp !== otp) {
      const updatedAttempts = otpDocument.attempts + 1;
      await otpModel.update(otpDocument.id, { attempts: updatedAttempts });
      const remaining = MAX_OTP_ATTEMPTS - updatedAttempts;
      throw new AppError(
        `Invalid OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : 'Maximum attempts exceeded.'}`,
        400,
        { remainingAttempts: Math.max(0, remaining) },
      );
    }

    await otpModel.update(otpDocument.id, { verified: true });
  },

  async resendOTP(email: string) {
    const otpCode = generateOTP();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

    await otpModel.deleteUnverified(email);
    const otpDocument = await otpModel.create({ email, otp: otpCode, expiresAt, verified: false, attempts: 0 });

    try {
      await sendOTPEmail(email, otpCode);
    } catch {
      await otpModel.delete(otpDocument.id);
      throw new AppError('Failed to send OTP email. Please try again.', 500);
    }
  },

  async checkVerification(email: string) {
    const verifiedOTP = await otpModel.findVerifiedOTP(email);
    return verifiedOTP ? { verified: true, verifiedAt: verifiedOTP.updatedAt } : { verified: false };
  },
};
