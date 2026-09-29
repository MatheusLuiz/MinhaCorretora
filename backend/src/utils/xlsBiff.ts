/*
 * Leitor mínimo de `.xls` BIFF8 (arquivo composto OLE2). Abrir no Excel e salvar
 * como .xlsx não é saída: número de apólice longo vira notação científica.
 * Só a primeira aba, resultado gravado das fórmulas, sem senha.
 */
import { codigoEhData, FORMATOS_DATA_PADRAO, serialParaData } from './xlsx.js';

const ASSINATURA_OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Marcas de fim de cadeia na FAT. */
const FIM_DA_CADEIA = 0xfffffffe;
const SETOR_LIVRE = 0xffffffff;

/** O conteúdo é um `.xls` BIFF de verdade, e não um HTML disfarçado. */
export function pareceXlsBiff(conteudo: Buffer): boolean {
  return conteudo.length > 512 && conteudo.subarray(0, 8).equals(ASSINATURA_OLE2);
}

interface Composto {
  buffer: Buffer;
  tamanhoSetor: number;
  tamanhoMiniSetor: number;
  fat: number[];
  miniFat: number[];
  miniStream: Buffer;
}

function deslocamento(setor: number, tamanhoSetor: number): number {
  // `+ 1`: o cabeçalho ocupa o primeiro setor.
  return (setor + 1) * tamanhoSetor;
}

/** Percorre uma cadeia da FAT e junta os setores em um buffer contínuo. */
function lerCadeia(
  c: Composto,
  primeiroSetor: number,
  tamanho: number,
  mini: boolean,
): Buffer {
  const tabela = mini ? c.miniFat : c.fat;
  const passo = mini ? c.tamanhoMiniSetor : c.tamanhoSetor;
  const fonte = mini ? c.miniStream : c.buffer;

  const partes: Buffer[] = [];
  let setor = primeiroSetor;
  let lidos = 0;
  // Teto: cadeia corrompida com ciclo travaria o processo.
  let voltas = 0;
  const maximo = tabela.length + 2;

  while (setor !== FIM_DA_CADEIA && setor !== SETOR_LIVRE && lidos < tamanho) {
    if (voltas++ > maximo) throw new Error('A cadeia de setores do arquivo tem um ciclo.');

    const inicio = mini ? setor * passo : deslocamento(setor, passo);
    const fatia = fonte.subarray(inicio, inicio + Math.min(passo, tamanho - lidos));
    if (fatia.length === 0) break;

    partes.push(fatia);
    lidos += fatia.length;
    setor = tabela[setor] ?? FIM_DA_CADEIA;
  }

  return Buffer.concat(partes, Math.min(lidos, tamanho));
}

