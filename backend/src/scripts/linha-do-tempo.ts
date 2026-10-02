/**
 * LINHA DO TEMPO da base: pontos de restauração com nome, e a volta a um deles.
 *
 *   npm run db:ponto -- --nome antes-junho-julho --descricao "base com ago e set"
 *   npm run db:pontos                                  # lista a linha do tempo
 *   npm run db:voltar -- --ponto antes-junho-julho     # prévia: o que muda
 *   npm run db:voltar -- --ponto antes-junho-julho --confirmar
 *
 * Só DADOS, nunca estrutura (tabelas e views são das migrations): a volta é
 * DELETE + INSERT numa transação. Antes de voltar, o estado atual vira ponto.
 * Dumps em `backups/pontos/`; índice em `docs/linha-do-tempo.md`.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';

import { env } from '../config/env.js';
import { encerrarPool, pool } from '../database/pool.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PASTA = join(RAIZ, 'backups', 'pontos');
const INDICE = join(RAIZ, 'docs', 'linha-do-tempo.md');

/** O que não volta no tempo: acesso e controle de schema. */
const FORA_DO_PONTO = ['_migrations', 'sessoes', 'tentativas_login', 'tokens_redefinicao_senha', 'usuarios'];

/** Contagens gravadas no índice. */
const CONTAGENS = ['clientes', 'apolices', 'comissoes', 'comissoes_itens', 'parcelas', 'sinistros', 'arquivos_importados'];

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function slug(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function agora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function tabelasDoPonto(): Promise<string[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT table_name AS nome FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE' AND table_name NOT IN (?)
      ORDER BY table_name`,
    [env.DB_NAME, FORA_DO_PONTO],
  );
  return linhas.map((l) => String(l.nome));
}

async function contagens(): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  for (const t of CONTAGENS) {
    const [linhas] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${t}\``);
    r[t] = Number(linhas[0]?.n ?? 0);
  }
  return r;
}

function commitAtual(): Promise<string> {
  return new Promise((ok) => {
    const p = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: RAIZ });
    let s = '';
    p.stdout.on('data', (d: Buffer) => (s += d.toString()));
    p.on('close', () => ok(s.trim() || '?'));
    p.on('error', () => ok('?'));
  });
}

/** Credenciais pelo ambiente (MYSQL_PWD), nunca na linha de comando. */
function credenciais(): { args: string[]; env: NodeJS.ProcessEnv } {
  const usuario = process.env.DB_MIGRATOR_USER ?? env.DB_USER;
  const senha = process.env.DB_MIGRATOR_PASSWORD ?? env.DB_PASSWORD;
  return {
    args: ['-h', env.DB_HOST, '-P', String(env.DB_PORT), '-u', usuario],
    env: { ...process.env, MYSQL_PWD: senha },
  };
}

function rodar(programa: string, args: string[], opcoes: { saida?: string; entrada?: string; prefixo?: string; sufixo?: string }): Promise<void> {
  return new Promise((ok, falha) => {
    const c = credenciais();
    const p = spawn(programa, [...c.args, ...args], { env: c.env });
    let erro = '';
    p.stderr.on('data', (d: Buffer) => (erro += d.toString()));
    if (opcoes.saida) {
      const partes: Buffer[] = [];
      p.stdout.on('data', (d: Buffer) => partes.push(d));
      p.on('close', (codigo) => {
        if (codigo !== 0) return falha(new Error(`${programa} falhou: ${erro.trim()}`));
        writeFileSync(opcoes.saida!, Buffer.concat(partes));
        ok();
      });
    } else {
      p.on('close', (codigo) => (codigo === 0 ? ok() : falha(new Error(`${programa} falhou: ${erro.trim()}`))));
    }
    if (opcoes.entrada) {
      p.stdin.write(opcoes.prefixo ?? '');
      const r = createReadStream(opcoes.entrada);
      r.on('data', (d) => p.stdin.write(d));
      r.on('end', () => p.stdin.end(opcoes.sufixo ?? ''));
    }
  });
}

interface Ponto {
  nome: string;
  arquivo: string;
  quando: string;
  descricao: string;
  commit: string;
  contagens: Record<string, number>;
}

function lerIndice(): Ponto[] {
  if (!existsSync(INDICE)) return [];
  const m = readFileSync(INDICE, 'utf8').match(/<!-- pontos\n([\s\S]*?)\n-->/);
  return m ? (JSON.parse(m[1]!) as Ponto[]) : [];
}

