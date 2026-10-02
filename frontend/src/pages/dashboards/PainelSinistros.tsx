import '@/styles/sinistros-painel.css';

import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';
import { CabecalhoPainel } from '@/components/Painel';
import {
  AvisoCobertura,
  NumerosSinistros,
  PorCausa,
  PorSeguradora,
  SerieSinistros,
  useResumoSinistros,
} from '@/components/sinistros/BlocosSinistros';

/** Dashboard de Sinistros: cada número leva à Fila de sinistros. */
export function PainelSinistros(): React.JSX.Element {
  const { resumo, erro } = useResumoSinistros();

  useEffect(() => {
    document.title = 'Sinistros — MinhaCorretora';
  }, []);

  useEffect(() => {
    document.body.classList.add('tela-ajustada');
    return () => document.body.classList.remove('tela-ajustada');
  }, []);

  if (!resumo) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Sinistros" />
        {erro ? (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        ) : (
          <p className="texto-discreto">Carregando…</p>
        )}
      </div>
    );
  }

  return (
    <div className="painel painel--tela">
      <CabecalhoPainel
        titulo="Sinistros"
        descricao="Sinistros e assistências dos relatórios das seguradoras. Os números abrem a fila."
        acoes={
          <Link className="botao botao--principal botao--compacto" to="/filas/sinistros">
            Abrir fila de sinistros
          </Link>
        }
      />

      <div className="sinistros-painel__corpo">
        <NumerosSinistros resumo={resumo} />
        <AvisoCobertura resumo={resumo} />

        <section className="cartao sinistros-painel__serie">
          <header className="cartao__cabecalho">
            <h2 title="Pela data de ocorrência. Clique numa coluna para ver os acionamentos do mês.">
              Acionamentos por mês
            </h2>
          </header>
          <AreaDoGrafico>{(altura) => <SerieSinistros resumo={resumo} altura={altura} />}</AreaDoGrafico>
        </section>

        <div className="sinistros-painel__lado">
          <section className="cartao sinistros-painel__bloco">
            <header className="cartao__cabecalho">
              <h2>Por seguradora</h2>
            </header>
            <div className="sinistros-painel__lista">
              <PorSeguradora resumo={resumo} />
            </div>
          </section>
          <section className="cartao sinistros-painel__bloco">
            <header className="cartao__cabecalho">
              <h2>Principais causas</h2>
            </header>
            <div className="sinistros-painel__lista">
              <PorCausa resumo={resumo} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

