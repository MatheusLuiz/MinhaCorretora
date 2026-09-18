import { randomBytes } from 'node:crypto';

import { logger } from '../config/logger.js';
import * as auditoriaRepo from '../repositories/auditoria.repository.js';
import * as repo from '../repositories/gestaoUsuarios.repository.js';
import * as sessaoRepo from '../repositories/sessao.repository.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import { AppError } from '../utils/AppError.js';
import { avaliarForcaSenha, gerarHashSenha } from './password.service.js';
import type { ContextoRequisicao } from './auth.service.js';

/** Regras da gestão de usuários. As travas valem AQUI; a tela só as espelha. */

export interface UsuarioPublicoDetalhado {
  id: string;
  nome: string;
  sobrenome: string | null;
  nomeCompleto: string;
  dataNascimento: string | null;
  email: string;
  papel: string;
  papelNome: string;
  permissoes: string[];
  ativo: boolean;
  precisaTrocarSenha: boolean;
  bloqueado: boolean;
  bloqueadoAte: string | null;
  tentativasFalhas: number;
  ultimoLoginEm: string | null;
  senhaAlteradaEm: string;
  criadoEm: string;
}

function montarPublico(
  u: repo.UsuarioDetalhado,
  permissoes: string[],
): UsuarioPublicoDetalhado {
  const agora = new Date();

  return {
    id: u.id,
    nome: u.nome,
    sobrenome: u.sobrenome,
    nomeCompleto: [u.nome, u.sobrenome].filter(Boolean).join(' '),
    dataNascimento: u.dataNascimento,
    email: u.email,
    papel: u.papelChave,
    papelNome: u.papelNome,
    permissoes,
    ativo: u.ativo,
    precisaTrocarSenha: u.precisaTrocarSenha,
    bloqueado: u.bloqueadoAte !== null && u.bloqueadoAte > agora,
    bloqueadoAte: u.bloqueadoAte ? u.bloqueadoAte.toISOString() : null,
    tentativasFalhas: u.tentativasFalhas,
    ultimoLoginEm: u.ultimoLoginEm ? u.ultimoLoginEm.toISOString() : null,
    senhaAlteradaEm: u.senhaAlteradaEm.toISOString(),
    criadoEm: u.criadoEm.toISOString(),
  };
}

export async function listar(): Promise<UsuarioPublicoDetalhado[]> {
  const usuarios = await repo.listarTodos();

  // Permissões dependem só do papel: uma consulta por papel, não por usuário.
  const cache = new Map<string, string[]>();

  for (const u of usuarios) {
    if (!cache.has(u.papelChave)) {
      cache.set(u.papelChave, await repo.listarPermissoesDoPapel(u.papelChave));
    }
  }

  return usuarios.map((u) => montarPublico(u, cache.get(u.papelChave) ?? []));
}

export async function detalhar(id: string): Promise<UsuarioPublicoDetalhado> {
  const usuario = await repo.detalhar(id);
  if (!usuario) throw AppError.notFound('Usuário não encontrado.');

  const permissoes = await repo.listarPermissoesDoPapel(usuario.papelChave);
  return montarPublico(usuario, permissoes);
}

export const listarPapeis = repo.listarPapeis;

/** Senha temporária; o alfabeto evita os confundíveis 0/O, 1/l/I. */
function gerarSenhaTemporaria(tamanho = 16): string {
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(tamanho);

  let senha = '';
  for (let i = 0; i < tamanho; i += 1) {
    senha += ALFABETO[bytes[i]! % ALFABETO.length];
  }
  return senha;
}

export interface EntradaNovoUsuario {
  nome: string;
  sobrenome?: string | null;
  dataNascimento?: string | null;
  email: string;
  papel: string;
}

export interface ResultadoCriacao {
  usuario: UsuarioPublicoDetalhado;
  /** Aparece UMA vez na resposta e não é gravada em lugar nenhum. */
  senhaTemporaria: string;
}

/**
 * Cria um usuário com senha temporária gerada pelo servidor — quem cadastra não
 * a escolhe, para a senha (trocada no primeiro acesso) ser só do dono.
 */
