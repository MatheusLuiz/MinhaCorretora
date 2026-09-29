import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Isola a falha de um pedaço da tela (ex.: payload de backend antigo sem um
 * campo) para não derrubar a árvore inteira. Classe porque não há hook equivalente.
 */

interface Props {
  /** Aparece na mensagem, para quem lê saber QUAL análise falhou. */
  nome: string;
  children: ReactNode;
}

interface Estado {
  erro: Error | null;
}

export class LimiteDeErro extends Component<Props, Estado> {
  override state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    console.error(`Falha ao desenhar "${this.props.nome}":`, erro, info.componentStack);
  }

  // Sem isto o erro fica preso: dados novos precisam dar uma segunda chance.
  override componentDidUpdate(anterior: Props): void {
    if (this.state.erro && anterior.children !== this.props.children) {
      this.setState({ erro: null });
    }
  }

  override render(): ReactNode {
    if (!this.state.erro) return this.props.children;

    return (
      <div className="pendente">
        <p className="pendente__titulo">Esta análise não pôde ser desenhada</p>
        <p>
          O resto do painel continua funcionando — o problema é só deste cartão.
        </p>
        <p className="texto-discreto">
          A causa mais comum é o servidor estar numa versão anterior à da tela,
          respondendo sem um campo que ela espera. Reinicie o backend e recarregue.
        </p>
        <p className="pendente__quando">{this.state.erro.message}</p>
      </div>
    );
  }
}
