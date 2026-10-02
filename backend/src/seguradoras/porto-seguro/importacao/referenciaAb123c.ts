import { arquivosDaOrigem } from '../../../services/arquivoAuditoria.service.js';
import { normalizarNomeColuna } from '../../../services/colunasImportacao.js';
import { chaveDoNome, desenhoDaMascara, semAcentoMaiusculo } from '../../../utils/texto.js';
import { lerXlsx, pareceXlsx } from '../../../utils/xlsx.js';

/**
 * CPF pelo número da apólice nas cópias guardadas do "Apólices_AB123C" (a mais recente vence).
 * Só vale se o nome limpo preencher a máscara de lá: prova de que o número não trocou de dono.
 */

export interface ApoliceAb123c {
  documento: string;
  nomeMascarado: string;
}

const so = (v: string | undefined): string => (v ?? '').trim();

export async function apolicesAb123cGuardadas(): Promise<{ copias: number; porNumero: Map<string, ApoliceAb123c> }> {
  const porNumero = new Map<string, ApoliceAb123c>();
  const copias = await arquivosDaOrigem('porto-seguro', /apolices-ab123c/i);
  for (const { conteudo } of copias) {
    if (!pareceXlsx(conteudo)) continue;
    const g = lerXlsx(conteudo);
    const cab = (g[0] ?? []).map(normalizarNomeColuna);
    const i = (n: string): number => cab.indexOf(n);
    const col = { ramo: i('ramo'), sucursal: i('sucursal'), apolice: i('apolice'), documento: i('cpfcnpj'), nome: i('nomerazaosocial') };
    if (Object.values(col).some((c) => c < 0)) continue;
    for (const l of g.slice(1)) {
      const [ramo, sucursal, apolice] = [so(l[col.ramo]), so(l[col.sucursal]), so(l[col.apolice])];
      const documento = so(l[col.documento]).replace(/\D/g, '');
      if (!ramo || !sucursal || !apolice || (documento.length !== 11 && documento.length !== 14)) continue;
      porNumero.set(`${ramo}-${sucursal}-${apolice}`, { documento, nomeMascarado: so(l[col.nome]) });
    }
  }
  return { copias: copias.length, porNumero };
}

/** O nome limpo da consulta é o dono do nome (mascarado) do AB123C? */
export function mesmoSegurado(nomeLimpo: string, nomeMascarado: string): boolean {
  const molde = desenhoDaMascara(nomeMascarado);
  if (molde) return molde.test(semAcentoMaiusculo(nomeLimpo).trim());
  return chaveDoNome(nomeLimpo) === chaveDoNome(nomeMascarado);
}
