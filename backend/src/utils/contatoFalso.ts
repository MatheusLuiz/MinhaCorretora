/*
 * Contato de PREENCHIMENTO ("naotem@…", e-mail e telefone da corretora, dígitos
 * repetidos): não é do cliente e não entra no cadastro.
 */

/** "Não tem" escrito de qualquer jeito, antes ou depois do @. */
const NAO_TEM = /(^|[@.])n[aã]?o?\s*t[e]?m+j?([@.]|$)|^n[aã]o@|@n?[aã]?o?informado\.|^n[aã]?o?informado@|^sem\s*e?-?mail@|^nt@|@nt\.com/i;
/** Domínio da CORRETORA = funcionário; e-mail de outra empresa é do cliente. */
const DA_CORRETORA = /@minhacorretora\.com/i;
/** Telefones da corretora (com ou sem DDD). */
const TELEFONES_DA_CORRETORA = ['4133330000', '33330000', '4144440000', '44440000'];

export function emailFalso(email: string | null | undefined): boolean {
  const e = (email ?? '').trim();
  return !e || NAO_TEM.test(e) || DA_CORRETORA.test(e);
}

export function telefoneFalso(telefone: string | null | undefined): boolean {
  // Sem o zero de discagem: "004133330000" também é o da corretora.
  const d = (telefone ?? '').replace(/\D/g, '').replace(/^0+/, '');
  // Todos os dígitos iguais depois do DDD (41 99999-9999, 0000-0000).
  const corpo = d.length >= 10 ? d.slice(2) : d;
  return !d || TELEFONES_DA_CORRETORA.includes(d) || /^(\d)\1+$/.test(corpo);
}
