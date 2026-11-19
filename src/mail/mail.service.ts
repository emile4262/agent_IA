import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env, SmtpConfig } from '../config/env.validation';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** En-têtes en plus, ex. List-Unsubscribe pour la veille. */
  headers?: Record<string, string>;
}

/**
 * Envoi des e-mails par SMTP (Brevo).
 * Sans configuration SMTP (développement), le message est affiché dans la console.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly smtp?: SmtpConfig;
  private readonly transport?: Transporter;

  constructor(config: ConfigService<Env, true>) {
    this.smtp = config.get('smtp', { infer: true });
    if (this.smtp) {
      this.transport = nodemailer.createTransport({
        host: this.smtp.host,
        port: this.smtp.port,
        secure: this.smtp.port === 465,
        auth: { user: this.smtp.user, pass: this.smtp.password },
      });
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transport || !this.smtp) {
      this.logger.warn(`E-mail non envoyé (SMTP non configuré) à ${message.to} — ${message.subject}\n${message.text}`);
      return;
    }
    await this.transport.sendMail({ from: this.smtp.from, ...message });
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }
}
