import { randomUUID } from 'node:crypto';

import { logger } from '../config/logger.js';
import { pool } from '../database/pool.js';
import * as repo from '../repositories/cliente.repository.js';
import type { NomeDimensao, OrigemSistema } from '../repositories/cliente.repository.js';
import { AppError } from '../utils/AppError.js';
import {
  mapearCabecalho,
  normalizarNomeColuna,
  type ColunaMapeada,
} from './colunasImportacao.js';

/*
 * Núcleo da importação de clientes, comum à CLI e à tela. A semântica é
 * ESPELHAR o arquivo: coluna ausente vira vazio e APAGA — por isso a simulação
 * devolve o estrago (`calcularImpacto`) antes de gravar.
 */

/** Uma linha de CSV: campo entre aspas pode ter vírgula e aspas escapada (`""`). */
export function parseLinhaCsv(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];

    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
      continue;
    }

    if (c === ',' && !dentroDeAspas) {
      campos.push(atual);
      atual = '';
      continue;
    }

    atual += c;
  }

  campos.push(atual);
  return campos;
}

/** Excel em português salva CSV com ponto e vírgula. */
function detectarSeparador(cabecalho: string): ',' | ';' {
  const virgulas = (cabecalho.match(/,/g) ?? []).length;
  const pontosEVirgula = (cabecalho.match(/;/g) ?? []).length;
  return pontosEVirgula > virgulas ? ';' : ',';
}

