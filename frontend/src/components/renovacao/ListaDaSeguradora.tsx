import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { formatarData, formatarNumero, formatarReais } from '@/lib/formato';
import type { RenovacaoDaSeguradora } from '@/lib/paineis';

/**
 * Apólices a renovar como a seguradora informa: à parte da fila, porque o
 * arquivo não traz CPF e a base ainda não as tem.
 */
export function ListaDaSeguradora({
  lista,
  abrirCliente,
}: {
  lista: RenovacaoDaSeguradora[];
  abrirCliente: (uuid: string) => void;
}): React.JSX.Element {
  const hoje = new Date().toISOString().slice(0, 10);
  const dias = (iso: string): number =>
    Math.round((Date.parse(`${iso}T12:00:00`) - Date.parse(`${hoje}T12:00:00`)) / 86_400_000);
  const semCliente = lista.filter((r) => !r.clienteId).length;
  const cotadas = lista.filter((r) => r.cotadoOutroCorretor).length;
  const paginacao = usePaginacao(lista);

  return (
    <div className="tabela-rolante">
      <p className="texto-discreto">
        {formatarNumero(lista.length)} apólice(s) a renovar informadas pela seguradora.
        {semCliente > 0 && (
          <>
            {' '}
            <strong>{formatarNumero(semCliente)} sem cliente na base</strong>: o relatório não traz CPF, e o
            cliente só aparece quando o PDF da apólice for importado.
          </>
        )}
        {cotadas > 0 && (
          <>
            {' '}
            <strong className="situacao--inadimplente">
              {formatarNumero(cotadas)} cotada(s) por outro corretor
            </strong>{' '}
            nos últimos 7 dias.
          </>
        )}
      </p>

      <table className="tabela tabela--densa">
        <thead>
          <tr>
            <th scope="col">Vence em</th>
            <th scope="col" className="tabela__num">
              Dias
            </th>
            <th scope="col">Segurado</th>
            <th scope="col">Veículo</th>
            <th scope="col">Apólice</th>
            <th scope="col" className="tabela__num">
              Comissão
            </th>
            <th scope="col" className="tabela__num">
              Bônus
            </th>
            <th scope="col" className="tabela__num">
              Prêmio calculado
            </th>
          </tr>
        </thead>
        <tbody>
          {paginacao.visiveis.map((r) => {
            const faltam = dias(r.vigenciaFim);
            return (
              <tr
                key={`${r.seguradora}-${r.numeroApolice}-${r.vigenciaFim}`}
                className={r.clienteId ? 'tabela__linha--clicavel' : undefined}
                onClick={r.clienteId ? () => abrirCliente(r.clienteId!) : undefined}
                tabIndex={r.clienteId ? 0 : undefined}
                onKeyDown={
                  r.clienteId
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          abrirCliente(r.clienteId!);
                        }
                      }
                    : undefined
                }
              >
                <td>{formatarData(r.vigenciaFim)}</td>
                <td className="tabela__num">
                  <span className={faltam <= 30 ? 'situacao--inadimplente' : undefined}>{faltam}</span>
                </td>
                <td>
                  {r.nomeSegurado}
                  {r.cotadoOutroCorretor && (
                    <span
                      className="etiqueta etiqueta--critico"
                      title="Segurado cotado por outro corretor nos últimos 7 dias"
                    >
                      cotado por outro
                    </span>
                  )}
                  <br />
                  <small className="texto-discreto">
                    {r.clienteId
                      ? `${r.produtor ?? 'sem corretor'}${r.vinculoOrigem === 'nome' ? ' · ligado pelo nome' : ''}`
                      : 'sem cliente na base'}
                    {` · ${r.seguradora}`}
                  </small>
                </td>
                <td>
                  {r.veiculo ?? <span className="texto-discreto">—</span>}
                  {r.placa && (
                    <>
                      <br />
                      <small className="tabela__mono">{r.placa}</small>
                    </>
                  )}
                </td>
                <td className="tabela__mono">{r.numeroApolice}</td>
                <td className="tabela__num">
                  {r.percentualComissao === null ? '—' : `${r.percentualComissao.toLocaleString('pt-BR')}%`}
                </td>
                <td className="tabela__num">
                  {r.classeBonus ?? '—'}
                  {(r.sinistros ?? 0) > 0 && (
                    <>
                      <br />
                      <small className="situacao--inadimplente">{r.sinistros} sinistro(s)</small>
                    </>
                  )}
                </td>
                <td className="tabela__num">
                  {r.premioRenovacao === null ? (
                    <span className="texto-discreto" title="O portal ainda não calculou a renovação">
                      não calculado
                    </span>
                  ) : (
                    formatarReais(r.premioRenovacao)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Paginacao p={paginacao} />
    </div>
  );
}
