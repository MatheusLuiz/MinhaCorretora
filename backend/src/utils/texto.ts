/**
 * Decodifica texto em UTF-8 estrito e, se inválido, em windows-1252 (CSV via Excel).
 * A ordem importa: 1252 aceita qualquer byte e estragaria um UTF-8 legítimo.
 */
export function decodificarTexto(conteudo: Buffer): string {
  if (conteudo.length >= 3 && conteudo[0] === 0xef && conteudo[1] === 0xbb && conteudo[2] === 0xbf) {
    return conteudo.subarray(3).toString('utf8');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(conteudo);
  } catch {
    return new TextDecoder('windows-1252').decode(conteudo);
  }
}

/** Codificação detectada; windows-1252 indica que o arquivo passou pelo Excel. */
export function detectarCodificacao(conteudo: Buffer): 'utf-8' | 'windows-1252' {
  if (conteudo.length >= 3 && conteudo[0] === 0xef && conteudo[1] === 0xbb && conteudo[2] === 0xbf) {
    return 'utf-8';
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(conteudo);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

/** E-mail em caixa alta; a máscara do e-mail (`/x{4,}/i`) segue detectável. */
export function emailEmCaixaAlta(email: string): string;
export function emailEmCaixaAlta(email: string | null): string | null;
export function emailEmCaixaAlta(email: string | null): string | null {
  return email === null ? null : email.trim().toUpperCase();
}

/**
 * Nome e cidade em CAIXA ALTA (aplicado nos repositórios). Nome MASCARADO fica
 * como veio: em caixa alta a minúscula após os X some e a máscara deixa de ser detectada.
 */
export function nomeEmCaixaAlta(nome: string): string;
export function nomeEmCaixaAlta(nome: string | null): string | null;
export function nomeEmCaixaAlta(nome: string | null): string | null {
  if (nome === null) return null;
  if (/(?:^|[^\p{L}])X{2,}\p{Ll}/u.test(nome)) return nome;
  return nome.toLocaleUpperCase('pt-BR');
}

/** Bytes 0x80–0x9F do windows-1252, que `Buffer.from(_, 'latin1')` não sabe reverter. */
const CP1252_ALTOS = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/**
 * Conserta UTF-8 lido como windows-1252 (o analítico da Porto mistura as duas).
 * Só age com a assinatura `Ã`/`Â` + caractere alto E releitura UTF-8 válida.
 */
export function repararMojibake(texto: string): string {
  const assinatura =
    /[ÃÂ][\u0080-¿–—‘-„†-•…‰‹›€ŒœŠšŸŽžƒˆ˜™]/;

  if (!assinatura.test(texto)) return texto;

  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    const byte = c < 0x100 ? c : CP1252_ALTOS.get(c);
    if (byte === undefined) return texto;
    bytes[i] = byte;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return texto;
  }
}

/** Sem acento e em caixa alta, para comparar nome com nome. */
export function semAcentoMaiusculo(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

/** "José da Silva-Júnior" → "JOSE DA SILVA JUNIOR": a mesma chave dos dois lados. */
export const chaveDoNome = (nome: string | undefined): string =>
  semAcentoMaiusculo(nome ?? '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Regex que só o nome verdadeiro preenche; `.{n}` conta as letras escondidas pelos X. */
export function desenhoDaMascara(nomeMascarado: string): RegExp | null {
  if (!/(?:^|[^\p{L}])X{2,}\p{Ll}/u.test(nomeMascarado)) return null;

  const corpo = semAcentoMaiusculo(nomeMascarado)
    .split(/(X{2,})/)
    .map((parte) =>
      /^X{2,}$/.test(parte)
        ? `.{${parte.length}}`
        : parte.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&'),
    )
    .join('');

  return new RegExp(`^${corpo}$`);
}
