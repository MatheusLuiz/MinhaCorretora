import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { cnpjDaMatriz, formatarDocumento } from '../utils/documento.js';
import { emailEmCaixaAlta, nomeEmCaixaAlta } from '../utils/texto.js';
import { uuidParaBinario } from '../utils/uuid.js';
import { condicaoDeCarteira, type Escopo } from '../utils/escopo.js';
import { condicaoEmVigor } from '../utils/vigencia.js';

export type OrigemSistema = 'seguradora' | 'manual';
/** `residencial` é o que a tela chama de FIXO. */
export type TipoTelefone = 'celular' | 'residencial' | 'comercial' | 'opcional' | 'whatsapp' | 'recado';
export type TipoEmail = 'pessoal' | 'comercial' | 'financeiro' | 'outro';
export type TipoEndereco = 'principal' | 'comercial' | 'cobranca';

/** Mapa fechado: o nome da tabela é constante no código, nunca dado de entrada. */
const DIMENSOES = {
  seguradoras: { tabela: 'seguradoras', coluna: 'nome' },
  ramos: { tabela: 'ramos', coluna: 'nome' },
  produtores: { tabela: 'produtores', coluna: 'nome' },
  origens_clientes: { tabela: 'origens_clientes', coluna: 'nome' },
  profissoes: { tabela: 'profissoes', coluna: 'nome' },
  faixas_renda: { tabela: 'faixas_renda', coluna: 'descricao' },
  estados_civis: { tabela: 'estados_civis', coluna: 'nome' },
} as const;

export type NomeDimensao = keyof typeof DIMENSOES;

/** Seguradora por nome, guardando o código da origem (estável se a companhia for renomeada). */
export async function resolverSeguradora(
  nome: string,
  codigoOrigem: string | null,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO seguradoras (nome, codigo_origem) VALUES (?, ?) AS novo
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(seguradoras.id),
       codigo_origem = COALESCE(seguradoras.codigo_origem, novo.codigo_origem)`,
    [nome, codigoOrigem],
  );

  return resultado.insertId;
}

/** `LAST_INSERT_ID(id)` no ON DUPLICATE evita a corrida entre SELECT e INSERT. */
export async function resolverDimensao(
  dimensao: NomeDimensao,
  valor: string,
  conexao?: PoolConnection,
): Promise<number> {
  const { tabela, coluna } = DIMENSOES[dimensao];
  const executor = conexao ?? pool;

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO \`${tabela}\` (\`${coluna}\`) VALUES (?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [valor],
  );

  return resultado.insertId;
}

/** Modalidade é resolvida com o ramo junto — "Residencial" existe dentro de um ramo. */
export async function resolverModalidade(
  nome: string,
  ramoId: number | null,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO modalidades (ramo_id, nome) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [ramoId, nome],
  );

  return resultado.insertId;
}

export async function resolverEstrutura(
  codigo: string | null,
  nome: string,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO estruturas_venda (codigo, nome) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [codigo, nome],
  );

  return resultado.insertId;
}

export async function resolverMunicipio(
  nome: string,
  uf: string,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  // A chave (nome, uf) ignora caixa; o UPDATE do nome normaliza a linha antiga para caixa alta.
  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO municipios (nome, uf) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), nome = VALUES(nome)`,
    [nomeEmCaixaAlta(nome.trim()), uf.trim().toUpperCase()],
  );

  return resultado.insertId;
}

export interface ClienteImportado {
  origemSistema: OrigemSistema;
  origemArquivo: string | null;
  origemLote: string;

  cpfCnpj: string | null;
  cpfCnpjNumeros: string;
  tipoPessoa: 'F' | 'J';

  nome: string;
  nomeSocial: string | null;
  profissaoId: number | null;
  estadoCivilId: number | null;
  sexo: 'M' | 'F' | null;
  dataNascimento: string | null;

  vip: boolean;
  autorizaContato: boolean;

  situacaoId: number | null;
  situacaoEm: string | null;
  saidaEm: string | null;

  produtorId: number | null;
  estruturaVendaId: number | null;
  origemClienteId: number | null;
  faixaRendaId: number | null;
  faturamentoAnual: string | null;

  clienteDesde: string | null;
  ultimaAlteracao: string | null;
}

const COLUNAS_CLIENTE = [
  'origem_sistema', 'origem_arquivo', 'origem_lote', 'importado_em',
  'cpf_cnpj', 'cpf_cnpj_numeros', 'tipo_pessoa',
  'nome', 'nome_social', 'profissao_id', 'estado_civil_id', 'sexo', 'data_nascimento',
  'vip', 'autoriza_contato',
  'situacao_id', 'situacao_em', 'saida_em',
  'produtor_id', 'estrutura_venda_id', 'origem_cliente_id',
  'faixa_renda_id', 'faturamento_anual',
  'cliente_desde', 'ultima_alteracao',
] as const;

/** Grava um lote de clientes (ESPELHA); `uuid` e `criado_em` ficam fora do UPDATE. */
export async function inserirClientes(
  clientes: ClienteImportado[],
  conexao?: PoolConnection,
): Promise<number> {
  if (clientes.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();

  const valores: unknown[] = [];
  for (const c of clientes) {
    valores.push(
      c.origemSistema, c.origemArquivo, c.origemLote, agora,
      c.cpfCnpj, c.cpfCnpjNumeros, c.tipoPessoa,
      nomeEmCaixaAlta(c.nome), nomeEmCaixaAlta(c.nomeSocial),
      c.profissaoId, c.estadoCivilId, c.sexo, c.dataNascimento,
      c.vip ? 1 : 0, c.autorizaContato ? 1 : 0,
      c.situacaoId, c.situacaoEm, c.saidaEm,
      c.produtorId, c.estruturaVendaId, c.origemClienteId,
      c.faixaRendaId, c.faturamentoAnual,
      c.clienteDesde, c.ultimaAlteracao,
    );
  }

  const tupla = `(${COLUNAS_CLIENTE.map(() => '?').join(', ')})`;
  // `origem_lote` FORA do UPDATE: senão desfazer a carga nova apagaria clientes antigos.
  const atualizaveis = COLUNAS_CLIENTE.filter((c) => c !== 'cpf_cnpj_numeros' && c !== 'origem_lote')
    .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(', ');

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO clientes (${COLUNAS_CLIENTE.map((c) => `\`${c}\``).join(', ')})
     VALUES ${clientes.map(() => tupla).join(', ')}
     ON DUPLICATE KEY UPDATE ${atualizaveis}`,
    valores,
  );

  return resultado.affectedRows;
}

/** Mapa documento → id interno, para ligar os satélites aos clientes. */
export async function mapearIdsPorDocumento(
  documentos: string[],
  conexao?: PoolConnection,
): Promise<Map<string, number>> {
  if (documentos.length === 0) return new Map();

  const executor = conexao ?? pool;

  const [linhas] = await executor.query<RowDataPacket[]>(
    'SELECT id, cpf_cnpj_numeros FROM clientes WHERE cpf_cnpj_numeros IN (?)',
    [documentos],
  );

  return new Map(linhas.map((l) => [String(l.cpf_cnpj_numeros), Number(l.id)]));
}

/** Apaga os satélites dos clientes do lote (a reimportação espelha a origem); nada referencia estas linhas. */
export async function limparSatelites(
  clienteIds: number[],
  conexao: PoolConnection,
): Promise<void> {
  if (clienteIds.length === 0) return;

  for (const tabela of ['telefones', 'emails', 'enderecos', 'segurados', 'seguradoras_clientes']) {
    await conexao.query(`DELETE FROM \`${tabela}\` WHERE cliente_id IN (?)`, [clienteIds]);
  }
}

export interface TelefoneImportado {
  clienteId: number;
  tipo: TipoTelefone;
  ddd: string | null;
  numero: string;
  completo: string;
  principal: boolean;
}

export async function inserirTelefones(
  telefones: TelefoneImportado[],
  conexao: PoolConnection,
): Promise<number> {
  const novos = soOsTiposNovos(
    telefones,
    await tiposGravados('telefones', telefones, conexao),
  );
  if (novos.length === 0) return 0;

  const valores: unknown[] = [];
  for (const t of novos) {
    valores.push(t.clienteId, t.tipo, t.ddd, t.numero, t.completo, t.principal ? 1 : 0);
  }

  // Importação ACRESCENTA: um contato por tipo, só se o cliente ainda não tem um daquele tipo.
  // O ON DUPLICATE evita ER_DUP_ENTRY quando o mesmo número já existe com outro tipo.
  const [resultado] = await conexao.query<ResultSetHeader>(
    `INSERT INTO telefones (cliente_id, tipo, ddd, numero, completo, principal)
     VALUES ${novos.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE completo = telefones.completo`,
    valores,
  );

  return resultado.affectedRows;
}

export interface EmailImportado {
  clienteId: number;
  tipo: TipoEmail;
  endereco: string;
  principal: boolean;
}

