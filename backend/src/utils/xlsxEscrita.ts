import { crc32 } from 'node:zlib';
import { deflateRawSync } from 'node:zlib';

/*
 * Escritor mínimo de `.xlsx`, uma aba. Toda célula é `inlineStr` (texto literal):
 * exportar CSV deixaria o Excel transformar CPF e apólice longa em número.
 */

interface Arquivo {
  nome: string;
  conteudo: Buffer;
}

/** Zip na mão: entradas locais, diretório central e registro de fim. */
function zipar(arquivos: Arquivo[]): Buffer {
  const locais: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;

  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const comprimido = deflateRawSync(a.conteudo);
    const crc = crc32(a.conteudo);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0, 6); // sem flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // hora
    local.writeUInt16LE(0x21, 12); // data (1980-01-01, irrelevante)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(a.conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);

    locais.push(local, nome, comprimido);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0, 8);
    entrada.writeUInt16LE(8, 10);
    entrada.writeUInt16LE(0, 12);
    entrada.writeUInt16LE(0x21, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(comprimido.length, 20);
    entrada.writeUInt32LE(a.conteudo.length, 24);
    entrada.writeUInt16LE(nome.length, 28);
    entrada.writeUInt32LE(deslocamento, 42);

    central.push(entrada, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }

  const corpoCentral = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  return Buffer.concat([...locais, corpoCentral, fim]);
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // O Excel recusa o arquivo inteiro se houver caractere de controle solto.
    // eslint-disable-next-line no-control-regex -- é exatamente o que se quer tirar
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** `0` → `A`, `26` → `AA`. */
function coluna(indice: number): string {
  let nome = '';
  let n = indice;
  do {
    nome = String.fromCharCode(65 + (n % 26)) + nome;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return nome;
}

/** `.xlsx` de uma aba a partir da grade; a primeira linha fica congelada. */
export function gerarXlsx(grade: string[][], nomeDaAba = 'Dados'): Buffer {
  const linhas = grade
    .map((linha, i) => {
      const celulas = linha
        .map((valor, j) =>
          valor === ''
            ? ''
            : `<c r="${coluna(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${escapar(String(valor))}</t></is></c>`,
        )
        .join('');
      return `<row r="${i + 1}">${celulas}</row>`;
    })
    .join('');

  const aba =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>' +
    `<sheetData>${linhas}</sheetData></worksheet>`;

  const livro =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${escapar(nomeDaAba).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>';

  return zipar([
    {
      nome: '[Content_Types].xml',
      conteudo: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '</Types>',
        'utf8',
      ),
    },
    {
      nome: '_rels/.rels',
      conteudo: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      conteudo: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '</Relationships>',
        'utf8',
      ),
    },
    { nome: 'xl/workbook.xml', conteudo: Buffer.from(livro, 'utf8') },
    { nome: 'xl/worksheets/sheet1.xml', conteudo: Buffer.from(aba, 'utf8') },
  ]);
}
