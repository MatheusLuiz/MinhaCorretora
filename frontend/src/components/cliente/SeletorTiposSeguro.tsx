import type { TipoSeguro } from '@/lib/tiposSeguro';

/** Caixas, não `<select multiple>`: este pede Ctrl+clique e esconde o marcado ao rolar. */
export function SeletorTiposSeguro({
  tipos,
  selecionados,
  aoMudar,
  legenda = 'Tipos de seguro',
  descricao,
}: {
  tipos: TipoSeguro[];
  selecionados: number[];
  aoMudar: (ids: number[]) => void;
  legenda?: string;
  descricao?: string;
}): React.JSX.Element {
  const alternar = (id: number): void =>
    aoMudar(selecionados.includes(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id]);

  return (
    <fieldset className="tipos-escolha">
      <legend>
        {legenda}
        {selecionados.length > 0 && <span className="texto-discreto"> · {selecionados.length} marcado(s)</span>}
      </legend>
      {descricao && <p className="texto-discreto">{descricao}</p>}

      {tipos.length === 0 ? (
        <p className="texto-discreto">Nenhum tipo de seguro ativo. Cadastre em Configurações › Tipos de seguro.</p>
      ) : (
        <div className="tipos-escolha__lista">
          {tipos.map((t) => {
            const marcado = selecionados.includes(t.id);
            return (
              <label key={t.id} className={`tipos-escolha__item${marcado ? ' tipos-escolha__item--marcado' : ''}`}>
                <input type="checkbox" checked={marcado} onChange={() => alternar(t.id)} />
                <span>{t.nome}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