export async function inserirEmails(
  emails: EmailImportado[],
  conexao: PoolConnection,
): Promise<number> {
  const novos = soOsTiposNovos(emails, await tiposGravados('emails', emails, conexao));
  if (novos.length === 0) return 0;

  const valores: unknown[] = [];
  for (const e of novos) {
    valores.push(e.clienteId, e.tipo, emailEmCaixaAlta(e.endereco), e.principal ? 1 : 0);
  }

  // Mesma regra dos telefones: um por tipo, sem estourar nem sobrescrever.
  const [resultado] = await conexao.query<ResultSetHeader>(
    `INSERT INTO emails (cliente_id, tipo, endereco, principal)
     VALUES ${novos.map(() => '(?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE endereco = emails.endereco`,
    valores,
  );

  return resultado.affectedRows;
}

/** `cliente|tipo` de quem, entre estes clientes, já tem contato de cada tipo. */
async function tiposGravados(
  tabela: 'telefones' | 'emails',
  itens: { clienteId: number }[],
  conexao: PoolConnection,
): Promise<Set<string>> {
  const ids = [...new Set(itens.map((i) => i.clienteId))];
  if (ids.length === 0) return new Set();

  // Duas consultas por extenso: nenhum pedaço de SQL entra por parâmetro.
  const [linhas] = await conexao.query<RowDataPacket[]>(
    tabela === 'telefones'
      ? 'SELECT DISTINCT cliente_id, tipo FROM telefones WHERE cliente_id IN (?)'
      : 'SELECT DISTINCT cliente_id, tipo FROM emails WHERE cliente_id IN (?)',
    [ids],
  );

  return new Set(linhas.map((l) => `${Number(l.cliente_id)}|${String(l.tipo)}`));
}

/** O primeiro de cada (cliente, tipo) que ainda não está gravado. */
function soOsTiposNovos<T extends { clienteId: number; tipo: string }>(
  itens: T[],
  gravados: Set<string>,
): T[] {
  const vistos = new Set(gravados);
  return itens.filter((i) => {
    const chave = `${i.clienteId}|${i.tipo}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

export interface EnderecoImportado {
  clienteId: number;
  tipo: TipoEndereco;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipioId: number | null;
  cep: string | null;
}

export async function inserirEnderecos(
  enderecos: EnderecoImportado[],
  conexao: PoolConnection,
): Promise<number> {
  if (enderecos.length === 0) return 0;

  const valores: unknown[] = [];
  for (const e of enderecos) {
    valores.push(
      e.clienteId, e.tipo, e.logradouro, e.numero,
      e.complemento, e.bairro, e.municipioId, e.cep,
    );
  }

  const [resultado] = await conexao.query<ResultSetHeader>(
    `INSERT INTO enderecos (cliente_id, tipo, logradouro, numero, complemento, bairro, municipio_id, cep)
     VALUES ${enderecos.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    valores,
  );

  return resultado.affectedRows;
}

/** Grava o endereço só onde o cliente ainda não tem um desse tipo; o existente fica inteiro. */
export async function inserirEnderecosSeAusente(
  enderecos: EnderecoImportado[],
  conexao: PoolConnection,
): Promise<number> {
  if (enderecos.length === 0) return 0;

  const valores: unknown[] = [];
  for (const e of enderecos) {
    valores.push(
      e.clienteId, e.tipo, e.logradouro, e.numero,
      e.complemento, e.bairro, e.municipioId, e.cep,
    );
  }

  const [resultado] = await conexao.query<ResultSetHeader>(
    `INSERT INTO enderecos (cliente_id, tipo, logradouro, numero, complemento, bairro, municipio_id, cep)
     VALUES ${enderecos.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE cliente_id = cliente_id`,
    valores,
  );

  return resultado.affectedRows;
}

export interface SeguradoImportado {
  clienteId: number;
  ordem: number;
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  logradouro: string | null;
  bairro: string | null;
  municipioId: number | null;
  cep: string | null;
  telefone: string | null;
  celular: string | null;
  email: string | null;
}

export async function inserirSegurados(
  segurados: SeguradoImportado[],
  conexao: PoolConnection,
): Promise<number> {
  if (segurados.length === 0) return 0;

  const valores: unknown[] = [];
  for (const s of segurados) {
    valores.push(
      s.clienteId, s.ordem, nomeEmCaixaAlta(s.nome), s.cpf, s.rg,
      s.logradouro, s.bairro, s.municipioId, s.cep,
      s.telefone, s.celular, emailEmCaixaAlta(s.email),
    );
  }

  const [resultado] = await conexao.query<ResultSetHeader>(
    `INSERT INTO segurados
       (cliente_id, ordem, nome, cpf, rg, logradouro, bairro, municipio_id, cep, telefone, celular, email)
     VALUES ${segurados.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    valores,
  );

  return resultado.affectedRows;
}

export interface VinculoSeguradora {
  clienteId: number;
  seguradoraId: number;
  ramoId: number | null;
  modalidadeId: number | null;
}

/** O cliente já tem algum vínculo com a seguradora, de qualquer ramo? */
export async function temVinculoComSeguradora(
  clienteId: number,
  seguradoraId: number,
  conexao?: PoolConnection,
): Promise<boolean> {
  const [linhas] = await (conexao ?? pool).execute<RowDataPacket[]>(
    'SELECT 1 FROM seguradoras_clientes WHERE cliente_id = ? AND seguradora_id = ? LIMIT 1',
    [clienteId, seguradoraId],
  );
  return linhas.length > 0;
}

export async function inserirVinculosSeguradora(
  vinculos: VinculoSeguradora[],
  conexao: PoolConnection,
): Promise<number> {
  if (vinculos.length === 0) return 0;

  // `NOT EXISTS` com `<=>`, e não ON DUPLICATE: `uq_seg_cli` tem colunas anuláveis, e NULLs
  // não colidem no índice único — cada carga reinseriria os vínculos.
  let inseridos = 0;

  for (const v of vinculos) {
    const [r] = await conexao.execute<ResultSetHeader>(
      `INSERT INTO seguradoras_clientes (cliente_id, seguradora_id, ramo_id, modalidade_id)
       SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM seguradoras_clientes sc
           WHERE sc.cliente_id = ?
             AND sc.seguradora_id = ?
             AND sc.ramo_id <=> ?
             AND sc.modalidade_id <=> ?
        )`,
      [
        v.clienteId, v.seguradoraId, v.ramoId, v.modalidadeId,
        v.clienteId, v.seguradoraId, v.ramoId, v.modalidadeId,
      ],
    );

    inseridos += r.affectedRows;
  }

  return inseridos;
}

export interface NovaImportacao {
  lote: string;
  origemSistema: OrigemSistema;
  arquivo: string | null;
  entidade?: string;
}

export async function abrirImportacao(dados: NovaImportacao): Promise<number> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `INSERT INTO importacoes (lote, origem_sistema, arquivo, entidade)
     VALUES (?, ?, ?, ?)`,
    [dados.lote, dados.origemSistema, dados.arquivo, dados.entidade ?? 'clientes'],
  );

  return resultado.insertId;
}

export interface FechamentoImportacao {
  lidas: number;
  inseridas: number;
  atualizadas: number;
  recusadas: number;
  detalhes?: Record<string, unknown> | null;
}

export async function fecharImportacao(
  id: number,
  resumo: FechamentoImportacao,
): Promise<void> {
  await pool.execute(
    `UPDATE importacoes
        SET linhas_lidas       = ?,
            linhas_inseridas   = ?,
            linhas_atualizadas = ?,
            linhas_recusadas   = ?,
            detalhes           = ?,
            concluido_em       = NOW(3)
      WHERE id = ?`,
    [
      resumo.lidas,
      resumo.inseridas,
      resumo.atualizadas,
      resumo.recusadas,
      resumo.detalhes ? JSON.stringify(resumo.detalhes) : null,
      id,
    ],
  );
}

export interface ClienteListagemLinha extends RowDataPacket {
  id: number;
  uuid: Buffer;
  origem_sistema: string;
  cpf_cnpj: string | null;
  cpf_cnpj_numeros: string;
  tipo_pessoa: 'F' | 'J';
  nome: string;
  nome_social: string | null;
  vip: number;
  situacao: string | null;
  situacao_chave: string | null;
  email: string | null;
  celular: string | null;
  cidade: string | null;
  uf: string | null;
  seguradora: string | null;
  produtor: string | null;
}

export interface FiltroClientes {
  busca?: string;
  situacao?: string;
  uf?: string;
  seguradora?: string;
  produtor?: string;
  origemSistema?: OrigemSistema;
  pagina: number;
  limite: number;

  /** Recorte de carteira. Ausente = base inteira (só scripts de linha de comando). */
  escopo?: Escopo;
}

/** Monta o WHERE só com condições fixas; todo valor vai por `?`. */
function montarFiltro(filtro: FiltroClientes): { sql: string; valores: unknown[] } {
  const condicoes: string[] = [];
  const valores: unknown[] = [];

  const busca = filtro.busca?.trim();

  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    const soPontuacao = busca.replace(/[.\-/\s]/g, '');

    // Termo que parece documento vai para a coluna normalizada.
    if (digitos.length >= 3 && digitos.length === soPontuacao.length) {
      condicoes.push('(cpf_cnpj_numeros LIKE ? OR nome LIKE ?)');
      valores.push(`${digitos}%`, `%${busca}%`);
    } else {
      condicoes.push('(nome LIKE ? OR nome_social LIKE ? OR email LIKE ?)');
      valores.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
    }
  }

  if (filtro.situacao) {
    condicoes.push('situacao_chave = ?');
    valores.push(filtro.situacao);
  }

  if (filtro.uf) {
    condicoes.push('uf = ?');
    valores.push(filtro.uf);
  }

  if (filtro.seguradora) {
    condicoes.push('seguradora = ?');
    valores.push(filtro.seguradora);
  }

  if (filtro.produtor) {
    condicoes.push('produtor = ?');
    valores.push(filtro.produtor);
  }

  if (filtro.origemSistema) {
    condicoes.push('origem_sistema = ?');
    valores.push(filtro.origemSistema);
  }

  // A carteira entra sempre: o usuário não a tira.
  const carteira = condicaoDeCarteira(filtro.escopo, 'produtor_id');

  if (carteira.condicao) {
    condicoes.push(carteira.condicao);
    valores.push(...carteira.valores);
  }

  return { sql: condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '', valores };
}

export async function listar(
  filtro: FiltroClientes,
): Promise<{ total: number; linhas: ClienteListagemLinha[] }> {
  const { sql: where, valores } = montarFiltro(filtro);

  const [contagem] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM vw_clientes_listagem ${where}`,
    valores,
  );

  const total = Number(contagem[0]?.total ?? 0);

  // LIMIT/OFFSET interpolados (o mysql2 manda LIMIT como string); são inteiros com clamp.
  const limite = Math.min(Math.max(Math.trunc(filtro.limite), 1), 200);
  const offset = Math.max(Math.trunc((filtro.pagina - 1) * limite), 0);

  const [linhas] = await pool.query<ClienteListagemLinha[]>(
    `SELECT * FROM vw_clientes_listagem
     ${where}
     ORDER BY nome
     LIMIT ${limite} OFFSET ${offset}`,
    valores,
  );

  return { total, linhas };
}

export interface ClienteFichaLinha extends RowDataPacket {
  id: number;
  uuid: Buffer;
  origem_sistema: string;
  origem_arquivo: string | null;
  importado_em: Date | null;
  cpf_cnpj: string | null;
  cpf_cnpj_numeros: string;
  tipo_pessoa: 'F' | 'J';
  nome: string;
  nome_social: string | null;
  profissao: string | null;
  estado_civil: string | null;
  sexo: 'M' | 'F' | null;
  // DATE chega como string 'AAAA-MM-DD' (dateStrings no pool).
  data_nascimento: string | null;
  vip: number;
  autoriza_contato: number;
  situacao: string | null;
  situacao_chave: string | null;
  /** Grupo de cliente: a chave e o nome cadastrado. */
  grupo_cliente_chave: string;
  grupo_cliente: string | null;
  produtor: string | null;
  estrutura_codigo: string | null;
  estrutura_nome: string | null;
  origem_cliente: string | null;
  faixa_renda: string | null;
  faturamento_anual: string | null;
  cliente_desde: string | null;
  ultima_alteracao: string | null;
}

/** Ficha de um cliente; fora da carteira devolve `null` (404, não 403: não confirma que existe). */
export async function buscarPorUuid(
  uuid: string,
  escopo?: Escopo,
): Promise<ClienteFichaLinha | null> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');

  const [linhas] = await pool.execute<ClienteFichaLinha[]>(
    `SELECT c.id, c.uuid, c.origem_sistema, c.origem_arquivo, c.importado_em,
            c.cpf_cnpj, c.cpf_cnpj_numeros, c.tipo_pessoa,
            c.nome, c.nome_social, c.sexo, c.data_nascimento,
            c.vip, c.autoriza_contato,
            c.faturamento_anual, c.cliente_desde, c.ultima_alteracao,
            pr.nome     AS profissao,
            ec.nome     AS estado_civil,
            p.nome      AS produtor,
            ev.codigo   AS estrutura_codigo,
            ev.nome     AS estrutura_nome,
            oc.nome     AS origem_cliente,
            fr.descricao AS faixa_renda,
            sit.nome  AS situacao,
            sit.chave AS situacao_chave,
            c.carteira_comercial AS grupo_cliente_chave,
            gc.nome   AS grupo_cliente
       FROM clientes c
       LEFT JOIN grupos_cliente   gc ON gc.chave = c.carteira_comercial
       LEFT JOIN profissoes       pr ON pr.id = c.profissao_id
       LEFT JOIN estados_civis    ec ON ec.id = c.estado_civil_id
       LEFT JOIN produtores        p ON p.id  = c.produtor_id
       LEFT JOIN estruturas_venda ev ON ev.id = c.estrutura_venda_id
       LEFT JOIN origens_clientes oc ON oc.id = c.origem_cliente_id
       LEFT JOIN faixas_renda     fr ON fr.id = c.faixa_renda_id
       LEFT JOIN situacoes_cliente sit ON sit.id = c.situacao_id
      WHERE c.uuid = ?${carteira.condicao ? ` AND ${carteira.condicao}` : ''}
      LIMIT 1`,
    [uuidParaBinario(uuid), ...carteira.valores],
  );

  return linhas[0] ?? null;
}

