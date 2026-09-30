import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

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
  private transporter: Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT') ?? 587,
        // The self-hosted Postfix container is outbound-only and reached over the private
        // Docker network, so there's no TLS cert to verify -- secure/STARTTLS aren't relevant
        // the way they would be for an external relay like Brevo or SendGrid's SMTP endpoint.
        secure: false,
        auth:
          this.config.get<string>('SMTP_USER') &&
          this.config.get<string>('SMTP_PASSWORD')
            ? {
                user: this.config.get<string>('SMTP_USER'),
                pass: this.config.get<string>('SMTP_PASSWORD'),
              }
            : undefined,
      });
      this.enabled = true;
    } else {
      this.enabled = false;
      console.warn(
        '[EmailService] SMTP_HOST not configured — email is disabled',
      );
    }
    this.fromAddress =
      this.config.get<string>('SMTP_FROM_EMAIL') || 'noreply@pikidada.com';
    this.webUrl = this.config.getOrThrow<string>('CORS_ORIGIN');
  }

  async send(to: string, subject: string, html: string) {
    if (!this.enabled || !this.transporter) {
      console.warn(
        '[EmailService] Email disabled (no SMTP_HOST). Would have sent:',
        subject,
        'to',
        to,
      );
      return;
    }
    try {
      console.log(
        `[EmailService] Sending email to ${to} with subject: ${subject}`,
      );
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        html,
      });
      console.log(`[EmailService] Email sent successfully to ${to}`);
    } catch (err) {
      console.error(
        '[EmailService] Failed to send email to',
        to,
        'subject:',
        subject,
        'error:',
        err,
      );
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