export async function criar(
  dados: EntradaNovoUsuario,
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<ResultadoCriacao> {
  const email = dados.email.trim().toLowerCase();

  if (await repo.emailJaUsado(email)) {
    throw AppError.conflict('Já existe um usuário com este e-mail.');
  }

  const papeis = await repo.listarPapeis();
  if (!papeis.some((p) => p.chave === dados.papel && p.ativo)) {
    throw AppError.badRequest(`Papel inválido ou inativo: ${dados.papel}`);
  }

  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await gerarHashSenha(senhaTemporaria);

  const id = await repo.criar({
    nome: dados.nome.trim(),
    sobrenome: dados.sobrenome?.trim() || null,
    dataNascimento: dados.dataNascimento || null,
    email,
    senhaHash,
    papelChave: dados.papel,
  });

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: 'usuario.criado',
    entidade: 'usuarios',
    entidadeId: id,
    detalhes: { email, papel: dados.papel, criadoPor: autorId },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  logger.info({ id, email, papel: dados.papel }, 'Usuário criado');

  return { usuario: await detalhar(id), senhaTemporaria };
}

export async function editar(
  id: string,
  dados: repo.DadosEdicao,
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<UsuarioPublicoDetalhado> {
  const alvo = await repo.detalhar(id);
  if (!alvo) throw AppError.notFound('Usuário não encontrado.');

  // Rebaixar o último administrador ativo trancaria todos fora da gestão.
  if (
    dados.papelChave !== undefined &&
    dados.papelChave !== 'admin' &&
    alvo.papelChave === 'admin' &&
    alvo.ativo &&
    (await repo.contarOutrosAdminsAtivos(id)) === 0
  ) {
    throw AppError.conflict(
      'Este é o último administrador ativo. Promova outra pessoa antes de mudar o papel dele.',
    );
  }

  if (dados.papelChave !== undefined) {
    const papeis = await repo.listarPapeis();
    // Papel inativo não recebe ninguém novo; quem já está nele pode seguir.
    if (!papeis.some((p) => p.chave === dados.papelChave && (p.ativo || p.chave === alvo.papelChave))) {
      throw AppError.badRequest(`Papel inválido ou inativo: ${dados.papelChave}`);
    }
  }

  await repo.atualizar(id, dados);

  // Permissões viajam no access token: derrubar as sessões faz a troca valer já.
  if (dados.papelChave !== undefined && dados.papelChave !== alvo.papelChave) {
    const usuarioAuth = await usuarioRepo.buscarPorUuid(id);
    if (usuarioAuth) {
      await sessaoRepo.revogarTodasDoUsuario(usuarioAuth.id, 'admin');
    }
  }

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: 'usuario.editado',
    entidade: 'usuarios',
    entidadeId: id,
    detalhes: { alteradoPor: autorId, campos: Object.keys(dados) },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  return detalhar(id);
}

export async function definirAtivo(
  id: string,
  ativo: boolean,
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<UsuarioPublicoDetalhado> {
  const alvo = await repo.detalhar(id);
  if (!alvo) throw AppError.notFound('Usuário não encontrado.');

  if (!ativo && id === autorId) {
    throw AppError.conflict('Você não pode desativar a própria conta.');
  }

  if (!ativo && alvo.papelChave === 'admin' && (await repo.contarOutrosAdminsAtivos(id)) === 0) {
    throw AppError.conflict(
      'Este é o último administrador ativo. Promova outra pessoa antes de desativá-lo.',
    );
  }

  await repo.definirAtivo(id, ativo);

  // Derruba as sessões na hora; senão o access token atual seguiria valendo.
  if (!ativo) {
    const usuarioAuth = await usuarioRepo.buscarPorUuid(id);
    if (usuarioAuth) {
      await sessaoRepo.revogarTodasDoUsuario(usuarioAuth.id, 'admin');
    }
  }

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: ativo ? 'usuario.reativado' : 'usuario.desativado',
    entidade: 'usuarios',
    entidadeId: id,
    detalhes: { por: autorId },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  return detalhar(id);
}

export async function redefinirSenha(
  id: string,
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<{ senhaTemporaria: string }> {
  const alvo = await repo.detalhar(id);
  if (!alvo) throw AppError.notFound('Usuário não encontrado.');

  const senhaTemporaria = gerarSenhaTemporaria();
  await repo.redefinirSenha(id, await gerarHashSenha(senhaTemporaria));

  const usuarioAuth = await usuarioRepo.buscarPorUuid(id);
  if (usuarioAuth) {
    await sessaoRepo.revogarTodasDoUsuario(usuarioAuth.id, 'senha_alterada');
  }

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: 'usuario.senha_redefinida',
    entidade: 'usuarios',
    entidadeId: id,
    detalhes: { por: autorId },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  return { senhaTemporaria };
}

/** Exposto para a tela mostrar a política antes de o usuário digitar. */
export function politicaDeSenha(): { minimo: number; regras: string[] } {
  const exemplo = avaliarForcaSenha('');

  return {
    minimo: Number(/\d+/.exec(exemplo.problemas[0] ?? '')?.[0] ?? 12),
    regras: [
      'Combinar letras e números',
      'Não conter seu nome nem seu e-mail',
      'Não conter sequências comuns (123456, senha, minhacorretora...)',
    ],
  };
}

export interface PermissaoDaFicha {
  chave: string;
  descricao: string | null;
  /** Vem do papel? */
  doPapel: boolean;
  /** Está valendo agora, depois de aplicar as exceções? */
  efetiva: boolean;
  /** 'concedida' = somada ao papel; 'revogada' = tirada dele; null = segue o papel. */
  excecao: 'concedida' | 'revogada' | null;
  motivo: string | null;
}

/** Quadro com TODAS as permissões do sistema e, para cada uma, se vem do papel ou de exceção. */
export async function quadroDePermissoes(id: string): Promise<PermissaoDaFicha[]> {
  const usuario = await repo.detalhar(id);
  if (!usuario) throw AppError.notFound('Usuário não encontrado.');

  const [catalogo, doPapel, excecoes, efetivas] = await Promise.all([
    repo.listarCatalogoPermissoes(),
    repo.listarPermissoesDoPapel(usuario.papelChave),
    repo.listarExcecoes(id),
    repo.listarEfetivas(id),
  ]);

  const conjuntoPapel = new Set(doPapel);
  const conjuntoEfetivo = new Set(efetivas);
  const porChave = new Map(excecoes.map((e) => [e.chave, e]));

  return catalogo.map((p) => {
    const excecao = porChave.get(p.chave);

    return {
      chave: p.chave,
      descricao: p.descricao,
      doPapel: conjuntoPapel.has(p.chave),
      efetiva: conjuntoEfetivo.has(p.chave),
      excecao: excecao ? (excecao.concedida ? 'concedida' : 'revogada') : null,
      motivo: excecao?.motivo ?? null,
    };
  });
}

export interface EntradaPermissoes {
  /** Estado final desejado: as chaves que a pessoa deve ter ao fim da operação. */
  permissoes: string[];
  motivo?: string | null;
}

/**
 * Recebe o conjunto FINAL desejado e grava só o que destoa do papel (exceções).
 * Ninguém edita as próprias permissões: senão `usuarios.gerenciar` se concederia tudo.
 */
export async function definirPermissoes(
  id: string,
  entrada: EntradaPermissoes,
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<PermissaoDaFicha[]> {
  if (id === autorId) {
    throw AppError.conflict(
      'Você não pode alterar as próprias permissões. Peça a outro administrador.',
    );
  }

  const usuario = await repo.detalhar(id);
  if (!usuario) throw AppError.notFound('Usuário não encontrado.');

  const catalogo = await repo.listarCatalogoPermissoes();
  const validas = new Set(catalogo.map((p) => p.chave));

  const desconhecidas = entrada.permissoes.filter((c) => !validas.has(c));
  if (desconhecidas.length > 0) {
    throw AppError.badRequest(`Permissões inexistentes: ${desconhecidas.join(', ')}`);
  }

  const doPapel = new Set(await repo.listarPermissoesDoPapel(usuario.papelChave));
  const desejadas = new Set(entrada.permissoes);

  const excecoes: repo.ExcecaoParaGravar[] = [];

  for (const chave of desejadas) {
    if (!doPapel.has(chave)) {
      excecoes.push({ chave, concedida: true, motivo: entrada.motivo ?? null });
    }
  }

  for (const chave of doPapel) {
    if (!desejadas.has(chave)) {
      excecoes.push({ chave, concedida: false, motivo: entrada.motivo ?? null });
    }
  }

  await repo.substituirExcecoes(id, excecoes, autorId);

  // Permissões viajam no access token: derrubar as sessões faz a mudança valer já.
  const usuarioAuth = await usuarioRepo.buscarPorUuid(id);
  if (usuarioAuth) {
    await sessaoRepo.revogarTodasDoUsuario(usuarioAuth.id, 'admin');
  }

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: 'usuario.permissoes_alteradas',
    entidade: 'usuarios',
    entidadeId: id,
    detalhes: {
      por: autorId,
      concedidas: excecoes.filter((e) => e.concedida).map((e) => e.chave),
      revogadas: excecoes.filter((e) => !e.concedida).map((e) => e.chave),
      motivo: entrada.motivo ?? null,
    },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  logger.info(
    { id, excecoes: excecoes.length, por: autorId },
    'Permissões individuais atualizadas',
  );

  return quadroDePermissoes(id);
}

export const detalharPapel = repo.detalharPapel;
export const definirPermissoesDoPapel = repo.definirPermissoesDoPapel;

/** "Cotação Vida" → `cotacao_vida`. Só letras e `_`: é o que `chavePapelSchema` aceita. */
function chaveDoPapel(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u{300}-\u{36f}]/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

/** Cria um papel SEM permissão nenhuma, ou com as de outro (`copiarDe`). */
export async function criarPapel(
  dados: { nome: string; descricao: string | null; copiarDe: string | null },
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<repo.PapelDetalhado> {
  const chave = chaveDoPapel(dados.nome);
  if (chave.length < 2) throw AppError.unprocessable('Use letras no nome do papel.');
  if (await repo.papelEmUso(chave, dados.nome)) {
    throw AppError.conflict(`Já existe um papel chamado "${dados.nome}" (ou com nome parecido).`);
  }
  if (dados.copiarDe && !(await repo.detalharPapel(dados.copiarDe))) {
    throw AppError.badRequest(`Papel de origem inexistente: ${dados.copiarDe}`);
  }

  await repo.criarPapel(chave, dados.nome, dados.descricao, dados.copiarDe);

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: 'papel.criado',
    entidade: 'papeis',
    entidadeId: chave,
    detalhes: { nome: dados.nome, copiarDe: dados.copiarDe, criadoPor: autorId },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  return (await repo.detalharPapel(chave))!;
}

/** Renomeia ou redescreve um papel. A chave fica: o código e a auditoria citam por ela. */
export async function editarPapel(
  chave: string,
  dados: { nome: string; descricao: string | null },
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<repo.PapelDetalhado> {
  const atual = await repo.detalharPapel(chave);
  if (!atual) throw AppError.notFound('Papel não encontrado.');
  if (await repo.nomeDePapelEmUso(dados.nome, chave)) {
    throw AppError.conflict(`Já existe um papel chamado "${dados.nome}".`);
  }

  await repo.atualizarPapel(chave, dados.nome, dados.descricao);

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: 'papel.editado',
    entidade: 'papeis',
    entidadeId: chave,
    detalhes: { antes: { nome: atual.nome, descricao: atual.descricao }, depois: dados, alteradoPor: autorId },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  return (await repo.detalharPapel(chave))!;
}

/**
 * Exclui um papel — só sem NENHUM usuário (ativo ou inativo) e nunca o
 * Administrador. Para tirar de uso um papel que alguém já teve, inative.
 */
export async function excluirPapel(chave: string, contexto: ContextoRequisicao, autorId: string): Promise<void> {
  const papel = await repo.detalharPapel(chave);
  if (!papel) throw AppError.notFound('Papel não encontrado.');
  if (chave === 'admin') throw AppError.conflict('O papel Administrador não se exclui.');

  const usuarios = await repo.contarUsuariosDoPapel(chave);
  if (usuarios > 0) {
    throw AppError.conflict(
      `${usuarios} usuário(s) — ativos ou inativos — têm este papel. Troque o papel deles antes, ou apenas inative o papel.`,
    );
  }

  await repo.excluirPapel(chave);

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: 'papel.excluido',
    entidade: 'papeis',
    entidadeId: chave,
    detalhes: {
      nome: papel.nome,
      permissoes: papel.permissoes.filter((p) => p.concedida).map((p) => p.chave),
      excluidoPor: autorId,
    },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });
}

/** Inativa ou reativa um papel; nunca inativa o Administrador nem papel com gente ATIVA. */
export async function definirSituacaoPapel(
  chave: string,
  ativo: boolean,
  contexto: ContextoRequisicao,
  autorId: string,
): Promise<repo.PapelDetalhado> {
  const papel = await repo.detalharPapel(chave);
  if (!papel) throw AppError.notFound('Papel não encontrado.');

  if (!ativo) {
    if (chave === 'admin') throw AppError.conflict('O papel Administrador não se inativa.');
    if (papel.usuariosAtivos > 0) {
      throw AppError.conflict(
        `${papel.usuariosAtivos} pessoa(s) ativa(s) têm este papel. Troque o papel delas antes de inativá-lo.`,
      );
    }
  }

  await repo.definirPapelAtivo(chave, ativo);

  await auditoriaRepo.registrar({
    usuarioId: null,
    acao: ativo ? 'papel.reativado' : 'papel.inativado',
    entidade: 'papeis',
    entidadeId: chave,
    detalhes: { alteradoPor: autorId },
    ip: contexto.ip,
    userAgent: contexto.userAgent,
  });

  return (await repo.detalharPapel(chave))!;
}
export { SemAdministradorError } from '../repositories/gestaoUsuarios.repository.js';
