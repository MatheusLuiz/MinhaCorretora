import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { uuidParaBinario } from '../utils/uuid.js';

export interface UsuarioAutenticacao {
  id: number;
  uuid: Buffer;
  nome: string;
  email: string;
  senhaHash: string;
  papelChave: string;
  ativo: boolean;
  precisaTrocarSenha: boolean;
  tentativasFalhas: number;
  bloqueadoAte: Date | null;
}

interface LinhaUsuarioAutenticacao extends RowDataPacket {
  id: number;
  uuid: Buffer;
  nome: string;
  email: string;
  senha_hash: string;
  papel_chave: string;
  ativo: number;
  precisa_trocar_senha: number;
  tentativas_falhas: number;
  bloqueado_ate: Date | null;
}

function mapearUsuario(linha: LinhaUsuarioAutenticacao): UsuarioAutenticacao {
  return {
    id: linha.id,
    uuid: linha.uuid,
    nome: linha.nome,
    email: linha.email,
    senhaHash: linha.senha_hash,
    papelChave: linha.papel_chave,
    ativo: linha.ativo === 1,
    precisaTrocarSenha: linha.precisa_trocar_senha === 1,
    tentativasFalhas: linha.tentativas_falhas,
    bloqueadoAte: linha.bloqueado_ate,
  };
}

export async function buscarPorEmail(email: string): Promise<UsuarioAutenticacao | null> {
  const [linhas] = await pool.execute<LinhaUsuarioAutenticacao[]>(
    `SELECT u.id,
            u.uuid,
            u.nome,
            u.email,
            u.senha_hash,
            u.ativo,
            u.precisa_trocar_senha,
            u.tentativas_falhas,
            u.bloqueado_ate,
            p.chave AS papel_chave
       FROM usuarios u
       JOIN papeis  p ON p.id = u.papel_id
      WHERE u.email = ?
      LIMIT 1`,
    [email],
  );

  const linha = linhas[0];
  return linha ? mapearUsuario(linha) : null;
}

export async function buscarPorUuid(uuid: string): Promise<UsuarioAutenticacao | null> {
  const [linhas] = await pool.execute<LinhaUsuarioAutenticacao[]>(
    `SELECT u.id,
            u.uuid,
            u.nome,
            u.email,
            u.senha_hash,
            u.ativo,
            u.precisa_trocar_senha,
            u.tentativas_falhas,
            u.bloqueado_ate,
            p.chave AS papel_chave
       FROM usuarios u
       JOIN papeis  p ON p.id = u.papel_id
      WHERE u.uuid = ?
      LIMIT 1`,
    [uuidParaBinario(uuid)],
  );

  const linha = linhas[0];
  return linha ? mapearUsuario(linha) : null;
}

/** Busca pelo id interno. Usado na renovação de sessão, que parte de `sessoes.usuario_id`. */
export async function buscarPorId(id: number): Promise<UsuarioAutenticacao | null> {
  const [linhas] = await pool.execute<LinhaUsuarioAutenticacao[]>(
    `SELECT u.id,
            u.uuid,
            u.nome,
            u.email,
            u.senha_hash,
            u.ativo,
            u.precisa_trocar_senha,
            u.tentativas_falhas,
            u.bloqueado_ate,
            p.chave AS papel_chave
       FROM usuarios u
       JOIN papeis  p ON p.id = u.papel_id
      WHERE u.id = ?
      LIMIT 1`,
    [id],
  );

  const linha = linhas[0];
  return linha ? mapearUsuario(linha) : null;
}

