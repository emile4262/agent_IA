import { Logger } from '@nestjs/common';
import { validate as isValidCron } from 'node-cron';

/**
 * Vérifie les variables d'environnement au démarrage.
 * Si une variable obligatoire manque, l'application refuse de démarrer
 * avec un message clair, au lieu de planter plus tard.
 */
export interface Env {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  MONGODB_URI: string;
  JWT_ACCESS_SECRET: string;
  /** Compte administrateur créé au premier lancement (voir AdminSeeder). */
  ADMIN_EMAIL: string;
  /** Facultatif : sans lui, un mot de passe provisoire est généré et affiché au premier lancement. */
  ADMIN_PASSWORD?: string;
  /** Adresse publique de l'API, utilisée pour construire les liens envoyés par e-mail. */
  APP_URL: string;
  /**
   * Envoi des e-mails (Brevo) : mêmes variables que l'ancien agent.
   * Absent en développement : les e-mails sont affichés dans la console au lieu d'être envoyés.
   */
  smtp?: SmtpConfig;
  /** Résumés par l'IA. Absent en développement : les articles sont collectés mais restent en attente. */
  gemini?: GeminiConfig;
  /** Fréquence de la collecte (expression cron, fuseau Africa/Abidjan) ; null = collecte automatique désactivée. */
  COLLECT_CRON: string | null;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  /** Facultatif : autre adresse que celle de Google (proxy, tests). */
  baseUrl?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

const SMTP_VARIABLES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const;
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
/** Toutes les 30 minutes : les nouveaux articles sont prêts avant les envois. */
const DEFAULT_COLLECT_CRON = '*/30 * * * *';

/**
 * Affiche au démarrage ce qui a été lu dans MONGODB_URI, mot de passe masqué,
 * et signale les erreurs de format les plus courantes.
 */
function describeMongoUri(uri: string): void {
  const logger = new Logger('MongoDB');
  const authority = uri.replace(/^mongodb(\+srv)?:\/\//, '').split('/')[0];

  if ((authority.match(/@/g) ?? []).length > 1) {
    logger.warn('Le mot de passe contient un « @ » : remplacez-le par %40, ou générez un mot de passe sans caractère spécial.');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    logger.warn('MONGODB_URI est illisible. Recopiez l’adresse donnée par Atlas (Connect → Drivers).');
    return;
  }

  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\//, '') || '(aucune, « test » sera utilisée)';
  logger.log(
    `Connexion avec l’utilisateur « ${user} » sur « ${parsed.hostname} », base « ${database} », mot de passe de ${password.length} caractère(s).`,
  );

  if (!user || !password) {
    logger.warn('Utilisateur ou mot de passe absent dans MONGODB_URI.');
  }
  if (/[<>]/.test(user + password)) {
    logger.warn('Des « < > » sont encore présents : remplacez <db_password> par le vrai mot de passe, sans les chevrons.');
  }
  if (/\s/.test(password) || /["']/.test(password)) {
    logger.warn('Le mot de passe contient un espace ou un guillemet : vérifiez la ligne dans .env.');
  }
  if (/[:/?#[\]%]/.test(password)) {
    logger.warn('Le mot de passe contient un caractère spécial qui doit être encodé : générez-en un sans caractère spécial.');
  }

  const authSource = parsed.searchParams.get('authSource');
  if (authSource && authSource !== 'admin') {
    logger.warn(`authSource=${authSource} dans MONGODB_URI : sur Atlas, les utilisateurs sont dans « admin ». Supprimez ce paramètre.`);
  }
  const authMechanism = parsed.searchParams.get('authMechanism');
  if (authMechanism && !authMechanism.startsWith('SCRAM')) {
    logger.warn(`authMechanism=${authMechanism} dans MONGODB_URI : supprimez ce paramètre pour une connexion par mot de passe.`);
  }
}

export function validateEnv(config: Record<string, unknown>): Env {
  const errors: string[] = [];

  const mongoUri = typeof config.MONGODB_URI === 'string' ? config.MONGODB_URI.trim() : '';
  if (!mongoUri) {
    errors.push('MONGODB_URI est obligatoire (adresse de connexion MongoDB Atlas).');
  } else if (!/^mongodb(\+srv)?:\/\//.test(mongoUri)) {
    errors.push('MONGODB_URI doit commencer par mongodb:// ou mongodb+srv://.');
  }

  const jwtSecret = typeof config.JWT_ACCESS_SECRET === 'string' ? config.JWT_ACCESS_SECRET.trim() : '';
  if (jwtSecret.length < 32) {
    errors.push(
      'JWT_ACCESS_SECRET est obligatoire et doit faire au moins 32 caractères. ' +
        'Générez-en un avec : node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    );
  }

  const adminEmail = typeof config.ADMIN_EMAIL === 'string' ? config.ADMIN_EMAIL.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    errors.push('ADMIN_EMAIL est obligatoire : adresse e-mail du compte administrateur créé au premier lancement.');
  }

  const adminPassword = typeof config.ADMIN_PASSWORD === 'string' ? config.ADMIN_PASSWORD : '';
  if (adminPassword && (adminPassword.length < 8 || adminPassword.length > 72)) {
    errors.push('ADMIN_PASSWORD doit faire entre 8 et 72 caractères (ou être supprimé pour en générer un).');
  }

  const rawPort = config.PORT ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT doit être un numéro de port valide (reçu : ${String(rawPort)}).`);
  }

  const nodeEnv = config.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'production' && nodeEnv !== 'test') {
    errors.push('NODE_ENV doit valoir development, production ou test.');
  }

  const rawAppUrl = typeof config.APP_URL === 'string' ? config.APP_URL.trim() : '';
  const appUrl = (rawAppUrl || `http://localhost:${port}`).replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/.test(appUrl)) {
    errors.push('APP_URL doit être une adresse http(s)://, par exemple http://localhost:3000.');
  }

  const smtpValues = Object.fromEntries(
    SMTP_VARIABLES.map((name) => {
      const value = config[name];
      return [name, typeof value === 'string' ? value.trim() : ''];
    }),
  ) as Record<(typeof SMTP_VARIABLES)[number], string>;
  const missingSmtp = SMTP_VARIABLES.filter((name) => !smtpValues[name]);
  let smtp: SmtpConfig | undefined;
  if (missingSmtp.length === 0) {
    const smtpPort = Number(smtpValues.SMTP_PORT);
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
      errors.push('SMTP_PORT doit être un numéro de port valide (587 pour Brevo).');
    }
    smtp = {
      host: smtpValues.SMTP_HOST,
      port: smtpPort,
      user: smtpValues.SMTP_USER,
      password: smtpValues.SMTP_PASSWORD,
      from: smtpValues.MAIL_FROM,
    };
  } else if (missingSmtp.length < SMTP_VARIABLES.length || nodeEnv === 'production') {
    errors.push(`Envoi des e-mails : il manque ${missingSmtp.join(', ')}.`);
  }

  const stringOf = (name: string): string => {
    const value = config[name];
    return typeof value === 'string' ? value.trim() : '';
  };
  const geminiKey = stringOf('GEMINI_API_KEY');
  const geminiBaseUrl = stringOf('GEMINI_BASE_URL');
  if (geminiBaseUrl && !/^https?:\/\/[^\s/]+/.test(geminiBaseUrl)) {
    errors.push('GEMINI_BASE_URL doit être une adresse http(s)://.');
  }
  if (!geminiKey && nodeEnv === 'production') {
    errors.push('GEMINI_API_KEY est obligatoire en production (résumés des articles).');
  }
  const gemini: GeminiConfig | undefined = geminiKey
    ? { apiKey: geminiKey, model: stringOf('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL, baseUrl: geminiBaseUrl || undefined }
    : undefined;

  const rawCron = stringOf('COLLECT_CRON') || DEFAULT_COLLECT_CRON;
  const collectCron = rawCron.toLowerCase() === 'off' ? null : rawCron;
  if (collectCron && !isValidCron(collectCron)) {
    errors.push(`COLLECT_CRON n'est pas une expression cron valide (reçu : ${collectCron}). Exemple : */30 * * * *, ou off.`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuration invalide dans .env :\n- ${errors.join('\n- ')}`);
  }

  describeMongoUri(mongoUri);
  if (!smtp) {
    new Logger('Mail').warn('SMTP non configuré : les e-mails seront affichés dans la console au lieu d’être envoyés.');
  }
  if (!gemini) {
    new Logger('Collecte').warn('GEMINI_API_KEY absent : les articles seront collectés mais pas résumés.');
  }

  return {
    NODE_ENV: nodeEnv as Env['NODE_ENV'],
    PORT: port,
    MONGODB_URI: mongoUri,
    JWT_ACCESS_SECRET: jwtSecret,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword || undefined,
    APP_URL: appUrl,
    smtp,
    gemini,
    COLLECT_CRON: collectCron,
  };
}