export interface TelefoneLinha extends RowDataPacket {
  tipo: TipoTelefone;
  ddd: string | null;
  numero: string;
  completo: string;
  observacao: string | null;
  principal: number;
}

export interface EmailLinha extends RowDataPacket {
  tipo: TipoEmail;
  endereco: string;
  observacao: string | null;
  principal: number;
}

export interface EnderecoLinha extends RowDataPacket {
  tipo: TipoEndereco;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface SeguradoLinha extends RowDataPacket {
  ordem: number;
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  logradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  celular: string | null;
  email: string | null;
}

export interface VinculoLinha extends RowDataPacket {
  seguradora: string;
  ramo: string | null;
  modalidade: string | null;
}

/** Satélites em consultas paralelas, em vez de JOINs que multiplicariam as linhas. */
export async function carregarSatelites(clienteId: number): Promise<{
  telefones: TelefoneLinha[];
  emails: EmailLinha[];
  enderecos: EnderecoLinha[];
  segurados: SeguradoLinha[];
  vinculos: VinculoLinha[];
}> {
  const [telefones, emails, enderecos, segurados, vinculos] = await Promise.all([
    pool.execute<TelefoneLinha[]>(
      // O id preserva a ordem em que a pessoa arrumou a lista na tela.
      `SELECT tipo, ddd, numero, completo, observacao, principal
         FROM telefones WHERE cliente_id = ?
        ORDER BY principal DESC, id`,
      [clienteId],
    ),
    pool.execute<EmailLinha[]>(
      `SELECT tipo, endereco, observacao, principal
         FROM emails WHERE cliente_id = ?
        ORDER BY principal DESC, id`,
      [clienteId],
    ),
    pool.execute<EnderecoLinha[]>(
      `SELECT e.tipo, e.logradouro, e.numero, e.complemento, e.bairro,
              m.nome AS cidade, m.uf AS uf, e.cep
         FROM enderecos e
         LEFT JOIN municipios m ON m.id = e.municipio_id
        WHERE e.cliente_id = ?
        ORDER BY FIELD(e.tipo, 'principal', 'comercial', 'cobranca')`,
      [clienteId],
    ),
    pool.execute<SeguradoLinha[]>(
      `SELECT s.ordem, s.nome, s.cpf, s.rg, s.logradouro, s.bairro,
              m.nome AS cidade, m.uf AS uf, s.cep, s.telefone, s.celular, s.email
         FROM segurados s
         LEFT JOIN municipios m ON m.id = s.municipio_id
        WHERE s.cliente_id = ?
        ORDER BY s.ordem`,
      [clienteId],
    ),
    pool.execute<VinculoLinha[]>(
      `SELECT sg.nome AS seguradora, r.nome AS ramo, md.nome AS modalidade
         FROM seguradoras_clientes sc
         JOIN seguradoras sg ON sg.id = sc.seguradora_id
         LEFT JOIN ramos       r  ON r.id  = sc.ramo_id
         LEFT JOIN modalidades md ON md.id = sc.modalidade_id
        WHERE sc.cliente_id = ?
        ORDER BY sg.nome`,
      [clienteId],
    ),
  ]);

  return {
    telefones: telefones[0],
    emails: emails[0],
    enderecos: enderecos[0],
    segurados: segurados[0],
    vinculos: vinculos[0],
  };
}

/** Opções dos filtros. Seguradora inativa continua (marcada): escondê-la esconderia os clientes dela. */
export async function opcoesDeFiltro(): Promise<{
  ufs: string[];
  seguradoras: { nome: string; ativa: boolean }[];
  produtores: string[];
  situacoes: SituacaoCliente[];
}> {
  const [ufs, seguradoras, produtores] = await Promise.all([
    pool.execute<RowDataPacket[]>('SELECT DISTINCT uf FROM municipios ORDER BY uf'),
    pool.execute<RowDataPacket[]>(
      `SELECT s.nome, s.ativa
         FROM seguradoras s
        WHERE s.ativa = 1
           OR EXISTS (SELECT 1 FROM seguradoras_clientes sc WHERE sc.seguradora_id = s.id)
        ORDER BY s.ativa DESC, s.nome`,
    ),
    pool.execute<RowDataPacket[]>('SELECT nome FROM produtores WHERE ativo = 1 ORDER BY nome'),
  ]);

  return {
    ufs: ufs[0].map((l) => String(l.uf)),
    seguradoras: seguradoras[0].map((l) => ({ nome: String(l.nome), ativa: Boolean(l.ativa) })),
    produtores: produtores[0].map((l) => String(l.nome)),
    situacoes: await listarSituacoes(),
  };
}

export interface SituacaoCliente {
  id: number;
  chave: string;
  nome: string;
  descricao: string | null;
  contaComoCarteira: boolean;
  eSaida: boolean;
}

export async function listarSituacoes(): Promise<SituacaoCliente[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT id, chave, nome, descricao, conta_como_carteira, e_saida
       FROM situacoes_cliente
      ORDER BY ordem`,
  );

  return linhas.map((l) => ({
    id: Number(l.id),
    chave: String(l.chave),
    nome: String(l.nome),
    descricao: l.descricao === null ? null : String(l.descricao),
    contaComoCarteira: l.conta_como_carteira === 1,
    eSaida: l.e_saida === 1,
  }));
}

/** Contagem de satélites para a prévia da importação, em lotes de 1.000 (`max_allowed_packet`). */
export async function contarSatelitesPorDocumento(documentos: string[]): Promise<{
  comCadastro: number;
  comTelefone: number;
  comEmail: number;
  comEndereco: number;
  comSegurado: number;
  comSeguradora: number;
}> {
  const zero = {
    comCadastro: 0, comTelefone: 0, comEmail: 0,
    comEndereco: 0, comSegurado: 0, comSeguradora: 0,
  };

  if (documentos.length === 0) return zero;

  const total = { ...zero };

  for (let i = 0; i < documentos.length; i += 1000) {
    const fatia = documentos.slice(i, i + 1000);

    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS com_cadastro,
         SUM(EXISTS(SELECT 1 FROM telefones            t  WHERE t.cliente_id  = c.id)) AS com_telefone,
         SUM(EXISTS(SELECT 1 FROM emails               e  WHERE e.cliente_id  = c.id)) AS com_email,
         SUM(EXISTS(SELECT 1 FROM enderecos            en WHERE en.cliente_id = c.id)) AS com_endereco,
         SUM(EXISTS(SELECT 1 FROM segurados            s  WHERE s.cliente_id  = c.id)) AS com_segurado,
         SUM(EXISTS(SELECT 1 FROM seguradoras_clientes sc WHERE sc.cliente_id = c.id)) AS com_seguradora
       FROM clientes c
      WHERE c.cpf_cnpj_numeros IN (?)`,
      [fatia],
    );

