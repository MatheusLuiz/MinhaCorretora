import { lerPdf, type CelulaPdf } from '../../../utils/pdf.js';

/**
 * "Histórico da Apólice — Histórico Completo" do portal do Bradesco (um PDF por apólice).
 * Lê pelo RÓTULO dentro da SEÇÃO, nunca pela posição: o layout muda entre PF/PJ e quebras de página.
 */

export interface ParcelaBradesco {
  numero: number;
  vencimento: string | null;
  valor: string | null;
  /** Como o portal escreve: Compensado, Aberto, Agendado, Parcela cancelada. */
  status: string;
  endosso: string | null;
  pagamento: string | null;
}

/** "Marca do Veículo" no PDF é o MODELO e "Fabricante" é a marca (ambos cortados em ~15 caracteres). */
export interface VeiculoBradesco {
  placa: string | null;
  chassi: string | null;
  fabricante: string | null;
  modelo: string | null;
  anoFabricacao: number | null;
  anoModelo: number | null;
  codigoFipe: string | null;
  combustivel: string | null;
  tipoVeiculo: string | null;
  uso: string | null;
  antifurto: string | null;
  /** Cláusula 70, "VEICULO 0 KM". */
  zeroKm: boolean;
  cepPernoite: string | null;
  pernoiteGaragem: boolean | null;
  condutor: { nome: string | null; documento: string | null; nascimento: string | null };
}

export interface ApoliceBradesco {
  apolice: string;
  /** Item da apólice; em frota cada veículo é um item e a cobrança é da frota inteira. */
  item: string | null;
  /** "Descrição do Seguro" decide se é frota, não o item (a frota também tem item 1). */
  frota: boolean | null;
  sucursal: string | null;
  ramo: string | null;
  inicio: string | null;
  fim: string | null;
  emissao: string | null;
  /** "ATIVA", "ENCERRADA - ENC.POR ENDOSSO"… como veio. */
  situacao: string | null;
  produto: string | null;
  /** Número da apólice anterior; null quando o portal diz 0 (seguro novo ou de outra companhia). */
  apoliceAnterior: string | null;
  segurado: {
    nome: string | null;
    documento: string | null;
    tipoPessoa: 'F' | 'J' | null;
    nascimento: string | null;
    sexo: 'M' | 'F' | null;
    email: string | null;
  };
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  } | null;
  premio: { liquido: string | null; iof: string | null; bruto: string | null };
  veiculo: VeiculoBradesco | null;
  parcelas: ParcelaBradesco[];
  /** Só se avisa: o formato da tabela de sinistros ainda não foi visto. */
  temSinistro: boolean;
  temEndosso: boolean;
}

interface Linha {
  celulas: CelulaPdf[];
}

