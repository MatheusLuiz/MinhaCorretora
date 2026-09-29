import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

import { env } from '../config/env.js';

/*
 * AES-256-GCM para segredos que o servidor precisa RECUPERAR (credenciais de
 * integração). Chave via HKDF com rótulo próprio, de SEGREDOS_KEY (senão do
 * JWT_SECRET); nonce novo a cada gravação. Trocar a chave inutiliza o que já foi gravado.
 */

const ROTULO = Buffer.from('minhacorretora-bi:integracao:v1');
const TAMANHO_NONCE = 12;
const TAMANHO_TAG = 16;

function chave(): Buffer {
  const material = env.SEGREDOS_KEY ?? env.JWT_SECRET;

  return Buffer.from(hkdfSync('sha256', Buffer.from(material), ROTULO, Buffer.alloc(0), 32));
}

/** Pacote gravável: nonce ‖ tag ‖ cifra. */
export function cifrar(texto: string): Buffer {
  const nonce = randomBytes(TAMANHO_NONCE);
  const cifrador = createCipheriv('aes-256-gcm', chave(), nonce);

  const cifra = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);

  return Buffer.concat([nonce, cifrador.getAuthTag(), cifra]);
}

/** `null` quando o pacote não abre (chave trocada): a tela pede novo cadastro em vez de dar 500. */
export function decifrar(pacote: Buffer): string | null {
  try {
    if (pacote.length <= TAMANHO_NONCE + TAMANHO_TAG) return null;

    const nonce = pacote.subarray(0, TAMANHO_NONCE);
    const tag = pacote.subarray(TAMANHO_NONCE, TAMANHO_NONCE + TAMANHO_TAG);
    const cifra = pacote.subarray(TAMANHO_NONCE + TAMANHO_TAG);

    const decifrador = createDecipheriv('aes-256-gcm', chave(), nonce);
    decifrador.setAuthTag(tag);

    return Buffer.concat([decifrador.update(cifra), decifrador.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Os últimos 4 caracteres: bastam para reconhecer, não para usar. */
export function dica(segredo: string): string | null {
  const limpo = segredo.trim();
  return limpo.length >= 4 ? `…${limpo.slice(-4)}` : null;
}
