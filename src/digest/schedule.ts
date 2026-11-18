import type { Frequency } from '../users/schemas/preferences.schema';

/** Une veille dont l'heure est passée depuis plus longtemps n'est plus envoyée (ex. serveur arrêté toute la journée). */
export const SEND_GRACE_MINUTES = 6 * 60;

/** Date locale « AAAA-MM-JJ » et minutes écoulées depuis minuit, dans un fuseau donné. */
export function localClock(at: Date, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** daily = tous les jours, weekdays = du lundi au vendredi, weekly = le lundi. */
export function isSendingDay(date: string, frequency: Frequency): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (frequency === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (frequency === 'weekly') return weekday === 1;
  return true;
}

/**
 * Jour (date locale) de la veille à envoyer maintenant, ou null s'il n'y en a pas :
 * la dernière heure d'envoi passée doit dater de moins de SEND_GRACE_MINUTES et tomber un jour d'envoi.
 * Gère le passage de minuit (ex. envoi à 23:50 vérifié à 00:00).
 */
export function dueDigestDate(
  at: Date,
  preferences: { sendTime: string; timezone: string; frequency: Frequency },
): string | null {
  const [hours, minutes] = preferences.sendTime.split(':').map(Number);
  const sendMinutes = hours * 60 + minutes;
  const now = localClock(at, preferences.timezone);

  let date = now.date;
  let late = now.minutes - sendMinutes;
  if (late < 0) {
    // L'heure d'aujourd'hui n'est pas encore passée : on regarde celle d'hier.
    date = localClock(new Date(at.getTime() - (now.minutes + 1) * 60_000), preferences.timezone).date;
    late += 24 * 60;
  }
  return late <= SEND_GRACE_MINUTES && isSendingDay(date, preferences.frequency) ? date : null;
}
