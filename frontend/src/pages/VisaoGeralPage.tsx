import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Icone } from '@/components/Icone';
import { Modal } from '@/components/Modal';
import { CabecalhoPainel } from '@/components/Painel';
import { useAuth } from '@/hooks/useAuth';
import { usePaineis } from '@/hooks/usePaineis';
import {
  gravarPreferencias,
  lerPreferencias,
  limparPreferencias,
  padraoVisaoGeral,
} from '@/lib/preferencias';
import { AREAS, WIDGETS, WIDGETS_POR_ID, widgetsPermitidos, type DefinicaoWidget } from '@/widgets/catalogo';
import { LimiteDeErro } from '@/components/LimiteDeErro';
import { ConteudoWidget } from '@/widgets/Widget';

/** Visão geral montada por cada pessoa, com os mesmos cartões dos painéis (não uma cópia). */
export function VisaoGeralPage(): React.JSX.Element {
  const { usuario, temPermissao } = useAuth();
  const { dados, carregando, erro, recarregar } = usePaineis();
  const idUsuario = usuario?.id ?? 'anonimo';

  // Sem escolha, vale o padrão do PAPEL, que chega com os dados: até lá nada é
  // desenhado, para não piscar o padrão do catálogo.
  const [escolhidos, setEscolhidos] = useState<string[]>(() => lerPreferencias(idUsuario).widgets);
  const [personalizada, setPersonalizada] = useState(() => lerPreferencias(idUsuario).personalizada);
  const [personalizando, setPersonalizando] = useState(false);

  useEffect(() => {
    document.title = 'Visão geral — MinhaCorretora';
  }, []);

  useEffect(() => {
    const lidas = lerPreferencias(idUsuario);
    setEscolhidos(lidas.widgets);
    setPersonalizada(lidas.personalizada);
  }, [idUsuario]);

  const salvar = useCallback(
    (lista: string[]) => {
      setEscolhidos(lista);
      setPersonalizada(true);
      gravarPreferencias(idUsuario, { widgets: lista });
    },
    [idUsuario],
  );

  const disponiveis = useMemo(
    () => widgetsPermitidos(WIDGETS, temPermissao),
    [temPermissao],
  );

  const lista = useMemo(
    () => (personalizada ? escolhidos : dados ? padraoVisaoGeral(dados.visaoGeralPadrao) : []),
    [personalizada, escolhidos, dados],
  );

  const visiveis = useMemo(
    () =>
      lista
        .map((id) => WIDGETS_POR_ID.get(id))
        .filter((w): w is DefinicaoWidget => Boolean(w))
        .filter((w) => !w.permissao || temPermissao(w.permissao)),
    [lista, temPermissao],
  );

  const primeiroNome = usuario?.nome.split(' ')[0] ?? '';

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo={`Olá, ${primeiroNome}`}
        descricao="Sua visão geral. Escolha o que quer acompanhar aqui."
        acoes={
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={() => setPersonalizando(true)}
            aria-haspopup="dialog"
          >
            <Icone nome="configuracoes" tamanho={15} />
            Personalizar
          </button>
        }
      />

      {carregando && <p className="texto-discreto">Carregando os números…</p>}

      {erro && (
        <div className="alerta alerta--erro" role="alert">
          <p>{erro}</p>
          <button type="button" className="botao botao--discreto botao--compacto" onClick={recarregar}>
            Tentar de novo
          </button>
        </div>
      )}

      {carregando && !personalizada ? null : visiveis.length === 0 ? (
        <section className="vazio">
          <span className="vazio__icone" aria-hidden="true">
            <Icone nome="painel" tamanho={28} />
          </span>
          <h2>Sua visão geral está vazia</h2>
          <p className="texto-discreto">
            Escolha as análises que quer acompanhar aqui. Elas são as mesmas dos
            painéis — o que você montar nesta tela é um atalho para elas.
          </p>
          <button type="button" className="botao botao--principal botao--compacto" onClick={() => setPersonalizando(true)}>
            Escolher análises
          </button>
        </section>
      ) : (
        <div className="grade-widgets">
          {visiveis.map((w) => (
            <section key={w.id} className={`cartao cartao--${w.largura}`}>
              <header className="cartao__cabecalho">
                <div>
                  <h2>{w.titulo}</h2>
                  <p className="texto-discreto">{w.descricao}</p>
                </div>
                <Link to={w.rota ?? AREAS.find((a) => a.chave === w.area)?.rota ?? '/'} className="cartao__atalho">
                  Ver painel
                </Link>
              </header>

              <div className="cartao__corpo">
                {dados && (
                  <LimiteDeErro nome={w.titulo}>
                    <ConteudoWidget id={w.id} dados={dados} />
                  </LimiteDeErro>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <ModalPersonalizar
        aberto={personalizando}
        aoFechar={() => setPersonalizando(false)}
        disponiveis={disponiveis}
        escolhidos={lista}
        aoSalvar={salvar}
        aoRestaurar={() => {
          // Volta ao padrão do PAPEL, não ao do catálogo.
          limparPreferencias(idUsuario);
          setPersonalizada(false);
          setEscolhidos(padraoVisaoGeral(dados?.visaoGeralPadrao));
        }}
      />
    </div>
  );
}

interface PropsModal {
  aberto: boolean;
  aoFechar: () => void;
  disponiveis: DefinicaoWidget[];
  escolhidos: string[];
  aoSalvar: (lista: string[]) => void;
  aoRestaurar: () => void;
}

function ModalPersonalizar({
  aberto,
  aoFechar,
  disponiveis,
  escolhidos,
  aoSalvar,
  aoRestaurar,
}: PropsModal): React.JSX.Element {
  const [selecao, setSelecao] = useState<string[]>(escolhidos);

  useEffect(() => {
    if (aberto) setSelecao(escolhidos);
  }, [aberto, escolhidos]);

  function alternar(id: string): void {
    setSelecao((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  }

  /** Setas em vez de arrastar: funciona por teclado e em toque. */
  function mover(id: string, direcao: -1 | 1): void {
    setSelecao((atual) => {
      const i = atual.indexOf(id);
      const j = i + direcao;
      if (i === -1 || j < 0 || j >= atual.length) return atual;

      const copia = [...atual];
      [copia[i], copia[j]] = [copia[j]!, copia[i]!];
      return copia;
    });
  }

  const porArea = AREAS.map((area) => ({
    area,
    widgets: disponiveis.filter((w) => w.area === area.chave),
  })).filter((g) => g.widgets.length > 0);

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Personalizar visão geral"
      descricao="Escolha as análises e a ordem em que aparecem"
      tamanho="largo"
    >
      <div className="personalizar">
        <section className="personalizar__selecionados">
          <h3>Na sua tela ({selecao.length})</h3>

          {selecao.length === 0 && (
            <p className="texto-discreto">
              Nenhuma análise escolhida. Marque ao lado para adicionar.
            </p>
          )}

          <ol className="ordem">
            {selecao.map((id, i) => {
              const w = WIDGETS_POR_ID.get(id);
              if (!w) return null;

              return (
                <li key={id}>
                  <span className="ordem__posicao">{i + 1}</span>
                  <span className="ordem__nome">{w.titulo}</span>

                  <span className="ordem__acoes">
                    <button
                      type="button"
                      onClick={() => mover(id, -1)}
                      disabled={i === 0}
                      aria-label={`Mover ${w.titulo} para cima`}
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(id, 1)}
                      disabled={i === selecao.length - 1}
                      aria-label={`Mover ${w.titulo} para baixo`}
                      title="Descer"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => alternar(id)}
                      aria-label={`Remover ${w.titulo}`}
                      title="Remover"
                      className="ordem__remover"
                    >
                      ×
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="personalizar__catalogo">
          <h3>Disponíveis</h3>

          {porArea.map(({ area, widgets }) => (
            <div key={area.chave} className="personalizar__grupo">
              <h4>
                <Icone nome={area.icone} tamanho={15} />
                {area.nome}
              </h4>

              <ul>
                {widgets.map((w) => (
                  <li key={w.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selecao.includes(w.id)}
                        onChange={() => alternar(w.id)}
                      />
                      <span>
                        <strong>{w.titulo}</strong>
                        <small>{w.descricao}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>

      <footer className="personalizar__rodape">
        <button
          type="button"
          className="botao botao--discreto botao--compacto"
          onClick={() => {
            aoRestaurar();
            aoFechar();
          }}
        >
          Restaurar padrão
        </button>

        <div className="personalizar__confirmar">
          <button type="button" className="botao botao--discreto botao--compacto" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao--principal botao--compacto"
            onClick={() => {
              aoSalvar(selecao);
              aoFechar();
            }}
          >
            Salvar
          </button>
        </div>
      </footer>
    </Modal>
  );
}
