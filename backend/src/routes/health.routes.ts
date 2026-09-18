import { Router } from 'express';

import { env } from '../config/env.js';

export const healthRouter: Router = Router();

/** Liveness: não toca em banco nem em serviço externo, de propósito. */
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ambiente: env.NODE_ENV,
    uptimeSegundos: Math.floor(process.uptime()),
    horario: new Date().toISOString(),
  });
});
