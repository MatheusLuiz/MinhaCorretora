import { inflateRawSync } from 'node:zlib';

/*
 * Leitor mínimo de .xlsx: grade de texto da primeira aba (valor gravado das
 * fórmulas). Sem zip64, mais de uma aba ou célula mesclada.
 */

interface EntradaZip {
  nome: string;
  metodo: number;
  tamanhoComprimido: number;
  deslocamentoLocal: number;
}

const MAX_ENTRADAS_ZIP = 200;
// Teto contra "bomba zip"; relatório real chega a dezenas de MB de XML.
const MAX_TAMANHO_DESCOMPACTADO = 96 * 1024 * 1024;
const MAX_LINHAS_PLANILHA = 100_000;
const MAX_COLUNAS_PLANILHA = 200;

/** Diretório central do zip, achado pelo EOCD no fim (varrer do início acha assinaturas falsas). */
function lerDiretorioCentral(buffer: Buffer): EntradaZip[] {
  const ASSINATURA_EOCD = 0x06054b50;

  // EOCD: 22 bytes + comentário de até 64 KB.
  let posicaoEocd = -1;
  const inicioBusca = Math.max(0, buffer.length - 22 - 0xffff);

  for (let i = buffer.length - 22; i >= inicioBusca; i -= 1) {
    if (buffer.readUInt32LE(i) === ASSINATURA_EOCD) {
      posicaoEocd = i;
      break;
    }
  }

  if (posicaoEocd < 0) {
    throw new Error('Arquivo não parece ser um .xlsx válido (fim do zip não encontrado).');
  }

  const totalEntradas = buffer.readUInt16LE(posicaoEocd + 10);
  let deslocamento = buffer.readUInt32LE(posicaoEocd + 16);

  if (deslocamento === 0xffffffff) {
    throw new Error('Arquivo .xlsx em formato zip64 não é suportado.');
  }

  if (totalEntradas === 0 || totalEntradas > MAX_ENTRADAS_ZIP) {
    throw new Error('Planilha possui uma quantidade de arquivos internos não permitida.');
  }

  const entradas: EntradaZip[] = [];

  for (let i = 0; i < totalEntradas; i += 1) {
    if (deslocamento + 46 > buffer.length || buffer.readUInt32LE(deslocamento) !== 0x02014b50) {
      throw new Error('Diretório interno do .xlsx corrompido.');
    }

    const metodo = buffer.readUInt16LE(deslocamento + 10);
    const tamanhoComprimido = buffer.readUInt32LE(deslocamento + 20);
    const tamanhoNome = buffer.readUInt16LE(deslocamento + 28);
    const tamanhoExtra = buffer.readUInt16LE(deslocamento + 30);
    const tamanhoComentario = buffer.readUInt16LE(deslocamento + 32);
    const deslocamentoLocal = buffer.readUInt32LE(deslocamento + 42);
    const nome = buffer.toString('utf8', deslocamento + 46, deslocamento + 46 + tamanhoNome);

    if (deslocamento + 46 + tamanhoNome + tamanhoExtra + tamanhoComentario > buffer.length) {
      throw new Error('Entrada interna do .xlsx ultrapassa o arquivo.');
    }

    entradas.push({ nome, metodo, tamanhoComprimido, deslocamentoLocal });

    deslocamento += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return entradas;
}

function extrair(buffer: Buffer, entrada: EntradaZip): string {
  const base = entrada.deslocamentoLocal;

  if (base + 30 > buffer.length || buffer.readUInt32LE(base) !== 0x04034b50) {
    throw new Error(`Entrada corrompida no .xlsx: ${entrada.nome}`);
  }

  // Tamanhos de nome/extra do cabeçalho local podem diferir dos do diretório central.
  const tamanhoNome = buffer.readUInt16LE(base + 26);
  const tamanhoExtra = buffer.readUInt16LE(base + 28);
  const inicio = base + 30 + tamanhoNome + tamanhoExtra;
  if (inicio < base || inicio + entrada.tamanhoComprimido > buffer.length) {
    throw new Error(`Entrada corrompida no .xlsx: ${entrada.nome}`);
  }
  const dados = buffer.subarray(inicio, inicio + entrada.tamanhoComprimido);

  if (entrada.metodo === 0) {
    if (dados.length > MAX_TAMANHO_DESCOMPACTADO) throw new Error('Planilha excede o limite de expansão.');
    return dados.toString('utf8');
  }
  if (entrada.metodo === 8) {
    return inflateRawSync(dados, { maxOutputLength: MAX_TAMANHO_DESCOMPACTADO }).toString('utf8');
  }

  throw new Error(`Compressão não suportada no .xlsx (método ${entrada.metodo}).`);
}

function desescapar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    // `&amp;` por último: antes dos outros, transformaria "&amp;lt;" em "<".
    .replace(/&amp;/g, '&');
}

