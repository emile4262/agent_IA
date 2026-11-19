import { Controller, Get, Header, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { escapeHtml, layout, submitButton } from '../mail/mail.templates';
import { DigestService } from './digest.service';

const INVALID_LINK = layout({
  title: 'Lien invalide',
  body:
    '<h1 style="margin:0 0 12px;font-size:22px">Lien invalide</h1>' +
    '<p>Ce lien de désinscription est incomplet ou n’est plus valable. Utilisez celui de votre dernière veille, ' +
    'ou mettez la veille en pause dans vos préférences.</p>',
});

const UNSUBSCRIBED = layout({
  title: 'Désinscription confirmée',
  body:
    '<h1 style="margin:0 0 12px;font-size:22px">C’est fait</h1>' +
    '<p>Vous ne recevrez plus la veille par e-mail. Votre compte reste ouvert.</p>' +
    '<p>Pour la recevoir de nouveau, réactivez-la dans vos préférences (<code>"active": true</code>).</p>',
});

/**
 * Lien de désinscription des e-mails de veille, utilisable sans être connecté.
 * GET affiche une page de confirmation (les antivirus des messageries ouvrent les liens : un simple
 * GET ne doit rien changer). POST désinscrit : bouton de la page, ou désinscription en un clic
 * de Gmail et Outlook (en-tête List-Unsubscribe-Post).
 */
@Public()
@ApiExcludeController()
@Controller('unsubscribe')
export class UnsubscribeController {
  constructor(private readonly digestService: DigestService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  confirm(@Query('u') userId: unknown, @Query('t') signature: unknown, @Res({ passthrough: true }) res: Response): string {
    if (!this.digestService.isValidUnsubscribe(userId, signature)) {
      res.status(HttpStatus.BAD_REQUEST);
      return INVALID_LINK;
    }
    return layout({
      title: 'Se désinscrire',
      body:
        '<h1 style="margin:0 0 12px;font-size:22px">Se désinscrire de la veille</h1>' +
        '<p>Vous ne recevrez plus la veille technologique par e-mail. Votre compte reste ouvert ' +
        'et vous pourrez la réactiver à tout moment dans vos préférences.</p>' +
        // Le formulaire renvoie le même lien signé.
        `<form method="post" action="?u=${escapeHtml(userId)}&amp;t=${escapeHtml(String(signature))}">${submitButton('Ne plus recevoir la veille')}</form>`,
    });
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async unsubscribe(@Query('u') userId: unknown, @Query('t') signature: unknown, @Res({ passthrough: true }) res: Response): Promise<string> {
    if (!(await this.digestService.unsubscribe(userId, signature))) {
      res.status(HttpStatus.BAD_REQUEST);
      return INVALID_LINK;
    }
    return UNSUBSCRIBED;
  }
}
