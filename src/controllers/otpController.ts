import { Request, Response } from "express";
import { validationResult } from "express-validator";
import otpModel from "../models/otpModel";
import { sendEmail } from "../services/emailService";
import { UserModel } from "../models/User";

/**
 * Generate a random 6-digit OTP
 */
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP email
 */
async function sendOTPEmail(email: string, otpCode: string): Promise<void> {
  const appName = process.env.APP_NAME || "Padlok";
  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification OTP</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      background-color: #f5f5f5;
      margin: 0;
      padding: 0;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #e0e0e0;
    }
    .email-header {
      background-color: #ffffff;
      padding: 30px 20px;
      text-align: center;
      border-bottom: 2px solid #000000;
    }
    .email-header h1 {
      font-size: 24px;
      font-weight: 600;
      margin: 0;
      color: #000000;
      letter-spacing: 1px;
    }
    .email-body {
      padding: 40px 30px;
    }
    .email-body p {
      color: #333333;
      font-size: 16px;
      margin: 0 0 20px 0;
    }
    .otp-box {
      background-color: #f9f9f9;
      border: 1px solid #d0d0d0;
      padding: 30px;
      margin: 30px 0;
      text-align: center;
    }
    .otp-code {
      font-size: 32px;
      font-weight: 600;
      color: #000000;
      letter-spacing: 6px;
      font-family: 'Courier New', monospace;
      margin: 10px 0;
    }
    .warning {
      background-color: #f9f9f9;
      border-left: 3px solid #666666;
      padding: 15px;
      margin: 25px 0;
      font-size: 14px;
      color: #333333;
    }
    .warning strong {
      color: #000000;
    }
    .footer {
      background-color: #f9f9f9;
      padding: 25px;
      text-align: center;
      border-top: 1px solid #e0e0e0;
      font-size: 12px;
      color: #666666;
    }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>Email Verification</h1>
    </div>
    <div class="email-body">
      <p>Hello,</p>
      <p>Thank you for choosing Padlok! Please use the following OTP to verify your email address:</p>
      <div class="otp-box">
        <div class="otp-code">${otpCode}</div>
      </div>
      <div class="warning">
        <strong>Important:</strong> This OTP will expire in 30 minutes. Do not share this code with anyone.
      </div>
      <p>If you didn't request this verification code, please ignore this email.</p>
    </div>
    <div class="footer">
      <p>This is an automated email. Please do not reply.</p>
      <p>&copy; ${new Date().getFullYear()} ${appName}</p>
    </div>
  </div>
</body>
</html>
  `;

  const emailText = `
Email Verification OTP

Hello,

Thank you for choosing Padlok! Please use the following OTP to verify your email address:

${otpCode}

Important: This OTP will expire in 30 minutes. Do not share this code with anyone.

If you didn't request this verification code, please ignore this email.

