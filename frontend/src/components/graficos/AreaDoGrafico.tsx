import { useEffect, useRef, useState } from 'react';

import { LARGURA_DO_GRAFICO } from '@/components/graficos';

/**
 * Dá ao gráfico a altura da área que sobrou na tela (F11 incluso). O gráfico
 * mora num filho ABSOLUTO para que medir não realimente o tamanho medido.
 */
export function AreaDoGrafico({
  children,
}: {
  children: (altura: number) => React.ReactNode;
}): React.JSX.Element {
  const area = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState(260);

  // Sem dependências de propósito: a legenda muda com os filtros. Só grava se mudou (sem laço).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const medir = (): void => {
      const { width, height } = el.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const legenda = el.querySelector<HTMLElement>('.gr__legenda');
      const reserva = legenda ? legenda.offsetHeight + 14 : 0;
      // Piso baixo, em unidades do viewBox: um maior vazaria da área; a altura
      // legível vem do `min-height` no CSS.
      const nova = Math.max(60, Math.round(((height - reserva) / width) * LARGURA_DO_GRAFICO));
      setAltura((atual) => (Math.abs(atual - nova) > 1 ? nova : atual));
    };
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    medir();
    return () => observador.disconnect();
  });

  return (
    <div ref={area} className="pagamentos__area-grafico">
      <div className="pagamentos__grafico-dentro">{children(altura)}</div>
    </div>
  );
}
