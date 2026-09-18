import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { emTransacao } from '../database/pool.js';
import * as auditoriaRepo from '../repositories/auditoria.repository.js';
import * as redefinicaoRepo from '../repositories/redefinicaoSenha.repository.js';
import * as sessaoRepo from '../repositories/sessao.repository.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import { AppError } from '../utils/AppError.js';
import { binarioParaUuid } from '../utils/uuid.js';
import { enviarPorFinalidade, valoresDaPessoa } from './emailFinalidades.js';
import { emailRedefinicaoSenha, emailSenhaAlterada } from './emailTemplates.js';
import {
  avaliarForcaSenha,
  gerarHashSenha,
  precisaRehash,
  verificacaoFalsa,
  verificarSenha,
} from './password.service.js';
import {
  gerarAccessToken,
  gerarFamiliaSessao,
  gerarRefreshToken,
  gerarTokenRedefinicao,
  hashRefreshToken,
  hashTokenRedefinicao,
} from './token.service.js';

export interface ContextoRequisicao {
  ip: Buffer | null;
  userAgent: string | null;
}

export interface UsuarioPublico {
  id: string;
  nome: string;
  email: string;
  papel: string;
  permissoes: string[];
  precisaTrocarSenha: boolean;
}

export interface ResultadoAutenticacao {
  usuario: UsuarioPublico;
  accessToken: string;
  refreshToken: string;
  refreshExpiraEm: Date;
}

/** Mensagem única para qualquer falha de login (não revela quem tem conta); o motivo real fica em `tentativas_login`. */
const ERRO_CREDENCIAL = 'E-mail ou senha inválidos.';

