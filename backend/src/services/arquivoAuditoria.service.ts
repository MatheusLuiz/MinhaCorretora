import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as repo from '../repositories/arquivoImportado.repository.js';
import { AppError } from '../utils/AppError.js';

/**
 * Cópia auditável de cada arquivo importado, em
 * `<ARQUIVOS_DIR>/<seguradora>/<AAAA-MM-DD>/<entidade>_<nome>_<lote>.<ext>`.
 * Todo pedaço do caminho passa por `paraCaminho`: fecha travessia de diretório.
 */

/** Raiz do armazenamento, resolvida uma vez. */
function raiz(): string {
  return resolve(env.ARQUIVOS_DIR);
}

const CABECALHO_CIFRA = Buffer.from('SSBI-AUD-1');
const TAMANHO_NONCE = 12;
const TAMANHO_TAG = 16;

function chaveDeArquivos(): Buffer | null {
  return env.ARQUIVOS_ENCRYPTION_KEY
    ? Buffer.from(env.ARQUIVOS_ENCRYPTION_KEY, 'base64')
    : null;
}

/** Cifra novas cópias em repouso; desenvolvimento sem chave mantém compatibilidade local. */
function cifrarConteudo(conteudo: Buffer): Buffer {
  const chave = chaveDeArquivos();
  if (!chave) return conteudo;

  const nonce = randomBytes(TAMANHO_NONCE);
  const cifra = createCipheriv('aes-256-gcm', chave, nonce);
  const dados = Buffer.concat([cifra.update(conteudo), cifra.final()]);

  return Buffer.concat([CABECALHO_CIFRA, nonce, cifra.getAuthTag(), dados]);
}

/** Aceita legado em claro para permitir migração gradual, mas nunca grava novo legado em produção. */
function decifrarConteudo(conteudo: Buffer): Buffer {
  if (!conteudo.subarray(0, CABECALHO_CIFRA.length).equals(CABECALHO_CIFRA)) return conteudo;

  const chave = chaveDeArquivos();
  if (!chave) throw AppError.internal('Chave de criptografia dos arquivos não está configurada.');

  const inicioTag = CABECALHO_CIFRA.length + TAMANHO_NONCE;
  const inicioCifra = inicioTag + TAMANHO_TAG;
  if (conteudo.length <= inicioCifra) throw AppError.internal('Arquivo de auditoria cifrado está corrompido.');

  try {
    const decifra = createDecipheriv('aes-256-gcm', chave, conteudo.subarray(CABECALHO_CIFRA.length, inicioTag));
    decifra.setAuthTag(conteudo.subarray(inicioTag, inicioCifra));
    return Buffer.concat([decifra.update(conteudo.subarray(inicioCifra)), decifra.final()]);
  } catch {
    throw AppError.internal('Não foi possível decifrar o arquivo de auditoria.');
  }
}

function caminhoDentroDaRaiz(caminho: string): boolean {
  const caminhoRelativo = relative(raiz(), resolve(caminho));
  return caminhoRelativo === '' || (!caminhoRelativo.startsWith('..') && !isAbsolute(caminhoRelativo));
}

export interface ArquivoParaGuardar {
  lote: string;
  conteudo: Buffer;
  nomeOriginal: string;
  entidade: repo.EntidadeArquivo;
  /** Companhia de origem. Define a pasta e fica no registro de auditoria. */
  seguradora: string | null;
  layout: string | null;
  origemSistema: repo.OrigemSistema;
  importadoPor?: number | null;
  resultado?: Record<string, unknown> | null;
}

/** Nome seguro para pasta ou arquivo: sem acento, espaço nem pontuação, e nunca vazio. */
function paraCaminho(bruto: string, alternativa: string): string {
  const limpo = bruto
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return limpo || alternativa;
}

export interface ArquivoGuardado {
  id: number;
  sha256: string;
  caminho: string;
  /** Lote de uma importação anterior com conteúdo idêntico, se houver. */
  duplicataDe: string | null;
}