/** "BC" → 54. */
function indiceDaColuna(referencia: string): number {
  const letras = /^([A-Z]+)/.exec(referencia)?.[1] ?? 'A';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Série do Excel (dias desde 1899-12-30, herança do bug de 1900 da Lotus) → `DD/MM/AAAA`. */
export function serialParaData(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);

  const dia = String(d.getUTCDate()).padStart(2, '0');
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0');

  return `${dia}/${mes}/${d.getUTCFullYear()}`;
}

/** Formatos embutidos de data/hora (não declarados no arquivo); os personalizados vêm de `numFmts`. */
export const FORMATOS_DATA_PADRAO = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** A máscara é de data se tiver d/m/y/h/s fora de colchetes e aspas (moeda não conta). */
export function codigoEhData(codigo: string): boolean {
  return /[dmyhs]/.test(codigo.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));
}

interface Estilos {
  /** Índice do estilo → id do formato numérico. */
  formatoPorEstilo: number[];
  /** Ids de formato que representam data. */
  formatosDeData: Set<number>;
}

function lerEstilos(xml: string | null): Estilos {
  const formatoPorEstilo: number[] = [];
  const formatosDeData = new Set(FORMATOS_DATA_PADRAO);

  if (!xml) return { formatoPorEstilo, formatosDeData };

  for (const m of xml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    if (codigoEhData(desescapar(m[2] ?? ''))) formatosDeData.add(Number(m[1]));
  }

  const bloco = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  for (const m of bloco.matchAll(/<xf[^>]*numFmtId="(\d+)"[^>]*\/?>/g)) {
    formatoPorEstilo.push(Number(m[1]));
  }

  return { formatoPorEstilo, formatosDeData };
}

function lerTextosCompartilhados(xml: string | null): string[] {
  if (!xml) return [];

  // Cada <si> pode ter vários <t> (texto com formatação parcial); junta todos.
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...(m[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => desescapar(t[1] ?? ''))
      .join(''),
  );
}

/** Primeira aba como grade de texto, cabeçalho na linha 0 (como um CSV). */
export function lerXlsx(buffer: Buffer): string[][] {
  const entradas = lerDiretorioCentral(buffer);
  const porNome = new Map(entradas.map((e) => [e.nome, e]));

  const pegar = (nome: string): string | null => {
    const e = porNome.get(nome);
    return e ? extrair(buffer, e) : null;
  };

  // Com abas removidas o arquivo pode não ter sheet1.xml.
  const nomeDaPrimeiraAba =
    porNome.has('xl/worksheets/sheet1.xml')
      ? 'xl/worksheets/sheet1.xml'
      : entradas
          .map((e) => e.nome)
          .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
          .sort()[0];

  if (!nomeDaPrimeiraAba) {
    throw new Error('Nenhuma aba encontrada no .xlsx.');
  }

  const planilha = pegar(nomeDaPrimeiraAba);
  if (!planilha) throw new Error('Não foi possível ler a aba do .xlsx.');

  const compartilhados = lerTextosCompartilhados(pegar('xl/sharedStrings.xml'));
  const { formatoPorEstilo, formatosDeData } = lerEstilos(pegar('xl/styles.xml'));

  const grade: string[][] = [];

  for (const linhaXml of planilha.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    if (grade.length >= MAX_LINHAS_PLANILHA) throw new Error('Planilha excede o limite de linhas.');
    const conteudo = linhaXml[1] ?? '';
    const linha: string[] = [];

    // Casa tanto `<c ...>…</c>` quanto `<c ... />` (célula vazia com estilo).
    for (const c of conteudo.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = c[1] ?? '';
      const corpo = c[2] ?? '';

      const referencia = /r="([^"]+)"/.exec(atributos)?.[1] ?? 'A1';
      const tipo = /t="([^"]+)"/.exec(atributos)?.[1] ?? 'n';
      const estilo = /s="(\d+)"/.exec(atributos)?.[1];

      let valor = '';

      if (tipo === 'inlineStr') {
        valor = [...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((t) => desescapar(t[1] ?? ''))
          .join('');
      } else if (tipo === 's') {
        const indice = Number(/<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1] ?? '-1');
        valor = compartilhados[indice] ?? '';
      } else if (tipo === 'str') {
        valor = desescapar(/<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1] ?? '');
      } else if (tipo === 'b') {
        valor = /<v>1<\/v>/.test(corpo) ? '1' : '0';
      } else {
        const bruto = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1] ?? '';
        const numero = Number(bruto);

        const formato = estilo !== undefined ? formatoPorEstilo[Number(estilo)] : undefined;
        const ehData =
          formato !== undefined && formatosDeData.has(formato) && Number.isFinite(numero) && numero > 0;

        valor = ehData ? serialParaData(numero) : desescapar(bruto);
      }

      const coluna = indiceDaColuna(referencia);
      if (coluna >= MAX_COLUNAS_PLANILHA) throw new Error('Planilha excede o limite de colunas.');
      linha[coluna] = valor;
    }

    // Preenche os buracos do array esparso.
    for (let i = 0; i < linha.length; i += 1) linha[i] ??= '';

    grade.push(linha);
  }

  return grade;
}

/** O conteúdo é um zip (todo .xlsx é). */
export function pareceXlsx(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}
