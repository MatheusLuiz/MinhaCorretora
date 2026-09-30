import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { logger } from '../../config/logger.js';
import type { Rotina } from './rotina.js';

/**
 * Descobre as rotinas: `<chave>/tarefas/<rotina>.ts` → "<chave>/<rotina>", `comum/tarefas/<rotina>.ts` → "<rotina>".
 * A tela só escolhe entre estas chaves (nunca caminho livre). Carrega uma vez: arquivo novo pede reiniciar.
 */

export interface RotinaCatalogada extends Rotina {
  /** "porto-seguro/apolices-emitidas" */
  arquivo: string;
  /** `null` = rotina genérica, serve a qualquer seguradora. */
  seguradoraChave: string | null;
}

const ESTE_ARQUIVO = fileURLToPath(import.meta.url);
const PASTA_SEGURADORAS = dirname(dirname(ESTE_ARQUIVO));
const COMUM = 'comum';
const SUBPASTA = 'tarefas';
// `.ts` rodando pelo tsx, `.js` depois do build: as rotinas têm a mesma extensão.
const EXTENSAO = extname(ESTE_ARQUIVO);
const NOME_VALIDO = /^[a-z0-9][a-z0-9-]*$/;

let catalogo: Promise<Map<string, RotinaCatalogada>> | null = null;

function ehRotina(x: unknown): x is Rotina {
  const r = x as Partial<Rotina> | null;
  return !!r && typeof r.nome === 'string' && typeof r.descricao === 'string' && typeof r.executar === 'function';
}

async function carregarArquivo(
  caminho: string,
  arquivo: string,
  seguradoraChave: string | null,
): Promise<RotinaCatalogada | null> {
  try {
    const modulo = (await import(pathToFileURL(caminho).href)) as { rotina?: unknown };
    if (!ehRotina(modulo.rotina)) {
      logger.warn({ arquivo }, 'Arquivo de integração sem `export const rotina` válido — ignorado.');
      return null;
    }
    return { ...modulo.rotina, arquivo, seguradoraChave };
  } catch (erro) {
    logger.error({ arquivo, err: erro }, 'Arquivo de integração não carregou — ignorado.');
    return null;
  }
}

async function doDiretorio(dir: string, prefixo: string, seguradoraChave: string | null) {
  const achadas: Promise<RotinaCatalogada | null>[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || extname(e.name) !== EXTENSAO || e.name.endsWith(`.d${EXTENSAO}`)) continue;
    const base = e.name.slice(0, -EXTENSAO.length);
    if (base.endsWith('.test') || !NOME_VALIDO.test(base)) continue;
    achadas.push(carregarArquivo(join(dir, e.name), `${prefixo}${base}`, seguradoraChave));
  }
  return (await Promise.all(achadas)).filter((r): r is RotinaCatalogada => r !== null);
}

async function carregar(): Promise<Map<string, RotinaCatalogada>> {
  const rotinas: RotinaCatalogada[] = [];
  for (const e of await readdir(PASTA_SEGURADORAS, { withFileTypes: true })) {
    if (!e.isDirectory() || !NOME_VALIDO.test(e.name)) continue;
    const pasta = join(PASTA_SEGURADORAS, e.name, SUBPASTA);
    if (!existsSync(pasta)) continue;
    rotinas.push(
      ...(e.name === COMUM
        ? await doDiretorio(pasta, '', null)
        : await doDiretorio(pasta, `${e.name}/`, e.name)),
    );
  }
  logger.info({ rotinas: rotinas.map((r) => r.arquivo) }, 'Arquivos de integração carregados');
  return new Map(rotinas.sort((a, b) => a.arquivo.localeCompare(b.arquivo)).map((r) => [r.arquivo, r]));
}

export function rotinas(): Promise<Map<string, RotinaCatalogada>> {
  catalogo ??= carregar();
  return catalogo;
}
