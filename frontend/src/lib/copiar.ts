/** Copia para a área de transferência. `navigator.clipboard` não existe por HTTP (acesso pelo IP): cai no `execCommand`. */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Permissão negada: tenta o caminho antigo abaixo.
    }
  }

  const campo = document.createElement('textarea');
  campo.value = texto;
  campo.setAttribute('readonly', '');
  // Fora da tela, mas visível: elemento com `display: none` não copia.
  campo.style.position = 'fixed';
  campo.style.top = '-1000px';
  campo.style.opacity = '0';
  document.body.appendChild(campo);

  const foco = document.activeElement as HTMLElement | null;
  campo.select();
  campo.setSelectionRange(0, texto.length);

  let copiou = false;
  try {
    copiou = document.execCommand('copy');
  } catch {
    copiou = false;
  }

  document.body.removeChild(campo);
  // Devolve o foco ao botão: quem navega por teclado não perde o lugar.
  foco?.focus();
  return copiou;
}