    const l = linhas[0];
    if (!l) continue;

    total.comCadastro += Number(l.com_cadastro ?? 0);
    total.comTelefone += Number(l.com_telefone ?? 0);
    total.comEmail += Number(l.com_email ?? 0);
    total.comEndereco += Number(l.com_endereco ?? 0);
    total.comSegurado += Number(l.com_segurado ?? 0);
    total.comSeguradora += Number(l.com_seguradora ?? 0);
  }

  return total;
}

export interface ResumoCarteira {
  /** Na carteira — soma de tudo que `conta_como_carteira`. */
  ativos: number;
  /** Tem apólice EM VIGOR (≠ `ativos`, que inclui "sem apólice conhecida"). */
  comApoliceVigente: number;
  /** É cliente, mas nenhuma apólice dele foi importada (não é "sem seguro"). */
  semApoliceConhecida: number;
  inativos: number;
  prospectos: number;
  inadimplentes: number;
  novosNoAno: number;
  perdidosNoAno: number;
  /** Denominador que diz se a série de movimento descreve a carteira ou só uma fatia dela. */
  comDataDeEntrada: number;
  total: number;
}

/**
 * Recalcula ativo/inativo/sem apólice conhecida pela vigência. Só rebaixa quem TEM histórico
 * de apólice; respeita `situacao_origem = 'manual'`; nunca toca `saida_em`.
 */
export async function recalcularSituacoes(
  conexao?: PoolConnection,
): Promise<{ ativos: number; inativos: number; semApolice: number }> {
  const executor = conexao ?? pool;

  // A apólice de uma FILIAL conta para a matriz. Filiais por tabela DERIVADA com DISTINCT:
  // o MySQL recusa ler `clientes` no UPDATE de `clientes` (1093), e sem o DISTINCT ela é fundida.
  const daEmpresa = `(a.cliente_id = c.id
    OR a.cliente_id IN (
      SELECT f.id FROM (SELECT DISTINCT id, matriz_id FROM clientes WHERE matriz_id IS NOT NULL) f
       WHERE f.matriz_id = c.id))`;
  const temApolice = `EXISTS (SELECT 1 FROM apolices a WHERE ${daEmpresa})`;
  const vigente = `EXISTS (
    SELECT 1 FROM apolices a
     WHERE ${daEmpresa}
       AND ${condicaoEmVigor('a')}
  )`;

  // Inadimplente fica de fora: é decidido pelo financeiro, não pela vigência.
  const elegivel = `c.situacao_origem = 'derivada'
    AND s.chave IN ('ativo', 'inativo', 'prospecto', 'sem_apolice_conhecida')`;

  const mover = async (destino: string, condicao: string): Promise<number> => {
    const [r] = await executor.execute<ResultSetHeader>(
      `UPDATE clientes c
         JOIN situacoes_cliente s    ON s.id = c.situacao_id
         JOIN situacoes_cliente alvo ON alvo.chave = ?
          SET c.situacao_id = alvo.id, c.situacao_em = NOW(3)
        WHERE ${elegivel} AND s.chave <> ? AND ${condicao}`,
      [destino, destino],
    );
    return r.affectedRows;
  };

  const ativos = await mover('ativo', vigente);
  // Rebaixa só quem TEM histórico de apólice. Sem histórico não há conclusão.
  const inativos = await mover('inativo', `${temApolice} AND NOT ${vigente}`);
  const semApolice = await mover('sem_apolice_conhecida', `NOT ${temApolice}`);

  return { ativos, inativos, semApolice };
}

/** Os números de cada grupo de cliente (`clientesPorCarteira`). */
export type CarteiraComercialContagem = Record<
  | 'ativo'
  | 'inadimplente'
  | 'inativo'
  | 'outros'
  | 'total'
  | 'novosNoMes'
  | 'novosNoMesComSeguro'
  | 'novosMesAnterior',
  number
>;

/** Mesma condição da dimensão `entradaMes`; por mês inteiro ("Cliente Desde" pode vir MM/AAAA). */
const ENTRADA_NO_MES = "DATE_FORMAT(c.cliente_desde, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')";
const ENTRADA_NO_MES_ANTERIOR =
  "DATE_FORMAT(c.cliente_desde, '%Y-%m') = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m')";

