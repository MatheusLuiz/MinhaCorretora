import { inflateSync } from 'node:zlib';

/*
 * Leitor mínimo de PDF (perfil iText/Helvetica WinAnsi/FlateDecode do Bradesco).
 * Devolve texto posicionado e CÉLULAS de tabela: ler por linha mistura colunas.
 */

export interface TextoPdf {
  x: number;
  y: number;
  texto: string;
  /** Tamanho da fonte, para medir a largura da linha. */
  tamanho: number;
}

/** Larguras AFM da Helvetica (milésimos), de 32 a 126; acentuada mede como a base. */
const LARGURA_HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function larguraHelvetica(texto: string, tamanho: number): number {
  let soma = 0;
  for (const c of texto.normalize('NFD').replace(/[̀-ͯ]/g, '')) {
    soma += LARGURA_HELVETICA[c.charCodeAt(0) - 32] ?? 556;
  }
  return (soma / 1000) * tamanho;
}

/*
 * Quebra NO MEIO da palavra (sem espaço): a linha de cima não tem espaço, encheu
 * a largura útil (célula − 2pt de cada lado) e o pedaço que desceu é curto (≤ 3
 * letras, fora conectivos). Na dúvida sobra um espaço, o erro menos grave.
 */
const CONECTIVOS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'NA', 'NO', 'NAS', 'NOS']);

function juntarLinhas(linhas: TextoPdf[], largura: number): string {
  const util = largura - 4;
  let saida = '';
  let anterior: TextoPdf | null = null;

  for (const l of linhas) {
    const atual = l.texto.replace(/\s+/g, ' ').trim();
    if (!atual) continue;

    if (!anterior) {
      saida = atual;
    } else {
      const cima = anterior.texto.replace(/\s+/g, ' ').trim();
      const pedaco = atual.split(' ')[0] ?? '';
      const forcada =
        !cima.includes(' ') &&
        larguraHelvetica(cima + atual.charAt(0), anterior.tamanho) > util &&
        pedaco.length <= 3 &&
        !CONECTIVOS.has(pedaco.toUpperCase()) &&
        // "F." é inicial abreviada, palavra por si: `ARACELLES F. GORDILHO`.
        !pedaco.endsWith('.');
      saida += (forcada ? '' : ' ') + atual;
    }
    anterior = l;
  }

  return saida;
}

export interface CelulaPdf {
  x: number;
  y: number;
  largura: number;
  altura: number;
  /** Linhas de texto da célula, de cima para baixo, já unidas por espaço. */
  texto: string;
}

export interface PaginaPdf {
  textos: TextoPdf[];
  celulas: CelulaPdf[];
}

export function parecePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Bytes 0x80–0x9F do WinAnsi, que o latin1 não tem; o resto coincide. */
const WIN_ANSI: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function decodificarWinAnsi(bytes: number[]): string {
  return bytes.map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join('');
}

/** Os streams de conteúdo, na ordem do arquivo — no iText, um por página. */
function streamsDeConteudo(buffer: Buffer): string[] {
  const bruto = buffer.toString('latin1');
  const saida: string[] = [];
  const marcador = /stream\r?\n/g;
  let achado: RegExpExecArray | null;

  while ((achado = marcador.exec(bruto))) {
    const inicio = achado.index + achado[0].length;
    const fim = bruto.indexOf('endstream', inicio);
    if (fim < 0) break;

    const dicionario = bruto.slice(Math.max(0, achado.index - 200), achado.index);
    if (!/\/FlateDecode/.test(dicionario)) continue;

    let texto: string;
    try {
      texto = inflateSync(buffer.subarray(inicio, fim)).toString('latin1');
    } catch {
      // Stream com lixo depois do fim declarado: tenta sem o \r\n final.
      try {
        texto = inflateSync(buffer.subarray(inicio, fim - 2)).toString('latin1');
      } catch {
        continue;
      }
    }

    if (/\bBT\b|\bre\b/.test(texto)) saida.push(texto);
    marcador.lastIndex = fim;
  }

  return saida;
}

