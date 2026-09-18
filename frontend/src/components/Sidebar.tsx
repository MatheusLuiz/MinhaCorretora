import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { Icone, type NomeIcone } from '@/components/Icone';
import { ModalConfiguracoes } from '@/components/configuracoes/ModalConfiguracoes';
import { useAuth } from '@/hooks/useAuth';
import { AREAS } from '@/widgets/catalogo';

/**
 * Navegação lateral que expande ao passar o mouse. Hover não basta (teclado e
 * toque não têm): também expande por `:focus-within` e tem botão de fixar.
 */

// Atraso ao recolher: sem ele, a saída acidental do mouse pela borda fecha a barra.
const MS_PARA_RECOLHER = 220;

interface ItemSimples {
  tipo: 'item';
  rotulo: string;
  para: string;
  icone: NomeIcone;
  /** Ausente = visível para todos; com lista, basta ter UMA. */
  permissao?: string | string[];
}

interface Grupo {
  tipo: 'grupo';
  rotulo: string;
  icone: NomeIcone;
  filhos: ItemSimples[];
}

type Entrada = ItemSimples | Grupo;

const NAVEGACAO: Entrada[] = [
  { tipo: 'item', rotulo: 'Visão geral', para: '/', icone: 'painel' },
  {
    tipo: 'grupo',
    rotulo: 'Dashboards',
    icone: 'dashboards',
    // Sai do catálogo; Comissões não é área do catálogo e entra depois de Renovações.
    filhos: AREAS.flatMap((a) => [
      {
        tipo: 'item' as const,
        rotulo: a.nome,
        para: a.rota,
        icone: a.icone,
        permissao: a.permissao,
      },
      ...(a.chave === 'renovacoes'
        ? [
            {
              tipo: 'item' as const,
              rotulo: 'Comissões',
              para: '/dashboards/comissoes',
              icone: 'comissoes' as const,
              // Demonstrativo agregado, sem cliente: não há como recortar por carteira.
              permissao: 'comissoes.todas',
            },
          ]
        : []),
    ]),
  },
  // Dashboards para ENXERGAR, Filas para TRABALHAR: todas as filas num grupo só.
  {
    tipo: 'grupo',
    rotulo: 'Filas',
    icone: 'apolices',
    filhos: [
      {
        tipo: 'item',
        rotulo: 'Renovação',
        para: '/filas/renovacao',
        icone: 'renovacoes',
        permissao: 'apolices.ler',
      },
      {
        tipo: 'item',
        rotulo: 'Comissões',
        para: '/filas/comissoes',
        icone: 'comissoes',
        permissao: 'comissoes.todas',
      },
      {
        tipo: 'item',
        rotulo: 'Emissões',
        para: '/filas/emissoes',
        icone: 'producao',
        permissao: 'apolices.ler',
      },
      {
        tipo: 'item',
        rotulo: 'Cadastro',
        para: '/filas/cadastro',
        icone: 'clientes',
        permissao: 'clientes.ler',
      },
      {
        tipo: 'item',
        rotulo: 'Sinistros',
        para: '/filas/sinistros',
        icone: 'sinistros',
        permissao: 'sinistros.ler',
      },
    ],
  },
  {
    tipo: 'grupo',
    rotulo: 'Clientes',
    icone: 'clientes',
    filhos: [
      { tipo: 'item', rotulo: 'Consultar', para: '/clientes', icone: 'clientes' },
      {
        tipo: 'item',
        rotulo: 'Apólices',
        para: '/clientes/apolices',
        icone: 'apolices',
        permissao: 'apolices.ler',
      },
      {
        tipo: 'item',
        rotulo: 'Novo cliente',
        para: '/clientes/novo',
        icone: 'clientes',
        permissao: 'clientes.gerenciar',
      },
      // Cotar pré-cadastra o cliente: mesma permissão de cadastrar.
      {
        tipo: 'item',
        rotulo: 'Cotações',
        para: '/clientes/cotacoes',
        icone: 'apolices',
        permissao: 'clientes.gerenciar',
      },
    ],
  },
  {
    tipo: 'grupo',
    rotulo: 'Importações',
    icone: 'apolices',
    filhos: [
      {
        tipo: 'item',
        rotulo: 'Importar arquivos',
        para: '/importacoes',
        icone: 'apolices',
        // Separada de `clientes.gerenciar`: a carga espelha o arquivo e pode apagar em massa.
        permissao: ['importacao.gerenciar', 'importacao.parcelas'],
      },
      {
        tipo: 'item',
        rotulo: 'Auditoria',
        para: '/importacoes/auditoria',
        icone: 'apolices',
        permissao: 'auditoria.ler',
      },
    ],
  },
  {
    tipo: 'grupo',
    rotulo: 'Financeiro',
    icone: 'comissoes',
    filhos: [
      {
        tipo: 'item',
        rotulo: 'Inadimplência',
        para: '/financeiro/inadimplencia',
        icone: 'comissoes',
        // Permissão própria: o papel Parcelas cobra atraso e não vê comissão.
        permissao: 'inadimplencia.ler',
      },
      {
        tipo: 'item',
        rotulo: 'Conciliação',
        para: '/financeiro/conciliacao',
        icone: 'comissoes',
        permissao: 'comissoes.todas',
      },
      {
        tipo: 'item',
        rotulo: 'Previsão de entrada',
        para: '/financeiro/previsao',
        icone: 'comissoes',
        permissao: 'comissoes.todas',
      },
      {
        tipo: 'item',
        rotulo: 'Estornos',
        para: '/financeiro/estornos',
        icone: 'comissoes',
        permissao: 'comissoes.todas',
      },
    ],
  },
];