/** Extrai o stream `Workbook` do arquivo composto. */
function lerStreamDoWorkbook(buffer: Buffer): Buffer {
  const tamanhoSetor = 1 << buffer.readUInt16LE(30);
  const tamanhoMiniSetor = 1 << buffer.readUInt16LE(32);
  const setoresFat = buffer.readUInt32LE(44);
  const primeiroDiretorio = buffer.readUInt32LE(48);
  const primeiroMiniFat = buffer.readUInt32LE(60);
  const setoresMiniFat = buffer.readUInt32LE(64);
  const primeiroDifat = buffer.readUInt32LE(68);
  const setoresDifat = buffer.readUInt32LE(72);

  // DIFAT: onde estão os setores da FAT.
  const setoresDaFat: number[] = [];
  for (let i = 0; i < 109 && setoresDaFat.length < setoresFat; i++) {
    const s = buffer.readUInt32LE(76 + i * 4);
    if (s !== SETOR_LIVRE) setoresDaFat.push(s);
  }

  let difat = primeiroDifat;
  for (let i = 0; i < setoresDifat && difat !== FIM_DA_CADEIA && difat !== SETOR_LIVRE; i++) {
    const base = deslocamento(difat, tamanhoSetor);
    const porSetor = tamanhoSetor / 4 - 1;
    for (let j = 0; j < porSetor && setoresDaFat.length < setoresFat; j++) {
      const s = buffer.readUInt32LE(base + j * 4);
      if (s !== SETOR_LIVRE) setoresDaFat.push(s);
    }
    difat = buffer.readUInt32LE(base + porSetor * 4);
  }

  const fat: number[] = [];
  for (const s of setoresDaFat) {
    const base = deslocamento(s, tamanhoSetor);
    for (let j = 0; j < tamanhoSetor / 4; j++) {
      if (base + j * 4 + 4 > buffer.length) break;
      fat.push(buffer.readUInt32LE(base + j * 4));
    }
  }

  const parcial: Composto = {
    buffer, tamanhoSetor, tamanhoMiniSetor, fat, miniFat: [], miniStream: Buffer.alloc(0),
  };

  // MiniFAT: streams pequenos vivem dentro do stream da raiz.
  const miniFat: number[] = [];
  let mf = primeiroMiniFat;
  for (let i = 0; i < setoresMiniFat && mf !== FIM_DA_CADEIA && mf !== SETOR_LIVRE; i++) {
    const base = deslocamento(mf, tamanhoSetor);
    for (let j = 0; j < tamanhoSetor / 4; j++) {
      if (base + j * 4 + 4 > buffer.length) break;
      miniFat.push(buffer.readUInt32LE(base + j * 4));
    }
    mf = fat[mf] ?? FIM_DA_CADEIA;
  }
  parcial.miniFat = miniFat;

  // Diretório: entradas de 128 bytes.
  const diretorio = lerCadeia(parcial, primeiroDiretorio, 1 << 30, false);

  let raizSetor = FIM_DA_CADEIA;
  let raizTamanho = 0;
  let workbookSetor = -1;
  let workbookTamanho = 0;

  for (let p = 0; p + 128 <= diretorio.length; p += 128) {
    const tamanhoNome = diretorio.readUInt16LE(p + 64);
    if (tamanhoNome < 2) continue;

    const nome = diretorio.subarray(p, p + tamanhoNome - 2).toString('utf16le');
    const tipo = diretorio.readUInt8(p + 66);
    const setor = diretorio.readUInt32LE(p + 116);
    const tamanho = diretorio.readUInt32LE(p + 120);

    if (tipo === 5) { raizSetor = setor; raizTamanho = tamanho; }
    // "Book" é o nome usado pelo Excel 95; "Workbook" pelo 97 em diante.
    if (tipo === 2 && (nome === 'Workbook' || nome === 'Book')) {
      workbookSetor = setor;
      workbookTamanho = tamanho;
    }
  }

  if (workbookSetor < 0) {
    throw new Error('O arquivo é um .xls mas não tem o stream "Workbook" dentro.');
  }

  if (raizSetor !== FIM_DA_CADEIA && raizTamanho > 0) {
    parcial.miniStream = lerCadeia(parcial, raizSetor, raizTamanho, false);
  }

  // Stream menor que o corte vive na miniFAT; maior, na FAT comum.
  const corte = buffer.readUInt32LE(56);
  return lerCadeia(parcial, workbookSetor, workbookTamanho, workbookTamanho < corte);
}

const BOF = 0x0809;
const EOF_REG = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const RSTRING = 0x00d6;
const FILEPASS = 0x002f;
const FORMAT = 0x041e;
const XF = 0x00e0;

interface Registro {
  id: number;
  dados: Buffer;
}

function registros(stream: Buffer, de = 0, ate = stream.length): Registro[] {
  const lista: Registro[] = [];
  let p = de;

  while (p + 4 <= ate) {
    const id = stream.readUInt16LE(p);
    const tamanho = stream.readUInt16LE(p + 2);
    if (p + 4 + tamanho > ate) break;
    lista.push({ id, dados: stream.subarray(p + 4, p + 4 + tamanho) });
    p += 4 + tamanho;
  }

  return lista;
}