type Token = number | string | { nome: string } | { texto: number[] } | Token[];

/** Tokeniza um stream de conteúdo; operador vem como string, string de PDF como bytes. */
function* tokens(fonte: string): Generator<Token> {
  let i = 0;
  const n = fonte.length;

  const lerString = (): number[] => {
    const bytes: number[] = [];
    let profundidade = 1;
    while (i < n) {
      const c = fonte[i++]!;
      if (c === '\\') {
        const e = fonte[i++]!;
        if (e >= '0' && e <= '7') {
          let oct = e;
          while (oct.length < 3 && fonte[i]! >= '0' && fonte[i]! <= '7') oct += fonte[i++];
          bytes.push(parseInt(oct, 8));
        } else {
          const mapa: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
          if (e === '\r' || e === '\n') {
            if (e === '\r' && fonte[i] === '\n') i++;
          } else {
            bytes.push(mapa[e] ?? e.charCodeAt(0));
          }
        }
      } else if (c === '(') {
        profundidade++;
        bytes.push(40);
      } else if (c === ')') {
        if (--profundidade === 0) break;
        bytes.push(41);
      } else {
        bytes.push(c.charCodeAt(0));
      }
    }
    return bytes;
  };

  const pilhaDeArrays: Token[][] = [];

  const emitir = function* (t: Token): Generator<Token> {
    const topo = pilhaDeArrays[pilhaDeArrays.length - 1];
    if (topo) topo.push(t);
    else yield t;
  };

  while (i < n) {
    const c = fonte[i]!;

    if (/\s/.test(c)) {
      i++;
    } else if (c === '%') {
      while (i < n && fonte[i] !== '\n' && fonte[i] !== '\r') i++;
    } else if (c === '(') {
      i++;
      yield* emitir({ texto: lerString() });
    } else if (c === '<' && fonte[i + 1] !== '<') {
      const fim = fonte.indexOf('>', i);
      const hex = fonte.slice(i + 1, fim).replace(/\s/g, '');
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) bytes.push(parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
      i = fim + 1;
      yield* emitir({ texto: bytes });
    } else if (c === '[') {
      i++;
      pilhaDeArrays.push([]);
    } else if (c === ']') {
      i++;
      const arr = pilhaDeArrays.pop() ?? [];
      yield* emitir(arr);
    } else if (c === '/') {
      let j = i + 1;
      while (j < n && !/[\s/[\]()<>{}%]/.test(fonte[j]!)) j++;
      yield* emitir({ nome: fonte.slice(i + 1, j) });
      i = j;
    } else if (/[-+.\d]/.test(c)) {
      let j = i + 1;
      while (j < n && /[.\d]/.test(fonte[j]!)) j++;
      yield* emitir(Number(fonte.slice(i, j)));
      i = j;
    } else if (c === '<' || c === '>' || c === '{' || c === '}') {
      // `<<`/`>>` de dicionário inline (BI/ID) — não ocorre neste perfil.
      i++;
    } else {
      let j = i + 1;
      while (j < n && !/[\s/[\]()<>{}%]/.test(fonte[j]!)) j++;
      yield* emitir(fonte.slice(i, j));
      i = j;
    }
  }
}

