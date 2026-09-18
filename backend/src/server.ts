import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { encerrarPool, verificarConexao } from './database/pool.js';
import { createApp } from './app.js';
import { iniciarAgendador, pararAgendador } from './services/tarefas/agendador.js';

// Banco inacessível quebra na subida, não no primeiro login.
try {
  await verificarConexao();
} catch (erro) {
  logger.fatal({ err: erro }, 'Não foi possível conectar ao MySQL. Confira as variáveis DB_* no .env.');
  process.exit(1);
}

const app = createApp();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    `MinhaCorretora API no ar em http://${env.HOST}:${env.PORT}${env.API_PREFIX} (${env.NODE_ENV})`,
  );
  // Falha do agendador não derruba a API.
  iniciarAgendador().catch((erro: unknown) => logger.error({ err: erro }, 'Agendador de tarefas não subiu'));
});

/** Encerra conexões abertas antes de sair, para não derrubar requisição em voo. */
function shutdown(signal: string): void {
  logger.info(`Recebido ${signal}, encerrando...`);
  pararAgendador();

  server.close(() => {
    void encerrarPool().finally(() => {
      logger.info('Servidor encerrado.');
      process.exit(0);
    });
  });

  setTimeout(() => {
    logger.error('Encerramento forçado após timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Promise rejeitada sem tratamento');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Exceção não capturada');
  process.exit(1);
});