/** Permissões EFETIVAS, pela view `vw_permissoes_efetivas` (a regra mora só lá: login, /auth/me e gestão). */
export async function listarPermissoes(usuarioId: number): Promise<string[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT permissao
       FROM vw_permissoes_efetivas
      WHERE usuario_id = ?
      ORDER BY permissao`,
    [usuarioId],
  );

  return linhas.map((linha) => String(linha.permissao));
}

/** Versão que entra no JWT: token com versão antiga é recusado, o que torna a revogação imediata. */
export async function versaoSessao(usuarioId: number): Promise<number> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT sessao_versao FROM usuarios WHERE id = ? LIMIT 1',
    [usuarioId],
  );

  return Number(linhas[0]?.sessao_versao ?? 0);
}

/** Zera o contador de falhas e registra o login bem-sucedido. */
export async function registrarLoginSucesso(usuarioId: number, ip: Buffer | null): Promise<void> {
  await pool.execute(
    `UPDATE usuarios
        SET tentativas_falhas = 0,
            bloqueado_ate     = NULL,
            ultimo_login_em   = NOW(3),
            ultimo_login_ip   = ?
      WHERE id = ?`,
    [ip, usuarioId],
  );
}

/**
 * Incrementa as falhas e bloqueia no limite, num UPDATE só (sem corrida).
 * ORDEM importa: o MySQL avalia o SET da esquerda para a direita, então
 * `bloqueado_ate` vem PRIMEIRO para o CASE ler `tentativas_falhas` antigo.
 */
export async function registrarFalhaLogin(
  usuarioId: number,
  maxTentativas: number,
  minutosBloqueio: number,
): Promise<void> {
  await pool.execute(
    `UPDATE usuarios
        SET bloqueado_ate = CASE
              WHEN tentativas_falhas + 1 >= ? THEN NOW(3) + INTERVAL ? MINUTE
              ELSE bloqueado_ate
            END,
            tentativas_falhas = tentativas_falhas + 1
      WHERE id = ?`,
    [maxTentativas, minutosBloqueio, usuarioId],
  );
}

export async function atualizarHashSenha(
  usuarioId: number,
  senhaHash: string,
  precisaTrocar = false,
  conexao?: PoolConnection,
): Promise<void> {
  const executor = conexao ?? pool;

  await executor.execute(
    `UPDATE usuarios
        SET senha_hash           = ?,
            senha_algoritmo      = 'argon2id',
            senha_alterada_em    = NOW(3),
            precisa_trocar_senha = ?
      WHERE id = ?`,
    [senhaHash, precisaTrocar ? 1 : 0, usuarioId],
  );
}

/** Grava a senha nova e libera a conta (zera falhas e bloqueio): usado pela redefinição por e-mail. */
export async function redefinirSenhaELiberar(
  usuarioId: number,
  senhaHash: string,
  conexao?: PoolConnection,
): Promise<void> {
  const executor = conexao ?? pool;

  await executor.execute(
    `UPDATE usuarios
        SET senha_hash           = ?,
            senha_algoritmo      = 'argon2id',
            senha_alterada_em    = NOW(3),
            precisa_trocar_senha = 0,
            tentativas_falhas    = 0,
            bloqueado_ate        = NULL
      WHERE id = ?`,
    [senhaHash, usuarioId],
  );
}

export interface NovoUsuario {
  nome: string;
  email: string;
  senhaHash: string;
  papelChave: string;
  precisaTrocarSenha?: boolean;
}

export async function criar(dados: NovoUsuario): Promise<number> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `INSERT INTO usuarios (nome, email, senha_hash, papel_id, precisa_trocar_senha)
     SELECT ?, ?, ?, p.id, ?
       FROM papeis p
      WHERE p.chave = ?`,
    [
      dados.nome,
      dados.email,
      dados.senhaHash,
      dados.precisaTrocarSenha ? 1 : 0,
      dados.papelChave,
    ],
  );

  if (resultado.affectedRows === 0) {
    throw new Error(`Papel inexistente: ${dados.papelChave}`);
  }

  return resultado.insertId;
}

export async function contarAtivos(): Promise<number> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM usuarios WHERE ativo = 1',
  );

  return Number(linhas[0]?.total ?? 0);
}

/** Produtores com carteira, para o filtro por consultor; com `ids`, esses mesmo sem cliente. */
export async function produtoresComCarteira(
  ids: number[] | null,
): Promise<{ id: number; nome: string; ativo: boolean; clientes: number }[]> {
  if (ids !== null && ids.length === 0) return [];
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.nome, p.ativo, COUNT(c.id) AS clientes
       FROM produtores p
       LEFT JOIN clientes c ON c.produtor_id = p.id
      ${ids === null ? '' : 'WHERE p.id IN (?)'}
      GROUP BY p.id, p.nome, p.ativo
      ${ids === null ? 'HAVING clientes > 0' : ''}
      ORDER BY p.nome`,
    ids === null ? [] : [ids],
  );
  return linhas.map((l) => ({ id: Number(l.id), nome: String(l.nome), ativo: Number(l.ativo) === 1, clientes: Number(l.clientes) }));
}

