/**
 * Ícones em SVG inline (grade de 24px, traço 1.75, `currentColor`). `aria-hidden`
 * porque o ícone sempre acompanha um rótulo de texto.
 */

export type NomeIcone =
  | 'painel'
  | 'dashboards'
  | 'producao'
  | 'comissoes'
  | 'sinistralidade'
  | 'renovacoes'
  | 'carteira'
  | 'clientes'
  | 'apolices'
  | 'sinistros'
  | 'integracao'
  | 'sair'
  | 'configuracoes'
  | 'seta'
  | 'fixar'
  | 'email';

interface Props {
  nome: NomeIcone;
  /** Tamanho em px. 20 na sidebar, 16 em uso inline. */
  tamanho?: number;
  className?: string;
}

const TRACADOS: Record<NomeIcone, React.JSX.Element> = {
  painel: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  dashboards: (
    <>
      <path d="M3 20h18" />
      <rect x="5" y="11" width="4" height="9" rx="1" />
      <rect x="10" y="6" width="4" height="14" rx="1" />
      <rect x="15" y="14" width="4" height="6" rx="1" />
    </>
  ),
  producao: (
    <>
      <path d="M3 17l5.5-5.5 3.5 3.5L21 6" />
      <path d="M15 6h6v6" />
    </>
  ),
  comissoes: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.5v11" />
      <path d="M14.8 9.4a2.8 2.8 0 0 0-2.8-1.6c-1.6 0-2.8.9-2.8 2.2 0 2.9 5.6 1.6 5.6 4.4 0 1.3-1.2 2.2-2.8 2.2a2.8 2.8 0 0 1-2.8-1.6" />
    </>
  ),
  sinistralidade: (
    <>
      <path d="M12 3.8 21 19.2H3L12 3.8z" />
      <path d="M12 10v4" />
      <path d="M12 17.2h.01" />
    </>
  ),
  renovacoes: (
    <>
      <path d="M20.5 11a8.5 8.5 0 0 0-14.8-4.4L3 9.5" />
      <path d="M3.5 13a8.5 8.5 0 0 0 14.8 4.4L21 14.5" />
      <path d="M3 4.5v5h5" />
      <path d="M21 19.5v-5h-5" />
    </>
  ),
  carteira: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9h-9V3z" />
      <path d="M15.5 3.8A9 9 0 0 1 20.2 8.5h-4.7V3.8z" />
    </>
  ),
  clientes: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4" />
      <path d="M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  apolices: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16.5h4.5" />
    </>
  ),
  sinistros: (
    <>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3z" />
      <path d="M12 9v3.5" />
      <path d="M12 15.5h.01" />
    </>
  ),
  integracao: (
    <>
      <path d="M9 3v5" />
      <path d="M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z" />
      <path d="M12 17v4" />
    </>
  ),
  sair: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h10" />
    </>
  ),
  configuracoes: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.46-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  seta: <path d="M9 5l7 7-7 7" />,
  fixar: (
    <>
      <path d="M12 16v5" />
      <path d="M8.5 3h7l-1 6 3 3.5H6.5l3-3.5-1-6z" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </>
  ),
};

export function Icone({ nome, tamanho = 20, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACADOS[nome]}
    </svg>
  );
}
