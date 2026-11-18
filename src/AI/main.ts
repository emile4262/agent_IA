import 'dotenv/config';
import cron from 'node-cron';
import { filterAndCurateArticles, type CuratedArticle } from './AI';
import { sendDailyReport } from './email';
import { scrapeArticles } from './scraper';

async function sendDailyDigest(): Promise<void> {
  const scrapedArticles = await scrapeArticles();
  console.log(`${scrapedArticles.length} article(s) récupéré(s).`);

  let curatedArticles: CuratedArticle[] = [];
  let curationNotice: string | undefined;
  try {
    curatedArticles = await filterAndCurateArticles(scrapedArticles);
  } catch (error) {
    console.error('La curation IA a échoué ; envoi des articles bruts uniquement :', error);
    curationNotice = "La sélection et les résumés par l'IA sont indisponibles pour le moment. Les titres collectés sont listés ci-dessous.";
    console.log('Envoi du courriel de secours avec les articles et leurs liens.');
  }

  await sendDailyReport(scrapedArticles, curatedArticles, curationNotice);
  console.log('La veille quotidienne a été envoyée par e-mail.');
}

if (process.argv.includes('--send-now')) {
  sendDailyDigest().catch((error) => {
    console.error('Échec de la veille immédiate :', error);
    process.exitCode = 1;
  });
} else {
  cron.schedule(
    '50 08 * * *',
    async () => {
      try {
        await sendDailyDigest();
      } catch (error) {
        console.error('Échec de la veille quotidienne :', error);
      }
    },
    { timezone: 'Africa/Abidjan', noOverlap: true },
  );

  console.log('Envoi quotidien planifié à 8:50 (heure de Côte d’Ivoire).');
}