export function Sidebar(): React.JSX.Element {
  const { temPermissao } = useAuth();
  const local = useLocation();
  const idNav = useId();

  const [sobreposta, setSobreposta] = useState(false);
  const [fixada, setFixada] = useState(false);
  const [configAberto, setConfigAberto] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expandida = fixada || sobreposta;

  /** Grupos abertos. O que contém a rota atual começa aberto. */
  const [abertos, setAbertos] = useState<Set<string>>(() => {
    const inicial = new Set<string>();
    for (const entrada of NAVEGACAO) {
      if (entrada.tipo === 'grupo' && entrada.filhos.some((f) => f.para === local.pathname)) {
        inicial.add(entrada.rotulo);
      }
    }
    return inicial;
  });

  const cancelarRecolhimento = useCallback(() => {
    if (temporizador.current !== null) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
  }, []);

  const aoEntrar = useCallback(() => {
    cancelarRecolhimento();
    setSobreposta(true);
  }, [cancelarRecolhimento]);

  const aoSair = useCallback(() => {
    cancelarRecolhimento();
    temporizador.current = setTimeout(() => setSobreposta(false), MS_PARA_RECOLHER);
  }, [cancelarRecolhimento]);

  useEffect(() => cancelarRecolhimento, [cancelarRecolhimento]);

  function alternarGrupo(rotulo: string): void {
    setAbertos((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(rotulo)) proximo.delete(rotulo);
      else proximo.add(rotulo);
      return proximo;
    });
  }

  // Filtra também os filhos; grupo sem filho visível some inteiro.
  const podeVer = (item: ItemSimples): boolean => !item.permissao || temPermissao(...[item.permissao].flat());

  const visiveis = NAVEGACAO.flatMap<Entrada>((entrada) => {
    if (entrada.tipo === 'item') return podeVer(entrada) ? [entrada] : [];

    const filhos = entrada.filhos.filter(podeVer);
    return filhos.length > 0 ? [{ ...entrada, filhos }] : [];
  });

  return (
    <>
      <nav
        className={`sidebar${expandida ? ' sidebar--expandida' : ''}${fixada ? ' sidebar--fixada' : ''}`}
        onMouseEnter={aoEntrar}
        onMouseLeave={aoSair}
        aria-label="Navegação principal"
      >
        <div className="sidebar__topo">
          {/* Duas imagens: o logo completo vira borrão a 36 px; a marca não. */}
          <img className="sidebar__marca" src="/marca.svg" alt="" width={36} height={36} />
          <img
            className="sidebar__logo"
            src="/logo.svg"
            alt={import.meta.env.VITE_APP_NAME ?? 'MinhaCorretora'}
            width={140}
            height={40}
          />

          <button
            type="button"
            className="sidebar__fixar"
            onClick={() => setFixada((v) => !v)}
            aria-pressed={fixada}
            title={fixada ? 'Desafixar a barra' : 'Manter a barra aberta'}
          >
            <Icone nome="fixar" tamanho={16} />
            <span className="visualmente-oculto">
              {fixada ? 'Desafixar a barra lateral' : 'Manter a barra lateral aberta'}
            </span>
          </button>
        </div>

        <ul className="sidebar__lista" id={idNav}>
          {visiveis.map((entrada) =>
            entrada.tipo === 'item' ? (
              <li key={entrada.para}>
                <ItemLink item={entrada} expandida={expandida} />
              </li>
            ) : (
              <li key={entrada.rotulo}>
                <GrupoSanfona
                  grupo={entrada}
                  expandida={expandida}
                  aberto={abertos.has(entrada.rotulo)}
                  aoAlternar={() => alternarGrupo(entrada.rotulo)}
                />
              </li>
            ),
          )}
        </ul>

        <div className="sidebar__rodape">
          {/*
          Modal, não rota: não perde a rolagem e os filtros da tela. O portão vale
          porque toda seção do modal exige permissão; seção universal o derruba.
        */}
          {temPermissao('usuarios.gerenciar', 'integracao.gerenciar') && (
            <button
              type="button"
              className="sidebar__link"
              onClick={() => setConfigAberto(true)}
              title={expandida ? undefined : 'Configurações'}
              aria-label={expandida ? undefined : 'Configurações'}
              aria-haspopup="dialog"
            >
              <span className="sidebar__icone">
                <Icone nome="configuracoes" />
              </span>
              <span className="sidebar__rotulo">Configurações</span>
            </button>
          )}
        </div>
      </nav>

      <ModalConfiguracoes aberto={configAberto} aoFechar={() => setConfigAberto(false)} />
    </>
  );
}

