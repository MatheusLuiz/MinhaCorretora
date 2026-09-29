import { decodificarTexto } from './texto.js';

/*
 * `.xls` que por dentro é HTML (exportação de portal). Regex basta: tabela gerada
 * por máquina, sem aninhamento — tabela dentro de tabela daria linhas erradas.
 */

/** O conteúdo é HTML, independentemente de o arquivo se chamar `.xls`. */
export function pareceTabelaHtml(conteudo: Buffer): boolean {
  const inicio = conteudo.subarray(0, 512).toString('latin1').toLowerCase();
  return inicio.includes('<html') && inicio.includes('<t');
}

/** Entidades e marcação viram texto puro. */
function textoDaCelula(bruto: string): string {
  return bruto
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grade como a de `lerXlsx`; os `<th>` (soltos, fora de `<tr>`) viram a linha 0. */
export function lerTabelaHtml(conteudo: Buffer): string[][] {
  // Há portal que exporta em windows-1252.
  const html = decodificarTexto(conteudo);

  const cabecalho = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    textoDaCelula(m[1] ?? ''),
  );

  const linhas = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((m) =>
      [...(m[1] ?? '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
        textoDaCelula(c[1] ?? ''),
      ),
    )
    .filter((l) => l.length > 0 && l.some((v) => v !== ''));

  return cabecalho.length > 0 ? [cabecalho, ...linhas] : linhas;
}