/** Situação por grupo de cliente; todo grupo cadastrado vem, mesmo zerado. */
export async function clientesPorCarteira(
  escopo?: Escopo,
): Promise<Record<string, CarteiraComercialContagem>> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const [grupos] = await pool.query<RowDataPacket[]>('SELECT chave FROM grupos_cliente');
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT c.carteira_comercial AS carteira,
            SUM(s.chave = 'ativo')        AS ativo,
            SUM(s.chave = 'inadimplente') AS inadimplente,
            SUM(s.chave = 'inativo')      AS inativo,
            COUNT(*)                      AS total,
            SUM(${ENTRADA_NO_MES})        AS novos_mes,
            SUM(${ENTRADA_NO_MES} AND s.chave IN ('ativo', 'inadimplente')) AS novos_mes_com_seguro,
            SUM(${ENTRADA_NO_MES_ANTERIOR}) AS novos_mes_anterior
       FROM clientes c
       LEFT JOIN situacoes_cliente s ON s.id = c.situacao_id
      ${carteira.condicao ? `WHERE ${carteira.condicao}` : ''}
      GROUP BY c.carteira_comercial`,
    carteira.valores,
  );
  const vazio = (): CarteiraComercialContagem => ({
    ativo: 0,
    inadimplente: 0,
    inativo: 0,
    outros: 0,
    total: 0,
    novosNoMes: 0,
    novosNoMesComSeguro: 0,
    novosMesAnterior: 0,
  });
  const resultado: Record<string, CarteiraComercialContagem> = Object.fromEntries(
    grupos.map((g) => [String(g.chave), vazio()]),
  );
  for (const l of linhas) {
    const r = resultado[String(l.carteira)];
    if (!r) continue;
    r.ativo = Number(l.ativo ?? 0);
    r.inadimplente = Number(l.inadimplente ?? 0);
    r.inativo = Number(l.inativo ?? 0);
    r.total = Number(l.total ?? 0);
    r.novosNoMes = Number(l.novos_mes ?? 0);
    r.novosNoMesComSeguro = Number(l.novos_mes_com_seguro ?? 0);
    r.novosMesAnterior = Number(l.novos_mes_anterior ?? 0);
    // Prospecto, "sem apólice conhecida" e sem situação.
    r.outros = r.total - r.ativo - r.inadimplente - r.inativo;
  }
  return resultado;
}

export async function resumoCarteira(escopo?: Escopo): Promise<ResumoCarteira> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(s.conta_como_carteira = 1)               AS ativos,
       SUM(s.chave = 'ativo')                       AS com_apolice_vigente,
       SUM(s.chave = 'sem_apolice_conhecida')       AS sem_apolice_conhecida,
       SUM(s.e_saida = 1)                           AS inativos,
       SUM(s.chave = 'prospecto')                   AS prospectos,
       SUM(s.chave = 'inadimplente')                AS inadimplentes,
       SUM(YEAR(c.cliente_desde) = YEAR(CURDATE())) AS novos_no_ano,
       SUM(YEAR(c.saida_em)      = YEAR(CURDATE())) AS perdidos_no_ano,
       SUM(c.cliente_desde IS NOT NULL)             AS com_data_de_entrada
     FROM clientes c
     LEFT JOIN situacoes_cliente s ON s.id = c.situacao_id
     ${carteira.condicao ? `WHERE ${carteira.condicao}` : ''}`,
    carteira.valores,
  );

  const l = linhas[0];

  return {
    total: Number(l?.total ?? 0),
    ativos: Number(l?.ativos ?? 0),
    comApoliceVigente: Number(l?.com_apolice_vigente ?? 0),
    semApoliceConhecida: Number(l?.sem_apolice_conhecida ?? 0),
    inativos: Number(l?.inativos ?? 0),
    prospectos: Number(l?.prospectos ?? 0),
    inadimplentes: Number(l?.inadimplentes ?? 0),
    novosNoAno: Number(l?.novos_no_ano ?? 0),
    perdidosNoAno: Number(l?.perdidos_no_ano ?? 0),
    comDataDeEntrada: Number(l?.com_data_de_entrada ?? 0),
  };
}

export interface MovimentoMes {
  periodo: string;
  novos: number;
  perdidos: number;
}

/** Entradas e saídas mês a mês; a série é gerada aqui para mês sem movimento sair zerado. */
export async function movimentoMensal(meses = 24, escopo?: Escopo): Promise<MovimentoMes[]> {
  const limite = Math.min(Math.max(Math.trunc(meses), 1), 60);
  const carteira = condicaoDeCarteira(escopo, 'produtor_id');
  const recorte = carteira.condicao ? ` AND ${carteira.condicao}` : '';

  const [entradas] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(cliente_desde, '%Y-%m') AS periodo, COUNT(*) AS n
       FROM clientes
      WHERE cliente_desde IS NOT NULL
        AND cliente_desde >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)${recorte}
      GROUP BY periodo`,
    [limite, ...carteira.valores],
  );

  const [saidas] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(saida_em, '%Y-%m') AS periodo, COUNT(*) AS n
       FROM clientes
      WHERE saida_em IS NOT NULL
        AND saida_em >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)${recorte}
      GROUP BY periodo`,
    [limite, ...carteira.valores],
  );

  const mapaEntradas = new Map(entradas.map((l) => [String(l.periodo), Number(l.n)]));
  const mapaSaidas = new Map(saidas.map((l) => [String(l.periodo), Number(l.n)]));

  const serie: MovimentoMes[] = [];
  const hoje = new Date();

  for (let i = limite - 1; i >= 0; i -= 1) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const periodo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    serie.push({
      periodo,
      novos: mapaEntradas.get(periodo) ?? 0,
      perdidos: mapaSaidas.get(periodo) ?? 0,
    });
  }

  return serie;
}

export interface FatiaSimples {
  rotulo: string;
  valor: number;
}

/** As fatias do painel de clientes; todas as consultas recebem o mesmo recorte de carteira. */
export async function distribuicoes(escopo?: Escopo): Promise<{
  porSituacao: FatiaSimples[];
  porUf: FatiaSimples[];
  porSeguradora: FatiaSimples[];
  porProdutor: FatiaSimples[];
  porFaixaRenda: FatiaSimples[];
  porTipoPessoa: FatiaSimples[];
}> {
  const mapear = (linhas: RowDataPacket[]): FatiaSimples[] =>
    linhas.map((l) => ({ rotulo: String(l.rotulo), valor: Number(l.valor) }));

  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const onde = (anterior?: string): string => {
    const partes = [anterior, carteira.condicao].filter(Boolean);
    return partes.length > 0 ? `WHERE ${partes.join(' AND ')}` : '';
  };

  const v = carteira.valores;

  const [situacao, uf, seguradora, produtor, renda, tipo] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COALESCE(s.nome, 'Sem situação') AS rotulo, COUNT(*) AS valor
         FROM clientes c LEFT JOIN situacoes_cliente s ON s.id = c.situacao_id
        ${onde()}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),
    pool.query<RowDataPacket[]>(
      `SELECT m.uf AS rotulo, COUNT(DISTINCT c.id) AS valor
         FROM clientes c
         JOIN enderecos e ON e.cliente_id = c.id AND e.tipo = 'principal'
         JOIN municipios m ON m.id = e.municipio_id
        ${onde()}
        GROUP BY rotulo ORDER BY valor DESC LIMIT 12`,
      v,
    ),
    pool.query<RowDataPacket[]>(
      `SELECT sg.nome AS rotulo, COUNT(DISTINCT sc.cliente_id) AS valor
         FROM seguradoras_clientes sc
         JOIN seguradoras sg ON sg.id = sc.seguradora_id
         JOIN clientes c ON c.id = sc.cliente_id
        ${onde()}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),
    pool.query<RowDataPacket[]>(
      `SELECT p.nome AS rotulo, COUNT(*) AS valor
         FROM clientes c JOIN produtores p ON p.id = c.produtor_id
        ${onde()}
        GROUP BY rotulo ORDER BY valor DESC LIMIT 10`,
      v,
    ),
    pool.query<RowDataPacket[]>(
      `SELECT f.descricao AS rotulo, COUNT(*) AS valor
         FROM clientes c JOIN faixas_renda f ON f.id = c.faixa_renda_id
        ${onde()}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),
    pool.query<RowDataPacket[]>(
      `SELECT CASE c.tipo_pessoa WHEN 'J' THEN 'Jurídica' ELSE 'Física' END AS rotulo,
              COUNT(*) AS valor
         FROM clientes c
        ${onde()}
        GROUP BY rotulo ORDER BY valor DESC`,
      v,
    ),
  ]);

  return {
    porSituacao: mapear(situacao[0]),
    porUf: mapear(uf[0]),
    porSeguradora: mapear(seguradora[0]),
    porProdutor: mapear(produtor[0]),
    porFaixaRenda: mapear(renda[0]),
    porTipoPessoa: mapear(tipo[0]),
  };
}

