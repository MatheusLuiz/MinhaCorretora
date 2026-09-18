import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { emTransacao, pool } from '../database/pool.js';
import { binarioParaUuid, uuidParaBinario } from '../utils/uuid.js';

/** `usuarios` para a tela de gestão; nunca toca em `senha_hash` (esse é o `usuario.repository`). */

export interface UsuarioDetalhado {
  id: string;
  nome: string;
  sobrenome: string | null;
  /** Já em "YYYY-MM-DD": o pool devolve DATE como string, sem passar por fuso. */
  dataNascimento: string | null;
  email: string;
  papelChave: string;
  papelNome: string;
  ativo: boolean;
  precisaTrocarSenha: boolean;
  senhaAlteradaEm: Date;
  ultimoLoginEm: Date | null;
  tentativasFalhas: number;
  bloqueadoAte: Date | null;
  criadoEm: Date;
}

interface Linha extends RowDataPacket {
  uuid: Buffer;
  nome: string;
  sobrenome: string | null;
  data_nascimento: string | null;
  email: string;
  papel_chave: string;
  papel_nome: string;
  ativo: number;
  precisa_trocar_senha: number;
  senha_alterada_em: Date;
  ultimo_login_em: Date | null;
  tentativas_falhas: number;
  bloqueado_ate: Date | null;
  criado_em: Date;
}

const SELECT_BASE = `
  SELECT u.uuid,
         u.nome,
         u.sobrenome,
         u.data_nascimento,
         u.email,
         u.ativo,
         u.precisa_trocar_senha,
         u.senha_alterada_em,
         u.ultimo_login_em,
         u.tentativas_falhas,
         u.bloqueado_ate,
         u.criado_em,
         p.chave AS papel_chave,
         p.nome  AS papel_nome
    FROM usuarios u
    JOIN papeis  p ON p.id = u.papel_id`;

function mapear(linha: Linha): UsuarioDetalhado {
  return {
    id: binarioParaUuid(linha.uuid),
    nome: linha.nome,
    sobrenome: linha.sobrenome,
    dataNascimento: linha.data_nascimento,
    email: linha.email,
    papelChave: linha.papel_chave,
    papelNome: linha.papel_nome,
    ativo: linha.ativo === 1,
    precisaTrocarSenha: linha.precisa_trocar_senha === 1,
    senhaAlteradaEm: linha.senha_alterada_em,
    ultimoLoginEm: linha.ultimo_login_em,
    tentativasFalhas: linha.tentativas_falhas,
    bloqueadoAte: linha.bloqueado_ate,
    criadoEm: linha.criado_em,
  };
}

/** Lista os usuários; o `COALESCE` cobre cadastros sem sobrenome (anteriores à 002). */
export async function listarTodos(): Promise<UsuarioDetalhado[]> {
  const [linhas] = await pool.execute<Linha[]>(
    `${SELECT_BASE} ORDER BY COALESCE(u.sobrenome, u.nome), u.nome`,
  );
  return linhas.map(mapear);
}

export async function detalhar(uuid: string): Promise<UsuarioDetalhado | null> {
  const [linhas] = await pool.execute<Linha[]>(`${SELECT_BASE} WHERE u.uuid = ? LIMIT 1`, [
    uuidParaBinario(uuid),
  ]);
  const linha = linhas[0];
  return linha ? mapear(linha) : null;
}

export interface DadosNovoUsuario {
  nome: string;
  sobrenome: string | null;
  dataNascimento: string | null;
  email: string;
  senhaHash: string;
  papelChave: string;
}

/**
 * Cria o usuário já marcado para trocar a senha. O `INSERT ... SELECT` resolve o
 * papel no próprio comando: papel removido vira zero linhas, não erro de FK.
 */