/** `dd/mm/aaaa` → `aaaa-mm-dd`; "Não Há", "Nao se aplica" e vazio → null. */
function data(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** O resumo escreve `6.332,57` e as parcelas `1055.42`: com vírgula é decimal BR, sem ela o ponto é decimal. */
function valor(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  if (!t || !/\d/.test(t)) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/** Valor ausente do portal: vazio, "null", "Não Há", "Nao se aplica". */
function texto(v: string | undefined): string | null {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /^(null|n[aã]o h[aá]|n[aã]o se aplica)$/i.test(t)) return null;
  return t;
}

/** O PDF quebra palavra longa e a junção cria espaço falso (`X@GMAI L.COM`); e-mail e CPF não têm espaço. */
const semEspaco = (v: string | null): string | null => (v ? v.replace(/\s+/g, '') : null);

function linhasDoDocumento(buffer: Buffer): Linha[] {
  const linhas: Linha[] = [];

  for (const pagina of lerPdf(buffer)) {
    const porY = new Map<number, CelulaPdf[]>();
    for (const c of pagina.celulas) {
      const y = Math.round(c.y);
      porY.set(y, [...(porY.get(y) ?? []), c]);
    }
    for (const [, celulas] of [...porY].sort((a, b) => b[0] - a[0])) {
      linhas.push({ celulas: celulas.sort((a, b) => a.x - b.x) });
    }
  }

  return linhas;
}

/** Linha de título de seção: uma célula só, larga, com texto. */
function tituloDaLinha(l: Linha): string | null {
  const cheias = l.celulas.filter((c) => c.texto);
  return cheias.length === 1 && cheias[0]!.largura > 400 ? cheias[0]!.texto : null;
}

/** Rótulo → valor por seção; a linha alterna rótulo e valor, e célula vazia conta como valor (pular desalinharia). */
function formulario(linhas: Linha[]): Map<string, string> {
  const campos = new Map<string, string>();
  let secao = '';

  for (const l of linhas) {
    const titulo = tituloDaLinha(l);
    if (titulo) {
      secao = titulo;
      continue;
    }

    for (let i = 0; i + 1 < l.celulas.length; i += 2) {
      const rotulo = l.celulas[i]!.texto;
      if (!rotulo) continue;
      const chave = `${secao}|${rotulo}`;
      // A primeira ocorrência vence: "Segurado" se repete no cabeçalho de cada bloco.
      if (!campos.has(chave)) campos.set(chave, l.celulas[i + 1]!.texto);
    }
  }

  return campos;
}

/** Cada célula vai à coluna cujo cabeçalho ela sobrepõe no eixo x: célula vazia nem sempre é desenhada. */
function tabela(
  linhas: Linha[],
  ehCabecalho: (l: Linha) => boolean,
  ehLinhaDeDado: (primeira: string) => boolean,
): Record<string, string>[] {
  const inicio = linhas.findIndex(ehCabecalho);
  if (inicio < 0) return [];

  const colunas = linhas[inicio]!.celulas.map((c) => ({ ...c, nome: c.texto }));
  const saida: Record<string, string>[] = [];

  for (const l of linhas.slice(inicio + 1)) {
    if (tituloDaLinha(l)) break;
    const primeira = l.celulas.find((c) => c.texto)?.texto ?? '';
    // Rodapé ou cabeçalho repetido no meio: a tabela continua na página seguinte.
    if (!ehLinhaDeDado(primeira)) continue;

    const registro: Record<string, string> = {};
    for (const c of l.celulas) {
      const meio = c.x + c.largura / 2;
      const coluna = colunas.find((k) => meio >= k.x && meio <= k.x + k.largura);
      if (coluna && c.texto) registro[coluna.nome] = c.texto;
    }
    saida.push(registro);
  }

  return saida;
}

export function lerHistoricoBradesco(buffer: Buffer): ApoliceBradesco {
  const linhas = linhasDoDocumento(buffer);
  const campos = formulario(linhas);
  const campo = (secao: string, rotulo: string): string | undefined => campos.get(`${secao}|${rotulo}`);

  // Campos de bloco sem título próprio (questionário do veículo).
  const emQualquerSecao = (rotulo: string): string | undefined =>
    [...campos.entries()].find(([chave]) => chave.endsWith(`|${rotulo}`))?.[1];
  const descricaoDoSeguro = texto(emQualquerSecao('Descrição do Seguro'));

  const APOLICE = 'Informações da Apólice';
  const ANTERIOR = 'Chave da Apólice Anterior';
  const SEGURADO = 'Informações do Segurado';

  const numero = texto(campo(APOLICE, 'Apólice'));
  if (!numero) {
    throw new Error(
      'Não encontrei o número da apólice. Confira se o arquivo é o "Histórico da Apólice — Histórico Completo" do portal do Bradesco.',
    );
  }

  const anterior = texto(campo(ANTERIOR, 'Apólice'));
  const documento = semEspaco(texto(campo(SEGURADO, 'CPF/CNPJ')))?.replace(/\D/g, '') ?? null;
  const tipoSegurado = texto(campo(SEGURADO, 'Tipo de Segurado'));
  const sexo = texto(campo(SEGURADO, 'Sexo'))?.charAt(0).toUpperCase();

  const enderecos = tabela(
    linhas,
    (l) => l.celulas.some((c) => c.texto === 'Tipo Endereço'),
    (primeira) => /^[A-ZÇÃ]{4,}$/.test(primeira),
  );
  // Vale o endereço de COBRANÇA (o de RISCO é onde o carro dorme).
  const end = enderecos.find((e) => e['Tipo Endereço'] === 'COBRANCA') ?? enderecos[0];

  const parcelas = tabela(
    linhas,
    (l) => l.celulas.some((c) => c.texto === 'Data Vencimento'),
    (primeira) => /^\d{1,3}$/.test(primeira),
  );

  // Primeira coluna do resumo = valor EMITIDO (a segunda é o já pago).
  const resumo = (rotulo: string): string | null => {
    const l = linhas.find((x) => x.celulas[0]?.texto === rotulo);
    return valor(l?.celulas.find((c, i) => i > 0 && c.texto)?.texto);
  };

  // "Não Existem…" vem numa célula larga sozinha: testar antes de tomá-la por título.
  const secaoTem = (titulo: string, vazio: RegExp): boolean => {
    const i = linhas.findIndex((l) => tituloDaLinha(l) === titulo);
    if (i < 0) return false;

    let conteudo = 0;
    for (const l of linhas.slice(i + 1)) {
      if (l.celulas.some((c) => vazio.test(c.texto))) return false;
      if (tituloDaLinha(l)) break;
      const primeira = l.celulas.find((c) => c.texto)?.texto ?? '';
      if (primeira && primeira !== 'Sucursal' && primeira !== 'Segurado') conteudo++;
    }
    return conteudo > 0;
  };

  const BEM = 'Informações do Bem Segurado';
  const temVeiculo = linhas.some((l) => tituloDaLinha(l) === BEM);
  const ano = (v: string | undefined): number | null => {
    const n = Number(texto(v));
    return Number.isInteger(n) && n > 1900 && n < 2100 ? n : null;
  };
  const simNao = (v: string | undefined): boolean | null => {
    const t = texto(v);
    return t ? /^sim/i.test(t) : null;
  };
  // Carro zero sem placa vem como "AAVISAR".
  const placa = (texto(campo(BEM, 'Nº da Placa')) ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const cepPernoite = (texto(emQualquerSecao('Cep de pernoite do veiculo')) ?? '').replace(/\D/g, '');
  const docCondutor = (texto(emQualquerSecao('CPF/CNPJ do condutor principal')) ?? '').replace(/\D/g, '');

  const veiculo: VeiculoBradesco | null = temVeiculo
    ? {
        placa: /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa) ? placa : null,
        chassi: semEspaco(texto(campo(BEM, 'Nº Chassi')))?.toUpperCase() ?? null,
        fabricante: texto(campo(BEM, 'Fabricante')),
        modelo: texto(campo(BEM, 'Marca do Veículo')),
        anoFabricacao: ano(campo(BEM, 'Ano Fabricação')),
        anoModelo: ano(campo(BEM, 'Ano Modelo')),
        codigoFipe: texto(campo(BEM, 'Código Fipe')),
        combustivel: texto(campo(BEM, 'Tipo Combustível')),
        tipoVeiculo: texto(campo(BEM, 'Tipo Veículo')),
        uso: texto(campo(APOLICE, 'Tipo Utilização')),
        antifurto: texto(campo(BEM, 'Anti-Furto')),
        zeroKm: linhas.some((l) => l.celulas.some((c) => /VEICULO 0 KM/i.test(c.texto))),
        cepPernoite: cepPernoite.length >= 7 ? cepPernoite.padStart(8, '0') : null,
        pernoiteGaragem: simNao(
          emQualquerSecao('O veículo pernoita em garagem, condomínio fechado ou estacionamento protegido'),
        ),
        condutor: {
          nome: texto(emQualquerSecao('Nome do condutor principal')),
          // Vem sem o zero da frente.
          documento: docCondutor
            ? docCondutor.length > 11 ? docCondutor.padStart(14, '0') : docCondutor.padStart(11, '0')
            : null,
          nascimento: data(emQualquerSecao('Data de nascimento do condutor principal')),
        },
      }
    : null;

  return {
    apolice: numero,
    item: texto(campo(APOLICE, 'Item')),
    frota: descricaoDoSeguro ? /FROTA/i.test(descricaoDoSeguro) : null,
    sucursal: texto(campo(APOLICE, 'Sucursal')),
    ramo: texto(campo(APOLICE, 'Ramo')),
    inicio: data(campo(APOLICE, 'Data Inicio Vigência')),
    fim: data(campo(APOLICE, 'Data Fim Vigência')),
    emissao: data(campo(APOLICE, 'Data da Emissão')),
    situacao: texto(campo(APOLICE, 'Descrição Situação')),
    produto: texto(campo(APOLICE, 'Descrição do produto')),
    apoliceAnterior: anterior && anterior !== '0' ? anterior : null,
    segurado: {
      nome: texto(campo(SEGURADO, 'Segurado')) ?? texto(campo(APOLICE, 'Segurado')),
      documento,
      tipoPessoa: tipoSegurado
        ? /jur/i.test(tipoSegurado) ? 'J' : 'F'
        : documento?.length === 14 ? 'J' : documento ? 'F' : null,
      nascimento: data(campo(SEGURADO, 'Data de Nascimento')),
      sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
      email: semEspaco(texto(campo(SEGURADO, 'Email')))?.toLowerCase() ?? null,
    },
    endereco: end
      ? {
          logradouro:
            [texto(end['Tipo Logradouro']), texto(end['Logradouro'])].filter(Boolean).join(' ') || null,
          numero: texto(end['Nº']),
          complemento: texto(end['Complemen to'] ?? end['Complemento']),
          cidade: texto(end['Municipio']),
          uf: texto(end['Uf']),
          cep: (texto(end['Cep']) ?? '').replace(/\D/g, '').padStart(8, '0').slice(-8) || null,
        }
      : null,
    premio: { liquido: resumo('Prêmio Líquido'), iof: resumo('IOF'), bruto: resumo('Prêmio Bruto') },
    veiculo,
    parcelas: parcelas
      .map((p) => ({
        numero: Number(p['Nº da Prestaçã o'] ?? p['Nº da Prestação']),
        vencimento: data(p['Data Vencimento']),
        valor: valor(p['Valor Prêmio']),
        status: texto(p['Descrição Status']) ?? '',
        endosso: texto(p['Nº do Endosso']),
        pagamento: data(p['Data Pagamento']),
      }))
      .filter((p) => Number.isFinite(p.numero) && p.numero > 0),
    temSinistro: secaoTem('Informações do Sinistro', /Não Existem Sinistros/i),
    temEndosso: secaoTem('Informações do Endosso', /Não Existem Endossos/i),
  };
}
