import { useMemo } from 'react';

import type { Correcao, Pendencia } from '@/lib/financeiro';

const ROTULO_TIPO: Record<string, string> = {
  documento_invalido: 'CPF/CNPJ inválido',
  sem_documento: 'Sem CPF/CNPJ',
  sem_apolice: 'Sem número de apólice',
  sem_corretor: 'Sem corretor',
  apolice_ilegivel: 'Número destruído pelo Excel',
};

/**
 * O que falta no arquivo, editável ANTES de gravar. Pendência sem conserto
 * possível (nº destruído pelo Excel) aparece como explicação, sem campo.
 */
export function PainelPendencias({
  pendencias,
  porTipo,
  ocultas,
  jaCadastrados,
  correcoes,
  aoCorrigir,
  aoReconferir,
  ocupado,
}: {
  pendencias: Pendencia[];
  porTipo: Record<string, number>;
  ocultas: number;
  jaCadastrados: { linha: number; documento: string; cliente: string }[];
  correcoes: Map<number, Correcao>;
  aoCorrigir: (linha: number, mudanca: Partial<Correcao>) => void;
  aoReconferir: () => void;
  ocupado: boolean;
}): React.JSX.Element | null {
  const donoPorLinha = useMemo(
    () => new Map(jaCadastrados.map((d) => [d.linha, d])),
    [jaCadastrados],
  );

  const corrigiveis = pendencias.filter((p) => p.corrigivel);
  const informativas = pendencias.filter((p) => !p.corrigivel);

  const preenchidas = [...correcoes.values()].filter(
    (c) => c.documento?.trim() || c.produtor?.trim() || c.ignorar,
  ).length;

  if (pendencias.length === 0) return null;

  return (
    <section className="cartao cartao--largo">
      <header className="cartao__cabecalho">
        <div>
          <h2>Pendências desta carga</h2>
          <p className="texto-discreto">
            Preencha o que puder aqui. Nada foi gravado — o que ficar em branco
            entra do jeito que está no arquivo.
          </p>
        </div>
      </header>

      <div className="cartao__corpo">
        <div className="tiles">
          {Object.entries(porTipo)
            .sort((a, b) => b[1] - a[1])
            .map(([tipo, n]) => (
              <article className="tile" key={tipo}>
                <h3 className="tile__rotulo">{ROTULO_TIPO[tipo] ?? tipo}</h3>
                <p className="tile__valor">{n.toLocaleString('pt-BR')}</p>
              </article>
            ))}
        </div>

        {ocultas > 0 && (
          <p className="texto-discreto">
            Mostrando {pendencias.length} de {(pendencias.length + ocultas).toLocaleString('pt-BR')}.
            A lista prioriza o que <strong>bloqueia a linha e tem conserto</strong> —
            o resto continua contado acima.
          </p>
        )}

        {corrigiveis.length > 0 && (
          <div className="tabela-rolante">
            <table className="tabela tabela--densa">
              <thead>
                <tr>
                  <th scope="col">Linha</th>
                  <th scope="col">O que falta</th>
                  <th scope="col">No arquivo</th>
                  <th scope="col">Preencher</th>
                  <th scope="col">Tirar</th>
                </tr>
              </thead>
              <tbody>
                {corrigiveis.map((p) => {
                  const atual = correcoes.get(p.linha);
                  const dono = donoPorLinha.get(p.linha);
                  const removida = atual?.ignorar === true;

                  return (
                    <tr key={p.linha} className={removida ? 'tabela__linha--inativa' : undefined}>
                      <td className="tabela__num">{p.linha}</td>

                      <td>
                        <strong>{ROTULO_TIPO[p.tipo] ?? p.tipo}</strong>
                        <br />
                        <small className="texto-discreto">{p.descricao}</small>
                      </td>

                      <td>
                        {p.nome || <span className="texto-discreto">sem nome</span>}
                        <br />
                        <small className="texto-discreto">
                          {p.seguradora}
                          {p.apolice && ` · apólice ${p.apolice}`}
                        </small>
                      </td>

                      <td>
                        <input
                          className="entrada-pendencia"
                          value={
                            (p.corrigivel === 'documento' ? atual?.documento : atual?.produtor) ?? ''
                          }
                          onChange={(e) =>
                            aoCorrigir(p.linha, {
                              [p.corrigivel === 'documento' ? 'documento' : 'produtor']:
                                e.target.value,
                            })
                          }
                          placeholder={
                            p.corrigivel === 'documento' ? '000.000.000-00' : 'Nome do corretor'
                          }
                          disabled={removida || ocupado}
                          maxLength={p.corrigivel === 'documento' ? 25 : 120}
                          autoComplete="off"
                        />

                        {/* Documento já com dono pode ser digitação errada: a apólice iria para outro em silêncio. */}
                        {dono && (
                          <p className="campo__dica">
                            ⚠ {dono.documento} já é de <strong>{dono.cliente}</strong>. Se
                            for a mesma pessoa, siga; se não, corrija ou tire a linha.
                          </p>
                        )}
                      </td>

                      <td>
                        <label className="campo-check">
                          <input
                            type="checkbox"
                            checked={removida}
                            onChange={(e) => aoCorrigir(p.linha, { ignorar: e.target.checked })}
                            disabled={ocupado}
                          />
                          <span className="visualmente-oculto">
                            Tirar a linha {p.linha} desta carga
                          </span>
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Reconferir, não gravar: o que foi digitado muda os números da prévia. */}
        <div className="barra-filtros barra-filtros--acoes">
          <span className="texto-discreto">
            {preenchidas > 0
              ? `${preenchidas} linha(s) preenchida(s) ou removida(s).`
              : 'Nada preenchido ainda.'}
          </span>
          <button
            type="button"
            className="botao botao--discreto botao--compacto"
            onClick={aoReconferir}
            disabled={preenchidas === 0 || ocupado}
          >
            Reconferir com o que preenchi
          </button>
        </div>

        {informativas.length > 0 && (
          <details className="colunas-modelo">
            <summary>
              As que não têm conserto aqui ({informativas.length} na lista)
            </summary>
            <div className="tabela-rolante">
              <table className="tabela tabela--densa">
                <thead>
                  <tr>
                    <th scope="col">Linha</th>
                    <th scope="col">O que falta</th>
                    <th scope="col">No arquivo</th>
                  </tr>
                </thead>
                <tbody>
                  {informativas.map((p) => (
                    <tr key={p.linha}>
                      <td className="tabela__num">{p.linha}</td>
                      <td>
                        <strong>{ROTULO_TIPO[p.tipo] ?? p.tipo}</strong>
                        <br />
                        <small className="texto-discreto">{p.descricao}</small>
                      </td>
                      <td>
                        {p.nome}
                        <br />
                        <small className="texto-discreto">{p.seguradora}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
