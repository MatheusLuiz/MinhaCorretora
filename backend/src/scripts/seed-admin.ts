/**
 * Cria o primeiro usuário administrador.
 *
 *   npm run db:seed:admin -- --nome "Fulano" --email fulano@corretora.com.br
 *
 * Senha gerada e mostrada uma vez (argumento iria para o histórico do shell),
 * com troca no primeiro acesso. Recusa se já houver usuário ativo.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

import { encerrarPool, verificarConexao } from '../database/pool.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import { gerarHashSenha } from '../services/password.service.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/** Senha aleatória legível: sem caracteres que se confundem (0/O, 1/l/I). */
function gerarSenhaTemporaria(tamanho = 20): string {
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(tamanho);

  let senha = '';
  for (let i = 0; i < tamanho; i += 1) {
    senha += ALFABETO[bytes[i]! % ALFABETO.length];
  }
  return senha;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      nome: { type: 'string' },
      email: { type: 'string' },
      papel: { type: 'string', default: 'admin' },
    },
    allowPositionals: false,
  });

  const nome = values.nome?.trim();
  const email = values.email?.trim().toLowerCase();

  if (!nome || !email) {
    console.error('\nUso: npm run db:seed:admin -- --nome "Nome" --email email@dominio\n');
    process.exit(1);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('\nE-mail em formato inválido.\n');
    process.exit(1);
  }

  await verificarConexao();

  const totalAtivos = await usuarioRepo.contarAtivos();

  if (totalAtivos > 0) {
    console.error(
      `\nJá existem ${totalAtivos} usuário(s) ativo(s). Este script só cria o primeiro administrador.` +
        '\nUse a tela de gestão de usuários para os demais.\n',
    );
    process.exit(1);
  }

  if (await usuarioRepo.buscarPorEmail(email)) {
    console.error(`\nJá existe um usuário com o e-mail ${email}.\n`);
    process.exit(1);
  }

  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await gerarHashSenha(senhaTemporaria);

  const id = await usuarioRepo.criar({
    nome,
    email,
    senhaHash,
    papelChave: values.papel ?? 'admin',
    precisaTrocarSenha: true,
  });

  logger.info({ usuarioId: id, email }, 'Administrador criado');

  // Fora do logger: a senha não pode ser persistida.
  console.log(`
┌─────────────────────────────────────────────────────────────┐
│  Administrador criado                                       │
└─────────────────────────────────────────────────────────────┘

  Nome   : ${nome}
  E-mail : ${email}
  Papel  : ${values.papel ?? 'admin'}
  Senha  : ${senhaTemporaria}

  Esta senha aparece UMA única vez e não fica gravada em lugar algum.
  Anote agora e troque no primeiro acesso — a conta já está marcada
  com "precisa trocar senha".

  Mínimo exigido pela política: ${env.SENHA_TAMANHO_MINIMO} caracteres.
`);
}

main()
  .catch((erro: unknown) => {
    logger.fatal({ err: erro }, 'Falha ao criar o administrador');
    process.exitCode = 1;
  })
  .finally(() => {
    void encerrarPool();
  });
