import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as veiculoRepo from '../repositories/apoliceVeiculo.repository.js';
import { pool } from '../database/pool.js';
import * as repo from '../repositories/cliente.repository.js';
import * as sinistroRepo from '../repositories/sinistro.repository.js';
import type { ClienteFichaLinha, ClienteListagemLinha, FiltroClientes } from '../repositories/cliente.repository.js';
import { AppError } from '../utils/AppError.js';
import { binarioParaUuid } from '../utils/uuid.js';

/**
 * Normaliza para `AAAA-MM-DD`. Coluna DATE chega string (`dateStrings`) e
 * DATETIME chega `Date`: tratar só um dos dois quebra a ficha.
 */
function dataIso(valor: string | Date | null): string | null {
  if (!valor) return null;

  if (typeof valor === 'string') {
    return valor.slice(0, 10);
  }

  // Sem `toISOString()`: em UTC, fuso negativo devolveria o dia anterior.
  const ano = valor.getFullYear();
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const dia = String(valor.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
}

/** Máscara de CPF/CNPJ na saída: a origem nem sempre o grava formatado. */
function formatarDocumento(numeros: string, jaFormatado: string | null): string {
  if (jaFormatado) return jaFormatado;

  if (numeros.length === 11) {
    return `${numeros.slice(0, 3)}.${numeros.slice(3, 6)}.${numeros.slice(6, 9)}-${numeros.slice(9)}`;
  }

  if (numeros.length === 14) {
    return `${numeros.slice(0, 2)}.${numeros.slice(2, 5)}.${numeros.slice(5, 8)}/${numeros.slice(8, 12)}-${numeros.slice(12)}`;
  }

  return numeros;
}

/** `41998765432` → `(41) 99876-5432`. Devolve como veio se não reconhecer. */
function formatarTelefone(valor: string | null): string | null {
  if (!valor) return null;

  const d = valor.replace(/\D/g, '');

  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;

  return valor;
}

function formatarCep(valor: string | null): string | null {
  if (!valor) return null;
  const d = valor.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : valor;
}

const ROTULO_TELEFONE: Record<repo.TipoTelefone, string> = {
  celular: 'Celular',
  whatsapp: 'WhatsApp',
  residencial: 'Fixo',
  comercial: 'Comercial',
  recado: 'Recado',
  opcional: 'Alternativo',
};

const ROTULO_EMAIL: Record<repo.TipoEmail, string> = {
  pessoal: 'Pessoal',
  comercial: 'Comercial',
  financeiro: 'Financeiro',
  outro: 'Outro',
};

const ROTULO_ENDERECO: Record<repo.TipoEndereco, string> = {
  principal: 'Principal',
  comercial: 'Comercial',
  cobranca: 'Cobrança',
};

export interface ClienteResumo {
  id: string;
  nome: string;
  tipoPessoa: 'Física' | 'Jurídica';
  cpfCnpj: string;
  email: string | null;
  celular: string | null;
  cidade: string | null;
  uf: string | null;
  seguradora: string | null;
  produtor: string | null;
  vip: boolean;
  situacao: string | null;
  situacaoChave: string | null;
  origem: string;
}

/** Forma reduzida da listagem: de propósito sem dado pessoal que a tabela não usa. */
function paraResumo(linha: ClienteListagemLinha): ClienteResumo {
  return {
    id: binarioParaUuid(linha.uuid),
    // O nome social, quando existe, substitui o civil.
    nome: linha.nome_social ?? linha.nome,
    tipoPessoa: linha.tipo_pessoa === 'J' ? 'Jurídica' : 'Física',
    cpfCnpj: formatarDocumento(linha.cpf_cnpj_numeros, linha.cpf_cnpj),
    email: linha.email,
    celular: formatarTelefone(linha.celular),
    cidade: linha.cidade,
    uf: linha.uf,
    seguradora: linha.seguradora,
    produtor: linha.produtor,
    vip: linha.vip === 1,
    situacao: linha.situacao,
    situacaoChave: linha.situacao_chave,
    origem: linha.origem_sistema,
  };
}

export interface TelefoneFicha {
  tipo: repo.TipoTelefone;
  rotulo: string;
  numero: string;
  observacao: string | null;
  principal: boolean;
}

export interface EmailFicha {
  tipo: repo.TipoEmail;
  rotulo: string;
  endereco: string;
  observacao: string | null;
  principal: boolean;
}

export interface EnderecoFicha {
  tipo: repo.TipoEndereco;
  rotulo: string;
  linha: string | null;
  /** Os campos soltos, para a edição abrir preenchida — `linha` é só leitura. */
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface SeguradoFicha {
  ordem: number;
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  celular: string | null;
  email: string | null;
}

export interface VinculoFicha {
  seguradora: string;
  ramo: string | null;
  modalidade: string | null;
}

export interface ApoliceFicha {
  id: string;
  numero: string;
  seguradora: string;
  produto: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  situacao: string;
  premioTotal: number | null;
  movimentos: number;
  /** `nome` significa vínculo por semelhança de nome — merece conferência. */
  vinculoOrigem: string | null;
  /** Tipo efetivo: o da apólice, senão o do produto. */
  tipoSeguro: string | null;
  formulario: string | null;
  veiculo: VeiculoFicha | null;
}

export interface VeiculoFicha {
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
  zeroKm: boolean | null;
  antifurto: string | null;
  kitGas: boolean | null;
  cepPernoite: string | null;
  pernoiteGaragem: boolean | null;
  condutorNome: string | null;
  condutorDocumento: string | null;
  condutorNascimento: string | null;
  observacoes: string | null;
  origem: 'importacao' | 'manual';
}

const simNao = (v: number | null): boolean | null => (v === null ? null : v === 1);

function paraVeiculoFicha(v: veiculoRepo.VeiculoLinha): VeiculoFicha {
  return {
    placa: v.placa,
    chassi: v.chassi,
    fabricante: v.fabricante,
    modelo: v.modelo,
    anoFabricacao: v.ano_fabricacao,
    anoModelo: v.ano_modelo,
    codigoFipe: v.codigo_fipe,
    combustivel: v.combustivel,
    tipoVeiculo: v.tipo_veiculo,
    uso: v.uso,
    zeroKm: simNao(v.zero_km),
    antifurto: v.antifurto,
    kitGas: simNao(v.kit_gas),
    cepPernoite: v.cep_pernoite,
    pernoiteGaragem: simNao(v.pernoite_garagem),
    condutorNome: v.condutor_nome,
    condutorDocumento: v.condutor_documento,
    condutorNascimento: dataIso(v.condutor_nascimento),
    observacoes: v.observacoes,
    origem: v.origem,
  };
}

/** Um acionamento — sinistro ou assistência. */
export interface SinistroFicha {
  numero: string;
  apolice: string;
  seguradora: string;
  tipo: 'sinistro' | 'assistencia';
  ramo: string | null;
  cobertura: string | null;
  causa: string | null;
  ocorridoEm: string | null;
  comunicadoEm: string | null;
  /** Status do movimento antes do processo (na Suhai o processo fica parado em "Em análise"). */
  status: string | null;
  reserva: number | null;
  veiculo: string | null;
  /** `nome`: a apólice é do período anterior e o vínculo veio pelo nome. */
  vinculoOrigem: 'apolice' | 'nome' | null;
}

/** Um cliente do mesmo grupo empresarial (matriz ou filial). */
export interface ClienteDoGrupoFicha {
  id: string;
  nome: string;
  cpfCnpj: string;
  situacao: string | null;
  apolices: number;
  apolicesEmVigor: number;
}

export interface ClienteCompleto extends ClienteResumo {
  tiposInteresse: string[];
  /** Grupo de cliente (Corretora, Seguradora…) — não é o `grupo` empresarial. */
  grupoCliente: { chave: string; nome: string };
  nomeCivil: string;
  nomeSocial: string | null;
  profissao: string | null;
  sexo: 'M' | 'F' | null;
  estadoCivil: string | null;
  dataNascimento: string | null;
  autorizaContato: boolean;

  telefones: TelefoneFicha[];
  emails: EmailFicha[];
  enderecos: EnderecoFicha[];
  segurados: SeguradoFicha[];
  seguradoras: VinculoFicha[];
  apolices: ApoliceFicha[];
  sinistros: SinistroFicha[];
  /** Empresa: `matriz` quando é filial; `filiais` quando é a matriz. */
  grupo: { matriz: ClienteDoGrupoFicha | null; filiais: ClienteDoGrupoFicha[] };
  /** Pessoas de contato da empresa. Vazio em pessoa física. */
  responsaveis: { nome: string; cargo: string | null; telefone: string | null; email: string | null }[];

  estruturaVendas: string | null;
  estruturaCodigo: string | null;
  origemCliente: string | null;
  renda: string | null;
  faturamentoAnual: number | null;

  clienteDesde: string | null;
  ultimaAlteracaoNaOrigem: string | null;
  importadoEm: string | null;
  origemArquivo: string | null;

  /** Distingue "não tem" de "ainda não foi importado" (as duas seriam lista vazia). */
  disponibilidade: {
    apolices: boolean;
    sinistros: boolean;
    historico: boolean;
  };
}

function montarLinhaEndereco(e: repo.EnderecoLinha): string | null {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const partes = [rua || null, e.complemento].filter(Boolean);
  return partes.length > 0 ? partes.join(' — ') : null;
}

export async function listar(filtro: FiltroClientes): Promise<{
  total: number;
  pagina: number;
  limite: number;
  paginas: number;
  clientes: ClienteResumo[];
}> {
  const { total, linhas } = await repo.listar(filtro);

  return {
    total,
    pagina: filtro.pagina,
    limite: filtro.limite,
    paginas: Math.max(Math.ceil(total / filtro.limite), 1),
    clientes: linhas.map(paraResumo),
  };
}

/** O cliente está dentro deste recorte? Usa a mesma busca da ficha. */
export async function estaNoEscopo(uuid: string, escopo: Escopo): Promise<boolean> {
  return (await repo.buscarPorUuid(uuid, escopo)) !== null;
}

export async function detalhar(uuid: string, escopo?: Escopo): Promise<ClienteCompleto> {
  const linha: ClienteFichaLinha | null = await repo.buscarPorUuid(uuid, escopo);

  if (!linha) {
    throw AppError.notFound('Cliente não encontrado.');
  }

  const [satelites, apolicesDoCliente, sinistrosDoCliente, sinistrosCobertos, grupo, responsaveis] =
    await Promise.all([
      repo.carregarSatelites(linha.id),
      apoliceRepo.listarDoCliente(linha.id),
      sinistroRepo.listarDoCliente(linha.id),
      sinistroRepo.haCoberturaParaCliente(linha.id),
      repo.grupoEmpresarial(linha.id, escopo),
      repo.listarResponsaveis(linha.id),
    ]);

  const [veiculos, tiposInteresse] = await Promise.all([
    veiculoRepo.porApolices(apolicesDoCliente.map((a) => Number(a.id))),
    repo.tiposDeInteresse(linha.id),
  ]);

  const doGrupo = (g: repo.ClienteDoGrupo): ClienteDoGrupoFicha => ({
    id: binarioParaUuid(g.uuid),
    nome: g.nome,
    cpfCnpj: formatarDocumento(g.cpf_cnpj_numeros, null),
    situacao: g.situacao,
    apolices: g.apolices,
    apolicesEmVigor: g.apolices_em_vigor,
  });

  const telefones: TelefoneFicha[] = satelites.telefones.map((t) => ({
    tipo: t.tipo,
    rotulo: ROTULO_TELEFONE[t.tipo],
    numero: formatarTelefone(t.completo) ?? t.completo,
    observacao: t.observacao,
    principal: t.principal === 1,
  }));

  const emails: EmailFicha[] = satelites.emails.map((e) => ({
    tipo: e.tipo,
    rotulo: ROTULO_EMAIL[e.tipo],
    endereco: e.endereco,
    observacao: e.observacao,
    principal: e.principal === 1,
  }));

  const enderecos: EnderecoFicha[] = satelites.enderecos.map((e) => ({
    tipo: e.tipo,
    rotulo: ROTULO_ENDERECO[e.tipo],
    linha: montarLinhaEndereco(e),
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
    cep: formatarCep(e.cep),
  }));

  const principalEndereco = enderecos.find((e) => e.tipo === 'principal') ?? enderecos[0] ?? null;
  // O PRINCIPAL de cada lista, de qualquer tipo — a mesma escolha da listagem.
  const celular = telefones.find((t) => t.principal) ?? telefones[0] ?? null;
  const emailPessoal = emails.find((e) => e.principal) ?? emails[0] ?? null;
  const primeiroVinculo = satelites.vinculos[0] ?? null;

  return {
    id: binarioParaUuid(linha.uuid),
    nome: linha.nome_social ?? linha.nome,
    tipoPessoa: linha.tipo_pessoa === 'J' ? 'Jurídica' : 'Física',
    cpfCnpj: formatarDocumento(linha.cpf_cnpj_numeros, linha.cpf_cnpj),

    // Repetem o "principal" de cada satélite, como na listagem.
    email: emailPessoal?.endereco ?? null,
    celular: celular?.numero ?? null,
    cidade: principalEndereco?.cidade ?? null,
    uf: principalEndereco?.uf ?? null,
    seguradora: primeiroVinculo?.seguradora ?? null,
    produtor: linha.produtor,
    vip: linha.vip === 1,
    situacao: linha.situacao,
    situacaoChave: linha.situacao_chave,
    origem: linha.origem_sistema,
    grupoCliente: {
      chave: linha.grupo_cliente_chave,
      nome: linha.grupo_cliente ?? linha.grupo_cliente_chave,
    },

    nomeCivil: linha.nome,
    nomeSocial: linha.nome_social,
    profissao: linha.profissao,
    sexo: linha.sexo,
    estadoCivil: linha.estado_civil,
    dataNascimento: dataIso(linha.data_nascimento),
    autorizaContato: linha.autoriza_contato === 1,

    telefones,
    emails,
    enderecos,
    segurados: satelites.segurados.map((s) => ({
      ordem: s.ordem,
      nome: s.nome,
      cpf: s.cpf,
      rg: s.rg,
      endereco: [s.logradouro, s.bairro].filter(Boolean).join(' — ') || null,
      cidade: s.cidade,
      uf: s.uf,
      telefone: formatarTelefone(s.telefone),
      celular: formatarTelefone(s.celular),
      email: s.email,
    })),
    seguradoras: satelites.vinculos.map((v) => ({
      seguradora: v.seguradora,
      ramo: v.ramo,
      modalidade: v.modalidade,
    })),

    estruturaVendas: linha.estrutura_nome,
    estruturaCodigo: linha.estrutura_codigo,
    origemCliente: linha.origem_cliente,
    renda: linha.faixa_renda,
    faturamentoAnual: linha.faturamento_anual === null ? null : Number(linha.faturamento_anual),

    clienteDesde: dataIso(linha.cliente_desde),
    ultimaAlteracaoNaOrigem: dataIso(linha.ultima_alteracao),
    importadoEm:
      linha.importado_em instanceof Date
        ? linha.importado_em.toISOString()
        : (linha.importado_em ?? null),
    origemArquivo: linha.origem_arquivo,

    apolices: apolicesDoCliente.map((a) => {
      const inicio = dataIso(a.vigencia_inicio);
      const fim = dataIso(a.vigencia_fim);
      const hoje = new Date().toISOString().slice(0, 10);

      return {
        id: binarioParaUuid(a.uuid),
        numero: a.numero,
        seguradora: a.seguradora,
        produto: a.produto,
        vigenciaInicio: inicio,
        vigenciaFim: fim,
        // Sem fim de vigência é `indefinida`, não "vencida" — senão some das renovações.
        situacao: !fim
          ? 'indefinida'
          : fim < hoje
            ? 'vencida'
            : inicio && inicio > hoje
              ? 'a_vencer'
              : 'vigente',
        premioTotal: a.premio_total === null ? null : Number(a.premio_total),
        movimentos: Number(a.movimentos),
        vinculoOrigem: a.vinculo_origem,
        numeroProvisorio: a.numero_provisorio === 1,
        tipoSeguro: a.tipo_seguro,
        formulario: a.formulario,
        veiculo: veiculos.has(Number(a.id)) ? paraVeiculoFicha(veiculos.get(Number(a.id))!) : null,
      };
    }),

    grupo: {
      matriz: grupo.matriz ? doGrupo(grupo.matriz) : null,
      filiais: grupo.filiais.map(doGrupo),
    },

    tiposInteresse,

    responsaveis: responsaveis.map((r) => ({
      nome: r.nome,
      cargo: r.cargo,
      telefone: formatarTelefone(r.telefone),
      email: r.email,
    })),

    sinistros: sinistrosDoCliente.map((s) => ({
      numero: s.numero,
      apolice: s.numero_apolice,
      seguradora: s.seguradora,
      tipo: s.tipo,
      ramo: s.ramo,
      cobertura: s.cobertura,
      causa: s.causa,
      ocorridoEm: s.ocorrido_em,
      comunicadoEm: s.comunicado_em,
      status: s.status_movimento ?? s.status_processo,
      reserva: s.reserva === null ? null : Number(s.reserva),
      veiculo: s.veiculo,
      vinculoOrigem: s.vinculo_origem,
    })),

    disponibilidade: {
      apolices: apolicesDoCliente.length > 0,
      // Com relatório de sinistros da companhia, lista vazia quer dizer "não acionou".
      sinistros: sinistrosCobertos || sinistrosDoCliente.length > 0,
      historico: false,
    },
  };
}

export async function opcoesDeFiltro(): Promise<{
  ufs: string[];
  seguradoras: { nome: string; ativa: boolean }[];
  produtores: string[];
  situacoes: repo.SituacaoCliente[];
}> {
  return repo.opcoesDeFiltro();
}

import type { CriarClienteInput } from '../schemas/clientes.schema.js';
import { limparDocumento, formatarDocumento as mascarar } from '../utils/documento.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import { type Escopo } from '../utils/escopo.js';

export interface ResultadoCriacao {
  id: string;
  nome: string;
  cpfCnpj: string;
  situacao: string | null;
}

/**
 * Cadastra um cliente pela tela. Duplicata é conferida antes, para a mensagem
 * dizer de quem é o cadastro; `produtorId` (já resolvido) vence o `produtor` digitado.
 */
export async function criar(
  dados: CriarClienteInput,
  opcoes: { produtorId?: number } = {},
): Promise<ResultadoCriacao> {
  const documento = limparDocumento(dados.cpfCnpj);

  const existente = await repo.buscarPorDocumento(documento);

  if (existente) {
    throw AppError.conflict(
      `Este CPF/CNPJ já está cadastrado para ${existente.nome}.`,
    );
  }

  const situacoes = await repo.listarSituacoes();
  const situacao =
    situacoes.find((s) => s.chave === dados.situacao) ??
    situacoes.find((s) => s.chave === 'prospecto') ??
    null;

  const [estadoCivilId, profissaoId, produtorId, origemClienteId] = await Promise.all([
    dados.estadoCivil ? repo.resolverDimensao('estados_civis', dados.estadoCivil) : null,
    dados.profissao ? repo.resolverDimensao('profissoes', dados.profissao) : null,
    opcoes.produtorId ?? (dados.produtor ? repo.resolverDimensao('produtores', dados.produtor) : null),
    dados.origemCliente ? repo.resolverDimensao('origens_clientes', dados.origemCliente) : null,
  ]);

  const clienteId = await repo.criarManual({
    cpfCnpj: mascarar(documento),
    cpfCnpjNumeros: documento,
    tipoPessoa: documento.length === 14 ? 'J' : 'F',
    nome: dados.nome,
    nomeSocial: dados.nomeSocial ?? null,
    situacaoId: situacao?.id ?? null,
    dataNascimento: dados.dataNascimento ?? null,
    sexo: dados.sexo ?? null,
    estadoCivilId,
    profissaoId,
    produtorId,
    origemClienteId,
    autorizaContato: dados.autorizaContato,
    vip: dados.vip,
  });

  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    if (dados.telefones?.length) {
      await repo.substituirTelefones(
        clienteId,
        dados.telefones.map((t) => ({ ...t, observacao: t.observacao || null })),
        conexao,
      );
    }
    if (dados.emails?.length) {
      await repo.substituirEmails(
        clienteId,
        dados.emails.map((e) => ({ ...e, observacao: e.observacao || null })),
        conexao,
      );
    }

    const temEndereco =
      dados.logradouro || dados.cep || dados.bairro || (dados.cidade && dados.uf);

    if (temEndereco) {
      const municipioId =
        dados.cidade && dados.uf ? await repo.resolverMunicipio(dados.cidade, dados.uf, conexao) : null;

      await repo.inserirEnderecos(
        [
          {
            clienteId,
            tipo: 'principal',
            logradouro: dados.logradouro ?? null,
            numero: dados.numero ?? null,
            complemento: dados.complemento ?? null,
            bairro: dados.bairro ?? null,
            municipioId,
            cep: (dados.cep ?? '').replace(/\D/g, '').slice(0, 8) || null,
          },
        ],
        conexao,
      );
    }

    if (dados.responsaveis && dados.responsaveis.length > 0) {
      await repo.substituirResponsaveis(
        clienteId,
        dados.responsaveis.map((r) => ({
          nome: r.nome,
          cargo: r.cargo || null,
          telefone: r.telefone || null,
          email: r.email || null,
        })),
        conexao,
      );
    }

    // Companhia inativa ou inexistente: o vínculo não nasce, mas o cadastro segue.
    if (dados.seguradora) {
      const seguradoraId = await seguradoraRepo.idAtivaPorNome(dados.seguradora);

      if (seguradoraId) {
        await repo.inserirVinculosSeguradora(
          [{ clienteId, seguradoraId, ramoId: null, modalidadeId: null }],
          conexao,
        );
      }
    }

    if (dados.tiposSeguro?.length) {
      await repo.acrescentarTiposDeInteresse(clienteId, dados.tiposSeguro, conexao);
    }

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }

  const uuid = await repo.uuidPorId(clienteId);

  return {
    id: uuid ? binarioParaUuid(uuid) : '',
    nome: dados.nome,
    cpfCnpj: mascarar(documento),
    situacao: situacao?.nome ?? null,
  };
}

export type DocumentoCadastrado =
  | { existe: false }
  /** `id` nulo: o cadastro é de outra carteira — a tela avisa sem abrir a ficha. */
  | { existe: true; nome: string; id: string | null };

/**
 * O CPF/CNPJ já tem cadastro? O nome sai mesmo fora da carteira (como no 409
 * do `criar`); o `id`, só dentro do recorte de consulta.
 */
export async function verificarDocumento(documento: string, escopo: Escopo): Promise<DocumentoCadastrado> {
  const existente = await repo.buscarPorDocumento(limparDocumento(documento));
  if (!existente) return { existe: false };
  const id = binarioParaUuid(existente.uuid);
  return { existe: true, nome: existente.nome, id: (await estaNoEscopo(id, escopo)) ? id : null };
}
