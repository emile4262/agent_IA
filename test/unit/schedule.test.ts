import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dueDigestDate, isSendingDay, localClock } from '../../src/digest/schedule';

const abidjan = { sendTime: '08:03', timezone: 'Africa/Abidjan', frequency: 'daily' as const };

describe('localClock', () => {
  it('donne la date et l’heure locales du fuseau', () => {
    // 23:30 UTC = 01:30 le lendemain à Paris (heure d'été).
    assert.deepEqual(localClock(new Date('2026-07-01T23:30:00Z'), 'Europe/Paris'), { date: '2026-07-02', minutes: 90 });
    assert.deepEqual(localClock(new Date('2026-07-01T23:30:00Z'), 'Africa/Abidjan'), { date: '2026-07-01', minutes: 1410 });
  });
});

describe('isSendingDay', () => {
  it('respecte la fréquence choisie', () => {
    // Le 16/11/2026 est un lundi, le 21/11/2026 un samedi.
    assert.equal(isSendingDay('2026-11-21', 'daily'), true);
    assert.equal(isSendingDay('2026-11-21', 'weekdays'), false);
    assert.equal(isSendingDay('2026-11-17', 'weekdays'), true);
    assert.equal(isSendingDay('2026-11-16', 'weekly'), true);
    assert.equal(isSendingDay('2026-11-17', 'weekly'), false);
  });
});

describe('dueDigestDate', () => {
  it('rien avant l’heure choisie (celle de la veille est trop ancienne)', () => {
    assert.equal(dueDigestDate(new Date('2026-11-19T08:02:59Z'), abidjan), null);
  });

  it('envoie à la minute exacte, puis pendant le délai de grâce', () => {
    assert.equal(dueDigestDate(new Date('2026-11-19T08:03:00Z'), abidjan), '2026-11-19');
    assert.equal(dueDigestDate(new Date('2026-11-19T14:03:00Z'), abidjan), '2026-11-19');
    assert.equal(dueDigestDate(new Date('2026-11-19T14:04:00Z'), abidjan), null);
  });

  it('gère le passage de minuit', () => {
    const late = { ...abidjan, sendTime: '23:50' };
    assert.equal(dueDigestDate(new Date('2026-11-20T00:00:00Z'), late), '2026-11-19');
  });

  it('tient compte du fuseau de l’utilisateur', () => {
    const paris = { ...abidjan, sendTime: '08:00', timezone: 'Europe/Paris' };
    // 08:00 à Paris en hiver = 07:00 UTC.
    assert.equal(dueDigestDate(new Date('2026-11-19T06:59:00Z'), paris), null);
    assert.equal(dueDigestDate(new Date('2026-11-19T07:00:00Z'), paris), '2026-11-19');
  });

  it('pas d’envoi le week-end en « jours ouvrés »', () => {
    const weekdays = { ...abidjan, frequency: 'weekdays' as const };
    assert.equal(dueDigestDate(new Date('2026-11-21T09:00:00Z'), weekdays), null);
    assert.equal(dueDigestDate(new Date('2026-11-20T09:00:00Z'), weekdays), '2026-11-20');
  });
});
