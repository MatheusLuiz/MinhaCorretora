import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

// Consulta de CEP (ver `CEP_API_URLS`). O `complemento` da resposta é a FAIXA do
// logradouro ("até 610 - lado par"), não o da pessoa: fica fora.

export interface EnderecoDoCep {
  cep: string;
  logradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  ibge: string | null;
}

const cache = new Map<string, { valor: EnderecoDoCep | null; ate: number }>();
const UM_DIA = 24 * 60 * 60 * 1000;
const MAXIMO_NO_CACHE = 5_000;

const texto = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t : null;
};

/** As APIs de CEP variam os nomes; esta aceita os dois dialetos comuns. */
function normalizar(cep: string, bruto: Record<string, unknown>): EnderecoDoCep {
  const uf = texto(bruto.uf) ?? texto(bruto.estado);
  return {
    cep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
    logradouro: texto(bruto.logradouro) ?? texto(bruto.street),
    bairro: texto(bruto.bairro) ?? texto(bruto.neighborhood),
    cidade: texto(bruto.localidade) ?? texto(bruto.cidade) ?? texto(bruto.city),
    uf: uf && uf.length === 2 ? uf.toUpperCase() : null,
    ibge: texto(bruto.ibge),
  };
}

export async function consultarCep(bruto: string): Promise<EnderecoDoCep | null> {
  const cep = bruto.replace(/\D/g, '');
  if (cep.length !== 8) {
    throw AppError.unprocessable('CEP precisa ter 8 dígitos.');
  }

  const guardado = cache.get(cep);
  if (guardado && guardado.ate > Date.now()) return guardado.valor;

  let ultimaFalha: string | null = null;

  for (const modelo of env.CEP_API_URLS) {
    const url = modelo.replace('{cep}', cep);
    try {
      const resposta = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(env.CEP_TIMEOUT_MS),
      });

      // 404 e 200 com `{ "erro": true }` significam "CEP não existe".
      if (resposta.status === 404) {
        guardar(cep, null, UM_DIA / 24);
        return null;
      }
      if (!resposta.ok) {
        ultimaFalha = `${url} → HTTP ${resposta.status}`;
        continue;
      }

      const corpo = (await resposta.json()) as Record<string, unknown>;
      if (corpo.erro === true || corpo.erro === 'true') {
        guardar(cep, null, UM_DIA / 24);
        return null;
      }

      const endereco = normalizar(cep, corpo);
      guardar(cep, endereco, 30 * UM_DIA);
      return endereco;
    } catch (erro) {
      ultimaFalha = `${url} → ${erro instanceof Error ? ((erro as { cause?: { code?: string } }).cause?.code ?? erro.name) : 'erro'}`;
    }
  }

  logger.warn({ cep, ultimaFalha }, 'Consulta de CEP indisponível');
  throw AppError.badGateway('A consulta de CEP está indisponível agora. Preencha o endereço à mão.');
}

function guardar(cep: string, valor: EnderecoDoCep | null, validade: number): void {
  if (cache.size >= MAXIMO_NO_CACHE) {
    const primeiro = cache.keys().next().value;
    if (primeiro !== undefined) cache.delete(primeiro);
  }
  cache.set(cep, { valor, ate: Date.now() + validade });
}
