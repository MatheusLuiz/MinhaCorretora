import nodemailer, { type Transporter } from 'nodemailer';

import { env, isProduction, smtpConfigurado } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as caixaRepo from '../repositories/caixaEmail.repository.js';
import { decifrar } from '../utils/cifra.js';

/**
 * Envio de e-mail transacional por SMTP. Caixa: a pedida (se ativa) → a padrão
 * (se ativa) → `SMTP_*` do `.env`. Sem caixa, o envio NÃO falha: só registra no log.
 */

export interface ParametrosSmtp {
  host: string;
  porta: number;
  /** true = TLS desde a conexão (465); false = STARTTLS (587). */
  tlsDireto: boolean;
  usuario: string | null;
  senha: string | null;
  remetenteNome: string | null;
  remetenteEmail: string;
  responderPara: string | null;
}

interface Caixa {
  transporter: Transporter;
  parametros: ParametrosSmtp;
  /** Nome da caixa da tela, ou "env". Vai para o log de envio. */
  origem: string;
}

const VALIDADE_DO_CACHE_MS = 60_000;
let cache: { em: number; porId: Map<number, Caixa>; padrao: Caixa | null; env: Caixa | null } | null = null;

function criarTransporter(p: ParametrosSmtp): Transporter {
  return nodemailer.createTransport({
    host: p.host,
    port: p.porta,
    secure: p.tlsDireto,
    ...(p.usuario && p.senha ? { auth: { user: p.usuario, pass: p.senha } } : {}),
    connectionTimeout: env.SMTP_TIMEOUT_MS,
    greetingTimeout: env.SMTP_TIMEOUT_MS,
    socketTimeout: env.SMTP_TIMEOUT_MS,
    // Sem isto, STARTTLS que falha seguiria em texto puro, com a credencial junto.
    requireTLS: !p.tlsDireto,
  });
}

function remetente(p: ParametrosSmtp): string | { name: string; address: string } {
  return p.remetenteNome ? { name: p.remetenteNome, address: p.remetenteEmail } : p.remetenteEmail;
}

/** Uma caixa da tela, se ativa. Senha que não decifra = caixa inválida, com log. */
function parametrosDoBanco(c: caixaRepo.CaixaEmail): ParametrosSmtp | null {
  if (!c.ativo) return null;

  let senha: string | null = null;
  if (c.senhaCifrada) {
    senha = decifrar(c.senhaCifrada);
    if (senha === null) {
      // A chave de cifragem mudou (SEGREDOS_KEY/JWT_SECRET).
      logger.error({ caixa: c.nome }, 'A senha da caixa de e-mail não pôde ser decifrada — cadastre-a de novo em Configurações.');
      return null;
    }
  }

  return {
    host: c.host,
    porta: c.porta,
    tlsDireto: c.seguranca === 'tls',
    usuario: c.usuario,
    senha,
    remetenteNome: c.remetenteNome,
    remetenteEmail: c.remetenteEmail,
    responderPara: c.responderPara,
  };
}

/** Parâmetros de uma caixa GRAVADA, ativa ou não (para teste). `null` = senha não decifra. */
export function parametrosDaCaixa(c: caixaRepo.CaixaEmail): ParametrosSmtp | null {
  return parametrosDoBanco({ ...c, ativo: true });
}

/** A caixa por onde sairia um e-mail sem caixa própria (padrão ativa, ou .env). */
export async function parametrosDaPadrao(): Promise<ParametrosSmtp | null> {
  return (await caixaPara())?.parametros ?? null;
}

function parametrosDoEnv(): ParametrosSmtp | null {
  if (!smtpConfigurado) return null;
  return {
    host: env.SMTP_HOST!,
    porta: env.SMTP_PORT,
    tlsDireto: env.SMTP_SECURE === true,
    usuario: env.SMTP_USER ?? null,
    senha: env.SMTP_PASS ?? null,
    // O SMTP_FROM já vem no formato "Nome <email>": vai inteiro no endereço.
    remetenteNome: null,
    remetenteEmail: env.SMTP_FROM!,
    responderPara: null,
  };
}

async function carregar(): Promise<NonNullable<typeof cache>> {
  if (cache && Date.now() - cache.em < VALIDADE_DO_CACHE_MS) return cache;

  const porId = new Map<number, Caixa>();
  let padrao: Caixa | null = null;
  try {
    for (const c of await caixaRepo.listar()) {
      const p = parametrosDoBanco(c);
      if (!p) continue;
      const caixa = { transporter: criarTransporter(p), parametros: p, origem: c.nome };
      porId.set(c.id, caixa);
      if (c.padrao) padrao = caixa;
    }
  } catch (erro) {
    // Tabela ausente ou banco fora do ar: o .env continua valendo.
    logger.warn({ err: erro }, 'Caixas de e-mail do banco indisponíveis; usando o .env');
  }

  const p = parametrosDoEnv();
  const env = p ? { transporter: criarTransporter(p), parametros: p, origem: 'env' } : null;

  cache = { em: Date.now(), porId, padrao, env };
  return cache;
}

