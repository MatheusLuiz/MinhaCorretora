import { Algorithm, hash, verify } from '@node-rs/argon2';

import { env } from '../config/env.js';

/**
 * Argon2id na linha de base da OWASP (19 MiB, t=2, p=1). Mudar não quebra senhas:
 * o hash carrega os parâmetros, e `precisaRehash()` detecta os defasados.
 */
const OPCOES_ARGON2 = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hash descartável para e-mail inexistente custar o mesmo tempo que um real. */
const HASH_FALSO = hash('senha-inexistente-para-equalizar-tempo', OPCOES_ARGON2);

export async function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, OPCOES_ARGON2);
}

export async function verificarSenha(hashArmazenado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha, OPCOES_ARGON2);
  } catch {
    // Hash corrompido = senha errada; a exceção não sobe com o hash junto.
    return false;
  }
}

/** Queima o mesmo tempo de uma verificação real, para e-mails inexistentes. */
export async function verificacaoFalsa(): Promise<void> {
  try {
    await verify(await HASH_FALSO, 'qualquer-coisa', OPCOES_ARGON2);
  } catch {
    /* irrelevante: o objetivo é só o custo de CPU */
  }
}

/**
 * O hash (PHC: `$argon2id$v=19$m=…,t=…,p=…$sal$digest`) tem custo MENOR que o
 * atual? Custo maior fica como está.
 */
export function precisaRehash(hashArmazenado: string): boolean {
  const partes = hashArmazenado.split('$');

  // ['', 'argon2id', 'v=19', 'm=...,t=...,p=...', sal, digest]
  if (partes.length < 6) return true;
  if (partes[1] !== 'argon2id') return true;

  const parametros = new Map(
    (partes[3] ?? '')
      .split(',')
      .map((par) => par.split('='))
      .filter((par): par is [string, string] => par.length === 2)
      .map(([chave, valor]) => [chave.trim(), Number(valor)]),
  );

  const memoria = parametros.get('m');
  const iteracoes = parametros.get('t');
  const paralelismo = parametros.get('p');

  if (
    memoria === undefined || Number.isNaN(memoria) ||
    iteracoes === undefined || Number.isNaN(iteracoes) ||
    paralelismo === undefined || Number.isNaN(paralelismo)
  ) {
    return true;
  }

  return (
    memoria < OPCOES_ARGON2.memoryCost ||
    iteracoes < OPCOES_ARGON2.timeCost ||
    paralelismo < OPCOES_ARGON2.parallelism
  );
}

export interface ResultadoForcaSenha {
  valida: boolean;
  problemas: string[];
}

/** Minúsculas e sem acento, para "José" casar com "jose". */
function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Política de senha: comprimento pesa mais que composição. */
export function avaliarForcaSenha(senha: string, dadosPessoais: string[] = []): ResultadoForcaSenha {
  const problemas: string[] = [];
  const minimo = env.SENHA_TAMANHO_MINIMO;

  if (senha.length < minimo) {
    problemas.push(`A senha precisa ter no mínimo ${minimo} caracteres.`);
  }

  if (senha.length > 128) {
    // Limite superior evita DoS: Argon2id sobre uma senha de 1 MB queima CPU.
    problemas.push('A senha pode ter no máximo 128 caracteres.');
  }

  if (!/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    problemas.push('A senha precisa combinar letras e números.');
  }

  if (/^(.)\1+$/.test(senha)) {
    problemas.push('A senha não pode ser um único caractere repetido.');
  }

  const senhaNormalizada = normalizar(senha);

  // Por palavra: a string inteira ("joao silva") deixaria passar "JoaoSilva2026".
  const termosPessoais = dadosPessoais
    .flatMap((dado) => normalizar(dado).split(/[^a-z0-9]+/))
    .filter((termo) => termo.length >= 4);

  if (termosPessoais.some((termo) => senhaNormalizada.includes(termo))) {
    problemas.push('A senha não pode conter seu nome ou e-mail.');
  }

  // Inclui o vocabulário da própria corretora, que listas genéricas não cobrem.
  const SEQUENCIAS_COMUNS = [
    '123456', 'password', 'senha', 'qwerty', 'abc123',
    'admin', '111111', 'seguro', 'minhacorretora', 'corretora',
  ];

  if (SEQUENCIAS_COMUNS.some((termo) => senhaNormalizada.includes(termo))) {
    problemas.push('A senha contém uma sequência muito comum.');
  }

  return { valida: problemas.length === 0, problemas };
}