export async function criar(dados: DadosNovoUsuario): Promise<string> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `INSERT INTO usuarios
       (nome, sobrenome, data_nascimento, email, senha_hash, papel_id, precisa_trocar_senha)
     SELECT ?, ?, ?, ?, ?, p.id, 1
       FROM papeis p
      WHERE p.chave = ?`,
    [dados.nome, dados.sobrenome, dados.dataNascimento, dados.email, dados.senhaHash, dados.papelChave],
  );

  if (resultado.affectedRows === 0) {
    throw new Error(`Papel inexistente: ${dados.papelChave}`);
  }

  const [linhas] = await pool.execute<RowDataPacket[]>('SELECT uuid FROM usuarios WHERE id = ?', [
    resultado.insertId,
  ]);

  return binarioParaUuid(linhas[0]!.uuid as Buffer);
}

export interface DadosEdicao {
  nome?: string;
  sobrenome?: string | null;
  dataNascimento?: string | null;
  papelChave?: string;
}

/** Atualiza o cadastro. O e-mail fica de fora: é o login, e trocá-lo sem verificação permite sequestrar a conta. */
export async function atualizar(uuid: string, dados: DadosEdicao): Promise<boolean> {
  const partes: string[] = [];
  // Tipado, e não unknown[]: o mysql2 só aceita escalares e Buffer.
  const valores: (string | Buffer | null)[] = [];

  if (dados.nome !== undefined) {
    partes.push('nome = ?');
    valores.push(dados.nome);
  }
  if (dados.sobrenome !== undefined) {
    partes.push('sobrenome = ?');
    valores.push(dados.sobrenome);
  }
  if (dados.dataNascimento !== undefined) {
    partes.push('data_nascimento = ?');
    valores.push(dados.dataNascimento);
  }
  if (dados.papelChave !== undefined) {
    partes.push('papel_id = (SELECT id FROM papeis WHERE chave = ?)');
    valores.push(dados.papelChave);
  }

  if (partes.length === 0) return false;

  valores.push(uuidParaBinario(uuid));

  const [resultado] = await pool.execute<ResultSetHeader>(
    `UPDATE usuarios SET ${partes.join(', ')} WHERE uuid = ?`,
    valores,
  );

  return resultado.affectedRows > 0;
}

/** Ativa ou desativa; reativar zera o contador de falhas e o bloqueio. */
export async function definirAtivo(uuid: string, ativo: boolean): Promise<boolean> {
  const marca = ativo ? 1 : 0;

  const [resultado] = await pool.execute<ResultSetHeader>(
    `UPDATE usuarios
        SET ativo = ?,
            tentativas_falhas = IF(? = 1, 0, tentativas_falhas),
            bloqueado_ate     = IF(? = 1, NULL, bloqueado_ate)
      WHERE uuid = ?`,
    [marca, marca, marca, uuidParaBinario(uuid)],
  );

  return resultado.affectedRows > 0;
}

/** Redefine a senha e volta a exigir troca no próximo acesso. */
export async function redefinirSenha(uuid: string, senhaHash: string): Promise<boolean> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `UPDATE usuarios
        SET senha_hash           = ?,
            senha_algoritmo      = 'argon2id',
            senha_alterada_em    = NOW(3),
            precisa_trocar_senha = 1,
            tentativas_falhas    = 0,
            bloqueado_ate        = NULL
      WHERE uuid = ?`,
    [senhaHash, uuidParaBinario(uuid)],
  );

  return resultado.affectedRows > 0;
}

/** Quantos administradores ativos existem ALÉM do informado. */
export async function contarOutrosAdminsAtivos(uuidExcluido: string): Promise<number> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM usuarios u
       JOIN papeis  p ON p.id = u.papel_id
      WHERE p.chave = 'admin'
        AND u.ativo = 1
        AND u.uuid <> ?`,
    [uuidParaBinario(uuidExcluido)],
  );

  return Number(linhas[0]?.total ?? 0);
}

export async function emailJaUsado(email: string): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM usuarios WHERE email = ? LIMIT 1',
    [email],
  );
  return linhas.length > 0;
}

/** Permissões concedidas por um papel — usado no detalhe do usuário. */
export async function listarPermissoesDoPapel(papelChave: string): Promise<string[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT pe.chave
       FROM papeis           p
       JOIN papel_permissoes pp ON pp.papel_id = p.id
       JOIN permissoes       pe ON pe.id = pp.permissao_id
      WHERE p.chave = ?
      ORDER BY pe.chave`,
    [papelChave],
  );

  return linhas.map((l) => String(l.chave));
}