This is an automated email. Please do not reply.
  `;

  const { error } = await sendEmail({
    from: process.env.BREVO_SENDER_EMAIL || "noreply@padlok.com",
    to: email,
    subject: "Email Verification OTP",
    html: emailHtml,
    text: emailText,
  });

  if (error) {
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
}

const otpController = {
  /**
   * Send OTP to email
   * POST /api/otp/send-otp
   */
  sendOTP: async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
        return;
      }

      const { email } = req.body;

      // Check if user already exists
      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        res.status(400).json({
          success: false,
          message: "User already exists",
        });
        return;
      }

      // Check if there's an existing unverified OTP
      const existingOTP = await otpModel.findValidOTP(email);

      let otpCode: string;
      let otpDocument;

      if (
        existingOTP &&
        new Date() < existingOTP.expiresAt &&
        !existingOTP.verified &&
        existingOTP.attempts < 5
      ) {
        // Use existing OTP if it's still valid
        otpCode = existingOTP.otp;
        otpDocument = existingOTP;
      } else {
        // Generate new OTP
        otpCode = generateOTP();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 30); // 30 minutes from now

        // Delete any existing unverified OTPs for this email
        await otpModel.deleteUnverified(email);

        // Create new OTP
        otpDocument = await otpModel.create({
          email,
          otp: otpCode,
          expiresAt,
          verified: false,
          attempts: 0,
        });
      }

      // Send OTP email
      try {
        await sendOTPEmail(email, otpCode);
      } catch (emailError: any) {
        console.error("Error sending OTP email:", emailError);
        // Delete the OTP if email sending fails
        await otpModel.delete(otpDocument.id);
        res.status(500).json({
          success: false,
          message: "Failed to send OTP email. Please try again.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "OTP sent successfully to your email",
        data: {
          email,
          expiresIn: "30 minutes",
        },
      });
    } catch (error: any) {
      console.error("Send OTP error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  },

  /**
   * Verify OTP
   * POST /api/otp/verify-otp
   */
  verifyOTP: async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
        return;
      }

      const { email, otp } = req.body;

      // Find valid OTP
      const otpDocument = await otpModel.findValidOTP(email);

      if (!otpDocument) {
        res.status(400).json({
          success: false,
          message: "Invalid or expired OTP. Please request a new one.",
        });
        return;
      }

      // Check if maximum attempts exceeded
      if (otpDocument.attempts >= 5) {
        await otpModel.delete(otpDocument.id);
        res.status(400).json({
          success: false,
          message:
            "Maximum verification attempts exceeded. Please request a new OTP.",
        });
        return;
      }

      // Check if OTP is expired
      if (new Date() > otpDocument.expiresAt) {
        await otpModel.delete(otpDocument.id);
        res.status(400).json({
          success: false,
          message: "OTP has expired. Please request a new one.",
        });
        return;
      }

      // Verify OTP
      if (otpDocument.otp !== otp) {
        const updatedAttempts = otpDocument.attempts + 1;
        await otpModel.update(otpDocument.id, { attempts: updatedAttempts });

        const remainingAttempts = 5 - updatedAttempts;

        res.status(400).json({
          success: false,
          message: `Invalid OTP. ${
            remainingAttempts > 0
              ? `${remainingAttempts} attempt(s) remaining.`
              : "Maximum attempts exceeded."
          }`,
          remainingAttempts: remainingAttempts > 0 ? remainingAttempts : 0,
        });
        return;
      }

      // Mark OTP as verified
      await otpModel.update(otpDocument.id, { verified: true });

      res.status(200).json({
        success: true,
        message: "Email verified successfully",
        data: {
          email,
          verified: true,
        },
      });
    } catch (error: any) {
      console.error("Verify OTP error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  },

  /**
   * Resend OTP
   * POST /api/otp/resend-otp
   */
  resendOTP: async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
        return;
      }

      const { email } = req.body;

      // Delete any existing unverified OTPs for this email
      await otpModel.deleteUnverified(email);

      // Generate new OTP
      const otpCode = generateOTP();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 30); // 30 minutes from now

      // Create new OTP
      const otpDocument = await otpModel.create({
        email,
        otp: otpCode,
        expiresAt,
        verified: false,
        attempts: 0,
      });

      // Send OTP email
      try {
        await sendOTPEmail(email, otpCode);
      } catch (emailError: any) {
        console.error("Error sending OTP email:", emailError);
        // Delete the OTP if email sending fails
        await otpModel.delete(otpDocument.id);
        res.status(500).json({
          success: false,
          message: "Failed to send OTP email. Please try again.",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "OTP resent successfully to your email",
        data: {
          email,
          expiresIn: "30 minutes",
        },
      });
    } catch (error: any) {
      console.error("Resend OTP error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  },

  /**
   * Check if email is verified
   * GET /api/otp/check-verification/:email
   */
  checkVerification: async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.params;

      if (!email) {
        res.status(400).json({
          success: false,
          message: "Email parameter is required",
        });
        return;
      }

      const verifiedOTP = await otpModel.findVerifiedOTP(email);

      if (!verifiedOTP) {
        res.status(200).json({
          success: true,
          data: {
            email,
            verified: false,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          email,
          verified: true,
          verifiedAt: verifiedOTP.updatedAt,
        },
      });
    } catch (error: any) {
      console.error("Check verification error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  },
};

export default otpController;
