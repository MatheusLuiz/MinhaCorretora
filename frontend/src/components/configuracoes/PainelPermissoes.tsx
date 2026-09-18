import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api';
import {
  ROTULO_PERMISSAO,
  usuariosApi,
  type PermissaoDaFicha,
} from '@/lib/usuarios';

interface Props {
  usuarioId: string;
  papelNome: string;
  /** Impede editar as próprias permissões — a mesma regra vale no servidor. */
  ehVoceMesmo: boolean;
}

/**
 * Permissões do usuário: as do papel ± exceções. Envia o conjunto FINAL; o
 * servidor grava só o que destoa do papel, mantendo o vínculo com ele.
 */
export function PainelPermissoes({
  usuarioId,
  papelNome,
  ehVoceMesmo,
}: Props): React.JSX.Element {
  const [quadro, setQuadro] = useState<PermissaoDaFicha[]>([]);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [motivo, setMotivo] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      try {
        const { permissoes } = await usuariosApi.permissoes(usuarioId);
        if (cancelado) return;

        setQuadro(permissoes);
        setSelecionadas(new Set(permissoes.filter((p) => p.efetiva).map((p) => p.chave)));
        setMotivo(permissoes.find((p) => p.motivo)?.motivo ?? '');
      } catch (falha) {
        if (!cancelado) {
          setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar.');
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [usuarioId]);

  const original = useMemo(
    () => new Set(quadro.filter((p) => p.efetiva).map((p) => p.chave)),
    [quadro],
  );

  const alterado = useMemo(() => {
    if (original.size !== selecionadas.size) return true;
    for (const chave of selecionadas) if (!original.has(chave)) return true;
    return false;
  }, [original, selecionadas]);

  function alternar(chave: string): void {
    setSalvo(false);
    setSelecionadas((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }

  async function salvar(): Promise<void> {
    setErro(null);
    setSalvando(true);

    try {
      const { permissoes } = await usuariosApi.definirPermissoes(
        usuarioId,
        [...selecionadas],
        motivo.trim() || undefined,
      );
      setQuadro(permissoes);
      setSelecionadas(new Set(permissoes.filter((p) => p.efetiva).map((p) => p.chave)));
      setSalvo(true);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  function restaurarPapel(): void {
    setSalvo(false);
    setSelecionadas(new Set(quadro.filter((p) => p.doPapel).map((p) => p.chave)));
  }

  if (carregando) return <p className="texto-discreto">Carregando permissões…</p>;

  const excecoesAtuais = quadro.filter((p) => p.excecao).length;

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>Permissões</h4>
          <p className="texto-discreto">
            O papel <strong>{papelNome}</strong> concede {quadro.filter((p) => p.doPapel).length} delas.
            Marque ou desmarque para abrir exceções.
          </p>
        </div>

        {excecoesAtuais > 0 && (
          <span className="etiqueta etiqueta--atencao">
            {excecoesAtuais} exceção(ões)
          </span>
        )}
      </header>

      {ehVoceMesmo && (
        <p className="alerta alerta--aviso" role="note">
          Você não pode alterar as próprias permissões. Sem essa regra, quem gerencia
          usuários se concederia acesso total em dois cliques — mudar o próprio acesso
          passa por outra pessoa.
        </p>
      )}

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}

      {salvo && !alterado && (
        <p className="alerta alerta--ok" role="status">
          Permissões salvas. As sessões da pessoa foram encerradas para que valham já.
        </p>
      )}

      <ul className="lista-permissoes">
        {quadro.map((p) => {
          const marcada = selecionadas.has(p.chave);
          const viraExcecao = marcada !== p.doPapel;

          return (
            <li key={p.chave} className={viraExcecao ? 'lista-permissoes--excecao' : undefined}>
              <label>
                <input
                  type="checkbox"
                  checked={marcada}
                  onChange={() => alternar(p.chave)}
                  disabled={ehVoceMesmo || salvando}
                />

                <span className="lista-permissoes__texto">
                  <strong>{ROTULO_PERMISSAO[p.chave] ?? p.chave}</strong>
                  <code>{p.chave}</code>
                </span>

                <span className="lista-permissoes__origem">
                  {!viraExcecao && p.doPapel && <span className="tag tag--papel">do papel</span>}
                  {viraExcecao && marcada && <span className="tag tag--mais">+ exceção</span>}
                  {viraExcecao && !marcada && <span className="tag tag--menos">− removida</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {!ehVoceMesmo && (
        <div className="bloco__acoes">
          <label className="campo-form campo-form--largo">
            <span>Motivo da exceção</span>
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: apoio ao fechamento mensal"
              maxLength={255}
              disabled={!alterado}
            />
            <small>
              Fica registrado na auditoria. Sem o motivo escrito, em seis meses
              ninguém lembra por que essa exceção existe — e ela nunca é removida.
            </small>
          </label>

          <div className="bloco__botoes">
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={restaurarPapel}
              disabled={salvando}
            >
              Voltar ao papel
            </button>
            <button
              type="button"
              className="botao botao--principal botao--compacto"
              onClick={() => void salvar()}
              disabled={!alterado || salvando}
            >
              {salvando ? 'Salvando…' : 'Salvar permissões'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