/** A caixa pedida se ativa; senão a padrão; senão o .env. */
async function caixaPara(caixaId?: number): Promise<Caixa | null> {
  const c = await carregar();
  return (caixaId !== undefined ? c.porId.get(caixaId) : undefined) ?? c.padrao ?? c.env;
}

/** Descarta as caixas guardadas — chamado quando a tela salva uma caixa. */
export function invalidarConfiguracao(): void {
  if (cache) {
    for (const c of cache.porId.values()) c.transporter.close();
    cache.env?.transporter.close();
  }
  cache = null;
}

/** Há alguma caixa de saída utilizável agora (tela ou .env)? */
export async function envioConfigurado(): Promise<boolean> {
  return (await caixaPara()) !== null;
}

export interface Mensagem {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

/** Entrega a mensagem. Nunca lança: a falha de entrega não pode mudar a resposta de autenticação. */
export async function enviar(mensagem: Mensagem, caixaId?: number): Promise<void> {
  const caixa = await caixaPara(caixaId);

  if (!caixa) {
    logger[isProduction ? 'error' : 'warn'](
      // Nunca registrar o corpo: pode conter o link de redefinição (uma credencial).
      { para: mensagem.para, assunto: mensagem.assunto },
      isProduction
        ? 'E-MAIL DE DISPARO NÃO CONFIGURADO — e-mail não foi enviado. Configure em Configurações › E-mail de disparo.'
        : 'E-mail de disparo não configurado — conteúdo sensível do e-mail não foi registrado',
    );
    return;
  }

  try {
    const resultado = await caixa.transporter.sendMail({
      from: remetente(caixa.parametros),
      ...(caixa.parametros.responderPara ? { replyTo: caixa.parametros.responderPara } : {}),
      to: mensagem.para,
      subject: mensagem.assunto,
      text: mensagem.texto,
      html: mensagem.html,
    });

    logger.info(
      { para: mensagem.para, assunto: mensagem.assunto, messageId: resultado.messageId, origem: caixa.origem },
      'E-mail enviado',
    );
  } catch (erro) {
    logger.error(
      { err: erro, para: mensagem.para, assunto: mensagem.assunto },
      'Falha ao enviar e-mail',
    );
  }
}

/** Traduz o erro do SMTP para quem está configurando (o `535` do Google é quase sempre senha da CONTA, não de APP). */
function explicarErro(erro: unknown): string {
  const e = erro as { code?: string; responseCode?: number; response?: string; message?: string };
  const cru = (e.response ?? e.message ?? 'erro desconhecido').replace(/\s+/g, ' ').trim();

  if (e.responseCode === 535 || e.code === 'EAUTH') {
    return `Usuário ou senha recusados pelo servidor. No Google Workspace, use a SENHA DE APP (16 letras), não a senha da conta. (${cru})`;
  }
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ESOCKET' || e.code === 'ECONNECTION') {
    return `Não foi possível conectar ao servidor: confira servidor, porta e segurança (587 = STARTTLS, 465 = TLS). (${cru})`;
  }
  if (e.code === 'EDNS' || /getaddrinfo/.test(cru)) {
    return `Servidor não encontrado: confira o endereço. (${cru})`;
  }
  if (e.responseCode === 550 || e.responseCode === 553 || e.responseCode === 554) {
    return `O servidor recusou o remetente ou o destinatário. O remetente precisa ser a própria conta ou um alias dela. (${cru})`;
  }
  return cru;
}

/** Envia uma mensagem de teste com os parâmetros DADOS; diferente de `enviar`, devolve o erro. */
export async function testar(
  p: ParametrosSmtp,
  para: string,
  mensagem?: Omit<Mensagem, 'para'>,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const transporter = criarTransporter(p);
  try {
    await transporter.verify();
    await transporter.sendMail({
      from: remetente(p),
      ...(p.responderPara ? { replyTo: p.responderPara } : {}),
      to: para,
      subject: mensagem?.assunto ?? 'Teste do e-mail de disparo — MinhaCorretora BI',
      text:
        mensagem?.texto ??
        'Este é um e-mail de teste enviado pela tela Configurações › E-mail de disparo.\n\n' +
          'Se ele chegou, o sistema já consegue enviar a redefinição de senha e os avisos.\n\n' +
          '— MinhaCorretora BI',
      html:
        mensagem?.html ??
        '<p>Este é um e-mail de teste enviado pela tela <strong>Configurações › E-mail de disparo</strong>.</p>' +
          '<p>Se ele chegou, o sistema já consegue enviar a redefinição de senha e os avisos.</p>' +
          '<p>— MinhaCorretora BI</p>',
    });
    return { ok: true };
  } catch (erro) {
    logger.warn({ err: erro, host: p.host, porta: p.porta }, 'Teste do e-mail de disparo falhou');
    return { ok: false, erro: explicarErro(erro) };
  } finally {
    transporter.close();
  }
}

/** Escapa texto para interpolação segura no HTML do e-mail. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
