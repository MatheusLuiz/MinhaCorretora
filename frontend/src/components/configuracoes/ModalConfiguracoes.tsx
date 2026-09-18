import { useState } from 'react';

import { Icone, type NomeIcone } from '@/components/Icone';
import { Modal } from '@/components/Modal';
import { PainelEmail } from '@/components/configuracoes/PainelEmail';
import { PainelGruposCliente } from '@/components/configuracoes/PainelGruposCliente';
import { PainelPapeis } from '@/components/configuracoes/PainelPapeis';
import { PainelSeguradoras } from '@/components/configuracoes/PainelSeguradoras';
import { PainelTarefas } from '@/components/configuracoes/PainelTarefas';
import { PainelTiposSeguro } from '@/components/configuracoes/PainelTiposSeguro';
import { PainelUsuarios } from '@/components/configuracoes/PainelUsuarios';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
}

interface Secao {
  chave: string;
  rotulo: string;
  icone: NomeIcone;
  descricao: string;
  /** Permissão exigida para ver a seção. */
  permissao?: string;
  disponivel: boolean;
}

const SECOES: Secao[] = [
  {
    chave: 'usuarios',
    rotulo: 'Usuários',
    icone: 'clientes',
    descricao: 'Quem acessa o painel e o que cada um pode ver',
    permissao: 'usuarios.gerenciar',
    disponivel: true,
  },
  {
    chave: 'papeis',
    rotulo: 'Papéis e permissões',
    icone: 'configuracoes',
    descricao: 'O que cada cargo pode fazer no sistema',
    permissao: 'usuarios.gerenciar',
    disponivel: true,
  },
  // Mesma permissão de Usuários: é a caixa que manda a redefinição de senha.
  {
    chave: 'email',
    rotulo: 'E-mail de disparo',
    icone: 'email',
    descricao: 'Caixas de saída e layouts dos e-mails',
    permissao: 'usuarios.gerenciar',
    disponivel: true,
  },
  {
    chave: 'seguradoras',
    rotulo: 'Seguradoras',
    icone: 'integracao',
    descricao: 'Companhias, integração e quais estão ativas',
    permissao: 'integracao.gerenciar',
    disponivel: true,
  },
  {
    chave: 'tipos-seguro',
    rotulo: 'Tipos de seguro',
    icone: 'apolices',
    descricao: 'O que a corretora vende e o que cada tipo pede',
    permissao: 'integracao.gerenciar',
    disponivel: true,
  },
  {
    chave: 'grupos-cliente',
    rotulo: 'Grupos de cliente',
    icone: 'carteira',
    descricao: 'Corretora, Seguradora e os grupos que a corretora criar',
    permissao: 'integracao.gerenciar',
    disponivel: true,
  },
  {
    chave: 'tarefas',
    rotulo: 'Tarefas',
    icone: 'renovacoes',
    descricao: 'Rotinas agendadas: relatórios das seguradoras via API',
    permissao: 'integracao.gerenciar',
    disponivel: true,
  },
];

/** Configurações em modal, para não perder a rolagem e os filtros da tela de baixo. */
export function ModalConfiguracoes({ aberto, aoFechar }: Props): React.JSX.Element {
  const { temPermissao } = useAuth();
  const [secaoAtiva, setSecaoAtiva] = useState('usuarios');

  const visiveis = SECOES.filter((s) => !s.permissao || temPermissao(s.permissao));

  // Sem este recuo, quem não vê "usuarios" abriria o modal em branco.
  const atual = visiveis.find((s) => s.chave === secaoAtiva) ?? visiveis[0];

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Configurações"
      descricao="Acessos, e-mail, perfil e origem dos dados"
      tamanho="largo"
    >
      <div className="config">
        <nav className="config__secoes" aria-label="Seções de configuração">
          {visiveis.map((secao) => (
            <button
              key={secao.chave}
              type="button"
              className={`config__secao${atual?.chave === secao.chave ? ' config__secao--ativa' : ''}`}
              onClick={() => setSecaoAtiva(secao.chave)}
              aria-current={atual?.chave === secao.chave ? 'true' : undefined}
            >
              <Icone nome={secao.icone} tamanho={18} />
              <span className="config__secao-texto" title={secao.descricao}>
                <strong>{secao.rotulo}</strong>
                <small className="visualmente-oculto">{secao.descricao}</small>
              </span>
              {!secao.disponivel && <span className="config__badge">em breve</span>}
            </button>
          ))}
        </nav>

        <div className="config__conteudo">
          {!atual && (
            <p className="texto-discreto">
              Seu perfil não tem acesso a nenhuma seção de configuração.
            </p>
          )}

          {atual?.chave === 'usuarios' && <PainelUsuarios />}
          {atual?.chave === 'papeis' && <PainelPapeis />}
          {atual?.chave === 'email' && <PainelEmail />}
          {atual?.chave === 'seguradoras' && <PainelSeguradoras />}
          {atual?.chave === 'tipos-seguro' && <PainelTiposSeguro />}
          {atual?.chave === 'grupos-cliente' && <PainelGruposCliente />}
          {atual?.chave === 'tarefas' && <PainelTarefas />}

          {atual && !atual.disponivel && (
            <div className="vazio vazio--compacto">
              <span className="vazio__icone" aria-hidden="true">
                <Icone nome={atual.icone} tamanho={24} />
              </span>
              <h3>{atual.rotulo}</h3>
              <p className="texto-discreto">{atual.descricao}. Ainda não implementado.</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