function ItemLink({
  item,
  expandida,
  filho = false,
}: {
  item: ItemSimples;
  expandida: boolean;
  filho?: boolean;
}): React.JSX.Element {
  return (
    <NavLink
      to={item.para}
      end={item.para === '/'}
      className={({ isActive }) =>
        `sidebar__link${filho ? ' sidebar__link--filho' : ''}${isActive ? ' sidebar__link--ativo' : ''}`
      }
      // Recolhida, o rótulo some: title para o mouse, aria-label para o leitor de tela.
      title={expandida ? undefined : item.rotulo}
      aria-label={expandida ? undefined : item.rotulo}
    >
      <span className="sidebar__icone">
        <Icone nome={item.icone} tamanho={filho ? 18 : 20} />
      </span>
      <span className="sidebar__rotulo">{item.rotulo}</span>
    </NavLink>
  );
}

function GrupoSanfona({
  grupo,
  expandida,
  aberto,
  aoAlternar,
}: {
  grupo: Grupo;
  expandida: boolean;
  aberto: boolean;
  aoAlternar: () => void;
}): React.JSX.Element {
  const idSubmenu = useId();
  const local = useLocation();

  const contemRotaAtual = grupo.filhos.some((f) => f.para === local.pathname);

  // Recolhida, o submenu seriam ícones sem rótulo: só aparece com a barra aberta.
  const mostrarFilhos = expandida && aberto;

  return (
    <>
      <button
        type="button"
        className={`sidebar__link sidebar__grupo${contemRotaAtual ? ' sidebar__link--ramo-ativo' : ''}`}
        onClick={aoAlternar}
        aria-expanded={mostrarFilhos}
        aria-controls={idSubmenu}
        title={expandida ? undefined : grupo.rotulo}
        aria-label={expandida ? undefined : grupo.rotulo}
      >
        <span className="sidebar__icone">
          <Icone nome={grupo.icone} />
        </span>
        <span className="sidebar__rotulo">{grupo.rotulo}</span>
        <span className={`sidebar__seta${mostrarFilhos ? ' sidebar__seta--aberta' : ''}`}>
          <Icone nome="seta" tamanho={14} />
        </span>
      </button>

      <ul
        id={idSubmenu}
        className={`sidebar__submenu${mostrarFilhos ? ' sidebar__submenu--aberto' : ''}`}
        hidden={!mostrarFilhos}
      >
        {grupo.filhos.map((filho) => (
          <li key={filho.para}>
            <ItemLink item={filho} expandida={expandida} filho />
          </li>
        ))}
      </ul>
    </>
  );
}
