/**
 * Aplica, em ordem alfabética, os .sql de `database/migrations` e `database/seeds`
 * que ainda não estão em `_migrations`. Usa DB_MIGRATOR_* (a aplicação não tem DDL).
 *
 *   npm run db:migrate
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mysql, { type RowDataPacket } from 'mysql2/promise';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_DATABASE = path.resolve(AQUI, '../../../database');

interface Arquivo {
  nome: string;
  caminho: string;
  conteudo: string;
  hash: string;
}

async function carregarArquivos(pasta: string, prefixo: string): Promise<Arquivo[]> {
  const diretorio = path.join(RAIZ_DATABASE, pasta);

  let nomes: string[];
  try {
    nomes = (await readdir(diretorio)).filter((nome) => nome.endsWith('.sql')).sort();
  } catch {
    logger.warn({ diretorio }, 'Pasta não encontrada, ignorando');
    return [];
  }

  return Promise.all(
    nomes.map(async (nome) => {
      const caminho = path.join(diretorio, nome);
      const conteudo = await readFile(caminho, 'utf8');
      return {
        nome: `${prefixo}/${nome}`,
        caminho,
        conteudo,
        hash: createHash('sha256').update(conteudo).digest('hex'),
      };
    }),
  );
}

/** Quebra em comandos pelo ';' fora de string, identificador e comentário. */
function separarComandos(sql: string): string[] {
  const comandos: string[] = [];
  let atual = '';
  let aspaSimples = false;
  let aspaDupla = false;
  let crase = false;
  let comentarioLinha = false;
  let comentarioBloco = false;

  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i]!;
    const proximo = sql[i + 1];

    if (comentarioLinha) {
      if (c === '\n') comentarioLinha = false;
      atual += c;
      continue;
    }

    if (comentarioBloco) {
      atual += c;
      if (c === '*' && proximo === '/') {
        atual += proximo;
        i += 1;
        comentarioBloco = false;
      }
      continue;
    }

    if (!aspaSimples && !aspaDupla && !crase) {
      if (c === '-' && proximo === '-') {
        comentarioLinha = true;
        atual += c;
        continue;
      }
      if (c === '#') {
        comentarioLinha = true;
        atual += c;
        continue;
      }
      if (c === '/' && proximo === '*') {
        comentarioBloco = true;
        atual += c;
        continue;
      }
    }

    if (c === "'" && !aspaDupla && !crase && sql[i - 1] !== '\\') aspaSimples = !aspaSimples;
    else if (c === '"' && !aspaSimples && !crase && sql[i - 1] !== '\\') aspaDupla = !aspaDupla;
    else if (c === '`' && !aspaSimples && !aspaDupla) crase = !crase;

    if (c === ';' && !aspaSimples && !aspaDupla && !crase) {
      const comando = atual.trim();
      if (comando) comandos.push(comando);
      atual = '';
      continue;
    }

    atual += c;
  }

  const resto = atual.trim();
  if (resto) comandos.push(resto);

  return comandos.filter((comando) => {
    const semComentario = comando
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(--|#).*$/gm, '')
      .trim();
    return semComentario.length > 0;
  });
}

async function main(): Promise<void> {
  // Fora do pool: o database pode ainda não existir.
  const conexao = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_MIGRATOR_USER ?? env.DB_USER,
    password: env.DB_MIGRATOR_PASSWORD ?? env.DB_PASSWORD,
    multipleStatements: false,
    ...(env.DB_SSL ? { ssl: { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : {}),
  });

  try {
    await conexao.changeUser({ database: env.DB_NAME });

    await conexao.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
         nome      VARCHAR(255) NOT NULL,
         hash      CHAR(64)     NOT NULL,
         aplicada_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
         PRIMARY KEY (id),
         UNIQUE KEY uq_migrations_nome (nome)
       ) ENGINE=InnoDB`,
    );

    const [aplicadas] = await conexao.execute<RowDataPacket[]>(
      'SELECT nome, hash FROM _migrations',
    );
    const jaAplicadas = new Map(aplicadas.map((l) => [String(l.nome), String(l.hash)]));

    const arquivos = [
      ...(await carregarArquivos('migrations', 'migrations')),
      ...(await carregarArquivos('seeds', 'seeds')),
    ];

    if (arquivos.length === 0) {
      logger.warn('Nenhum arquivo .sql encontrado.');
      return;
    }

    let aplicou = 0;

    for (const arquivo of arquivos) {
      const hashAnterior = jaAplicadas.get(arquivo.nome);

      if (hashAnterior) {
        if (hashAnterior !== arquivo.hash) {
          logger.error(
            { arquivo: arquivo.nome },
            'Migration já aplicada foi alterada. Crie uma nova em vez de editar esta.',
          );
          process.exitCode = 1;
          return;
        }
        continue;
      }

      const comandos = separarComandos(arquivo.conteudo);
      logger.info({ arquivo: arquivo.nome, comandos: comandos.length }, 'Aplicando');

      for (const comando of comandos) {
        await conexao.query(comando);
      }

      await conexao.execute('INSERT INTO _migrations (nome, hash) VALUES (?, ?)', [
        arquivo.nome,
        arquivo.hash,
      ]);

      aplicou += 1;
    }

    logger.info(
      aplicou === 0 ? 'Banco já está atualizado.' : `${aplicou} arquivo(s) aplicado(s).`,
    );
  } finally {
    await conexao.end();
  }
}

main().catch((erro: unknown) => {
  logger.fatal({ err: erro }, 'Falha ao aplicar migrations');
  process.exit(1);
});
