interface Props {
  rotulo: string;
  valor: string;
  /** Variação percentual contra o período anterior. */
  variacao?: number;
  descricao?: string;
  /** Quando `true`, cair é bom (sinistralidade, inadimplência). */
  menorEhMelhor?: boolean;
  /** Abre os registros por trás do número; o cartão vira `<button>`. */
  aoClicar?: () => void;
  /** Cartão é o filtro ativo da tela. Só vale com `aoClicar` (vira `aria-pressed`). */
  ativo?: boolean;
}

/** Indicador isolado. A variação vai com seta e sinal, nunca só por cor. */
export function TileKpi({
  rotulo,
  valor,
  variacao,
  descricao,
  menorEhMelhor = false,
  aoClicar,
  ativo,
}: Props): React.JSX.Element {
  const temVariacao = typeof variacao === 'number' && Number.isFinite(variacao);
  const subiu = temVariacao && variacao > 0;
  const estavel = temVariacao && Math.abs(variacao) < 0.05;

  const positivo = menorEhMelhor ? !subiu : subiu;
  const estado = !temVariacao || estavel ? 'neutro' : positivo ? 'bom' : 'ruim';

  const conteudo = (
    <>
      <h3 className="tile__rotulo">{rotulo}</h3>
      <p className="tile__valor">{valor}</p>

      {temVariacao && (
        <p className={`tile__variacao tile__variacao--${estado}`}>
          <span aria-hidden="true">{estavel ? '→' : subiu ? '↑' : '↓'}</span>
          <span>
            {subiu ? '+' : ''}
            {variacao.toLocaleString('pt-BR', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
            %
          </span>
        </p>
      )}

      {/* Fora do bloco de variação: a descrição vale também sem comparação. */}
      {descricao && <p className="tile__descricao">{descricao}</p>}
    </>
  );

  if (aoClicar) {
    return (
      <button
        type="button"
        className={`tile tile--clicavel${ativo ? ' tile--ativo' : ''}`}
        onClick={aoClicar}
        aria-pressed={ativo === undefined ? undefined : ativo}
      >
        {conteudo}
      </button>
    );
  }

  return <article className="tile">{conteudo}</article>;
}