export interface PapelDisponivel {
  chave: string;
  nome: string;
  descricao: string | null;
  totalPermissoes: number;
  /** Inativo sai da escolha ao criar ou editar usuário. */
  ativo: boolean;
  usuariosAtivos: number;
}

export async function listarPapeis(): Promise<PapelDisponivel[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT p.chave, p.nome, p.descricao, p.ativo, COUNT(pp.permissao_id) AS total,
            (SELECT COUNT(*) FROM usuarios u WHERE u.papel_id = p.id AND u.ativo = 1) AS usuarios_ativos
       FROM papeis p
       LEFT JOIN papel_permissoes pp ON pp.papel_id = p.id
      GROUP BY p.id, p.chave, p.nome, p.descricao, p.ativo
      ORDER BY p.ativo DESC, COUNT(pp.permissao_id) DESC`,
  );

  return linhas.map((l) => ({
    chave: String(l.chave),
    nome: String(l.nome),
    descricao: l.descricao === null ? null : String(l.descricao),
    totalPermissoes: Number(l.total),
    ativo: Boolean(l.ativo),
    usuariosAtivos: Number(l.usuarios_ativos),
  }));
}

/** Chave ou nome já usados? O nome compara pela collation (sem acento, sem caixa). */
export async function papelEmUso(chave: string, nome: string): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM papeis WHERE chave = ? OR nome = ? LIMIT 1',
    [chave, nome],
  );
  return linhas.length > 0;
}

/** Cria um papel; com `copiarDe`, nasce com as permissões e a visão geral do de origem. */
export async function criarPapel(
  chave: string,
  nome: string,
  descricao: string | null,
  copiarDe: string | null,
): Promise<void> {
  await emTransacao(async (conexao) => {
    // Consulta à parte: o MySQL recusa ler `papeis` numa subconsulta do INSERT em `papeis` (1093).
    const [origem] = await conexao.execute<RowDataPacket[]>(
      'SELECT visao_geral FROM papeis WHERE chave = ?',
      [copiarDe],
    );
    const visaoGeral = origem[0]?.visao_geral ?? null;
    const [r] = await conexao.execute<ResultSetHeader>(
      'INSERT INTO papeis (chave, nome, descricao, visao_geral) VALUES (?, ?, ?, ?)',
      [chave, nome, descricao, visaoGeral === null ? null : JSON.stringify(visaoGeral)],
    );
    if (copiarDe) {
      await conexao.execute(
        `INSERT INTO papel_permissoes (papel_id, permissao_id)
         SELECT ?, pp.permissao_id
           FROM papel_permissoes pp JOIN papeis o ON o.id = pp.papel_id
          WHERE o.chave = ?`,
        [r.insertId, copiarDe],
      );
    }
  });
}

export async function definirPapelAtivo(chave: string, ativo: boolean): Promise<void> {
  await pool.execute('UPDATE papeis SET ativo = ? WHERE chave = ?', [ativo ? 1 : 0, chave]);
}

/** Nome já usado por OUTRO papel? (collation: sem acento, sem caixa) */
export async function nomeDePapelEmUso(nome: string, excetoChave: string): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM papeis WHERE nome = ? AND chave <> ? LIMIT 1',
    [nome, excetoChave],
  );
  return linhas.length > 0;
}

/** Nome e descrição. A chave não muda: é a referência do código e da auditoria. */
export async function atualizarPapel(chave: string, nome: string, descricao: string | null): Promise<void> {
  await pool.execute('UPDATE papeis SET nome = ?, descricao = ? WHERE chave = ?', [nome, descricao, chave]);
}

/** Usuários com o papel, ATIVOS OU NÃO — `usuarios.papel_id` impede apagar com algum. */
export async function contarUsuariosDoPapel(chave: string): Promise<number> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM usuarios u JOIN papeis p ON p.id = u.papel_id WHERE p.chave = ?',
    [chave],
  );
  return Number(linhas[0]?.n ?? 0);
}

/** Apaga o papel; as permissões dele caem junto (`ON DELETE CASCADE`). */
export async function excluirPapel(chave: string): Promise<void> {
  await pool.execute('DELETE FROM papeis WHERE chave = ?', [chave]);
}

export interface ExcecaoPermissao {
  chave: string;
  concedida: boolean;
  motivo: string | null;
  criadoEm: Date;
}

/** Exceções registradas para um usuário — o que foi somado ou tirado do papel. */
export async function listarExcecoes(uuid: string): Promise<ExcecaoPermissao[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT pe.chave, up.concedida, up.motivo, up.criado_em
       FROM usuarios           u
       JOIN usuario_permissoes up ON up.usuario_id = u.id
       JOIN permissoes         pe ON pe.id = up.permissao_id
      WHERE u.uuid = ?
      ORDER BY pe.chave`,
    [uuidParaBinario(uuid)],
  );

  return linhas.map((l) => ({
    chave: String(l.chave),
    concedida: Number(l.concedida) === 1,
    motivo: l.motivo === null ? null : String(l.motivo),
    criadoEm: l.criado_em as Date,
  }));
}

