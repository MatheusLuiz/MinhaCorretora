import { WIDGETS } from '@/widgets/catalogo';

/** Preferências da Visão Geral em `localStorage`, por navegador; a chave inclui o id do usuário. */

// `v2`: descarta as escolhas anteriores ao padrão por papel.
const PREFIXO = 'minhacorretora:visao-geral:v2:';

export interface PreferenciasVisaoGeral {
  /** Ids do catálogo, na ordem em que devem aparecer. */
  widgets: string[];
}

/** O que a tela lê: a lista, e se ela é escolha da pessoa ou padrão. */
export interface PreferenciasLidas extends PreferenciasVisaoGeral {
  /** `false` = nunca personalizou (ou restaurou): vale o padrão do papel. */
  personalizada: boolean;
}

function chave(usuarioId: string): string {
  return `${PREFIXO}${usuarioId}`;
}

/** O padrão do PAPEL, quando ele define e algum id ainda existe; senão, o do catálogo. */
export function padraoVisaoGeral(doPapel?: string[] | null): string[] {
  const doPapelValidos = (doPapel ?? []).filter((id) => WIDGETS.some((w) => w.id === id));
  if (doPapelValidos.length > 0) return doPapelValidos;
  return WIDGETS.filter((w) => w.padraoNaVisaoGeral).map((w) => w.id);
}

export function lerPreferencias(usuarioId: string): PreferenciasLidas {
  try {
    const bruto = localStorage.getItem(chave(usuarioId));
    if (!bruto) return { widgets: padraoVisaoGeral(), personalizada: false };

    const dados = JSON.parse(bruto) as PreferenciasVisaoGeral;

    // Ignora ids que saíram do catálogo.
    const validos = dados.widgets?.filter((id) => WIDGETS.some((w) => w.id === id)) ?? [];

    return validos.length > 0
      ? { widgets: validos, personalizada: true }
      : { widgets: padraoVisaoGeral(), personalizada: false };
  } catch {
    // localStorage indisponível ou JSON corrompido: vale o padrão.
    return { widgets: padraoVisaoGeral(), personalizada: false };
  }
}

export function gravarPreferencias(usuarioId: string, prefs: PreferenciasVisaoGeral): void {
  try {
    localStorage.setItem(chave(usuarioId), JSON.stringify(prefs));
  } catch {
    /* sem persistência; a escolha vale só nesta sessão */
  }
}

export function limparPreferencias(usuarioId: string): void {
  try {
    localStorage.removeItem(chave(usuarioId));
  } catch {
    /* nada a fazer */
  }
}