function escreverIndice(pontos: Ponto[]): void {
  const linhas = pontos
    .map((p) => {
      const c = p.contagens;
      return `| ${p.quando} | \`${p.nome}\` | ${p.descricao} | ${c.clientes ?? ''} | ${c.apolices ?? ''} | ${c.comissoes ?? ''} | ${c.arquivos_importados ?? ''} | ${p.commit} |`;
    })
    .join('\n');
  writeFileSync(
    INDICE,
    `# Linha do tempo da base

Pontos de restauração dos DADOS (gerado por \`npm run db:ponto\` — não edite à
mão a tabela nem o bloco escondido no fim). Para voltar a um ponto:

    npm run db:voltar -- --ponto <nome>              # prévia
    npm run db:voltar -- --ponto <nome> --confirmar  # volta (e cria um ponto do estado de antes)

Depois de voltar, reinicie o backend. Usuários, sessões e migrations não
voltam no tempo. Os arquivos ficam em \`backups/pontos/\` (fora do git).

| Quando | Ponto | O que é | Clientes | Apólices | Comissões | Cargas | Commit |
|---|---|---|---|---|---|---|---|
${linhas}

<!-- pontos
${JSON.stringify(pontos, null, 1)}
-->
`,
  );
}

async function criarPonto(nomeBruto: string, descricao: string): Promise<Ponto> {
  const nome = slug(nomeBruto);
  if (!nome) throw new Error('Dê um nome ao ponto: --nome <nome>');
  const pontos = lerIndice();
  if (pontos.some((p) => p.nome === nome)) throw new Error(`Já existe o ponto "${nome}". Use outro nome.`);

  mkdirSync(PASTA, { recursive: true });
  const arquivo = `${agora()}_${nome}.sql`;
  const tabelas = await tabelasDoPonto();
  await rodar(
    'mysqldump',
    [
      '--single-transaction', '--no-tablespaces', '--no-create-info', '--skip-triggers',
      '--skip-add-locks', '--skip-disable-keys', '--complete-insert', '--hex-blob',
      '--default-character-set=utf8mb4', '--set-gtid-purged=OFF', env.DB_NAME, ...tabelas,
    ],
    { saida: join(PASTA, arquivo) },
  );

  const ponto: Ponto = {
    nome,
    arquivo,
    quando: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(0, 17),
    descricao: descricao.replace(/\|/g, '/'),
    commit: await commitAtual(),
    contagens: await contagens(),
  };
  escreverIndice([...pontos, ponto]);
  const mb = (statSync(join(PASTA, arquivo)).size / 1048576).toFixed(1);
  console.log(`\nPonto "${nome}" criado: backups/pontos/${arquivo} (${mb} MB, ${tabelas.length} tabelas)`);
  console.log('Contagens:', ponto.contagens, '\n');
  return ponto;
}

async function voltar(nomeBruto: string, confirmar: boolean): Promise<void> {
  const nome = slug(nomeBruto);
  const ponto = lerIndice().find((p) => p.nome === nome);
  if (!ponto) throw new Error(`Não há ponto "${nome}". Veja os pontos com: npm run db:pontos`);
  const caminho = join(PASTA, ponto.arquivo);
  if (!existsSync(caminho)) throw new Error(`O arquivo do ponto sumiu: backups/pontos/${ponto.arquivo}`);

  const atual = await contagens();
  console.log(`\nVoltar para "${ponto.nome}" (${ponto.quando}) — ${ponto.descricao}`);
  for (const t of CONTAGENS) console.log(`  ${t.padEnd(20)} hoje ${String(atual[t]).padStart(7)} → no ponto ${String(ponto.contagens[t] ?? '?').padStart(7)}`);
  if (!confirmar) {
    console.log('\nPrévia: nada mudou. Para voltar, repita com --confirmar.\n');
    return;
  }

  await criarPonto(`antes-de-voltar-para-${nome}-${agora()}`, `estado de antes de voltar para "${nome}"`);

  // Tabela criada depois do ponto também é esvaziada.
  const tabelas = await tabelasDoPonto();
  const prefixo = `SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET UNIQUE_CHECKS = 0;\nSTART TRANSACTION;\n${tabelas.map((t) => `DELETE FROM \`${t}\`;`).join('\n')}\n`;
  const sufixo = '\nCOMMIT;\nSET FOREIGN_KEY_CHECKS = 1;\nSET UNIQUE_CHECKS = 1;\n';
  await rodar('mysql', ['--default-character-set=utf8mb4', env.DB_NAME], { entrada: caminho, prefixo, sufixo });

  const depois = await contagens();
  const bate = CONTAGENS.every((t) => depois[t] === ponto.contagens[t]);
  console.log(`\n${bate ? 'Base de volta ao ponto' : 'ATENÇÃO: as contagens não batem com o ponto'} "${ponto.nome}":`, depois);
  console.log('Reinicie o backend.\n');
}

async function main(): Promise<void> {
  const acao = process.argv[2];
  if (acao === 'ponto') {
    await criarPonto(argumento('nome') ?? '', argumento('descricao') ?? '');
  } else if (acao === 'voltar') {
    await voltar(argumento('ponto') ?? '', process.argv.includes('--confirmar'));
  } else {
    const pontos = lerIndice();
    if (!pontos.length) console.log('\nNenhum ponto ainda. Crie com: npm run db:ponto -- --nome <nome>\n');
    for (const p of pontos) console.log(`${p.quando}  ${p.nome.padEnd(40)} ${p.contagens.clientes} clientes · ${p.contagens.apolices} apólices — ${p.descricao}`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(`\n${(e as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => void encerrarPool());
