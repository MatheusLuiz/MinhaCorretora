import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Pool de conexões MySQL.
 *
 * A defesa contra SQL injection deste projeto se decide aqui e no fato de que
 * todo SQL vive em `repositories/`:
 *
 *  1. `multipleStatements: false` — o driver recusa mais de um comando por
 *     query. Mesmo que alguma string escape, um `; DROP TABLE` nem chega a ser
 *     parseado pelo servidor.
 *
 *  2. Só usamos `execute()` (prepared statement de verdade, protocolo binário do
 *     MySQL), nunca `query()`. Em `execute()`, o comando e os dados viajam em
 *     mensagens separadas: o servidor já compilou o plano antes de ver o valor,
 *     então o dado não tem como virar comando. Em `query()` o driver interpola a
 *     string no cliente — mesmo escapando, é outra categoria de garantia.
 *
 *  3. `namedPlaceholders: false` mantém tudo em `?` posicional, que é o caminho
 *     mais simples de auditar em revisão de código.
 */
export const pool: Pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,

  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  connectTimeout: 10_000,

  // --- Segurança ---
  multipleStatements: false,
  namedPlaceholders: false,

  // Devolve DECIMAL/BIGINT como string em vez de number, para não perder
  // precisão silenciosamente em valor monetário (prêmio, comissão).
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: false,

  charset: 'utf8mb4_0900_ai_ci',
  timezone: 'Z',

  /**
   * Colunas `DATE` voltam como string 'YYYY-MM-DD'; `DATETIME` continua virando
   * `Date`.
   *
   * Uma data sem hora não tem fuso. Deixando o driver convertê-la em `Date`, ela
   * vira meia-noite UTC — e ler essa data com os métodos locais no Brasil
   * (UTC-3) devolve o DIA ANTERIOR. Quem nasceu em 17/04 aparece como 16/04.
   * Como string, o valor atravessa o sistema exatamente como foi gravado.
   */
  dateStrings: ['DATE'],

  ...(env.DB_SSL
    ? { ssl: { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } }
    : {}),
});

/** Confere a conexão na subida — melhor falhar aqui do que no primeiro login. */
export async function verificarConexao(): Promise<void> {
  const conexao = await pool.getConnection();
  try {
    const [linhas] = await conexao.execute<RowDataPacket[]>('SELECT VERSION() AS versao');
    logger.info({ mysql: linhas[0]?.versao }, 'Conexão com o MySQL estabelecida');
  } finally {
    conexao.release();
  }
}

export async function encerrarPool(): Promise<void> {
  await pool.end();
  logger.info('Pool do MySQL encerrado.');
}

/**
 * Executa um bloco dentro de uma transação, com rollback automático em erro.
 *
 * Usado onde a consistência não pode depender de sorte — por exemplo, rotacionar
 * um refresh token: marcar o antigo como usado e criar o novo precisa acontecer
 * junto ou não acontecer.
 */
export async function emTransacao<T>(
  operacao: (conexao: PoolConnection) => Promise<T>,
): Promise<T> {
  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();
    const resultado = await operacao(conexao);
    await conexao.commit();
    return resultado;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

export type { Pool, PoolConnection, RowDataPacket, ResultSetHeader };
