/** O que fica gravado. `'sistema'` = a pessoa ainda não escolheu. */
export type Tema = 'claro' | 'escuro' | 'rosa' | 'sistema';

/** Os temas que aparecem para escolha (o seletor do menu do usuário). */
export type TemaVisivel = Exclude<Tema, 'sistema'>;

// A mesma chave (e valores) do script inline de `index.html` — mantenha os dois em sincronia.
const CHAVE = 'minhacorretora:tema';

const TEMAS: readonly TemaVisivel[] = ['claro', 'escuro', 'rosa'];

/**
 * `'sistema'` acompanha o SO. Rosa = tema claro + `data-paleta`, não outro `data-theme`
 * (o modo escuro do CSS vale para todo data-theme ≠ light). localStorage pode lançar.
 */
export function lerTema(): Tema {
  try {
    const guardado = localStorage.getItem(CHAVE);
    if ((TEMAS as readonly string[]).includes(guardado ?? '')) return guardado as TemaVisivel;
  } catch {
    /* localStorage indisponível — cai no padrão */
  }

  return 'sistema';
}

export function gravarTema(tema: Tema): void {
  try {
    if (tema === 'sistema') localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, tema);
  } catch {
    /* sem persistência; a escolha vale só nesta aba */
  }
}

/** O que o sistema operacional pede agora. */
export function sistemaPrefereEscuro(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** O tema valendo na tela, com `'sistema'` resolvido — é o que o seletor marca. */
export function temaEfetivo(): TemaVisivel {
  const guardado = lerTema();
  if (guardado !== 'sistema') return guardado;
  return sistemaPrefereEscuro() ? 'escuro' : 'claro';
}

/** `'sistema'` REMOVE o atributo, para o CSS acompanhar o SO pelo media query. */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;

  if (tema === 'sistema') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', tema === 'escuro' ? 'dark' : 'light');

  if (tema === 'rosa') raiz.setAttribute('data-paleta', 'rosa');
  else raiz.removeAttribute('data-paleta');
}

/** Só importa enquanto a pessoa não escolheu um tema. */
export function observarTemaDoSistema(aoMudar: () => void): () => void {
  try {
    const consulta = window.matchMedia('(prefers-color-scheme: dark)');
    consulta.addEventListener('change', aoMudar);
    return () => consulta.removeEventListener('change', aoMudar);
  } catch {
    return () => {};
  }
}