function texto(valor: string | undefined, maximo: number): string | null {
  const limpo = (valor ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return null;
  return limpo.length > maximo ? limpo.slice(0, maximo) : limpo;
}

function somenteDigitos(valor: string | undefined): string | null {
  const limpo = (valor ?? '').replace(/\D/g, '');
  return limpo || null;
}

/** Aceita ISO e dia/mês/ano (nunca mês/dia). */
function data(valor: string | undefined): string | null {
  const limpo = (valor ?? '').trim();
  if (!limpo) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(limpo);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Separador `/`, `-` ou `.`, e hora no fim (`04/09/2025 00:00:00`, CSV da Suhai).
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(limpo);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;

  return null;
}

function booleano(valor: string | undefined): boolean {
  const limpo = (valor ?? '').trim().toLowerCase();
  return limpo === '1' || limpo === 'true' || limpo === 'sim' || limpo === 's' || limpo === 'x';
}

function decimal(valor: string | undefined): string | null {
  const limpo = (valor ?? '').trim().replace(/^R\$\s*/i, '');
  if (!limpo) return null;

  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero.toFixed(2) : null;
}

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function email(valor: string | undefined): string | null {
  const limpo = texto(valor, 120);
  if (!limpo) return null;
  return EMAIL_VALIDO.test(limpo) ? limpo.toLowerCase() : null;
}

/** Separa "00305 - Filial Centro S/a" em código e nome. */
function separarEstrutura(valor: string | undefined): { codigo: string | null; nome: string } | null {
  const limpo = texto(valor, 140);
  if (!limpo) return null;

  const casou = /^(\d{2,10})\s*[-–]\s*(.+)$/.exec(limpo);
  if (casou) return { codigo: casou[1]!, nome: casou[2]!.slice(0, 120) };

  return { codigo: null, nome: limpo.slice(0, 120) };
}

/**
 * Resolve "texto → id" uma vez por valor distinto. Resolver INSERE o valor
 * novo, então na simulação distribui ids de mentira.
 */
class CacheDimensoes {
  private readonly mapas = new Map<string, Map<string, number>>();
  private proximoIdFalso = 1;

  constructor(private readonly simular: boolean) {}

  private mapa(chave: string): Map<string, number> {
    let m = this.mapas.get(chave);
    if (!m) {
      m = new Map();
      this.mapas.set(chave, m);
    }
    return m;
  }

  private async resolver(grupo: string, chave: string, gravar: () => Promise<number>): Promise<number> {
    const m = this.mapa(grupo);
    const emCache = m.get(chave);
    if (emCache !== undefined) return emCache;

    const id = this.simular ? this.proximoIdFalso++ : await gravar();
    m.set(chave, id);
    return id;
  }

  async simples(dimensao: NomeDimensao, valor: string | null): Promise<number | null> {
    if (!valor) return null;
    return this.resolver(dimensao, valor, () => repo.resolverDimensao(dimensao, valor));
  }

  async modalidade(nome: string | null, ramoId: number | null): Promise<number | null> {
    if (!nome) return null;
    return this.resolver('modalidades', `${ramoId ?? 0}|${nome}`, () =>
      repo.resolverModalidade(nome, ramoId),
    );
  }

  async estrutura(codigo: string | null, nome: string | null): Promise<number | null> {
    if (!nome) return null;
    return this.resolver('estruturas_venda', `${codigo ?? ''}|${nome}`, () =>
      repo.resolverEstrutura(codigo, nome),
    );
  }

  async municipio(nome: string | null, uf: string | null): Promise<number | null> {
    // Município sem UF é ambíguo ("Bom Jesus" existe em nove estados).
    if (!nome || !uf) return null;
    return this.resolver('municipios', `${uf}|${nome}`, () => repo.resolverMunicipio(nome, uf));
  }

  get tamanhos(): Record<string, number> {
    return Object.fromEntries([...this.mapas].map(([k, v]) => [k, v.size]));
  }
}

export interface Recusa {
  linha: number;
  motivo: string;
}

export interface ImpactoImportacao {
  /** Documentos do arquivo que ainda não existem na base. */
  novos: number;
  /** Documentos que já existem e serão sobrescritos. */
  existentes: number;
  /** Clientes existentes que perderiam cada tipo de dado (o arquivo não o traz). */
  perdem: {
    telefones: number;
    emails: number;
    enderecos: number;
    segurados: number;
    seguradoras: number;
  };
}

export interface ResultadoImportacao {
  lote: string;
  arquivo: string;
  origem: OrigemSistema;
  simulacao: boolean;

  lidas: number;
  inseridas: number;
  atualizadas: number;
  recusadas: number;

  satelites: { telefones: number; emails: number; enderecos: number; segurados: number; vinculos: number };
  valoresDistintos: Record<string, number>;

  emailsDescartados: number;
  recusas: Recusa[];
  motivosDeRecusa: Record<string, number>;

  colunasReconhecidas: string[];
  colunasIgnoradas: string[];
  /** De que nome no arquivo veio cada coluna canônica. */
  mapeamento: ColunaMapeada[];

  /** Só na simulação: o que a gravação faria. */
  impacto?: ImpactoImportacao;
}

export interface OpcoesImportacao {
  origem: OrigemSistema;
  arquivo: string;
  simular: boolean;
  /** Situação atribuída a quem o arquivo não classificar. */
  situacaoPadrao?: string;
  /** Mapa do layout escolhido: nome de origem normalizado → coluna canônica. */
  aliases?: Record<string, string>;
  /** Seguradora das linhas quando o arquivo não traz a coluna. */
  seguradoraPadrao?: string;
  aoProgredir?: (lidas: number) => void;
}

/** Colunas que o importador sabe ler. */
export const COLUNAS_CONHECIDAS = [
  'cpf_cnpj', 'cpf_cnpj_numeros', 'tipo_pessoa', 'nome_civil', 'nome_social',
  'profissao', 'sexo', 'estado_civil', 'data_nascimento',
  'cliente_vip', 'autoriza_contato', 'situacao', 'situacao_em', 'saida_em',
  'email', 'email_comercial',
  'ddd_celular', 'celular', 'celular_completo',
  'ddd_residencial', 'telefone_residencial',
  'ddd_comercial', 'telefone_comercial',
  'ddd_opcional', 'telefone_opcional',
  'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep',
  'ramo_descricao', 'modalidade', 'seguradora',
  'estrutura_vendas', 'produtor', 'origem_cliente',
  'renda', 'faturamento_anual', 'cliente_desde', 'ultima_alteracao',
  'arquivo_origem',
  ...[1, 2, 3].flatMap((n) => [
    `resp${n}_nome`, `resp${n}_cpf`, `resp${n}_rg`, `resp${n}_endereco`,
    `resp${n}_bairro`, `resp${n}_cep`, `resp${n}_cidade`, `resp${n}_uf`,
    `resp${n}_telefone`, `resp${n}_celular`, `resp${n}_email`,
  ]),
];

interface LinhaPreparada {
  cliente: repo.ClienteImportado;
  telefones: Omit<repo.TelefoneImportado, 'clienteId'>[];
  emails: Omit<repo.EmailImportado, 'clienteId'>[];
  endereco: Omit<repo.EnderecoImportado, 'clienteId'> | null;
  segurados: Omit<repo.SeguradoImportado, 'clienteId'>[];
  vinculo: Omit<repo.VinculoSeguradora, 'clienteId'> | null;
}

/** Quantos clientes por transação. 500 mantém o pacote longe do `max_allowed_packet`. */
const TAMANHO_LOTE = 500;

/** Lê as linhas (de `readline` na CLI ou do corpo HTTP) e, fora da simulação, grava. */
export async function importar(
  linhas: AsyncIterable<string>,
  opcoes: OpcoesImportacao,
): Promise<ResultadoImportacao> {
  const lote = randomUUID();
  const cache = new CacheDimensoes(opcoes.simular);

  const situacoes = await repo.listarSituacoes();
  const situacaoPorChave = new Map(situacoes.map((s) => [s.chave, s.id]));
  const situacaoPorNome = new Map(situacoes.map((s) => [s.nome.toLowerCase(), s.id]));

  const resolverSituacao = (valor: string | null): number | null => {
    if (!valor) return null;
    const limpo = valor.trim().toLowerCase();
    return situacaoPorChave.get(limpo) ?? situacaoPorNome.get(limpo) ?? null;
  };

  const situacaoPadraoId = resolverSituacao(opcoes.situacaoPadrao ?? null);

  let cabecalho: string[] | null = null;
  let indice = new Map<string, number>();
  let separador: ',' | ';' = ',';
  let numeroLinha = 0;
  let lidas = 0;
  let afetadasClientes = 0;

  const totais = { telefones: 0, emails: 0, enderecos: 0, segurados: 0, vinculos: 0 };
  const recusas: Recusa[] = [];
  let emailsDescartados = 0;
  let colunasIgnoradas: string[] = [];
  let colunasReconhecidas: string[] = [];
  let mapeamento: ColunaMapeada[] = [];

  let buffer: LinhaPreparada[] = [];
  /** Só na simulação: documentos vistos, para calcular o impacto no fim. */
  const documentosVistos = new Set<string>();

  const importacaoId = opcoes.simular
    ? null
    : await repo.abrirImportacao({ lote, origemSistema: opcoes.origem, arquivo: opcoes.arquivo });

  const campo = (campos: string[], nome: string): string | undefined => {
    const i = indice.get(nome);
    return i === undefined ? undefined : campos[i];
  };

  async function descarregar(): Promise<void> {
    if (buffer.length === 0) return;
    if (opcoes.simular) {
      totais.telefones += buffer.reduce((n, l) => n + l.telefones.length, 0);
      totais.emails += buffer.reduce((n, l) => n + l.emails.length, 0);
      totais.enderecos += buffer.filter((l) => l.endereco).length;
      totais.segurados += buffer.reduce((n, l) => n + l.segurados.length, 0);
      totais.vinculos += buffer.filter((l) => l.vinculo).length;
      buffer = [];
      return;
    }

    const conexao = await pool.getConnection();

    try {
      await conexao.beginTransaction();

      afetadasClientes += await repo.inserirClientes(buffer.map((l) => l.cliente), conexao);

      const ids = await repo.mapearIdsPorDocumento(
        buffer.map((l) => l.cliente.cpfCnpjNumeros),
        conexao,
      );

      // Espelhar o arquivo: o que estava e não vem de novo, sai.
      await repo.limparSatelites([...ids.values()], conexao);

      const telefones: repo.TelefoneImportado[] = [];
      const emails: repo.EmailImportado[] = [];
      const enderecos: repo.EnderecoImportado[] = [];
      const segurados: repo.SeguradoImportado[] = [];
      const vinculos: repo.VinculoSeguradora[] = [];

      for (const linha of buffer) {
        const clienteId = ids.get(linha.cliente.cpfCnpjNumeros);
        if (clienteId === undefined) continue;

        for (const t of linha.telefones) telefones.push({ ...t, clienteId });
        for (const e of linha.emails) emails.push({ ...e, clienteId });
        if (linha.endereco) enderecos.push({ ...linha.endereco, clienteId });
        for (const s of linha.segurados) segurados.push({ ...s, clienteId });
        if (linha.vinculo) vinculos.push({ ...linha.vinculo, clienteId });
      }

      totais.telefones += await repo.inserirTelefones(telefones, conexao);
      totais.emails += await repo.inserirEmails(emails, conexao);
      totais.enderecos += await repo.inserirEnderecos(enderecos, conexao);
      totais.segurados += await repo.inserirSegurados(segurados, conexao);
      totais.vinculos += await repo.inserirVinculosSeguradora(vinculos, conexao);

      await conexao.commit();
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    } finally {
      conexao.release();
    }

    buffer = [];
  }

  for await (const linhaBruta of linhas) {
    numeroLinha += 1;
    if (!linhaBruta.trim()) continue;

    if (!cabecalho) {
      // O BOM vem antes da primeira aspa: tem de sair da linha inteira.
      const linhaLimpa = linhaBruta.replace(/^\u{FEFF}/u, '');
      separador = detectarSeparador(linhaLimpa);
      const bruto =
        separador === ';'
          ? linhaLimpa.split(';').map((c) => c.trim().replace(/^"|"$/g, ''))
          : parseLinhaCsv(linhaLimpa);

      cabecalho = bruto;

      const traduzido = mapearCabecalho(
        bruto,
        new Set(COLUNAS_CONHECIDAS),
        opcoes.aliases ?? {},
      );

      indice = traduzido.indice;
      mapeamento = traduzido.colunas;

      colunasReconhecidas = traduzido.colunas
        .filter((c) => c.canonica !== null)
        .map((c) => c.canonica!);
      colunasIgnoradas = traduzido.colunas
        .filter((c) => c.canonica === null && c.origem !== '')
        .map((c) => c.origem);

      // Mostra a chave NORMALIZADA: é ela que entra no `aliases` do layout.
      const relatorioDoCabecalho = (): string[] =>
        traduzido.colunas
          .filter((c) => c.origem !== '')
          .map((c) =>
            c.canonica
              ? `  ${c.origem}  →  ${c.canonica}`
              : `  ${c.origem}  →  NÃO RECONHECIDA (chave para o mapa: "${normalizarNomeColuna(c.origem)}")`,
          );

      if (!indice.has('cpf_cnpj') && !indice.has('cpf_cnpj_numeros')) {
        throw AppError.unprocessable(
          'Não encontrei a coluna de CPF/CNPJ nesta planilha.',
          relatorioDoCabecalho(),
        );
      }

      if (!indice.has('nome_civil')) {
        throw AppError.unprocessable(
          'Não encontrei a coluna de nome nesta planilha.',
          relatorioDoCabecalho(),
        );
      }

      continue;
    }

    const campos =
      separador === ';'
        ? linhaBruta.split(';').map((c) => c.replace(/^"|"$/g, ''))
        : parseLinhaCsv(linhaBruta);

    lidas += 1;

    const documento =
      somenteDigitos(campo(campos, 'cpf_cnpj_numeros')) ?? somenteDigitos(campo(campos, 'cpf_cnpj'));

    if (!documento) {
      recusas.push({ linha: numeroLinha, motivo: 'sem CPF/CNPJ' });
      continue;
    }

    if (documento.length !== 11 && documento.length !== 14) {
      recusas.push({ linha: numeroLinha, motivo: `CPF/CNPJ com ${documento.length} dígitos` });
      continue;
    }

    const nome = texto(campo(campos, 'nome_civil'), 150);
    if (!nome) {
      recusas.push({ linha: numeroLinha, motivo: 'sem nome' });
      continue;
    }

    const situacaoTexto = texto(campo(campos, 'situacao'), 40);
    const situacaoId = resolverSituacao(situacaoTexto) ?? situacaoPadraoId;

    if (situacaoTexto && resolverSituacao(situacaoTexto) === null) {
      recusas.push({
        linha: numeroLinha,
        motivo: `situação desconhecida: "${situacaoTexto}"`,
      });
      continue;
    }

    documentosVistos.add(documento);

    const ramoId = await cache.simples('ramos', texto(campo(campos, 'ramo_descricao'), 60));
    const modalidadeId = await cache.modalidade(texto(campo(campos, 'modalidade'), 60), ramoId);
    // Sem coluna de seguradora, vale a do layout (arquivo exportado por uma companhia).
    const seguradoraDaLinha =
      texto(campo(campos, 'seguradora'), 60) ?? opcoes.seguradoraPadrao ?? null;
    const seguradoraId = await cache.simples('seguradoras', seguradoraDaLinha);
    const produtorId = await cache.simples('produtores', texto(campo(campos, 'produtor'), 120));
    const profissaoId = await cache.simples('profissoes', texto(campo(campos, 'profissao'), 120));
    const estadoCivilId = await cache.simples('estados_civis', texto(campo(campos, 'estado_civil'), 40));
    const faixaRendaId = await cache.simples('faixas_renda', texto(campo(campos, 'renda'), 40));
    const origemClienteId = await cache.simples(
      'origens_clientes',
      texto(campo(campos, 'origem_cliente'), 60),
    );

    const estrutura = separarEstrutura(campo(campos, 'estrutura_vendas'));
    const estruturaId = estrutura ? await cache.estrutura(estrutura.codigo, estrutura.nome) : null;

    const uf = texto(campo(campos, 'uf'), 2)?.toUpperCase() ?? null;
    const municipioId = await cache.municipio(texto(campo(campos, 'cidade'), 80), uf);

    const tipoPessoa: 'F' | 'J' = documento.length === 14 ? 'J' : 'F';
    const sexoBruto = (campo(campos, 'sexo') ?? '').trim().toUpperCase();

    const telefones: Omit<repo.TelefoneImportado, 'clienteId'>[] = [];

    const montarTelefone = (
      tipo: repo.TipoTelefone,
      colunaDdd: string,
      colunaNumero: string,
      colunaCompleta?: string,
    ): void => {
      const ddd = somenteDigitos(campo(campos, colunaDdd));
      const numero = somenteDigitos(campo(campos, colunaNumero));
      if (!numero) return;

      const completo =
        (colunaCompleta ? somenteDigitos(campo(campos, colunaCompleta)) : null) ??
        (ddd ? `${ddd}${numero}` : numero);

      telefones.push({
        tipo,
        ddd: ddd?.slice(0, 3) ?? null,
        numero: numero.slice(0, 15),
        completo: completo.slice(0, 20),
        principal: tipo === 'celular',
      });
    };

    montarTelefone('celular', 'ddd_celular', 'celular', 'celular_completo');
    montarTelefone('residencial', 'ddd_residencial', 'telefone_residencial');
    montarTelefone('comercial', 'ddd_comercial', 'telefone_comercial');
    montarTelefone('opcional', 'ddd_opcional', 'telefone_opcional');

    const emails: Omit<repo.EmailImportado, 'clienteId'>[] = [];

    const pessoalBruto = texto(campo(campos, 'email'), 120);
    const pessoal = email(campo(campos, 'email'));
    if (pessoalBruto && !pessoal) emailsDescartados += 1;
    if (pessoal) emails.push({ tipo: 'pessoal', endereco: pessoal, principal: true });

    const comercialBruto = texto(campo(campos, 'email_comercial'), 120);
    const comercial = email(campo(campos, 'email_comercial'));
    if (comercialBruto && !comercial) emailsDescartados += 1;
    // A origem costuma repetir o pessoal na coluna comercial.
    if (comercial && comercial !== pessoal) {
      emails.push({ tipo: 'comercial', endereco: comercial, principal: false });
    }

    const logradouro = texto(campo(campos, 'logradouro'), 150);
    const cep = somenteDigitos(campo(campos, 'cep'))?.slice(0, 8) ?? null;
    const bairro = texto(campo(campos, 'bairro'), 60);

    const endereco =
      logradouro || cep || bairro || municipioId
        ? {
            tipo: 'principal' as const,
            logradouro,
            numero: texto(campo(campos, 'numero'), 10),
            complemento: texto(campo(campos, 'complemento'), 60),
            bairro,
            municipioId,
            cep,
          }
        : null;

    const segurados: Omit<repo.SeguradoImportado, 'clienteId'>[] = [];

    for (const ordem of [1, 2, 3]) {
      const nomeResp = texto(campo(campos, `resp${ordem}_nome`), 120);
      const cpfResp = texto(campo(campos, `resp${ordem}_cpf`), 18);
      const rgResp = texto(campo(campos, `resp${ordem}_rg`), 20);
      const endResp = texto(campo(campos, `resp${ordem}_endereco`), 150);
      const bairroResp = texto(campo(campos, `resp${ordem}_bairro`), 60);
      const cepResp = somenteDigitos(campo(campos, `resp${ordem}_cep`))?.slice(0, 8) ?? null;
      const telResp = texto(campo(campos, `resp${ordem}_telefone`), 20);
      const celResp = texto(campo(campos, `resp${ordem}_celular`), 20);
      const emailResp = email(campo(campos, `resp${ordem}_email`));
      const ufResp = texto(campo(campos, `resp${ordem}_uf`), 2)?.toUpperCase() ?? null;
      const cidadeResp = texto(campo(campos, `resp${ordem}_cidade`), 80);

      const temAlgo =
        nomeResp || cpfResp || rgResp || endResp || bairroResp ||
        cepResp || telResp || celResp || emailResp || cidadeResp;

      if (!temAlgo) continue;

      segurados.push({
        ordem,
        nome: nomeResp,
        cpf: cpfResp,
        rg: rgResp,
        logradouro: endResp,
        bairro: bairroResp,
        municipioId: await cache.municipio(cidadeResp, ufResp),
        cep: cepResp,
        telefone: telResp,
        celular: celResp,
        email: emailResp,
      });
    }

    buffer.push({
      cliente: {
        origemSistema: opcoes.origem,
        origemArquivo: texto(campo(campos, 'arquivo_origem'), 120) ?? opcoes.arquivo,
        origemLote: lote,

        cpfCnpj: texto(campo(campos, 'cpf_cnpj'), 18),
        cpfCnpjNumeros: documento,
        tipoPessoa,

        nome,
        nomeSocial: texto(campo(campos, 'nome_social'), 150),
        profissaoId,
        estadoCivilId,
        sexo: sexoBruto === 'M' || sexoBruto === 'F' ? sexoBruto : null,
        dataNascimento: data(campo(campos, 'data_nascimento')),

        vip: booleano(campo(campos, 'cliente_vip')),
        autorizaContato: booleano(campo(campos, 'autoriza_contato')),

        situacaoId,
        situacaoEm: data(campo(campos, 'situacao_em')),
        saidaEm: data(campo(campos, 'saida_em')),

        produtorId,
        estruturaVendaId: estruturaId,
        origemClienteId,
        faixaRendaId,
        faturamentoAnual: decimal(campo(campos, 'faturamento_anual')),

        clienteDesde: data(campo(campos, 'cliente_desde')),
        ultimaAlteracao: data(campo(campos, 'ultima_alteracao')),
      },
      telefones,
      emails,
      endereco,
      segurados,
      vinculo: seguradoraId === null ? null : { seguradoraId, ramoId, modalidadeId },
    });

    if (buffer.length >= TAMANHO_LOTE) {
      await descarregar();
      opcoes.aoProgredir?.(lidas);
    }
  }

  await descarregar();

  if (!cabecalho) {
    throw AppError.unprocessable('O arquivo está vazio.');
  }

  // O MySQL conta 1 por linha inserida e 2 por linha efetivamente atualizada.
  const gravadas = lidas - recusas.length;
  const atualizadas = opcoes.simular ? 0 : Math.max(afetadasClientes - gravadas, 0);
  const inseridas = opcoes.simular ? 0 : Math.max(gravadas - atualizadas, 0);

  const motivosDeRecusa = recusas.reduce<Record<string, number>>((acc, r) => {
    acc[r.motivo] = (acc[r.motivo] ?? 0) + 1;
    return acc;
  }, {});

  if (importacaoId !== null) {
    await repo.fecharImportacao(importacaoId, {
      lidas,
      inseridas,
      atualizadas,
      recusadas: recusas.length,
      detalhes: {
        motivos: motivosDeRecusa,
        emailsDescartados,
        satelites: totais,
        colunasIgnoradas,
      },
    });
  }

  const resultado: ResultadoImportacao = {
    lote,
    arquivo: opcoes.arquivo,
    origem: opcoes.origem,
    simulacao: opcoes.simular,
    lidas,
    inseridas,
    atualizadas,
    recusadas: recusas.length,
    satelites: totais,
    valoresDistintos: cache.tamanhos,
    emailsDescartados,
    recusas: recusas.slice(0, 50),
    motivosDeRecusa,
    colunasReconhecidas,
    colunasIgnoradas,
    mapeamento,
  };

  if (opcoes.simular) {
    resultado.impacto = await calcularImpacto([...documentosVistos], buffer, {
      temTelefone: indice.has('celular') || indice.has('telefone_residencial') || indice.has('celular_completo'),
      temEmail: indice.has('email') || indice.has('email_comercial'),
      temEndereco: indice.has('logradouro') || indice.has('cep') || indice.has('cidade'),
      temSegurado: indice.has('resp1_nome') || indice.has('resp1_cpf'),
      temSeguradora: indice.has('seguradora'),
    });
  }

  logger.info(
    { lote, arquivo: opcoes.arquivo, lidas, recusadas: recusas.length, simulacao: opcoes.simular },
    opcoes.simular ? 'Simulação de importação concluída' : 'Importação concluída',
  );

  return resultado;
}

/** O que a gravação APAGARIA: satélites de clientes existentes que o arquivo não traz. */
async function calcularImpacto(
  documentos: string[],
  _buffer: LinhaPreparada[],
  arquivoTraz: {
    temTelefone: boolean;
    temEmail: boolean;
    temEndereco: boolean;
    temSegurado: boolean;
    temSeguradora: boolean;
  },
): Promise<ImpactoImportacao> {
  const existentes = await repo.contarSatelitesPorDocumento(documentos);

  return {
    novos: documentos.length - existentes.comCadastro,
    existentes: existentes.comCadastro,
    perdem: {
      telefones: arquivoTraz.temTelefone ? 0 : existentes.comTelefone,
      emails: arquivoTraz.temEmail ? 0 : existentes.comEmail,
      enderecos: arquivoTraz.temEndereco ? 0 : existentes.comEndereco,
      segurados: arquivoTraz.temSegurado ? 0 : existentes.comSegurado,
      seguradoras: arquivoTraz.temSeguradora ? 0 : existentes.comSeguradora,
    },
  };
}

/** Quebra um texto de CSV em linhas, para a rota HTTP alimentar `importar`. */
export async function* linhasDeTexto(conteudo: string): AsyncGenerator<string> {
  for (const linha of conteudo.split(/\r?\n/)) {
    yield linha;
  }
}
