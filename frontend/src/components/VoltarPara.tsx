import { useContext } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { OrigemContext } from '@/contexts/OrigemContext';

/**
 * "← Voltar" das filas: volta à tela de onde a pessoa veio, com os filtros;
 * `para`/`rotulo` valem quando não há tela anterior (link aberto direto).
 */
export function VoltarPara({ para, rotulo }: { para: string; rotulo: string }): React.JSX.Element {
  const origem = useContext(OrigemContext);
  const { pathname } = useLocation();
  // A origem só vale se for OUTRA tela: recarregar a própria fila não é "vir de".
  const veioDe = origem && origem.caminho.split('?')[0] !== pathname ? origem : null;

  return (
    <Link className="voltar-para" to={veioDe?.caminho ?? para}>
      <span aria-hidden="true">←</span>{' '}
      {veioDe ? `Voltar para ${veioDe.titulo ?? 'a tela anterior'}` : rotulo}
    </Link>
  );
}
