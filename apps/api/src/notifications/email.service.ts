import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Injectable()
export class EmailService {
  private fromAddress: string;
  private webUrl: string;
  private enabled: boolean;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    if (apiKey) {
      sgMail.setApiKey(apiKey);
      this.enabled = true;
    } else {
      this.enabled = false;
      console.warn('[EmailService] SENDGRID_API_KEY not configured — email is disabled');
    }
    this.fromAddress = this.config.get<string>('SMTP_FROM_EMAIL') || 'noreply@pikidada.com';
    this.webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
  }

  async send(to: string, subject: string, html: string) {
    if (!this.enabled) {
      console.warn('[EmailService] Email disabled (no API key). Would have sent:', subject, 'to', to);
      return;
    }
    try {
      console.log(`[EmailService] Sending email to ${to} with subject: ${subject}`);
      await sgMail.send({ from: this.fromAddress, to, subject, html });
      console.log(`[EmailService] Email sent successfully to ${to}`);
    } catch (err) {
      console.error('[EmailService] Failed to send email to', to, 'subject:', subject, 'error:', err);
    }
  }

  sendWelcomeEmail(to: string, name: string) {
    return this.send(
      to,
      'Welcome to Piki Dada',
      `<p>Hi ${escapeHtml(name)},</p><p>Welcome to Piki Dada! Your account is ready.</p>`,
    );
  }

  sendTripReceipt(to: string, fare: number, currency: string, tripId: string) {
    return this.send(
      to,
      'Your Piki Dada trip receipt',
      `<p>Your trip is complete.</p><p><strong>${fare} ${currency}</strong></p><p>Trip ID: ${tripId}</p>`,
    );
  }

  sendVerificationEmail(to: string, token: string) {
    const link = `${this.webUrl}/verify-email?token=${token}`;
    return this.send(
      to,
      'Verify your Piki Dada email',
      `<p>Confirm this is your email address by clicking the link below.</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
    );
  }

  sendPasswordResetEmail(to: string, token: string) {
    const link = `${this.webUrl}/reset-password?token=${token}`;
    return this.send(
      to,
      'Reset your Piki Dada password',
      `<p>We received a request to reset your password.</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
    );
  }
}