/** Permissões efetivas, já resolvendo papel + exceções. */
export async function listarEfetivas(uuid: string): Promise<string[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT v.permissao
       FROM usuarios u
       JOIN vw_permissoes_efetivas v ON v.usuario_id = u.id
      WHERE u.uuid = ?
      ORDER BY v.permissao`,
    [uuidParaBinario(uuid)],
  );

  return linhas.map((l) => String(l.permissao));
}

/** Catálogo completo de permissões do sistema. */
export async function listarCatalogoPermissoes(): Promise<
  { chave: string; descricao: string | null }[]
> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT chave, descricao FROM permissoes ORDER BY chave',
  );

  return linhas.map((l) => ({
    chave: String(l.chave),
    descricao: l.descricao === null ? null : String(l.descricao),
  }));
}

export interface ExcecaoParaGravar {
  chave: string;
  concedida: boolean;
  motivo?: string | null;
}

/** Substitui TODAS as exceções do usuário pelas informadas, em transação. */
export async function substituirExcecoes(
  uuid: string,
  excecoes: ExcecaoParaGravar[],
  autorUuid: string,
): Promise<void> {
  await emTransacao(async (conexao) => {
    const [alvo] = await conexao.execute<RowDataPacket[]>(
      'SELECT id FROM usuarios WHERE uuid = ?',
      [uuidParaBinario(uuid)],
    );
    const usuarioId = alvo[0]?.id as number | undefined;
    if (usuarioId === undefined) throw new Error('Usuário não encontrado.');

    const [autor] = await conexao.execute<RowDataPacket[]>(
      'SELECT id FROM usuarios WHERE uuid = ?',
      [uuidParaBinario(autorUuid)],
    );
    const autorId = (autor[0]?.id as number | undefined) ?? null;

    await conexao.execute('DELETE FROM usuario_permissoes WHERE usuario_id = ?', [usuarioId]);

    for (const excecao of excecoes) {
      await conexao.execute(
        `INSERT INTO usuario_permissoes (usuario_id, permissao_id, concedida, motivo, concedida_por)
         SELECT ?, p.id, ?, ?, ?
           FROM permissoes p
          WHERE p.chave = ?`,
        [
          usuarioId,
          excecao.concedida ? 1 : 0,
          excecao.motivo ?? null,
          autorId,
          excecao.chave,
        ],
      );
    }
  });
}

export interface PermissaoDoPapel {
  chave: string;
  descricao: string | null;
  concedida: boolean;
}

export interface PapelDetalhado {
  chave: string;
  nome: string;
  descricao: string | null;
  /** Quantas pessoas ATIVAS têm este papel — o alcance de qualquer mudança. */
  usuariosAtivos: number;
  ativo: boolean;
  permissoes: PermissaoDoPapel[];
}

/** O papel com o catálogo INTEIRO de permissões (a tela precisa das desmarcadas), marcando o que concede. */
export async function detalharPapel(chave: string): Promise<PapelDetalhado | null> {
  const [papeis] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.chave, p.nome, p.descricao, p.ativo,
            (SELECT COUNT(*) FROM usuarios u WHERE u.papel_id = p.id AND u.ativo = 1) AS ativos
       FROM papeis p WHERE p.chave = ? LIMIT 1`,
    [chave],
  );

  const papel = papeis[0];
  if (!papel) return null;

  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT pe.chave, pe.descricao, (pp.papel_id IS NOT NULL) AS concedida
       FROM permissoes pe
       LEFT JOIN papel_permissoes pp
              ON pp.permissao_id = pe.id AND pp.papel_id = ?
      ORDER BY pe.chave`,
    [papel.id],
  );

  return {
    chave: String(papel.chave),
    nome: String(papel.nome),
    descricao: papel.descricao === null ? null : String(papel.descricao),
    usuariosAtivos: Number(papel.ativos),
    ativo: Boolean(papel.ativo),
    permissoes: linhas.map((l) => ({
      chave: String(l.chave),
      descricao: l.descricao === null ? null : String(l.descricao),
      concedida: Number(l.concedida) === 1,
    })),
  };
}

/** Ninguém pode se trancar para fora: alguém precisa continuar podendo gerir. */
export class SemAdministradorError extends Error {
  constructor() {
    super(
      'A mudança deixaria o sistema sem nenhum usuário ativo capaz de gerenciar ' +
        'usuários e papéis. Conceda "usuarios.gerenciar" a outro papel antes.',
    );
    this.name = 'SemAdministradorError';
  }
}

/**
 * Substitui as permissões do papel. Desfaz se não sobrar usuário ATIVO com
 * `usuarios.gerenciar` (conferido na view: concessão individual também serve).
 * Incrementa `sessao_versao` de quem tem o papel: o JWT carrega as permissões do login.
 */
export async function definirPermissoesDoPapel(
  chave: string,
  permissoes: string[],
): Promise<PapelDetalhado> {
  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    const [papeis] = await conexao.execute<RowDataPacket[]>(
      'SELECT id FROM papeis WHERE chave = ? LIMIT 1',
      [chave],
    );
    const papelId = papeis[0]?.id;
    if (!papelId) throw new Error(`Papel inexistente: ${chave}`);

    await conexao.execute('DELETE FROM papel_permissoes WHERE papel_id = ?', [papelId]);

    if (permissoes.length > 0) {
      await conexao.query(
        `INSERT INTO papel_permissoes (papel_id, permissao_id)
         SELECT ?, id FROM permissoes WHERE chave IN (?)`,
        [papelId, permissoes],
      );
    }

    const [sobrou] = await conexao.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n
         FROM vw_permissoes_efetivas v
         JOIN usuarios u ON u.id = v.usuario_id
        WHERE v.permissao = 'usuarios.gerenciar' AND u.ativo = 1`,
    );

    if (Number(sobrou[0]?.n ?? 0) === 0) {
      await conexao.rollback();
      throw new SemAdministradorError();
    }

    await conexao.execute(
      'UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE papel_id = ?',
      [papelId],
    );

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }

  return (await detalharPapel(chave))!;
}
