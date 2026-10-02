import '@/styles/sinistros-painel.css';

import { AreaDoGrafico } from '@/components/graficos/AreaDoGrafico';

import { AvisoCobertura, NumerosSinistros, PorSeguradora, SerieSinistros, useResumoSinistros } from './BlocosSinistros';

/** Os widgets `sin.*` da Visão geral: os mesmos blocos do dashboard de Sinistros. */
export function WidgetSinistros({ parte }: { parte: string }): React.JSX.Element {
  const { resumo, erro } = useResumoSinistros();
  if (erro) {
    return (
      <p className="alerta alerta--erro" role="alert">
        {erro}
      </p>
    );
  }
  if (!resumo) return <p className="texto-discreto">Carregando…</p>;

  if (parte === 'sin.mes') {
    return (
      <div className="sinistros-widget__grafico">
        <AreaDoGrafico>{(altura) => <SerieSinistros resumo={resumo} altura={altura} />}</AreaDoGrafico>
      </div>
    );
  }
  if (parte === 'sin.seguradoras') return <PorSeguradora resumo={resumo} />;
  return (
    <div className="sinistros-widget__numeros">
      <NumerosSinistros resumo={resumo} />
      <AvisoCobertura resumo={resumo} />
    </div>
  );
}
