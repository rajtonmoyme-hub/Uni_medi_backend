import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter = nodemailer.createTransport({
  host: env.SMTP.HOST,
  port: env.SMTP.PORT,
  secure: env.SMTP.PORT === 465,
  auth: {
    user: env.SMTP.USER,
    pass: env.SMTP.PASS,
  },
});

export interface OtpMailResult {
  sentViaSmtp: boolean;
  demoOtpHint?: string;
  error?: string;
}

export async function sendOtpEmail(
  recipientEmail: string,
  recipientName: string,
  otpCode: string,
  uniqueId: string
): Promise<OtpMailResult> {
  const htmlBody = `
    <div style="font-family: Inter, system-ui, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e3eae5; border-radius: 8px; overflow: hidden; background: #ffffff;">
      <div style="background: #005830; color: #ffffff; padding: 20px 24px;">
        <h2 style="margin: 0; font-size: 18px; letter-spacing: 0.02em;">Unified Health Platform — Account Verification</h2>
        <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.85;">National Integrated Health Registry</p>
      </div>
      <div style="padding: 24px; color: #101613;">
        <p style="margin-top: 0;">Hello <strong>${recipientName}</strong>,</p>
        <p>Your Patient Identity (<strong>${uniqueId}</strong>) has been created. Please verify your account using the 6-digit One-Time Password (OTP) below:</p>
        <div style="background: #eef6f1; border: 1px solid #b9d9c6; border-radius: 6px; padding: 16px; text-align: center; margin: 20px 0;">
          <span style="font-family: monospace; font-size: 28px; font-weight: 700; letter-spacing: 0.25em; color: #005830;">${otpCode}</span>
        </div>
        <p style="font-size: 13px; color: #5c6b62;">This verification code expires in 15 minutes. If you did not request this registration, please ignore this email.</p>
      </div>
    </div>
  `;

  if (env.DEMO_MODE) {
    console.log(
      `[OTP-MAILER] Patient=${recipientEmail} (${uniqueId}) | OTP=${otpCode}`
    );
  }

  // Skip external network call during automated Vitest suite to keep tests deterministic & fast
  if (process.env.NODE_ENV === 'test') {
    return {
      sentViaSmtp: false,
      demoOtpHint: env.DEMO_MODE ? otpCode : undefined,
    };
  }

  try {
    await transporter.sendMail({
      from: env.SMTP.FROM,
      to: recipientEmail,
      subject: `[Unified Health Platform] Your Verification OTP: ${otpCode}`,
      html: htmlBody,
    });
    return {
      sentViaSmtp: true,
      demoOtpHint: env.DEMO_MODE ? otpCode : undefined,
    };
  } catch (err: any) {
    console.warn(`[OTP-MAILER] SMTP fallback activated: ${err?.message || err}`);
    return {
      sentViaSmtp: false,
      demoOtpHint: env.DEMO_MODE ? otpCode : undefined,
      error: err?.message,
    };
  }
}
