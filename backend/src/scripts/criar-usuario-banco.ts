/**
 * Cria o usuário de banco da aplicação com privilégio mínimo.
 *
 *   npm run db:criar-usuario
 *
 * Usa as credenciais administrativas do .env e gera senha aleatória, mostrada
 * uma única vez para colar em DB_PASSWORD.
 */
import { randomBytes } from 'node:crypto';

import mysql, { type RowDataPacket } from 'mysql2/promise';

import { env, isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';

/** 32 bytes em base64url: sem aspas, barras ou cifrão que quebrem .env e shell. */
function gerarSenha(): string {
  return randomBytes(32).toString('base64url');
}

async function main(): Promise<void> {
  const senhaApp = gerarSenha();
  const usuarioApp = 'minhacorretora_bi_app';

  const conexao = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    multipleStatements: false,
    ...(env.DB_SSL ? { ssl: { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } : {}),
  });

  try {
    const [quem] = await conexao.query<RowDataPacket[]>('SELECT CURRENT_USER() AS u');
    logger.info({ conectadoComo: quem[0]?.u }, 'Conectado ao MySQL');

    await conexao.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );

    // Num MySQL local sem certificado, exigir TLS impediria a conexão.
    const exigeSsl = env.DB_SSL ? 'REQUIRE SSL' : '';

    const hostApp = env.DB_HOST === '127.0.0.1' || env.DB_HOST === 'localhost' ? 'localhost' : '%';

    // DDL não aceita placeholder; nada aqui vem do usuário (senha em base64url).
    const identificacao = `IDENTIFIED WITH caching_sha2_password BY '${senhaApp}'`;
    const alvo = `'${usuarioApp}'@'${hostApp}'`;

    // Ordem obrigatória: IDENTIFIED → REQUIRE → WITH → opções de senha.
    await conexao.query(
      `CREATE USER IF NOT EXISTS ${alvo} ${identificacao} ${exigeSsl}
         WITH MAX_USER_CONNECTIONS 30
         FAILED_LOGIN_ATTEMPTS 5 PASSWORD_LOCK_TIME 1`,
    );

    // Usuário já existente: o CREATE não fez nada, o ALTER troca a senha.
    await conexao.query(`ALTER USER ${alvo} ${identificacao} ${exigeSsl}`);

    // Privilégio mínimo: só DML, só neste schema.
    await conexao.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE
         ON \`${env.DB_NAME}\`.*
         TO '${usuarioApp}'@'${hostApp}'`,
    );

    await conexao.query('FLUSH PRIVILEGES');

    const [grants] = await conexao.query<RowDataPacket[]>(
      `SHOW GRANTS FOR '${usuarioApp}'@'${hostApp}'`,
    );

    // Fora do logger: a senha não pode ser persistida.
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│  Usuário de banco criado                                    │
└─────────────────────────────────────────────────────────────┘

  Usuário : ${usuarioApp}@${hostApp}
  Senha   : ${senhaApp}
  Schema  : ${env.DB_NAME}

  Cole no backend/.env:

    DB_USER=${usuarioApp}
    DB_PASSWORD=${senhaApp}

  Privilégios concedidos:
${grants.map((linha) => `    ${Object.values(linha)[0]}`).join('\n')}

  Confira acima: deve aparecer apenas USAGE em *.* e
  SELECT, INSERT, UPDATE, DELETE em \`${env.DB_NAME}\`.
  Se aparecer ALL PRIVILEGES, DROP ou GRANT OPTION, algo saiu errado.
`);

    if (isProduction) {
      console.log(
        '  Produção: restrinja o host ao IP do servidor de aplicação com\n' +
          `  RENAME USER '${usuarioApp}'@'${hostApp}' TO '${usuarioApp}'@'10.0.1.%';\n`,
      );
    }
  } finally {
    await conexao.end();
  }
}

main().catch((erro: unknown) => {
  logger.fatal({ err: erro }, 'Falha ao criar o usuário de banco');
  process.exit(1);
});