export async function login(
  email: string,
  senha: string,
  contexto: ContextoRequisicao,
): Promise<ResultadoAutenticacao> {
  const emailNormalizado = email.trim().toLowerCase();
  const usuario = await usuarioRepo.buscarPorEmail(emailNormalizado);

  if (!usuario) {
    // Queima o tempo de um Argon2id real: resposta instantânea denunciaria o e-mail inexistente.
    await verificacaoFalsa();
    await auditoriaRepo.registrarTentativaLogin({
      emailTentado: emailNormalizado,
      sucesso: false,
      motivo: 'usuario_inexistente',
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });
    throw AppError.unauthorized(ERRO_CREDENCIAL);
  }

  if (usuario.bloqueadoAte && usuario.bloqueadoAte > new Date()) {
    await auditoriaRepo.registrarTentativaLogin({
      emailTentado: emailNormalizado,
      usuarioId: usuario.id,
      sucesso: false,
      motivo: 'bloqueado',
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });

    const minutos = Math.ceil((usuario.bloqueadoAte.getTime() - Date.now()) / 60_000);
    throw new AppError(
      `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${minutos} minuto(s).`,
      429,
      'CONTA_BLOQUEADA',
    );
  }

  const senhaCorreta = await verificarSenha(usuario.senhaHash, senha);

  if (!senhaCorreta) {
    await usuarioRepo.registrarFalhaLogin(
      usuario.id,
      env.LOGIN_MAX_TENTATIVAS,
      env.LOGIN_BLOQUEIO_MINUTOS,
    );
    await auditoriaRepo.registrarTentativaLogin({
      emailTentado: emailNormalizado,
      usuarioId: usuario.id,
      sucesso: false,
      motivo: 'senha_invalida',
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });
    throw AppError.unauthorized(ERRO_CREDENCIAL);
  }

  // Só depois da senha: antes, revelaria a quem errou a senha que o e-mail existe.
  if (!usuario.ativo) {
    await auditoriaRepo.registrarTentativaLogin({
      emailTentado: emailNormalizado,
      usuarioId: usuario.id,
      sucesso: false,
      motivo: 'usuario_inativo',
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });
    throw AppError.forbidden('Conta desativada. Procure o administrador do sistema.');
  }

  // Único momento com a senha em claro para reforçar um hash de parâmetros antigos.
  if (precisaRehash(usuario.senhaHash)) {
    const novoHash = await gerarHashSenha(senha);
    await usuarioRepo.atualizarHashSenha(usuario.id, novoHash, usuario.precisaTrocarSenha);
    logger.info({ usuarioId: usuario.id }, 'Hash de senha atualizado para os parâmetros atuais');
  }

  const permissoes = await usuarioRepo.listarPermissoes(usuario.id);
  await usuarioRepo.registrarLoginSucesso(usuario.id, contexto.ip);

  const familia = gerarFamiliaSessao();
  const refresh = gerarRefreshToken();

  await sessaoRepo.criar({
    usuarioId: usuario.id,
    tokenHash: refresh.hash,
    familia,
    expiraEm: refresh.expiraEm,
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  const uuidTexto = binarioParaUuid(usuario.uuid);

  const accessToken = await gerarAccessToken({
    sub: uuidTexto,
    email: usuario.email,
    nome: usuario.nome,
    papel: usuario.papelChave,
    permissoes,
    sessaoVersao: await usuarioRepo.versaoSessao(usuario.id),
  });

  await auditoriaRepo.registrarTentativaLogin({
    emailTentado: emailNormalizado,
    usuarioId: usuario.id,
    sucesso: true,
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  await auditoriaRepo.registrar({
    usuarioId: usuario.id,
    acao: 'login',
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  return {
    usuario: {
      id: uuidTexto,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papelChave,
      permissoes,
      precisaTrocarSenha: usuario.precisaTrocarSenha,
    },
    accessToken,
    refreshToken: refresh.token,
    refreshExpiraEm: refresh.expiraEm,
  };
}

/**
 * Troca o refresh token por um par novo (rotação). Token já consumido que volta
 * é tratado como roubo: a família inteira é revogada.
 */
export async function renovarSessao(
  refreshToken: string,
  contexto: ContextoRequisicao,
): Promise<ResultadoAutenticacao> {
  const hashRecebido = hashRefreshToken(refreshToken);
  const sessao = await sessaoRepo.buscarPorHash(hashRecebido);

  if (!sessao) {
    throw AppError.unauthorized('Sessão inválida. Faça login novamente.');
  }

  if (sessao.usadoEm !== null) {
    const revogadas = await sessaoRepo.revogarFamilia(sessao.familia, 'reuso_detectado');

    logger.warn(
      { usuarioId: sessao.usuarioId, sessoesRevogadas: revogadas },
      'Reuso de refresh token detectado — família revogada',
    );

    await auditoriaRepo.registrar({
      usuarioId: sessao.usuarioId,
      acao: 'sessao.reuso_detectado',
      entidade: 'sessoes',
      entidadeId: String(sessao.id),
      detalhes: { sessoesRevogadas: revogadas },
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });

    throw AppError.unauthorized('Sessão encerrada por segurança. Faça login novamente.');
  }

  if (sessao.revogadoEm !== null) {
    throw AppError.unauthorized('Sessão encerrada. Faça login novamente.');
  }

  if (sessao.expiraEm <= new Date()) {
    await sessaoRepo.revogar(sessao.id, 'expirado');
    throw AppError.unauthorized('Sessão expirada. Faça login novamente.');
  }

  const usuario = await usuarioRepo.buscarPorId(sessao.usuarioId);

  // Conta desativada depois do login: a sessão morre junto.
  if (!usuario || !usuario.ativo) {
    await sessaoRepo.revogarTodasDoUsuario(sessao.usuarioId, 'admin');
    throw AppError.unauthorized('Sessão inválida. Faça login novamente.');
  }

  const novoRefresh = gerarRefreshToken();

  await emTransacao(async (conexao) => {
    const ganhouACorrida = await sessaoRepo.marcarComoUsada(sessao.id, conexao);

    if (!ganhouACorrida) {
      // Outra requisição consumiu este mesmo token entre o SELECT e o UPDATE.
      throw AppError.unauthorized('Sessão encerrada por segurança. Faça login novamente.');
    }

    await sessaoRepo.criar(
      {
        usuarioId: usuario.id,
        tokenHash: novoRefresh.hash,
        familia: sessao.familia,
        expiraEm: novoRefresh.expiraEm,
        ip: contexto.ip,
        userAgent: contexto.userAgent,
      },
      conexao,
    );
  });

  const permissoes = await usuarioRepo.listarPermissoes(usuario.id);
  const uuidTexto = binarioParaUuid(usuario.uuid);

  const accessToken = await gerarAccessToken({
    sub: uuidTexto,
    email: usuario.email,
    nome: usuario.nome,
    papel: usuario.papelChave,
    permissoes,
    sessaoVersao: await usuarioRepo.versaoSessao(usuario.id),
  });

  return {
    usuario: {
      id: uuidTexto,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papelChave,
      permissoes,
      precisaTrocarSenha: usuario.precisaTrocarSenha,
    },
    accessToken,
    refreshToken: novoRefresh.token,
    refreshExpiraEm: novoRefresh.expiraEm,
  };
}

export async function logout(
  refreshToken: string | undefined,
  contexto: ContextoRequisicao,
): Promise<void> {
  if (!refreshToken) return;

  const sessao = await sessaoRepo.buscarPorHash(hashRefreshToken(refreshToken));
  if (!sessao) return;

  await sessaoRepo.revogar(sessao.id, 'logout');

  await auditoriaRepo.registrar({
    usuarioId: sessao.usuarioId,
    acao: 'logout',
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });
}

export async function alterarSenha(
  usuarioUuid: string,
  senhaAtual: string,
  novaSenha: string,
  contexto: ContextoRequisicao,
): Promise<void> {
  const usuario = await usuarioRepo.buscarPorUuid(usuarioUuid);

  if (!usuario) {
    throw AppError.unauthorized();
  }

  if (!(await verificarSenha(usuario.senhaHash, senhaAtual))) {
    await auditoriaRepo.registrar({
      usuarioId: usuario.id,
      acao: 'senha.alteracao_negada',
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });
    throw AppError.unauthorized('Senha atual incorreta.');
  }

  const forca = avaliarForcaSenha(novaSenha, [usuario.nome, usuario.email]);
  if (!forca.valida) {
    throw AppError.unprocessable('A nova senha não atende à política.', forca.problemas);
  }

  if (await verificarSenha(usuario.senhaHash, novaSenha)) {
    throw AppError.badRequest('A nova senha precisa ser diferente da atual.');
  }

  const novoHash = await gerarHashSenha(novaSenha);

  await emTransacao(async (conexao) => {
    await usuarioRepo.atualizarHashSenha(usuario.id, novoHash, false, conexao);
    // Derruba todas as sessões: a troca pode ser por suspeita de invasão.
    await sessaoRepo.revogarTodasDoUsuario(usuario.id, 'senha_alterada', conexao);
  });

  await auditoriaRepo.registrar({
    usuarioId: usuario.id,
    acao: 'senha.alterada',
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });
}

function montarLinkRedefinicao(token: string): string {
  return `${env.APP_URL.replace(/\/+$/, '')}/redefinir-senha?token=${encodeURIComponent(token)}`;
}

/**
 * "Esqueci minha senha". Nunca revela se o e-mail existe, está inativo ou
 * estourou o limite (o motivo fica em `auditoria`); o envio não é aguardado
 * para o tempo de resposta não virar oráculo.
 */
export async function solicitarRedefinicaoSenha(
  email: string,
  contexto: ContextoRequisicao,
): Promise<void> {
  const emailNormalizado = email.trim().toLowerCase();
  const usuario = await usuarioRepo.buscarPorEmail(emailNormalizado);

  if (!usuario) {
    await auditoriaRepo.registrar({
      acao: 'senha.redefinicao_solicitada_inexistente',
      entidade: 'usuarios',
      detalhes: { emailTentado: emailNormalizado },
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });
    return;
  }

  if (!usuario.ativo) {
    await auditoriaRepo.registrar({
      usuarioId: usuario.id,
      acao: 'senha.redefinicao_negada_inativo',
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });
    return;
  }

  // Teto por conta: cada pedido novo invalida o link anterior, e o formulário é público.
  const pedidosRecentes = await redefinicaoRepo.contarPedidosRecentes(usuario.id);

  if (pedidosRecentes >= env.RESET_SENHA_MAX_POR_HORA) {
    logger.warn(
      { usuarioId: usuario.id, pedidosRecentes },
      'Limite de pedidos de redefinição de senha atingido — e-mail não enviado',
    );
    await auditoriaRepo.registrar({
      usuarioId: usuario.id,
      acao: 'senha.redefinicao_limitada',
      detalhes: { pedidosRecentes },
      ip: contexto.ip,
      userAgent: contexto.userAgent,
    });
    return;
  }

  const novoToken = gerarTokenRedefinicao();

  await emTransacao(async (conexao) => {
    await redefinicaoRepo.invalidarPendentes(usuario.id, 'substituido', conexao);
    await redefinicaoRepo.criar(
      {
        usuarioId: usuario.id,
        tokenHash: novoToken.hash,
        expiraEm: novoToken.expiraEm,
        ip: contexto.ip,
        userAgent: contexto.userAgent,
      },
      conexao,
    );
  });

  await auditoriaRepo.registrar({
    usuarioId: usuario.id,
    acao: 'senha.redefinicao_solicitada',
    entidade: 'usuarios',
    entidadeId: binarioParaUuid(usuario.uuid),
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  // `void`, não `await` (ver cabeçalho); o envio engole e registra toda falha.
  const dadosRedefinicao = {
    nome: usuario.nome,
    email: usuario.email,
    link: montarLinkRedefinicao(novoToken.token),
    validadeMinutos: env.RESET_SENHA_TTL_MIN,
  };
  void enviarPorFinalidade(
    'redefinicao_senha',
    usuario.email,
    {
      ...valoresDaPessoa(usuario.nome, usuario.email),
      link: dadosRedefinicao.link,
      validade_minutos: String(dadosRedefinicao.validadeMinutos),
    },
    () => emailRedefinicaoSenha(dadosRedefinicao),
  );
}

/** Mensagem única para todo token que não serve. Ver `redefinirSenhaComToken`. */
const ERRO_TOKEN_REDEFINICAO =
  'Link inválido ou expirado. Peça uma nova redefinição de senha.';

export interface ResultadoValidacaoToken {
  /** Primeiro nome, só para a tela dizer para quem está redefinindo. */
  nome: string;
  /** E-mail parcialmente oculto, para confirmar a conta sem expor o endereço. */
  emailMascarado: string;
}

/** Oculta o miolo do e-mail: `fulano@exemplo.com.br` → `fu••••@exemplo.com.br`. */
function mascararEmail(email: string): string {
  const [local = '', dominio = ''] = email.split('@');
  const visivel = local.slice(0, 2);
  return `${visivel}${'•'.repeat(Math.max(local.length - 2, 1))}@${dominio}`;
}

/** Checa o token sem consumi-lo, para a tela avisar do link vencido antes de pedir a senha. */
export async function validarTokenRedefinicao(
  token: string,
): Promise<ResultadoValidacaoToken> {
  const registro = await redefinicaoRepo.buscarPorHash(hashTokenRedefinicao(token));

  if (
    !registro ||
    registro.usadoEm !== null ||
    registro.invalidadoEm !== null ||
    registro.expiraEm <= new Date()
  ) {
    throw new AppError(ERRO_TOKEN_REDEFINICAO, 400, 'TOKEN_REDEFINICAO_INVALIDO');
  }

  const usuario = await usuarioRepo.buscarPorId(registro.usuarioId);

  if (!usuario || !usuario.ativo) {
    throw new AppError(ERRO_TOKEN_REDEFINICAO, 400, 'TOKEN_REDEFINICAO_INVALIDO');
  }

  return { nome: usuario.nome, emailMascarado: mascararEmail(usuario.email) };
}

/** Consome o token e grava a senha nova. Toda recusa usa a MESMA mensagem e código. */
export async function redefinirSenhaComToken(
  token: string,
  novaSenha: string,
  contexto: ContextoRequisicao,
): Promise<void> {
  const registro = await redefinicaoRepo.buscarPorHash(hashTokenRedefinicao(token));

  if (
    !registro ||
    registro.usadoEm !== null ||
    registro.invalidadoEm !== null ||
    registro.expiraEm <= new Date()
  ) {
    logger.warn(
      { motivo: !registro ? 'inexistente' : registro.usadoEm ? 'ja_usado' : 'expirado_ou_invalidado' },
      'Token de redefinição recusado',
    );
    throw new AppError(ERRO_TOKEN_REDEFINICAO, 400, 'TOKEN_REDEFINICAO_INVALIDO');
  }

  const usuario = await usuarioRepo.buscarPorId(registro.usuarioId);

  if (!usuario || !usuario.ativo) {
    throw new AppError(ERRO_TOKEN_REDEFINICAO, 400, 'TOKEN_REDEFINICAO_INVALIDO');
  }

  const forca = avaliarForcaSenha(novaSenha, [usuario.nome, usuario.email]);
  if (!forca.valida) {
    throw AppError.unprocessable('A nova senha não atende à política.', forca.problemas);
  }

  if (await verificarSenha(usuario.senhaHash, novaSenha)) {
    throw AppError.badRequest('A nova senha precisa ser diferente da atual.');
  }

  const novoHash = await gerarHashSenha(novaSenha);

  await emTransacao(async (conexao) => {
    // Consumir o token PRIMEIRO arbitra a corrida entre dois cliques no mesmo link.
    const consumiu = await redefinicaoRepo.marcarComoUsado(registro.id, contexto.ip, conexao);

    if (!consumiu) {
      throw new AppError(ERRO_TOKEN_REDEFINICAO, 400, 'TOKEN_REDEFINICAO_INVALIDO');
    }

    await redefinicaoRepo.invalidarPendentes(
      usuario.id,
      'senha_redefinida',
      conexao,
      registro.id,
    );

    await usuarioRepo.redefinirSenhaELiberar(usuario.id, novoHash, conexao);

    await sessaoRepo.revogarTodasDoUsuario(usuario.id, 'senha_alterada', conexao);
  });

  await auditoriaRepo.registrar({
    usuarioId: usuario.id,
    acao: 'senha.redefinida_por_email',
    entidade: 'usuarios',
    entidadeId: binarioParaUuid(usuario.uuid),
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  // Aviso de segurança, não confirmação: não segura a resposta esperando o SMTP.
  const quandoFormatado = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
  void enviarPorFinalidade(
    'senha_alterada',
    usuario.email,
    { ...valoresDaPessoa(usuario.nome, usuario.email), quando: quandoFormatado },
    () => emailSenhaAlterada({ nome: usuario.nome, email: usuario.email, quandoFormatado }),
  );
}

export async function obterPerfil(usuarioUuid: string): Promise<UsuarioPublico> {
  const usuario = await usuarioRepo.buscarPorUuid(usuarioUuid);

  if (!usuario || !usuario.ativo) {
    throw AppError.unauthorized();
  }

  const permissoes = await usuarioRepo.listarPermissoes(usuario.id);

  return {
    id: binarioParaUuid(usuario.uuid),
    nome: usuario.nome,
    email: usuario.email,
    papel: usuario.papelChave,
    permissoes,
    precisaTrocarSenha: usuario.precisaTrocarSenha,
  };
}
