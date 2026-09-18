import { useEffect, useId, useRef } from 'react';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  /** Largura máxima. 'largo' para conteúdo com tabela. */
  tamanho?: 'pequeno' | 'medio' | 'largo';
}

/**
 * Diálogo modal sobre o `<dialog>` nativo (prisão de foco, Esc, camada superior
 * e `inert` de graça). Fechar no fundo e devolver o foco ficam por nossa conta.
 */
export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  tamanho = 'medio',
}: Props): React.JSX.Element | null {
  const refDialogo = useRef<HTMLDialogElement>(null);
  const refFocoAnterior = useRef<HTMLElement | null>(null);
  // Ids próprios: com modal sobre modal, ids fixos repetiriam e o título lido seria o errado.
  const id = useId();

  /** Destrava a rolagem só se não sobrar outro modal aberto por baixo. */
  const liberarRolagem = (): void => {
    const outroAberto = [...document.querySelectorAll('dialog[open]')].some((d) => d !== refDialogo.current);
    if (!outroAberto) document.body.style.overflow = '';
  };

  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;

    if (aberto && !dialogo.open) {
      // Devolvido ao fechar; senão o teclado recomeça do topo da página.
      refFocoAnterior.current = document.activeElement as HTMLElement | null;
      dialogo.showModal();
      // Senão a rolagem do modal "vaza" para a página atrás.
      document.body.style.overflow = 'hidden';
    }

    if (!aberto && dialogo.open) {
      dialogo.close();
    }
  }, [aberto]);

  useEffect(() => {
    return () => {
      liberarRolagem();
    };
  }, []);

  function aoFecharDialogo(): void {
    liberarRolagem();
    refFocoAnterior.current?.focus();
    aoFechar();
  }

  // O clique no backdrop chega com target = o próprio <dialog>.
  function aoClicar(evento: React.MouseEvent<HTMLDialogElement>): void {
    if (evento.target === refDialogo.current) {
      aoFecharDialogo();
    }
  }

  return (
    <dialog
      ref={refDialogo}
      className={`modal modal--${tamanho}`}
      onClose={aoFecharDialogo}
      onClick={aoClicar}
      aria-labelledby={`${id}-titulo`}
      aria-describedby={descricao ? `${id}-descricao` : undefined}
    >
      <div className="modal__caixa">
        <header className="modal__cabecalho">
          <div>
            <h2 id={`${id}-titulo`}>{titulo}</h2>
            {descricao && (
              <p id={`${id}-descricao`} className="texto-discreto">
                {descricao}
              </p>
            )}
          </div>

          <button
            type="button"
            className="modal__fechar"
            onClick={aoFecharDialogo}
            aria-label="Fechar"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="modal__corpo">{children}</div>
      </div>
    </dialog>
  );
}
