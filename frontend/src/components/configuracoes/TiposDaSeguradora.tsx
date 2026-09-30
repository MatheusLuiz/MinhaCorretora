import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';
import type { Seguradora } from '@/lib/seguradoras';
import { FORMULARIOS, tiposSeguroApi, type TipoSeguro } from '@/lib/tiposSeguro';

/** Sem acento e sem caixa, para a busca. */
const comparavel = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u{300}-\u{36f}]/gu, '')
    .toLowerCase();

/** Tipos de seguro que ESTA seguradora vende; cada caixa salva na hora. */
export function TiposDaSeguradora({ seguradora }: { seguradora: Seguradora }): React.JSX.Element {
  const [tipos, setTipos] = useState<TipoSeguro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);
    try {
      setTipos((await tiposSeguroApi.listar()).tipos);
    } catch (falha) {
      setErro(falha instanceof ApiError ? falha.message : 'Não foi possível carregar os tipos de seguro.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternar(tipo: TipoSeguro): Promise<void> {
    const habilitar = !tipo.seguradoras.includes(seguradora.id);
    setOcupado(tipo.id);
    setAviso(null);
    try {
      const { tipo: salvo } = await tiposSeguroApi.definirHabilitacao(tipo.id, seguradora.id, habilitar);
      setTipos((antes) => antes.map((t) => (t.id === salvo.id ? salvo : t)));
    } catch (falha) {
      setAviso(falha instanceof ApiError ? falha.message : 'Não foi possível salvar a mudança.');
    } finally {
      setOcupado(null);
    }
  }

  if (carregando) return <p className="texto-discreto">Carregando tipos de seguro…</p>;

  if (erro) {
    return (
      <div className="alerta alerta--erro" role="alert">
        <p>{erro}</p>
        <button type="button" className="botao botao--discreto botao--compacto" onClick={() => void carregar()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  // Tipo inativo só aparece se já marcado, para a marcação poder ser desfeita.
  const visiveis = tipos.filter((t) => t.ativo || t.seguradoras.includes(seguradora.id));
  const marcados = visiveis.filter((t) => t.seguradoras.includes(seguradora.id)).length;
  const termo = comparavel(busca.trim());
  const filtrados = termo ? visiveis.filter((t) => comparavel(t.nome).includes(termo)) : visiveis;

  return (
    <div className="formulario">
      {aviso && (
        <div className="alerta alerta--erro" role="alert">
          <p>{aviso}</p>
        </div>
      )}

      {visiveis.length === 0 ? (
        <p className="alerta alerta--aviso" role="note">
          Nenhum tipo de seguro cadastrado. Cadastre em Configurações › Tipos de seguro.
        </p>
      ) : (
        <>
          <div className="tipos-seguro__barra">
            <input
              type="search"
              className="tipos-seguradora__busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar tipo de seguro…"
              aria-label="Pesquisar tipo de seguro"
            />
            <span className="texto-discreto">
              {marcados} de {visiveis.length} marcados
            </span>
          </div>

          {filtrados.length === 0 ? (
            <p className="texto-discreto">Nenhum tipo com “{busca.trim()}”.</p>
          ) : (
            <div className="tipos-seguradora__lista">
              {filtrados.map((t) => (
                <label
                  key={t.id}
                  className="campo-check"
                  title={`Formulário ${FORMULARIOS[t.formulario].rotulo}${t.descricao ? ` · ${t.descricao}` : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={t.seguradoras.includes(seguradora.id)}
                    disabled={ocupado === t.id || !seguradora.ativa}
                    onChange={() => void alternar(t)}
                  />
                  <span>
                    {t.nome}
                    {!t.ativo && <span className="texto-discreto"> (inativo)</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </>
      )}

      {!seguradora.ativa && (
        <p className="texto-discreto">Seguradora inativa: reative no Cadastro para mudar os tipos.</p>
      )}
    </div>
  );
}
