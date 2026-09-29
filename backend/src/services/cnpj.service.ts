import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { cnpjEhValido, limparDocumento } from '../utils/documento.js';

// Consulta de CNPJ (ver `CNPJ_API_URLS`). A CNPJ.ws aninha em `estabelecimento`; a BrasilAPI
// é plana. As duas mandam o tipo do logradouro à parte. CPF de sócio vem mascarado: não se devolve.

export interface SocioDoCnpj {
  nome: string;
  qualificacao: string | null;
  pessoaJuridica: boolean;
}

export interface EmpresaDoCnpj {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacao: string | null;
  /** AAAA-MM-DD. */
  dataAbertura: string | null;
  matriz: boolean | null;
  atividade: string | null;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  };
  /** Só dígitos, com DDD. */
  telefones: string[];
  email: string | null;
  socios: SocioDoCnpj[];
}

const cache = new Map<string, { valor: EmpresaDoCnpj | null; ate: number }>();
const UMA_HORA = 60 * 60 * 1000;
const MAXIMO_NO_CACHE = 2_000;

const texto = (v: unknown): string | null => {
  if (typeof v === 'number') return String(v);
  // A CNPJ.ws preenche o complemento com colunas de largura fixa.
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? t : null;
};

const data = (v: unknown): string | null => {
  const t = texto(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};

/** "S/N" e "SN" são ausência de número, não um número. */
const numero = (v: unknown): string | null => {
  const t = texto(v);
  return t && !/^s\/?n$/i.test(t) ? t : null;
};

function telefone(ddd: unknown, numeroTel: unknown): string | null {
  const d = `${texto(ddd) ?? ''}${texto(numeroTel) ?? ''}`.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 11 ? d : null;
}

function juntarLogradouro(tipo: string | null, nome: string | null): string | null {
  if (!nome) return null;
  if (!tipo || nome.toUpperCase().startsWith(tipo.toUpperCase())) return nome;
  return `${tipo} ${nome}`;
}

function normalizar(cnpj: string, b: Record<string, unknown>): EmpresaDoCnpj | null {
  const razaoSocial = texto(b.razao_social);
  if (!razaoSocial) return null;

  const est = b.estabelecimento as Record<string, unknown> | undefined;

  if (est) {
    // CNPJ.ws
    const cidade = est.cidade as { nome?: unknown } | undefined;
    const estado = est.estado as { sigla?: unknown } | undefined;
    const atividade = est.atividade_principal as { descricao?: unknown } | undefined;
    const socios = Array.isArray(b.socios) ? (b.socios as Record<string, unknown>[]) : [];
    const tipo = texto(est.tipo);

    return {
      cnpj,
      razaoSocial,
      nomeFantasia: texto(est.nome_fantasia),
      situacao: texto(est.situacao_cadastral)?.toUpperCase() ?? null,
      dataAbertura: data(est.data_inicio_atividade),
      matriz: tipo ? tipo.toUpperCase() === 'MATRIZ' : null,
      atividade: texto(atividade?.descricao),
      endereco: {
        logradouro: juntarLogradouro(texto(est.tipo_logradouro), texto(est.logradouro)),
        numero: numero(est.numero),
        complemento: texto(est.complemento),
        bairro: texto(est.bairro),
        cidade: texto(cidade?.nome),
        uf: texto(estado?.sigla),
        cep: texto(est.cep),
      },
      telefones: [telefone(est.ddd1, est.telefone1), telefone(est.ddd2, est.telefone2)].filter(
        (t): t is string => t !== null,
      ),
      email: texto(est.email),
      socios: socios
        .map((s) => ({
          nome: texto(s.nome) ?? '',
          qualificacao: texto((s.qualificacao_socio as { descricao?: unknown } | undefined)?.descricao),
          pessoaJuridica: texto(s.tipo) === 'Pessoa Jurídica',
        }))
        .filter((s) => s.nome),
    };
  }

  // BrasilAPI
  const qsa = Array.isArray(b.qsa) ? (b.qsa as Record<string, unknown>[]) : [];
  const tipo = texto(b.descricao_identificador_matriz_filial);

  return {
    cnpj,
    razaoSocial,
    nomeFantasia: texto(b.nome_fantasia),
    situacao: texto(b.descricao_situacao_cadastral)?.toUpperCase() ?? null,
    dataAbertura: data(b.data_inicio_atividade),
    matriz: tipo ? tipo.toUpperCase() === 'MATRIZ' : null,
    atividade: texto(b.cnae_fiscal_descricao),
    endereco: {
      logradouro: juntarLogradouro(texto(b.descricao_tipo_de_logradouro), texto(b.logradouro)),
      numero: numero(b.numero),
      complemento: texto(b.complemento),
      bairro: texto(b.bairro),
      cidade: texto(b.municipio),
      uf: texto(b.uf),
      cep: texto(b.cep),
    },
    telefones: [telefone(null, b.ddd_telefone_1), telefone(null, b.ddd_telefone_2)].filter(
      (t): t is string => t !== null,
    ),
    email: texto(b.email),
    socios: qsa
      .map((s) => ({
        nome: texto(s.nome_socio) ?? '',
        qualificacao: texto(s.qualificacao_socio),
        // Sócio PJ vem com a raiz do CNPJ em dígitos; PF vem com asteriscos.
        pessoaJuridica: /^\d{8,14}$/.test(texto(s.cnpj_cpf_do_socio) ?? ''),
      }))
      .filter((s) => s.nome),
  };
}

/** Banco e estatal chegam a 40 diretores; passados vinte, não é sugestão de contato. */
const MAXIMO_DE_SOCIOS = 20;

export async function consultarCnpj(bruto: string): Promise<EmpresaDoCnpj | null> {
  const cnpj = limparDocumento(bruto);
  // Validar antes de montar a URL: nenhum texto da tela chega ao endereço consultado.
  if (!cnpjEhValido(cnpj)) {
    throw AppError.unprocessable('CNPJ inválido. Confira o número.');
  }

  const guardado = cache.get(cnpj);
  if (guardado && guardado.ate > Date.now()) return guardado.valor;

  let ultimaFalha: string | null = null;

  for (const modelo of env.CNPJ_API_URLS) {
    const url = modelo.replace('{cnpj}', cnpj);
    try {
      const resposta = await fetch(url, {
        // A BrasilAPI responde 403 a pedido sem User-Agent.
        headers: { Accept: 'application/json', 'User-Agent': 'minhacorretora-bi/1.0' },
        signal: AbortSignal.timeout(env.CNPJ_TIMEOUT_MS),
      });

      if (resposta.status === 404) {
        guardar(cnpj, null, UMA_HORA);
        return null;
      }
      // 429 e 5xx: a fonte está cheia ou fora — tenta a próxima.
      if (!resposta.ok) {
        ultimaFalha = `${url} → HTTP ${resposta.status}`;
        continue;
      }

      const empresa = normalizar(cnpj, (await resposta.json()) as Record<string, unknown>);
      if (!empresa) {
        ultimaFalha = `${url} → resposta sem razão social`;
        continue;
      }

      empresa.socios = empresa.socios.slice(0, MAXIMO_DE_SOCIOS);
      guardar(cnpj, empresa, 7 * 24 * UMA_HORA);
      return empresa;
    } catch (erro) {
      ultimaFalha = `${url} → ${erro instanceof Error ? ((erro as { cause?: { code?: string } }).cause?.code ?? erro.name) : 'erro'}`;
    }
  }

  logger.warn({ cnpj, ultimaFalha }, 'Consulta de CNPJ indisponível');
  throw AppError.badGateway('A consulta de CNPJ está indisponível agora. Preencha os dados à mão.');
}

function guardar(cnpj: string, valor: EmpresaDoCnpj | null, validade: number): void {
  if (cache.size >= MAXIMO_NO_CACHE) {
    const primeiro = cache.keys().next().value;
    if (primeiro !== undefined) cache.delete(primeiro);
  }
  cache.set(cnpj, { valor, ate: Date.now() + validade });
}
