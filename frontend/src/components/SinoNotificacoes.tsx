import { useCallback, useEffect, useRef, useState } from 'react';

import { useCliente } from '@/hooks/useCliente';
import { notificacoesApi, type Notificacao } from '@/lib/notificacoes';

/** Consulta só com a aba à vista (e ao voltar para ela). */
const INTERVALO_MS = 60_000;

/** Sino de notificações; clicar num aviso abre a ficha e o marca como lido. */
export function SinoNotificacoes(): React.JSX.Element {
  const { abrir } = useCliente();
  const [aberto, setAberto] = useState(false);
  const [naoLidas, setNaoLidas] = useState(0);
  const [lista, setLista] = useState<Notificacao[]>([]);

  const container = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);

  const carregar = useCallback(() => {
    notificacoesApi
      .listar()
      .then((r) => {
        setNaoLidas(Number(r.naoLidas) || 0);
        setLista(Array.isArray(r.notificacoes) ? r.notificacoes : []);
      })
      .catch(() => {
        // Backend sem a rota ou fora do ar: o sino fica quieto.
      });
  }, []);

  useEffect(() => {
    carregar();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') carregar();
    }, INTERVALO_MS);
    const aoVoltar = (): void => {
      if (document.visibilityState === 'visible') carregar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [carregar]);

  useEffect(() => {
    if (!aberto) return;
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

  function abrirAviso(n: Notificacao): void {
    if (!n.lida) {
      setLista((atual) => atual.map((x) => (x.id === n.id ? { ...x, lida: true } : x)));
      setNaoLidas((q) => Math.max(0, q - 1));
      void notificacoesApi.marcarLida(n.id).catch(carregar);
    }
    setAberto(false);
    if (n.clienteId) abrir(n.clienteId);
  }

  function marcarTodas(): void {
    setLista((atual) => atual.map((x) => ({ ...x, lida: true })));
    setNaoLidas(0);
    void notificacoesApi.marcarTodasLidas().catch(carregar);
  }

  const rotulo =
    naoLidas > 0 ? `Notificações: ${naoLidas} não lida${naoLidas > 1 ? 's' : ''}` : 'Notificações';

  return (
    <div className="sino" ref={container}>
      <button
        ref={gatilho}
        type="button"
        className={aberto ? 'sino__gatilho sino__gatilho--aberto' : 'sino__gatilho'}
        onClick={() => {
          if (!aberto) carregar();
          setAberto(!aberto);
        }}
        aria-expanded={aberto}
        aria-haspopup="true"
        aria-label={rotulo}
        title={rotulo}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {naoLidas > 0 && <span className="sino__contador">{naoLidas > 99 ? '99+' : naoLidas}</span>}
      </button>

      {aberto && (
        <div className="sino__painel" role="dialog" aria-label="Notificações">
          <div className="sino__cabecalho">
            <strong>Notificações</strong>
            {naoLidas > 0 && (
              <button type="button" className="botao botao--discreto botao--compacto" onClick={marcarTodas}>
                Marcar todas como lidas
              </button>
            )}
          </div>

          {lista.length === 0 ? (
            <p className="sino__vazio texto-discreto">Nenhuma notificação.</p>
          ) : (
            <ul className="sino__lista">
              {lista.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.lida ? 'sino__item' : 'sino__item sino__item--nova'}
                    onClick={() => abrirAviso(n)}
                  >
                    <span className="sino__titulo">{n.titulo}</span>
                    <span className="sino__mensagem">{n.mensagem}</span>
                    <span className="sino__quando">
                      {new Date(n.criadaEm).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