/** Clientes em planilha, com os MESMOS nomes de coluna que o importador lê. */
export async function exportarParaPlanilha(situacaoChave?: string): Promise<RowDataPacket[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT c.cpf_cnpj, c.nome AS nome_civil, c.nome_social,
            pr.nome AS profissao, c.sexo, ec.nome AS estado_civil,
            c.data_nascimento, c.vip AS cliente_vip, c.autoriza_contato,
            sit.chave AS situacao, c.situacao_em, c.saida_em,
            (SELECT endereco FROM emails WHERE cliente_id = c.id AND tipo = 'pessoal'   LIMIT 1) AS email,
            (SELECT endereco FROM emails WHERE cliente_id = c.id AND tipo = 'comercial' LIMIT 1) AS email_comercial,
            (SELECT ddd    FROM telefones WHERE cliente_id = c.id AND tipo = 'celular'     LIMIT 1) AS ddd_celular,
            (SELECT numero FROM telefones WHERE cliente_id = c.id AND tipo = 'celular'     LIMIT 1) AS celular,
            (SELECT ddd    FROM telefones WHERE cliente_id = c.id AND tipo = 'residencial' LIMIT 1) AS ddd_residencial,
            (SELECT numero FROM telefones WHERE cliente_id = c.id AND tipo = 'residencial' LIMIT 1) AS telefone_residencial,
            (SELECT ddd    FROM telefones WHERE cliente_id = c.id AND tipo = 'comercial'   LIMIT 1) AS ddd_comercial,
            (SELECT numero FROM telefones WHERE cliente_id = c.id AND tipo = 'comercial'   LIMIT 1) AS telefone_comercial,
            en.logradouro, en.numero, en.complemento, en.bairro,
            mu.nome AS cidade, mu.uf, en.cep,
            r.nome AS ramo_descricao, md.nome AS modalidade, sg.nome AS seguradora,
            CASE WHEN ev.codigo IS NULL THEN ev.nome
                 ELSE CONCAT(ev.codigo, ' - ', ev.nome) END AS estrutura_vendas,
            p.nome AS produtor, oc.nome AS origem_cliente,
            fr.descricao AS renda, c.faturamento_anual, c.cliente_desde,
            s1.nome AS resp1_nome, s1.cpf AS resp1_cpf, s1.rg AS resp1_rg,
            s1.logradouro AS resp1_endereco, s1.bairro AS resp1_bairro, s1.cep AS resp1_cep,
            ms1.nome AS resp1_cidade, ms1.uf AS resp1_uf,
            s1.telefone AS resp1_telefone, s1.celular AS resp1_celular, s1.email AS resp1_email,
            s2.nome AS resp2_nome, s2.cpf AS resp2_cpf, s2.rg AS resp2_rg,
            s2.logradouro AS resp2_endereco, s2.bairro AS resp2_bairro, s2.cep AS resp2_cep,
            ms2.nome AS resp2_cidade, ms2.uf AS resp2_uf,
            s2.telefone AS resp2_telefone, s2.celular AS resp2_celular, s2.email AS resp2_email,
            s3.nome AS resp3_nome, s3.cpf AS resp3_cpf, s3.rg AS resp3_rg,
            s3.logradouro AS resp3_endereco, s3.bairro AS resp3_bairro, s3.cep AS resp3_cep,
            ms3.nome AS resp3_cidade, ms3.uf AS resp3_uf,
            s3.telefone AS resp3_telefone, s3.celular AS resp3_celular, s3.email AS resp3_email
       FROM clientes c
       LEFT JOIN situacoes_cliente sit ON sit.id = c.situacao_id
       LEFT JOIN profissoes        pr ON pr.id = c.profissao_id
       LEFT JOIN estados_civis     ec ON ec.id = c.estado_civil_id
       LEFT JOIN produtores         p ON p.id  = c.produtor_id
       LEFT JOIN estruturas_venda  ev ON ev.id = c.estrutura_venda_id
       LEFT JOIN origens_clientes  oc ON oc.id = c.origem_cliente_id
       LEFT JOIN faixas_renda      fr ON fr.id = c.faixa_renda_id
       LEFT JOIN enderecos         en ON en.cliente_id = c.id AND en.tipo = 'principal'
       LEFT JOIN municipios        mu ON mu.id = en.municipio_id
       LEFT JOIN seguradoras_clientes sc
              ON sc.id = (SELECT MIN(id) FROM seguradoras_clientes WHERE cliente_id = c.id)
       LEFT JOIN seguradoras  sg ON sg.id = sc.seguradora_id
       LEFT JOIN ramos         r ON r.id  = sc.ramo_id
       LEFT JOIN modalidades  md ON md.id = sc.modalidade_id
       LEFT JOIN segurados  s1 ON s1.cliente_id = c.id AND s1.ordem = 1
       LEFT JOIN municipios ms1 ON ms1.id = s1.municipio_id
       LEFT JOIN segurados  s2 ON s2.cliente_id = c.id AND s2.ordem = 2
       LEFT JOIN municipios ms2 ON ms2.id = s2.municipio_id
       LEFT JOIN segurados  s3 ON s3.cliente_id = c.id AND s3.ordem = 3
       LEFT JOIN municipios ms3 ON ms3.id = s3.municipio_id
      WHERE (? IS NULL OR sit.chave = ?)
      ORDER BY c.nome`,
    [situacaoChave ?? null, situacaoChave ?? null],
  );

  return linhas;
}

export interface NovoClienteManual {
  cpfCnpj: string;
  cpfCnpjNumeros: string;
  tipoPessoa: 'F' | 'J';
  nome: string;
  nomeSocial: string | null;
  situacaoId: number | null;
  dataNascimento: string | null;
  sexo: 'M' | 'F' | null;
  estadoCivilId: number | null;
  profissaoId: number | null;
  produtorId: number | null;
  origemClienteId: number | null;
  autorizaContato: boolean;
  vip: boolean;
}

/** Cria um cliente pela tela; sem ON DUPLICATE: documento repetido sobe como erro. */
export async function criarManual(
  dados: NovoClienteManual,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `INSERT INTO clientes
       (origem_sistema, importado_em, cpf_cnpj, cpf_cnpj_numeros, tipo_pessoa,
        nome, nome_social, situacao_id, situacao_em, data_nascimento, sexo,
        estado_civil_id, profissao_id, produtor_id, origem_cliente_id,
        autoriza_contato, vip, cliente_desde)
     VALUES ('manual', NOW(3), ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
    [
      dados.cpfCnpj,
      dados.cpfCnpjNumeros,
      dados.tipoPessoa,
      nomeEmCaixaAlta(dados.nome),
      nomeEmCaixaAlta(dados.nomeSocial),
      dados.situacaoId,
      dados.dataNascimento,
      dados.sexo,
      dados.estadoCivilId,
      dados.profissaoId,
      dados.produtorId,
      dados.origemClienteId,
      dados.autorizaContato ? 1 : 0,
      dados.vip ? 1 : 0,
    ],
  );

  return resultado.insertId;
}

/** O documento já está cadastrado? Usado antes de inserir, para a mensagem ser útil. */
export async function buscarPorDocumento(documento: string): Promise<{
  id: number;
  uuid: Buffer;
  nome: string;
} | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id, uuid, nome FROM clientes WHERE cpf_cnpj_numeros = ? LIMIT 1',
    [documento],
  );

  const l = linhas[0];
  return l ? { id: Number(l.id), uuid: l.uuid as Buffer, nome: String(l.nome) } : null;
}

/** `uuid` de um cliente recém-criado, para a API devolver o identificador público. */
export async function uuidPorId(id: number): Promise<Buffer | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT uuid FROM clientes WHERE id = ? LIMIT 1',
    [id],
  );

  return (linhas[0]?.uuid as Buffer | undefined) ?? null;
}

/**
 * Grava clientes PRESERVANDO o cadastro (`COALESCE(VALUES(x), x)`), para relatório de carteira.
 * Só o nome é reescrito — exceto quando o novo é máscara e o atual não.
 */
export async function inserirClientesPreservando(
  clientes: ClienteImportado[],
  conexao?: PoolConnection,
): Promise<number> {
  if (clientes.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();

  const SEMPRE = new Set(['nome']);

  // `origem_lote` nunca entra no UPDATE: desfazer a carga nova apagaria cadastros antigos.
  const NUNCA = new Set([
    'cpf_cnpj_numeros',
    'origem_sistema', 'origem_arquivo', 'origem_lote', 'importado_em',
    // TINYINT NOT NULL: COALESCE não preservaria um consentimento registrado à mão.
    'vip', 'autoriza_contato',
  ]);

  const valores: unknown[] = [];
  for (const c of clientes) {
    valores.push(
      c.origemSistema, c.origemArquivo, c.origemLote, agora,
      c.cpfCnpj, c.cpfCnpjNumeros, c.tipoPessoa,
      nomeEmCaixaAlta(c.nome), nomeEmCaixaAlta(c.nomeSocial),
      c.profissaoId, c.estadoCivilId, c.sexo, c.dataNascimento,
      c.vip ? 1 : 0, c.autorizaContato ? 1 : 0,
      c.situacaoId, c.situacaoEm, c.saidaEm,
      c.produtorId, c.estruturaVendaId, c.origemClienteId,
      c.faixaRendaId, c.faturamentoAnual,
      c.clienteDesde, c.ultimaAlteracao,
    );
  }

  const tupla = `(${COLUNAS_CLIENTE.map(() => '?').join(', ')})`;

  const atualizaveis = COLUNAS_CLIENTE.filter((c) => !NUNCA.has(c))
    .map((c) =>
      c === 'nome'
        ? // Máscara pela POSIÇÃO do X; `utf8mb4_bin` porque a collation padrão ignora caixa.
          '`nome` = CASE' +
          " WHEN VALUES(`nome`) COLLATE utf8mb4_bin REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'" +
          " AND `nome` COLLATE utf8mb4_bin NOT REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'" +
          ' THEN `nome` ELSE VALUES(`nome`) END'
        : SEMPRE.has(c)
          ? `\`${c}\` = VALUES(\`${c}\`)`
          : `\`${c}\` = COALESCE(VALUES(\`${c}\`), \`${c}\`)`,
    )
    .join(', ');

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO clientes (${COLUNAS_CLIENTE.map((c) => `\`${c}\``).join(', ')})
     VALUES ${clientes.map(() => tupla).join(', ')}
     ON DUPLICATE KEY UPDATE ${atualizaveis}`,
    valores,
  );

  return resultado.affectedRows;
}

/** Nome do dono de cada documento, para a conferência na tela. */
export async function nomesPorDocumento(
  documentos: string[],
): Promise<Map<string, string>> {
  if (documentos.length === 0) return new Map();

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT cpf_cnpj_numeros, nome FROM clientes
      WHERE cpf_cnpj_numeros IN (${documentos.map(() => '?').join(', ')})`,
    documentos,
  );

  return new Map(linhas.map((l) => [String(l.cpf_cnpj_numeros), String(l.nome)]));
}