/** Texto Unicode do BIFF8; o `grbit` diz se é UTF-16 ou latin1 e o que pular depois. */
function lerTextoUnicode(
  b: Buffer,
  p: number,
  caracteres: number,
): { texto: string; fim: number } {
  const grbit = b.readUInt8(p);
  let q = p + 1;

  const doisBytes = (grbit & 0x01) !== 0;
  const temFonetico = (grbit & 0x04) !== 0;
  const temRico = (grbit & 0x08) !== 0;

  let execucoes = 0;
  let fonetico = 0;
  if (temRico) { execucoes = b.readUInt16LE(q); q += 2; }
  if (temFonetico) { fonetico = b.readUInt32LE(q); q += 4; }

  const bytes = caracteres * (doisBytes ? 2 : 1);
  const bruto = b.subarray(q, q + bytes);
  q += bytes;

  const texto = doisBytes
    ? bruto.toString('utf16le')
    : // "Comprimido": latin1 com o byte alto implícito em zero.
      Buffer.from(bruto).toString('latin1');

  q += execucoes * 4 + fonetico;
  return { texto, fim: q };
}

/**
 * Tabela de textos compartilhados. Um texto que cruza para o `CONTINUE` ganha um
 * `grbit` novo ali: colar os registros num buffer só estraga os acentos.
 */
function lerSst(partes: Buffer[]): string[] {
  if (partes.length === 0) return [];

  const textos: string[] = [];
  const primeira = partes[0]!;
  const unicos = primeira.readUInt32LE(4);

  let parte = 0;
  let p = 8;

  const atual = (): Buffer => partes[parte]!;
  const proximaParte = (): boolean => {
    if (parte + 1 >= partes.length) return false;
    parte++;
    p = 0;
    return true;
  };

  while (textos.length < unicos) {
    if (p + 3 > atual().length && !proximaParte()) break;

    let restantes = atual().readUInt16LE(p);
    p += 2;

    let montado = '';

    for (;;) {
      const lido = lerTextoUnicode(atual(), p, restantes);
      const coube = Math.min(restantes, lido.texto.length);
      montado += lido.texto.slice(0, coube);
      restantes -= coube;
      p = lido.fim;

      if (restantes <= 0) break;
      if (!proximaParte()) { restantes = 0; break; }
    }

    textos.push(montado);
  }

  return textos;
}

/** Decodifica o número compactado de 4 bytes usado por `RK` e `MULRK`. */
function numeroRk(valor: number): number {
  const inteiro = (valor & 0x02) !== 0;
  const centesimos = (valor & 0x01) !== 0;

  let n: number;
  if (inteiro) {
    n = valor >> 2;
  } else {
    // Os 30 bits são a metade alta de um double IEEE; a baixa é zero.
    const b = Buffer.alloc(8);
    b.writeInt32LE(0, 0);
    b.writeInt32LE(valor & 0xfffffffc, 4);
    n = b.readDoubleLE(0);
  }

  return centesimos ? n / 100 : n;
}

