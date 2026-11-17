import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Response } from 'express';
import { Connection, ConnectionStates } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * GET /health : indique si le serveur tourne et si MongoDB est joignable.
   * Répond 503 quand la base est déconnectée, pour que l'hébergeur le détecte.
   */
  @Get()
  check(@Res({ passthrough: true }) response: Response) {
    const mongoConnected = this.connection.readyState === ConnectionStates.connected;
    if (!mongoConnected) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: mongoConnected ? 'ok' : 'degraded',
      mongo: mongoConnected ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