/** Grava o arquivo e registra a cópia. Nunca lança: a importação já terminou; a falha vai ao log. */
export async function guardar(dados: ArquivoParaGuardar): Promise<ArquivoGuardado | null> {
  try {
    const sha256 = createHash('sha256').update(dados.conteudo).digest('hex');

    // Arquivo idêntico já importado não bloqueia (a carga é idempotente), só fica registrado.
    const anterior = await repo.buscarPorHash(sha256);

    const extensao = extname(dados.nomeOriginal).slice(0, 10) || '.dat';

    // O pedaço do lote evita que duas cargas do mesmo arquivo no mesmo dia se sobrescrevam.
    const pastaSeguradora = paraCaminho(dados.seguradora ?? '', 'sem-seguradora');
    const dia = new Date().toISOString().slice(0, 10);
    const base = paraCaminho(dados.nomeOriginal.replace(extensao, ''), 'arquivo');
    const nomeEmDisco = `${dados.entidade}_${base}_${dados.lote.slice(0, 8)}${extensao}`;

    const relativo = join(pastaSeguradora, dia, nomeEmDisco);
    const absoluto = join(raiz(), relativo);

    await mkdir(dirname(absoluto), { recursive: true });
    await writeFile(absoluto, cifrarConteudo(dados.conteudo), { mode: 0o600 });

    const id = await repo.registrar({
      lote: dados.lote,
      nomeOriginal: dados.nomeOriginal.slice(0, 255),
      extensao,
      tamanhoBytes: dados.conteudo.length,
      sha256,
      // Barra normal: o caminho é lido por Windows e Linux.
      caminho: relativo.split('\\').join('/'),
      entidade: dados.entidade,
      seguradora: dados.seguradora,
      layout: dados.layout,
      origemSistema: dados.origemSistema,
      importadoPor: dados.importadoPor ?? null,
      resultado: dados.resultado ?? null,
    });

    logger.info(
      { lote: dados.lote, arquivo: dados.nomeOriginal, sha256, duplicataDe: anterior?.lote ?? null },
      'Cópia do arquivo importado guardada',
    );

    return { id, sha256, caminho: relativo, duplicataDe: anterior?.lote ?? null };
  } catch (erro) {
    logger.error(
      { err: erro, lote: dados.lote, arquivo: dados.nomeOriginal },
      'Falha ao guardar a cópia do arquivo — a importação em si foi concluída',
    );
    return null;
  }
}

/** Devolve o conteúdo da cópia, conferindo o hash antes de entregar. */
export async function recuperar(lote: string): Promise<{ nome: string; conteudo: Buffer }> {
  const registro = await repo.buscarPorLote(lote);

  if (!registro) {
    throw AppError.notFound('Arquivo não encontrado para este lote.');
  }

  const absoluto = join(raiz(), registro.caminho);

  // Mesmo vindo do banco, uma linha adulterada não pode escapar do armazenamento.
  if (!caminhoDentroDaRaiz(absoluto)) {
    throw AppError.internal('Caminho de arquivo inválido no registro de auditoria.');
  }

  const conteudo = decifrarConteudo(await readFile(absoluto));
  const sha256 = createHash('sha256').update(conteudo).digest('hex');

  if (sha256 !== registro.sha256) {
    throw new AppError(
      'A cópia guardada não confere com o registro — o arquivo foi alterado depois da importação.',
      409,
      'ARQUIVO_ADULTERADO',
    );
  }

  return { nome: registro.nomeOriginal, conteudo };
}

/**
 * Cópias guardadas como FONTE: todas as da `origem` cujo nome casa com `padrao`,
 * da mais antiga para a mais recente (a última vence). Decifradas.
 */
export async function arquivosDaOrigem(origem: string, padrao: RegExp): Promise<{ caminho: string; conteudo: Buffer }[]> {
  const pasta = join(raiz(), paraCaminho(origem, 'origem'));
  let dias: string[];
  try {
    dias = (await readdir(pasta, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
  const achados: { caminho: string; conteudo: Buffer }[] = [];
  for (const dia of dias) {
    for (const nome of (await readdir(join(pasta, dia))).filter((n) => padrao.test(n)).sort()) {
      const caminho = join(pasta, dia, nome);
      achados.push({ caminho: relative(raiz(), caminho), conteudo: decifrarConteudo(await readFile(caminho)) });
    }
  }
  return achados;
}