/** Interpreta um stream de página: texto com posição e retângulos. */
function interpretar(conteudo: string): { textos: TextoPdf[]; retangulos: Omit<CelulaPdf, 'texto'>[] } {
  const textos: TextoPdf[] = [];
  const retangulos: Omit<CelulaPdf, 'texto'>[] = [];

  // Só translação (texto e `cm`): o iText deste relatório não gira nem escala.
  let linhaX = 0;
  let linhaY = 0;
  let entrelinha = 0;
  let desvioX = 0;
  let desvioY = 0;
  const pilhaGrafica: [number, number][] = [];

  let operandos: Token[] = [];
  let ultimo: TextoPdf | null = null;
  let tamanho = 12;

  const num = (k: number): number => Number(operandos[operandos.length - k] ?? 0);

  const desenhar = (bytes: number[]): void => {
    const texto = decodificarWinAnsi(bytes);
    // Tj seguido de Tj sem reposicionar é continuação da mesma frase.
    if (ultimo && ultimo.x === linhaX + desvioX && ultimo.y === linhaY + desvioY) {
      ultimo.texto += texto;
      return;
    }
    ultimo = { x: linhaX + desvioX, y: linhaY + desvioY, texto, tamanho };
    textos.push(ultimo);
  };

  for (const t of tokens(conteudo)) {
    if (typeof t !== 'string') {
      operandos.push(t);
      continue;
    }

    switch (t) {
      case 'BT':
        linhaX = 0;
        linhaY = 0;
        ultimo = null;
        break;
      case 'Td':
        linhaX += num(2);
        linhaY += num(1);
        break;
      case 'TD':
        linhaX += num(2);
        linhaY += num(1);
        entrelinha = -num(1);
        break;
      case 'TL':
        entrelinha = num(1);
        break;
      case 'Tf':
        tamanho = num(1) || tamanho;
        break;
      case 'Tm':
        linhaX = num(2);
        linhaY = num(1);
        break;
      case 'T*':
        linhaY -= entrelinha;
        break;
      case 'Tj':
      case "'":
      case '"': {
        if (t !== 'Tj') linhaY -= entrelinha;
        const s = operandos[operandos.length - 1];
        if (s && typeof s === 'object' && 'texto' in s) desenhar(s.texto);
        break;
      }
      case 'TJ': {
        const arr = operandos[operandos.length - 1];
        if (Array.isArray(arr)) {
          const bytes: number[] = [];
          for (const item of arr) {
            if (item && typeof item === 'object' && 'texto' in item) bytes.push(...item.texto);
            // Recuo grande no TJ é espaço entre palavras.
            else if (typeof item === 'number' && item < -200) bytes.push(32);
          }
          desenhar(bytes);
        }
        break;
      }
      case 'q':
        pilhaGrafica.push([desvioX, desvioY]);
        break;
      case 'Q':
        [desvioX, desvioY] = pilhaGrafica.pop() ?? [0, 0];
        break;
      case 'cm':
        desvioX += num(2);
        desvioY += num(1);
        break;
      case 're':
        retangulos.push({ x: num(4) + desvioX, y: num(3) + desvioY, largura: num(2), altura: num(1) });
        break;
      default:
        break;
    }

    operandos = [];
  }

  return { textos, retangulos };
}

/** Por página, textos e células; o texto cai na MENOR célula que o contém (a borda externa conteria tudo). */
export function lerPdf(buffer: Buffer): PaginaPdf[] {
  return streamsDeConteudo(buffer).map((conteudo) => {
    const { textos, retangulos } = interpretar(conteudo);

    const porCelula = new Map<number, TextoPdf[]>();
    for (const t of textos) {
      let melhor = -1;
      let menorArea = Infinity;
      retangulos.forEach((r, i) => {
        // Folga de 1pt para o arredondamento do gerador.
        if (t.x >= r.x - 1 && t.x <= r.x + r.largura + 1 && t.y >= r.y - 1 && t.y <= r.y + r.altura + 1) {
          const area = r.largura * r.altura;
          if (area < menorArea) {
            menorArea = area;
            melhor = i;
          }
        }
      });
      if (melhor >= 0) {
        const lista = porCelula.get(melhor) ?? [];
        lista.push(t);
        porCelula.set(melhor, lista);
      }
    }

    const celulas: CelulaPdf[] = retangulos.map((r, i) => ({
      ...r,
      texto: juntarLinhas(
        (porCelula.get(i) ?? []).sort((a, b) => b.y - a.y || a.x - b.x),
        r.largura,
      ),
    }));

    return { textos, celulas };
  });
}