/** Mesma assinatura de máscara do SQL: pela POSIÇÃO do X, não pela quantidade. */
const NOME_MASCARADO = /(?:^|[^\p{L}])X{2,}\p{Ll}/u;

/**
 * Conserta nome mascarado e contato ausente pelo segurado da apólice (a Porto só mascara o
 * relatório de apólices). Nunca troca nome legível nem telefone existente.
 */
export async function enriquecerPeloSegurado(
  linhas: { apoliceId: number; nome: string | null; telefone: string | null }[],
  conexao?: PoolConnection,
): Promise<{ nomes: number; telefones: number }> {
  const executor = conexao ?? pool;
  let nomes = 0;
  let telefones = 0;

  for (const l of linhas) {
    if (!l.apoliceId) continue;

    if (l.nome && !NOME_MASCARADO.test(l.nome)) {
      const [r] = await executor.query<ResultSetHeader>(
        `UPDATE clientes c
           JOIN apolices a ON a.cliente_id = c.id
            SET c.nome = ?
          WHERE a.id = ?
            AND c.nome COLLATE utf8mb4_bin REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'`,
        [nomeEmCaixaAlta(l.nome), l.apoliceId],
      );
      nomes += r.affectedRows;
    }

    const digitos = (l.telefone ?? '').replace(/\D/g, '');
    // Menos de 10 dígitos não é telefone com DDD.
    if (digitos.length >= 10 && digitos.length <= 11) {
      const ddd = digitos.slice(0, 2);
      const numero = digitos.slice(2);

      const [r] = await executor.query<ResultSetHeader>(
        `INSERT INTO telefones (cliente_id, tipo, ddd, numero, completo, principal)
         SELECT a.cliente_id, 'celular', ?, ?, ?, 1
           FROM apolices a
          WHERE a.id = ? AND a.cliente_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM telefones t
               WHERE t.cliente_id = a.cliente_id AND t.tipo = 'celular')
         -- O mesmo número já gravado com outro tipo: fica como está.
         ON DUPLICATE KEY UPDATE completo = telefones.completo`,
        [ddd, numero, `(${ddd}) ${numero}`, l.apoliceId],
      );
      telefones += r.affectedRows;
    }
  }

  return { nomes, telefones };
}

/** Campos de `clientes` que a edição manual pode tocar. */
export interface EdicaoDeCliente {
  nome?: string;
  nome_social?: string | null;
  situacao_id?: number | null;
  situacao_origem?: 'derivada' | 'manual';
  data_nascimento?: string | null;
  sexo?: 'M' | 'F' | null;
  estado_civil_id?: number | null;
  profissao_id?: number | null;
  produtor_id?: number | null;
  origem_cliente_id?: number | null;
  autoriza_contato?: 0 | 1;
  vip?: 0 | 1;
  /** Grupo de cliente: chave de `grupos_cliente`, validada no serviço. */
  carteira_comercial?: string;
}

/** Só nomes de coluna escritos NESTE arquivo chegam ao SQL; os valores vão por `?`. */
const COLUNAS_EDITAVEIS = new Set<keyof EdicaoDeCliente>([
  'nome', 'nome_social', 'situacao_id', 'situacao_origem', 'data_nascimento',
  'sexo', 'estado_civil_id', 'profissao_id', 'produtor_id', 'origem_cliente_id',
  'autoriza_contato', 'vip', 'carteira_comercial',
]);

