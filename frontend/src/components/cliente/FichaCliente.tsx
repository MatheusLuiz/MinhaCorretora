import { useEffect, useRef, useState } from 'react';

import { EdicaoCliente } from '@/components/cliente/EdicaoCliente';
import { FichaClienteImportado } from '@/components/cliente/FichaClienteImportado';
import { NovaApolice } from '@/components/cliente/NovaApolice';
import { useAuth } from '@/hooks/useAuth';
import { useCliente } from '@/hooks/useCliente';
import { clientesApi, type ClienteCompleto } from '@/lib/clientes';

/**
 * Ficha do cliente em painel lateral: a lista atrás fica visível e mantém
 * rolagem e filtro. Renderizada uma vez no layout; quem abre é o contexto.
 */
export function FichaCliente(): React.JSX.Element | null {
  const { aberto, fechar } = useCliente();
  const [cliente, setCliente] = useState<ClienteCompleto | null>(null);
  const [carregando, setCarregando] = useState(false);
  // Abre sempre em leitura: reduz o risco de salvar sem querer.
  const [editando, setEditando] = useState(false);
  const [cadastrandoApolice, setCadastrandoApolice] = useState(false);
  const [abaInicial, setAbaInicial] = useState<'cadastro' | 'apolices'>('cadastro');
  const { temPermissao } = useAuth();

  const painel = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!aberto) {
      setCliente(null);
      return;
    }

    let cancelado = false;
    // Sem isso, o formulário de um cliente ficaria preenchido com o outro.
    setEditando(false);
    setCadastrandoApolice(false);
    setAbaInicial('cadastro');
    setCarregando(true);
    focoAnterior.current = document.activeElement as HTMLElement | null;

    void clientesApi
      .detalhar(aberto)
      .then(({ cliente: dados }) => {
        if (!cancelado) setCliente(dados);
      })
      .catch(() => {
        // Fora da carteira a API devolve 404 de propósito: 403 confirmaria que existe.
        if (!cancelado) setCliente(null);
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [aberto]);

  // Devolve o foco a quem abriu: sem isso, quem usa teclado recomeça do topo.
  useEffect(() => {
    if (!aberto) return;

    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') {
        fechar();
        focoAnterior.current?.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = '';
    };
  }, [aberto, fechar]);

  // Foco no painel para o leitor de tela anunciar o conteúdo novo.
  useEffect(() => {
    if (cliente) painel.current?.focus();
  }, [cliente]);

  if (!aberto) return null;

  return (
    <>
      <div
        className="ficha-cliente__fundo"
        onClick={() => {
          fechar();
          focoAnterior.current?.focus();
        }}
        aria-hidden="true"
      />

      <aside
        ref={painel}
        className="ficha-cliente"
        role="dialog"
        aria-modal="true"
        aria-label={cliente ? `Ficha de ${cliente.nome}` : 'Carregando ficha do cliente'}
        tabIndex={-1}
      >
        {carregando && <p className="ficha-cliente__carregando">Carregando ficha…</p>}

        {!carregando && !cliente && (
          <div className="ficha-cliente__vazio">
            <p>
              Não foi possível abrir a ficha deste cliente. Ele pode ter saído da
              base — ou estar fora da sua carteira.
            </p>
            <button type="button" className="botao botao--discreto botao--compacto" onClick={fechar}>
              Fechar
            </button>
          </div>
        )}

        {cliente && !editando && !cadastrandoApolice && (
          <>
            <FichaClienteImportado cliente={cliente} aoFechar={fechar} abaInicial={abaInicial} />
            <div className="ficha-cliente__rodape">
              {cliente.somenteConsulta ? (
                <p className="texto-discreto">
                  Cliente de outra carteira — só consulta.{' '}
                  {cliente.produtor
                    ? <>Direcione o atendimento a <strong>{cliente.produtor}</strong>.</>
                    : 'Ainda sem corretor responsável definido.'}
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="botao botao--discreto botao--compacto"
                    onClick={() => setEditando(true)}
                  >
                    Corrigir cadastro
                  </button>
                  {/* O servidor exige a mesma permissão. */}
                  {temPermissao('clientes.gerenciar') && (
                    <button
                      type="button"
                      className="botao botao--principal botao--compacto"
                      onClick={() => setCadastrandoApolice(true)}
                    >
                      Nova apólice
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {cliente && cadastrandoApolice && (
          <NovaApolice
            cliente={cliente}
            aoCancelar={() => setCadastrandoApolice(false)}
            aoSalvar={(atualizado) => {
              setCliente(atualizado);
              setAbaInicial('apolices');
              setCadastrandoApolice(false);
            }}
          />
        )}

        {cliente && editando && (
          <EdicaoCliente
            cliente={cliente}
            aoCancelar={() => setEditando(false)}
            aoSalvar={(atualizado) => {
              setCliente(atualizado);
              setEditando(false);
            }}
          />
        )}
      </aside>
    </>
  );
}

/** Rótulo + valor, com "não informado" quando o dado não veio. */
export function Dado({
  rotulo,
  valor,
  largo,
}: {
  rotulo: string;
  valor: string | null;
  largo?: boolean;
}): React.JSX.Element {
  return (
    <div className={`cartao-dado${largo ? ' cartao-dado--largo' : ''}`}>
      <span className="cartao-dado__rotulo">{rotulo}</span>
      <span className="cartao-dado__valor">
        {valor ?? <span className="texto-discreto">não informado</span>}
      </span>
    </div>
  );
}
