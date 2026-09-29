import { Fragment, useCallback, useEffect, useState } from 'react';

import { CabecalhoPainel } from '@/components/Painel';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { arquivosApi, type ArquivoAuditoria } from '@/lib/financeiro';

/** Auditoria das importações. Desfazer apaga o dado, não o registro: a linha fica, marcada. */
export function AuditoriaImportacoesPage(): React.JSX.Element {
  const { temPermissao } = useAuth();
  const podeDesfazer = temPermissao('importacao.gerenciar');

  const [arquivos, setArquivos] = useState<ArquivoAuditoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Auditoria de importações — MinhaCorretora';
  }, []);

  const carregar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);

    try {
      setArquivos((await arquivosApi.auditoria()).arquivos);
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível carregar o histórico de importações.',
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function confirmarDesfazer(lote: string): Promise<void> {
    try {
      const r = await arquivosApi.desfazer(lote, motivo);
      const total = Object.entries(r.removidos)
        .map(([t, n]) => `${n} ${t}`)
        .join(', ');

      setAviso(`Importação desfeita. Removido: ${total || 'nada (a carga já não tinha linhas)'}.`);
      setDesfazendo(null);
      setMotivo('');
      await carregar();
    } catch (falha) {
      setErro(
        falha instanceof ApiError ? falha.message : 'Não foi possível desfazer a importação.',
      );
    }
  }

  const tamanho = (bytes: number): string =>
    bytes > 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} kB`;

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Auditoria de importações"
        descricao="Cada carga guarda uma cópia do arquivo original, com hash de integridade."
      />

      {aviso && (
        <p className="alerta alerta--ok" role="status">
          {aviso}
        </p>
      )}

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      <section className="cartao cartao--largo">
        <div className="cartao__corpo">
          {carregando ? (
            <p className="texto-discreto">Carregando…</p>
          ) : arquivos.length === 0 ? (
            <p className="texto-discreto">Nenhuma importação registrada ainda.</p>
          ) : (
            <div className="tabela-rolante">
              <table className="tabela tabela--densa">
                <thead>
                  <tr>
                    <th scope="col">Arquivo</th>
                    <th scope="col">Seguradora</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Layout</th>
                    <th scope="col">Quando</th>
                    <th scope="col">Por</th>
                    <th scope="col">Tamanho</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {arquivos.map((a) => (
                    <Fragment key={a.lote}>
                      <tr className={a.desfeito_em ? 'tabela__linha--inativa' : undefined}>
                        <td>
                          {a.nome_original}
                          <br />
                          <span className="texto-discreto tabela__mono" title={`SHA-256: ${a.sha256}`}>
                            {a.caminho}
                          </span>
                        </td>
                        <td>{a.seguradora ?? <span className="texto-discreto">—</span>}</td>
                        <td>
                          <span className="tipo-pessoa">{a.entidade}</span>
                          {a.desfeito_em && (
                            <span className="etiqueta etiqueta--critico">desfeita</span>
                          )}
                        </td>
                        <td className="texto-discreto">{a.layout ?? a.origem_sistema}</td>
                        <td>
                          {new Date(a.importado_em).toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </td>
                        {/* Vazio = linha de comando, sem sessão: "sistema" inventaria um responsável. */}
                        <td>{a.importado_por ?? <span className="texto-discreto">terminal</span>}</td>
                        <td className="tabela__num">{tamanho(a.tamanho_bytes)}</td>
                        <td>
                          <button
                            type="button"
                            className="botao botao--discreto botao--compacto"
                            onClick={() => void arquivosApi.baixarOriginal(a.lote, a.nome_original)}
                          >
                            ↓ Original
                          </button>

                          {podeDesfazer && !a.desfeito_em && (
                            <button
                              type="button"
                              className="botao botao--discreto botao--compacto"
                              onClick={() => {
                                setDesfazendo(a.lote);
                                setMotivo('');
                                setAviso(null);
                              }}
                            >
                              Desfazer
                            </button>
                          )}
                        </td>
                      </tr>

                      {a.desfeito_em && (
                        <tr key={`${a.lote}-motivo`}>
                          <td colSpan={8} className="texto-discreto">
                            Desfeita em{' '}
                            {new Date(a.desfeito_em).toLocaleString('pt-BR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                            {a.motivo_desfazimento ? ` — ${a.motivo_desfazimento}` : ''}
                          </td>
                        </tr>
                      )}

                      {desfazendo === a.lote && (
                        <tr key={`${a.lote}-form`}>
                          <td colSpan={8}>
                            <div className="alerta alerta--erro">
                              <p>
                                <strong>Desfazer apaga as linhas que esta carga trouxe.</strong>{' '}
                                Clientes, apólices, parcelas e comissões do lote{' '}
                                <span className="tabela__mono">{a.lote.slice(0, 8)}…</span> serão
                                removidos. O arquivo e o registro continuam aqui.
                              </p>
                            </div>

                            <div className="campo">
                              <label htmlFor={`motivo-${a.lote}`}>
                                Por que esta importação está sendo desfeita?
                              </label>
                              <input
                                id={`motivo-${a.lote}`}
                                value={motivo}
                                onChange={(e) => setMotivo(e.target.value)}
                                placeholder="Layout errado, arquivo desatualizado…"
                                autoComplete="off"
                              />
                            </div>

                            <div className="barra-filtros">
                              <button
                                type="button"
                                className="botao botao--principal botao--compacto"
                                onClick={() => void confirmarDesfazer(a.lote)}
                                disabled={motivo.trim().length < 5}
                              >
                                Confirmar e desfazer
                              </button>
                              <button
                                type="button"
                                className="botao botao--discreto botao--compacto"
                                onClick={() => setDesfazendo(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