/** Produtores pelos quais o usuário responde. Vazio = NENHUM, nunca "todos". */
export async function produtoresDoUsuario(uuid: string): Promise<number[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT up.produtor_id
       FROM usuario_produtores up
       JOIN usuarios u ON u.id = up.usuario_id
      WHERE u.uuid = ?`,
    [uuidParaBinario(uuid)],
  );

  return linhas.map((l) => Number(l.produtor_id));
}

export interface ProdutorVinculado {
  id: number;
  nome: string;
  /** Quantos cadastros estão nesta carteira hoje. */
  clientes: number;
}

export async function produtoresVinculados(usuarioId: number): Promise<ProdutorVinculado[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.nome,
            (SELECT COUNT(*) FROM clientes c WHERE c.produtor_id = p.id) AS clientes
       FROM usuario_produtores up
       JOIN produtores p ON p.id = up.produtor_id
      WHERE up.usuario_id = ?
      ORDER BY p.nome`,
    [usuarioId],
  );

  return linhas.map((l) => ({
    id: Number(l.id),
    nome: String(l.nome),
    clientes: Number(l.clientes ?? 0),
  }));
}

/** Substitui a lista inteira (DELETE + INSERT) numa transação. */
export async function definirProdutores(
  usuarioId: number,
  produtorIds: number[],
  alteradoPor: number | null = null,
): Promise<void> {
  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    await conexao.execute('DELETE FROM usuario_produtores WHERE usuario_id = ?', [usuarioId]);

    if (produtorIds.length > 0) {
      const valores: number[] = [];
      for (const id of produtorIds) valores.push(usuarioId, id);

      await conexao.query(
        `INSERT INTO usuario_produtores (usuario_id, produtor_id)
         VALUES ${produtorIds.map(() => '(?, ?)').join(', ')}`,
        valores,
      );
    }

    // O histórico vai na MESMA transação: acesso ampliado nunca fica sem rastro.
    await conexao.execute(
      `INSERT INTO usuario_produtores_historico
         (usuario_id, produtores, quantidade, alterado_por)
       VALUES (?, CAST(? AS JSON), ?, ?)`,
      [usuarioId, JSON.stringify(produtorIds), produtorIds.length, alteradoPor],
    );

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

export interface MudancaDeCarteira {
  produtores: number[];
  quantidade: number;
  alteradoPor: string | null;
  alteradoEm: Date;
}

/** As últimas mudanças de carteira de um usuário, da mais recente. */
export async function historicoDeCarteira(
  usuarioId: number,
  limite = 20,
): Promise<MudancaDeCarteira[]> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 100);

  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT h.produtores, h.quantidade, h.alterado_em,
            CONCAT_WS(' ', a.nome, a.sobrenome) AS autor
       FROM usuario_produtores_historico h
       LEFT JOIN usuarios a ON a.id = h.alterado_por
      WHERE h.usuario_id = ?
      ORDER BY h.alterado_em DESC
      LIMIT ${n}`,
    [usuarioId],
  );

  return linhas.map((l) => ({
    // JSON já vem desserializado; texto só em algumas versões do MySQL.
    produtores: Array.isArray(l.produtores)
      ? (l.produtores as number[])
      : (JSON.parse(String(l.produtores)) as number[]),
    quantidade: Number(l.quantidade),
    alteradoPor: l.autor ? String(l.autor).trim() || null : null,
    alteradoEm: l.alterado_em as Date,
  }));
}

/** Catálogo de produtores para a tela de vínculo. */
export async function listarProdutores(): Promise<ProdutorVinculado[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.nome,
            (SELECT COUNT(*) FROM clientes c WHERE c.produtor_id = p.id) AS clientes
       FROM produtores p
      WHERE p.ativo = 1
      ORDER BY p.nome`,
  );

  return linhas.map((l) => ({
    id: Number(l.id),
    nome: String(l.nome),
    clientes: Number(l.clientes ?? 0),
  }));
}

/** Visão geral padrão do papel (ids do catálogo de widgets); `null` = padrão do catálogo. */
export async function visaoGeralDoPapel(uuid: string): Promise<string[] | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT p.visao_geral
       FROM usuarios u
       JOIN papeis p ON p.id = u.papel_id
      WHERE u.uuid = ?`,
    [uuidParaBinario(uuid)],
  );
  const bruto: unknown = linhas[0]?.visao_geral;
  const lista = typeof bruto === 'string' ? (JSON.parse(bruto) as unknown) : bruto;
  return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : null;
}
