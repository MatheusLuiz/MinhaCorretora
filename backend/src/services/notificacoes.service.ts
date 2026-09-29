import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/notificacao.repository.js';
import * as email from './email.service.js';
import { enviarPorFinalidade, valoresDaPessoa } from './emailFinalidades.js';

/** Aviso de primeiro atraso ao corretor (no sino); por e-mail só com `NOTIFICAR_POR_EMAIL=true`. */
export async function avisarPrimeiroAtraso(): Promise<{
  avisos: number;
  semDestinatario: number;
}> {
  const avisos = await repo.gerarPrimeiroAtraso();
  const semDestinatario = await repo.primeiroAtrasoSemDestinatario();

  if (avisos > 0 && env.NOTIFICAR_POR_EMAIL && (await email.envioConfigurado())) {
    // Sem await: e-mail lento não segura a carga, e falha de entrega não a desfaz.
    void enviarPendentes().catch((erro: unknown) =>
      logger.error({ erro }, 'Falha ao enviar os e-mails de primeiro atraso'),
    );
  }

  return { avisos, semDestinatario };
}

async function enviarPendentes(): Promise<void> {
  for (const n of await repo.pendentesDeEmail()) {
    await enviarPorFinalidade(
      'primeiro_atraso',
      n.email,
      { ...valoresDaPessoa(n.nome, n.email), titulo: n.titulo, mensagem: n.mensagem },
      () => ({
        para: n.email,
        assunto: n.titulo,
        texto: `${n.nome},\n\n${n.mensagem}\n\n— MinhaCorretora BI`,
        html: `<p>${email.escaparHtml(n.nome)},</p><p>${email.escaparHtml(n.mensagem)}</p><p>— MinhaCorretora BI</p>`,
      }),
    );
    await repo.marcarEmailEnviado(n.id);
  }
}
