import { isIP } from 'node:net';

import type { Request } from 'express';

/** IP para o `VARBINARY(16)` do banco, como o `INET6_ATON` (IPv4 = 4 bytes, IPv6 = 16). */
export function ipParaBinario(ip: string | undefined): Buffer | null {
  if (!ip) return null;

  // Express entrega IPv4 mapeado em IPv6 (::ffff:200.1.2.3) atrás de proxy.
  const limpo = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  const versao = isIP(limpo);

  if (versao === 4) {
    const partes = limpo.split('.').map(Number);
    if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    return Buffer.from(partes);
  }

  if (versao === 6) {
    return ipv6ParaBinario(limpo);
  }

  return null;
}

function ipv6ParaBinario(ip: string): Buffer | null {
  const [antes = '', depois = ''] = ip.split('::');

  const grupos = (texto: string): string[] => (texto ? texto.split(':') : []);

  const esquerda = grupos(antes);
  const direita = ip.includes('::') ? grupos(depois) : [];

  if (!ip.includes('::') && esquerda.length !== 8) return null;

  const preenchimento = 8 - esquerda.length - direita.length;
  if (preenchimento < 0) return null;

  const completo = [
    ...esquerda,
    ...Array<string>(ip.includes('::') ? preenchimento : 0).fill('0'),
    ...direita,
  ];

  const buffer = Buffer.alloc(16);

  for (let i = 0; i < 8; i += 1) {
    const valor = Number.parseInt(completo[i] || '0', 16);
    if (Number.isNaN(valor) || valor < 0 || valor > 0xffff) return null;
    buffer.writeUInt16BE(valor, i * 2);
  }

  return buffer;
}

/** IP do cliente já convertido, pronto para o banco. */
export function ipDaRequisicao(req: Request): Buffer | null {
  return ipParaBinario(req.ip);
}

/** User-agent truncado no tamanho da coluna. */
export function userAgentDaRequisicao(req: Request): string | null {
  const ua = req.get('user-agent');
  return ua ? ua.slice(0, 255) : null;
}
