/**
 * Cliente HTTP da API. O access token fica só em memória (nunca em storage); um 401
 * tenta o refresh, e chamadas simultâneas compartilham a mesma promessa — refreshes
 * paralelos seriam tratados como reúso pela rotação e derrubariam a sessão.
 */

const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api';

let tokenEmMemoria: string | null = null;
let refreshEmAndamento: Promise<string | null> | null = null;
let aoPerderSessao: (() => void) | null = null;

export function definirAccessToken(token: string | null): void {
  tokenEmMemoria = token;
}

export function obterAccessToken(): string | null {
  return tokenEmMemoria;
}

/** Callback chamado quando a sessão não pode mais ser renovada. */
export function definirHandlerSessaoPerdida(handler: (() => void) | null): void {
  aoPerderSessao = handler;
}

export interface ApiErrorBody {
  erro: {
    codigo: string;
    mensagem: string;
    detalhes?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly codigo: string;
  readonly detalhes?: unknown;

  constructor(status: number, codigo: string, mensagem: string, detalhes?: unknown) {
    super(mensagem);
    this.name = 'ApiError';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }

  /** Lista plana de mensagens de validação, quando houver. */
  get mensagensDeValidacao(): string[] {
    if (!Array.isArray(this.detalhes)) return [];

    return this.detalhes
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'mensagem' in item) {
          return String((item as { mensagem: unknown }).mensagem);
        }
        return null;
      })
      .filter((mensagem): mensagem is string => Boolean(mensagem));
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Uso interno: evita loop infinito de refresh. */
  _jaTentouRenovar?: boolean;
  /** Rotas públicas (login, refresh) não devem disparar renovação. */
  semAutenticacao?: boolean;
}

interface RespostaSessao {
  accessToken: string;
}

/** Token de CSRF do cookie (legível de propósito): outro site faz o navegador enviá-lo, mas não o lê. */
function tokenCsrf(): string | null {
  const achado = document.cookie
    .split('; ')
    .find((p) => p.startsWith('minhacorretora_csrf='));

  return achado ? decodeURIComponent(achado.slice('minhacorretora_csrf='.length)) : null;
}

/** Cabeçalhos das rotas que autenticam pelo cookie: refresh e logout. */
export function cabecalhosDeCookie(): Record<string, string> {
  const csrf = tokenCsrf();
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

async function renovarToken(): Promise<string | null> {
  refreshEmAndamento ??= (async () => {
    try {
      const resposta = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', ...cabecalhosDeCookie() },
      });

      if (!resposta.ok) return null;

      const dados = (await resposta.json()) as RespostaSessao;
      tokenEmMemoria = dados.accessToken;
      return dados.accessToken;
    } catch {
      return null;
    } finally {
      // Libera para a próxima rodada só depois que esta terminou.
      queueMicrotask(() => {
        refreshEmAndamento = null;
      });
    }
  })();

  return refreshEmAndamento;
}

/** Corpo já binário vai como está: `JSON.stringify(arrayBuffer)` devolve "{}" sem erro. */
function corpoBinario(body: unknown): BodyInit | null {
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) return body as unknown as BodyInit;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
  return null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, _jaTentouRenovar, semAutenticacao, ...rest } = options;

  const binario = body === undefined ? null : corpoBinario(body);

  const resposta = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      // Só declara JSON quando o corpo é JSON; para binário vale o cabeçalho do chamador.
      ...(body !== undefined && !binario ? { 'Content-Type': 'application/json' } : {}),
      ...(tokenEmMemoria && !semAutenticacao
        ? { Authorization: `Bearer ${tokenEmMemoria}` }
        : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: binario ?? JSON.stringify(body) } : {}),
  });

  if (resposta.status === 401 && !_jaTentouRenovar && !semAutenticacao) {
    const novoToken = await renovarToken();

    if (novoToken) {
      return apiRequest<T>(path, { ...options, _jaTentouRenovar: true });
    }

    tokenEmMemoria = null;
    aoPerderSessao?.();
  }

  if (resposta.status === 204) {
    return undefined as T;
  }

  const texto = await resposta.text();
  let payload: unknown = null;

  try {
    payload = texto ? JSON.parse(texto) : null;
  } catch {
    // Resposta não-JSON (proxy fora do ar, HTML de erro do servidor).
    if (!resposta.ok) {
      throw new ApiError(resposta.status, 'RESPOSTA_INVALIDA', 'Resposta inesperada do servidor.');
    }
  }

  if (!resposta.ok) {
    const erro = (payload as ApiErrorBody | null)?.erro;
    throw new ApiError(
      resposta.status,
      erro?.codigo ?? 'UNKNOWN',
      erro?.mensagem ?? 'Falha na comunicação com o servidor.',
      erro?.detalhes,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

export { renovarToken };