export async function atualizarManual(
  clienteId: number,
  campos: EdicaoDeCliente,
  conexao?: PoolConnection,
): Promise<number> {
  type Valor = string | number | null;

  const entradas = (Object.entries(campos) as [keyof EdicaoDeCliente, Valor][]).filter(
    ([coluna, valor]) => COLUNAS_EDITAVEIS.has(coluna) && valor !== undefined,
  );

  if (entradas.length === 0) return 0;

  const executor = conexao ?? pool;
  const valores: Valor[] = [
    ...entradas.map(([c, v]) =>
      (c === 'nome' || c === 'nome_social') && typeof v === 'string' ? nomeEmCaixaAlta(v) : v,
    ),
    clienteId,
  ];

  const [r] = await executor.execute<ResultSetHeader>(
    `UPDATE clientes SET ${entradas.map(([c]) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
    valores,
  );

  return r.affectedRows;
}

export interface TelefoneDoCadastro {
  tipo: TipoTelefone;
  /** Como a pessoa digitou; só os dígitos são gravados. */
  numero: string;
  observacao: string | null;
}

export interface EmailDoCadastro {
  tipo: TipoEmail;
  endereco: string;
  observacao: string | null;
}

/** Grava a lista INTEIRA de telefones na ordem dada (o primeiro é o principal); repetido entra uma vez. */
export async function substituirTelefones(
  clienteId: number,
  telefones: TelefoneDoCadastro[],
  conexao?: PoolConnection,
): Promise<void> {
  const executor = conexao ?? pool;
  await executor.execute('DELETE FROM telefones WHERE cliente_id = ?', [clienteId]);

  const vistos = new Set<string>();
  const linhas: unknown[][] = [];

  for (const t of telefones) {
    const digitos = t.numero.replace(/\D/g, '').slice(0, 20);
    if (!digitos || vistos.has(digitos)) continue;
    vistos.add(digitos);

    const ddd = digitos.length > 9 ? digitos.slice(0, 2) : null;
    const numero = (digitos.length > 9 ? digitos.slice(2) : digitos).slice(0, 15);
    linhas.push([
      clienteId, t.tipo, ddd, numero, digitos,
      t.observacao?.trim().slice(0, 80) || null, linhas.length === 0 ? 1 : 0,
    ]);
  }

  if (linhas.length === 0) return;

  await executor.query(
    `INSERT INTO telefones (cliente_id, tipo, ddd, numero, completo, observacao, principal)
     VALUES ${linhas.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    linhas.flat(),
  );
}

/** Lista INTEIRA de e-mails, na ordem dada. Mesma regra dos telefones. */
export async function substituirEmails(
  clienteId: number,
  emails: EmailDoCadastro[],
  conexao?: PoolConnection,
): Promise<void> {
  const executor = conexao ?? pool;
  await executor.execute('DELETE FROM emails WHERE cliente_id = ?', [clienteId]);

  const vistos = new Set<string>();
  const linhas: unknown[][] = [];

  for (const e of emails) {
    const endereco = emailEmCaixaAlta(e.endereco.trim()).slice(0, 120);
    if (!endereco || vistos.has(endereco)) continue;
    vistos.add(endereco);
    linhas.push([
      clienteId, e.tipo, endereco,
      e.observacao?.trim().slice(0, 80) || null, linhas.length === 0 ? 1 : 0,
    ]);
  }

  if (linhas.length === 0) return;

  await executor.query(
    `INSERT INTO emails (cliente_id, tipo, endereco, observacao, principal)
     VALUES ${linhas.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
    linhas.flat(),
  );
}

/**
 * Liga cada filial à matriz (raiz do CNPJ + 0001), cadastrando a matriz que faltar com o nome
 * e o produtor da filial. Idempotente.
 */
export async function organizarMatrizes(
  conexao?: PoolConnection,
): Promise<{ matrizesCriadas: number; filiaisLigadas: number }> {
  const executor = conexao ?? pool;

  const [filiais] = await executor.query<RowDataPacket[]>(
    `SELECT id, nome, cnpj_raiz, produtor_id
       FROM clientes
      WHERE cnpj_raiz IS NOT NULL
        AND SUBSTRING(cpf_cnpj_numeros, 9, 4) <> '0001'
      ORDER BY cnpj_raiz, cpf_cnpj_numeros`,
  );

  let matrizesCriadas = 0;
  let filiaisLigadas = 0;
  const matrizPorRaiz = new Map<string, number>();

  for (const f of filiais) {
    const raiz = String(f.cnpj_raiz);

    let matrizId = matrizPorRaiz.get(raiz);
    if (matrizId === undefined) {
      const cnpj = cnpjDaMatriz(raiz);
      const [existente] = await executor.query<RowDataPacket[]>(
        'SELECT id FROM clientes WHERE cpf_cnpj_numeros = ? LIMIT 1',
        [cnpj],
      );

      if (existente[0]) {
        matrizId = Number(existente[0].id);
      } else {
        const [r] = await executor.query<ResultSetHeader>(
          // Nasce "sem apólice conhecida": o recálculo só move quem tem situação derivada.
          `INSERT INTO clientes
             (origem_sistema, origem_arquivo, importado_em, cpf_cnpj, cpf_cnpj_numeros,
              tipo_pessoa, nome, produtor_id, vip, autoriza_contato, situacao_id, situacao_em)
           SELECT 'manual', 'MATRIZ DERIVADA DAS FILIAIS', NOW(3), ?, ?, 'J', ?, ?, 0, 0, s.id, NOW(3)
             FROM situacoes_cliente s WHERE s.chave = 'sem_apolice_conhecida'`,
          [formatarDocumento(cnpj), cnpj, nomeEmCaixaAlta(String(f.nome)), f.produtor_id ?? null],
        );
        matrizId = r.insertId;
        matrizesCriadas++;
      }
      matrizPorRaiz.set(raiz, matrizId);
    }

    const [ligou] = await executor.query<ResultSetHeader>(
      'UPDATE clientes SET matriz_id = ? WHERE id = ? AND (matriz_id IS NULL OR matriz_id <> ?)',
      [matrizId, f.id, matrizId],
    );
    filiaisLigadas += ligou.affectedRows;
  }

  return { matrizesCriadas, filiaisLigadas };
}

export interface ClienteDoGrupo {
  uuid: Buffer;
  nome: string;
  cpf_cnpj_numeros: string;
  situacao: string | null;
  apolices: number;
  apolices_em_vigor: number;
}

/** Matriz e filiais de um cliente, com o recorte de carteira. */
export async function grupoEmpresarial(
  clienteId: number,
  escopo?: Escopo,
): Promise<{ matriz: ClienteDoGrupo | null; filiais: ClienteDoGrupo[] }> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const recorte = carteira.condicao ? `AND ${carteira.condicao}` : '';

  const colunas = `c.uuid, c.nome, c.cpf_cnpj_numeros, s.nome AS situacao,
    (SELECT COUNT(*) FROM apolices a WHERE a.cliente_id = c.id) AS apolices,
    (SELECT COUNT(*) FROM apolices a WHERE a.cliente_id = c.id AND ${condicaoEmVigor('a')}) AS apolices_em_vigor`;

  const [matriz] = await pool.query<RowDataPacket[]>(
    `SELECT ${colunas}
       FROM clientes c
       JOIN clientes filial ON filial.matriz_id = c.id
       LEFT JOIN situacoes_cliente s ON s.id = c.situacao_id
      WHERE filial.id = ? ${recorte}`,
    [clienteId, ...carteira.valores],
  );

  const [filiais] = await pool.query<RowDataPacket[]>(
    `SELECT ${colunas}
       FROM clientes c
       LEFT JOIN situacoes_cliente s ON s.id = c.situacao_id
      WHERE c.matriz_id = ? ${recorte}
      ORDER BY c.cpf_cnpj_numeros`,
    [clienteId, ...carteira.valores],
  );

  const paraGrupo = (l: RowDataPacket): ClienteDoGrupo => ({
    uuid: l.uuid as Buffer,
    nome: String(l.nome),
    cpf_cnpj_numeros: String(l.cpf_cnpj_numeros),
    situacao: l.situacao ? String(l.situacao) : null,
    apolices: Number(l.apolices ?? 0),
    apolices_em_vigor: Number(l.apolices_em_vigor ?? 0),
  });

  return { matriz: matriz[0] ? paraGrupo(matriz[0]) : null, filiais: filiais.map(paraGrupo) };
}

export interface ResponsavelContato {
  nome: string;
  cargo: string | null;
  /** Só dígitos. */
  telefone: string | null;
  email: string | null;
}

/** Os responsáveis do cliente, na ordem em que foram cadastrados. */
export async function listarResponsaveis(clienteId: number): Promise<ResponsavelContato[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT nome, cargo, telefone, email
       FROM responsaveis_contato
      WHERE cliente_id = ?
      ORDER BY ordem, id`,
    [clienteId],
  );

  return linhas.map((l) => ({
    nome: String(l.nome),
    cargo: l.cargo ? String(l.cargo) : null,
    telefone: l.telefone ? String(l.telefone) : null,
    email: l.email ? String(l.email) : null,
  }));
}

/** Substitui a lista inteira (apaga e reinsere). */
export async function substituirResponsaveis(
  clienteId: number,
  lista: ResponsavelContato[],
  conexao: PoolConnection,
): Promise<void> {
  await conexao.execute('DELETE FROM responsaveis_contato WHERE cliente_id = ?', [clienteId]);
  if (lista.length === 0) return;

  const valores: unknown[] = [];
  lista.forEach((r, i) => {
    valores.push(
      clienteId,
      i + 1,
      nomeEmCaixaAlta(r.nome.trim()),
      r.cargo ? nomeEmCaixaAlta(r.cargo.trim()) : null,
      r.telefone ? r.telefone.replace(/\D/g, '').slice(0, 20) || null : null,
      r.email ? emailEmCaixaAlta(r.email) : null,
    );
  });

  await conexao.query(
    `INSERT INTO responsaveis_contato (cliente_id, ordem, nome, cargo, telefone, email)
     VALUES ${lista.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
    valores,
  );
}

/** Grava o endereço SUBSTITUINDO o daquele tipo inteiro — nunca campo a campo. */
export async function definirEndereco(
  endereco: EnderecoImportado,
  conexao: PoolConnection,
): Promise<void> {
  await conexao.execute(
    `INSERT INTO enderecos (cliente_id, tipo, logradouro, numero, complemento, bairro, municipio_id, cep)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       logradouro = VALUES(logradouro), numero = VALUES(numero), complemento = VALUES(complemento),
       bairro = VALUES(bairro), municipio_id = VALUES(municipio_id), cep = VALUES(cep)`,
    [
      endereco.clienteId, endereco.tipo,
      endereco.logradouro,
      endereco.numero,
      endereco.complemento,
      endereco.bairro,
      endereco.municipioId, endereco.cep,
    ],
  );
}

/** Acrescenta os tipos de interesse; tipo inexistente ou inativo é ignorado pelo JOIN. */
export async function acrescentarTiposDeInteresse(
  clienteId: number,
  tipoIds: number[],
  conexao?: PoolConnection,
): Promise<void> {
  if (tipoIds.length === 0) return;
  await (conexao ?? pool).query(
    `INSERT IGNORE INTO cliente_tipos_seguro (cliente_id, tipo_seguro_id)
     SELECT ?, t.id FROM tipos_seguro t WHERE t.ativo = 1 AND t.id IN (?)`,
    [clienteId, tipoIds],
  );
}

export async function tiposDeInteresse(clienteId: number): Promise<string[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT t.nome
       FROM cliente_tipos_seguro ct
       JOIN tipos_seguro t ON t.id = ct.tipo_seguro_id
      WHERE ct.cliente_id = ?
      ORDER BY t.ordem, t.nome`,
    [clienteId],
  );
  return linhas.map((l) => String(l.nome));
}

/** Troca o nome MASCARADO pelo verdadeiro; nome já corrigido não é sobrescrito. */
export async function trocarNomeMascarado(clienteId: number, nome: string, conexao: PoolConnection): Promise<boolean> {
  const [r] = await conexao.query<ResultSetHeader>(
    `UPDATE clientes SET nome = ?
      WHERE id = ? AND nome COLLATE utf8mb4_bin REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'`,
    [nomeEmCaixaAlta(nome), clienteId],
  );
  return r.affectedRows > 0;
}

/** Documentos por NOME (collation ignora acento e caixa); quem chama só aceita nome com UM documento. */
export async function documentosPorNome(nomes: string[]): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  const unicos = [...new Set(nomes.map((n) => n.trim()).filter(Boolean))];
  if (unicos.length === 0) return mapa;
  const [linhas] = await pool.query<RowDataPacket[]>(
    'SELECT nome, cpf_cnpj_numeros FROM clientes WHERE nome IN (?)',
    [unicos],
  );
  for (const l of linhas) {
    const chave = String(l.nome).toUpperCase();
    mapa.set(chave, (mapa.get(chave) ?? new Set()).add(String(l.cpf_cnpj_numeros)));
  }
  return mapa;
}
