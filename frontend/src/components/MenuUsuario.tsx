import { useEffect, useRef, useState } from 'react';

import { Icone } from '@/components/Icone';
import { OPCOES_TEMA, SeletorTema } from '@/components/SeletorTema';
import { useAuth } from '@/hooks/useAuth';
import {
  aplicarTema,
  gravarTema,
  lerTema,
  observarTemaDoSistema,
  temaEfetivo,
  type TemaVisivel,
} from '@/lib/tema';

// Papel ausente daqui aparece pela chave.
const ROTULO_PAPEL: Record<string, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  corretor_corretora: 'Corretor — Corretora',
  corretor_loja: 'Corretor — Loja',
  corretor_renovacao: 'Corretor — Renovação',
  parcelas: 'Parcelas',
};

/** Nome do usuário com menu suspenso. */
export function MenuUsuario(): React.JSX.Element {
  const { usuario, sair } = useAuth();
  const [aberto, setAberto] = useState(false);
  const [tema, setTema] = useState<TemaVisivel>(() => temaEfetivo());
  const [seletorTema, setSeletorTema] = useState(false);

  const container = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);

  // Sem escolha gravada, acompanha o tema do sistema ao vivo.
  useEffect(() => {
    if (lerTema() !== 'sistema') return;
    return observarTemaDoSistema(() => setTema(temaEfetivo()));
  }, []);

  function escolherTema(proximo: TemaVisivel): void {
    setTema(proximo);
    aplicarTema(proximo);
    gravarTema(proximo);
  }

  useEffect(() => {
    if (!aberto) return;

    // `pointerdown` cobre toque e chega antes do `click` do alvo.
    function aoApontar(evento: PointerEvent): void {
      if (!container.current?.contains(evento.target as Node)) setAberto(false);
    }

    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') {
        setAberto(false);
        gatilho.current?.focus();
      }
    }

    document.addEventListener('pointerdown', aoApontar);
    document.addEventListener('keydown', aoTeclar);

    return () => {
      document.removeEventListener('pointerdown', aoApontar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  return (
    <div className="menu-usuario" ref={container}>
      <SeletorTema
        aberto={seletorTema}
        atual={tema}
        aoEscolher={escolherTema}
        aoFechar={() => setSeletorTema(false)}
      />

      <button
        ref={gatilho}
        type="button"
        className={`menu-usuario__gatilho${aberto ? ' menu-usuario__gatilho--aberto' : ''}`}
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="menu"
      >
        <span className="menu-usuario__dados">
          <strong>{usuario?.nome}</strong>
          <small>{ROTULO_PAPEL[usuario?.papel ?? ''] ?? usuario?.papel}</small>
        </span>

        <span className="menu-usuario__avatar" aria-hidden="true">
          {iniciais(usuario?.nome)}
        </span>

        <span className={`menu-usuario__seta${aberto ? ' menu-usuario__seta--aberta' : ''}`}>
          <Icone nome="seta" tamanho={13} />
        </span>
      </button>

      {aberto && (
        <div className="menu-usuario__painel" role="menu">
          <header className="menu-usuario__cabecalho">
            <span className="menu-usuario__avatar menu-usuario__avatar--grande" aria-hidden="true">
              {iniciais(usuario?.nome)}
            </span>
            <span className="menu-usuario__identidade">
              <strong>{usuario?.nome}</strong>
              <small>{usuario?.email}</small>
            </span>
          </header>

          <div className="menu-usuario__grupo">
            <button
              type="button"
              className="menu-usuario__item"
              role="menuitem"
              onClick={() => {
                setAberto(false);
                setSeletorTema(true);
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.4-9-7.4z" />
                <circle cx="7.5" cy="11.5" r="1" />
                <circle cx="10.5" cy="7.5" r="1" />
                <circle cx="15" cy="8" r="1" />
              </svg>
              Tema
              <small className="menu-usuario__valor">{OPCOES_TEMA.find((o) => o.tema === tema)?.nome}</small>
            </button>
          </div>

          <div className="menu-usuario__grupo">
            <button
              type="button"
              className="menu-usuario__item menu-usuario__item--sair"
              role="menuitem"
              onClick={() => void sair()}
            >
              <Icone nome="sair" tamanho={16} />
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function iniciais(nome: string | undefined): string {
  if (!nome) return '?';

  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';

  return (primeira + ultima).toUpperCase();
}