/** Números viram texto sem notação científica nem perda de dígito. */
function comoTexto(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

/** Primeira aba de um `.xls` BIFF, na mesma grade de `lerXlsx`. */
export function lerXlsBiff(conteudo: Buffer): string[][] {
  if (!pareceXlsBiff(conteudo)) {
    throw new Error('O arquivo não é um .xls no formato composto da Microsoft.');
  }

  const stream = lerStreamDoWorkbook(conteudo);
  const globais = registros(stream);

  if (globais.some((r) => r.id === FILEPASS)) {
    throw new Error('A planilha está protegida por senha e não pode ser lida.');
  }

  const versao = globais[0]?.id === BOF ? globais[0].dados.readUInt16LE(0) : 0;
  if (versao !== 0x0600) {
    throw new Error(
      `Só o BIFF8 (Excel 97 em diante) é lido; este arquivo é versão 0x${versao.toString(16)}.`,
    );
  }

  const partesSst: Buffer[] = [];
  for (let i = 0; i < globais.length; i++) {
    if (globais[i]!.id !== SST) continue;
    partesSst.push(globais[i]!.dados);
    for (let j = i + 1; j < globais.length && globais[j]!.id === CONTINUE; j++) {
      partesSst.push(globais[j]!.dados);
    }
    break;
  }
  const textos = lerSst(partesSst);

  // Data é número com estilo (XF) de data: formatar pelo estilo, como o `lerXlsx`,
  // para o .xls dar o mesmo resultado que o .xlsx.
  const formatosDeData = new Set(FORMATOS_DATA_PADRAO);
  for (const r of globais) {
    if (r.id !== FORMAT) continue;
    const { texto } = lerTextoUnicode(r.dados, 4, r.dados.readUInt16LE(2));
    if (codigoEhData(texto)) formatosDeData.add(r.dados.readUInt16LE(0));
  }
  // XF na ordem em que aparece: a posição é o índice que a célula cita.
  const estiloEhData = globais.filter((r) => r.id === XF).map((r) => formatosDeData.has(r.dados.readUInt16LE(2)));
  const numero = (n: number, estilo: number): string =>
    estiloEhData[estilo] && Number.isFinite(n) && n > 0 ? serialParaData(n) : comoTexto(n);

  const aba = globais.find((r) => r.id === BOUNDSHEET);
  if (!aba) throw new Error('A planilha não declara nenhuma aba.');

  const inicioDaAba = aba.dados.readUInt32LE(0);
  const daAba = registros(stream, inicioDaAba);

  const grade = new Map<number, Map<number, string>>();
  let maiorLinha = -1;
  let maiorColuna = -1;

  const por = (linha: number, coluna: number, valor: string): void => {
    if (valor === '') return;
    if (!grade.has(linha)) grade.set(linha, new Map());
    grade.get(linha)!.set(coluna, valor);
    if (linha > maiorLinha) maiorLinha = linha;
    if (coluna > maiorColuna) maiorColuna = coluna;
  };

  for (let i = 0; i < daAba.length; i++) {
    const r = daAba[i]!;
    const d = r.dados;

    if (r.id === EOF_REG) break;

    switch (r.id) {
      case LABELSST: {
        const indice = d.readUInt32LE(6);
        por(d.readUInt16LE(0), d.readUInt16LE(2), textos[indice] ?? '');
        break;
      }

      case LABEL:
      case RSTRING: {
        const { texto } = lerTextoUnicode(d, 8, d.readUInt16LE(6));
        por(d.readUInt16LE(0), d.readUInt16LE(2), texto);
        break;
      }

      case NUMBER:
        por(d.readUInt16LE(0), d.readUInt16LE(2), numero(d.readDoubleLE(6), d.readUInt16LE(4)));
        break;

      case RK:
        por(d.readUInt16LE(0), d.readUInt16LE(2), numero(numeroRk(d.readInt32LE(6)), d.readUInt16LE(4)));
        break;

      case MULRK: {
        const linha = d.readUInt16LE(0);
        const primeira = d.readUInt16LE(2);
        // 6 bytes por célula (XF + RK); os 2 últimos do registro são a última coluna.
        const quantas = (d.length - 6) / 6;
        for (let k = 0; k < quantas; k++) {
          por(linha, primeira + k, numero(numeroRk(d.readInt32LE(4 + k * 6 + 2)), d.readUInt16LE(4 + k * 6)));
        }
        break;
      }

      case FORMULA: {
        // Resultado em texto não vem aqui: vem no `STRING` seguinte.
        const linha = d.readUInt16LE(0);
        const coluna = d.readUInt16LE(2);
        const ehTexto = d.readUInt16LE(12) === 0xffff && d.readUInt8(6) === 0x00;

        if (ehTexto) {
          const seguinte = daAba[i + 1];
          if (seguinte?.id === STRING) {
            const { texto } = lerTextoUnicode(seguinte.dados, 2, seguinte.dados.readUInt16LE(0));
            por(linha, coluna, texto);
            i++;
          }
        } else {
          por(linha, coluna, numero(d.readDoubleLE(6), d.readUInt16LE(4)));
        }
        break;
      }

      default:
        break;
    }
  }

  if (maiorLinha < 0) return [];

  const saida: string[][] = [];
  for (let l = 0; l <= maiorLinha; l++) {
    const linha = grade.get(l);
    const celulas: string[] = [];
    for (let c = 0; c <= maiorColuna; c++) celulas.push(linha?.get(c) ?? '');
    saida.push(celulas);
  }

  return saida;
}
