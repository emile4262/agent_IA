import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import { validateEnv } from '../../src/config/env.validation';

/** Configuration minimale valide, complétée ou modifiée par chaque test. */
const base = {
  MONGODB_URI: 'mongodb://localhost:27017/veille',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  ADMIN_EMAIL: 'admin@exemple.ci',
};

const errorOf = (config: Record<string, unknown>): string => {
  try {
    validateEnv(config);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  assert.fail('La configuration aurait dû être refusée.');
};

describe('validateEnv', () => {
  // Les avertissements de démarrage n'ont pas d'intérêt ici.
  before(() => Logger.overrideLogger(false));

  it('applique les valeurs par défaut', () => {
    const env = validateEnv(base);
    assert.equal(env.PORT, 3000);
    assert.equal(env.NODE_ENV, 'development');
    assert.equal(env.APP_URL, 'http://localhost:3000');
    assert.equal(env.COLLECT_CRON, '*/30 * * * *');
    assert.equal(env.DIGEST_CRON, '* * * * *');
    assert.equal(env.GOOGLE_NEWS_URL, 'https://news.google.com');
    assert.deepEqual(env.CORS_ORIGINS, []);
    assert.equal(env.WEB_URL, null);
    assert.equal(env.TRUST_PROXY, 0);
    assert.equal(env.RATE_LIMIT, true);
  });

  it('refuse les variables obligatoires absentes, toutes en une fois', () => {
    const message = errorOf({});
    assert.match(message, /MONGODB_URI est obligatoire/);
    assert.match(message, /JWT_ACCESS_SECRET/);
    assert.match(message, /ADMIN_EMAIL/);
  });

  it('refuse un secret JWT trop court', () => {
    assert.match(errorOf({ ...base, JWT_ACCESS_SECRET: 'court' }), /au moins 32 caractères/);
  });

  it('exige les 5 variables SMTP ensemble', () => {
    assert.match(errorOf({ ...base, SMTP_HOST: 'smtp-relay.brevo.com' }), /il manque SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM/);
  });

  it('exige SMTP et Gemini en production', () => {
    const message = errorOf({ ...base, NODE_ENV: 'production' });
    assert.match(message, /il manque SMTP_HOST/);
    assert.match(message, /GEMINI_API_KEY est obligatoire en production/);
  });

  it('désactive un cron avec off et refuse une expression invalide', () => {
    assert.equal(validateEnv({ ...base, DIGEST_CRON: 'off' }).DIGEST_CRON, null);
    assert.match(errorOf({ ...base, COLLECT_CRON: 'toutes les heures' }), /COLLECT_CRON n'est pas une expression cron valide/);
  });

  it('WEB_URL : valeur donnée, sinon la première origine CORS', () => {
    assert.equal(validateEnv({ ...base, WEB_URL: 'https://veille.exemple.ci/' }).WEB_URL, 'https://veille.exemple.ci');
    assert.equal(validateEnv({ ...base, CORS_ORIGINS: 'http://localhost:3001,https://b.ci' }).WEB_URL, 'http://localhost:3001');
    assert.match(errorOf({ ...base, WEB_URL: 'veille.exemple.ci' }), /WEB_URL/);
  });

  it('lit CORS_ORIGINS sans les barres finales', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: ' https://veille.exemple.ci/ , http://localhost:5173 ' });
    assert.deepEqual(env.CORS_ORIGINS, ['https://veille.exemple.ci', 'http://localhost:5173']);
  });

  it('refuse une origine CORS avec un chemin ou sans http(s)', () => {
    assert.match(errorOf({ ...base, CORS_ORIGINS: 'https://exemple.ci/app' }), /CORS_ORIGINS/);
    assert.match(errorOf({ ...base, CORS_ORIGINS: '*' }), /CORS_ORIGINS/);
  });

  it('vérifie TRUST_PROXY', () => {
    assert.equal(validateEnv({ ...base, TRUST_PROXY: '1' }).TRUST_PROXY, 1);
    assert.match(errorOf({ ...base, TRUST_PROXY: 'true' }), /TRUST_PROXY/);
    assert.match(errorOf({ ...base, TRUST_PROXY: '-1' }), /TRUST_PROXY/);
  });

  it('autorise RATE_LIMIT=off hors production seulement', () => {
    assert.equal(validateEnv({ ...base, RATE_LIMIT: 'OFF' }).RATE_LIMIT, false);
    assert.match(errorOf({ ...base, RATE_LIMIT: 'non' }), /RATE_LIMIT doit valoir on ou off/);
    assert.match(errorOf({ ...base, NODE_ENV: 'production', RATE_LIMIT: 'off' }), /RATE_LIMIT=off est interdit en production/);
  });
});
