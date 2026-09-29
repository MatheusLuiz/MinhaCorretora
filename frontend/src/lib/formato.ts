/** Formatação de números para a tela. */

/** Dinheiro, sempre com centavos: a tela é conferida contra o extrato da companhia ao centavo. */
export function formatarReais(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Versão compacta para eixo de gráfico ("R$ 1,2 mi" se lê como aproximação). */
export function formatarReaisCompacto(valor: number): string {
  if (Math.abs(valor) >= 1_000_000) {
    return `R$ ${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  }
  // Abaixo de 10 mil, uma casa: arredondar ao milhar repetia "R$ 2 mil" em marcas diferentes.
  if (Math.abs(valor) >= 1_000) {
    return `R$ ${(valor / 1_000).toLocaleString('pt-BR', {
      maximumFractionDigits: Math.abs(valor) < 10_000 ? 1 : 0,
    })} mil`;
  }
  // Sem centavo: é escala de eixo, e "R$ 212,50" não cabia na margem.
  return `R$ ${Math.round(valor).toLocaleString('pt-BR')}`;
}

export function formatarNumero(valor: number): string {
  return Math.round(valor).toLocaleString('pt-BR');
}

export function formatarPercentual(valor: number, casas = 1): string {
  return `${valor.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

export function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/** `2026-09` → `set/26`. Rótulo de eixo, onde o ano inteiro não cabe. */
export function formatarCompetencia(periodo: string): string {
  const [ano, mes] = periodo.split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const indice = Number(mes) - 1;

  return nomes[indice] ? `${nomes[indice]}/${(ano ?? '').slice(2)}` : periodo;
}
