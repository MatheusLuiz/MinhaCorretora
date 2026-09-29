import { useCallback, useEffect, useState } from 'react';

import { FichaSeguradora } from '@/components/configuracoes/FichaSeguradora';
import { ApiError } from '@/lib/api';
import { seguradorasApi, type Seguradora } from '@/lib/seguradoras';

/**
 * Cadastro das companhias. Inativar, nunca apagar: apólices e arquivos citam a
 * companhia, e apagar cortaria o histórico.
 */
export function PainelSeguradoras(): React.JSX.Element {
  const [seguradoras, setSeguradoras] = useState<Seguradora[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState<number | 'nova' | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    setCarregando(true);
    setErro(null);

    try {
      // Inclui as inativas: é aqui que se religa uma companhia.
      setSeguradoras((await seguradorasApi.listar(true)).seguradoras);
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : 'Não foi possível carregar as seguradoras.',
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (selecionada !== null) {
    const atual = selecionada === 'nova'
      ? null
      : seguradoras.find((s) => s.id === selecionada) ?? null;

    if (selecionada !== 'nova' && !atual) {
      return <p className="texto-discreto">Seguradora não encontrada.</p>;
    }

    return (
      <FichaSeguradora
        seguradora={atual}
        aoVoltar={() => setSelecionada(null)}
        aoSalvar={(salva) => {
          setSeguradoras((antes) =>
            antes.some((s) => s.id === salva.id)
              ? antes.map((s) => (s.id === salva.id ? salva : s))
              : [...antes, salva].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
          );
          setSelecionada(salva.id);
        }}
      />
    );
  }

  if (carregando) return <p className="texto-discreto">Carregando seguradoras…</p>;

  if (erro) {
    return (
      <div className="alerta alerta--erro" role="alert">
        <p>{erro}</p>
        <button
          type="button"
          className="botao botao--discreto botao--compacto"
          onClick={() => void carregar()}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const termo = busca.trim().toLowerCase();
  const visiveis = termo
    ? seguradoras.filter((s) => s.nome.toLowerCase().includes(termo))
    : seguradoras;

  const ativas = seguradoras.filter((s) => s.ativa).length;

  return (
    <div className="usuarios">
      <div className="usuarios__barra">
        <label className="campo-busca">
          <span className="visualmente-oculto">Buscar seguradora</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome…"
            autoComplete="off"
          />
        </label>

        <button
          type="button"
          className="botao botao--principal botao--compacto"
          onClick={() => setSelecionada('nova')}
        >
          Nova seguradora
        </button>
      </div>

      <p className="usuarios__resumo texto-discreto">
        {ativas} ativa(s) de {seguradoras.length}. Companhia inativa não aparece
        no cadastro de cliente nem na importação de arquivos — mas continua nos
        filtros de busca, para não esconder quem já está ligado a ela.
      </p>

      <table className="tabela tabela--densa tabela--clicavel">
        <thead>
          <tr>
            <th scope="col">Seguradora</th>
            <th scope="col">Integração</th>
            <th scope="col" className="tabela__num">Carteira</th>
            <th scope="col">Situação</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((s) => (
            <tr
              key={s.id}
              onClick={() => setSelecionada(s.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelecionada(s.id);
                }
              }}
              className={s.ativa ? undefined : 'tabela__linha--inativa'}
            >
              <td>
                <strong>{s.nome}</strong>
                {s.cnpj && (
                  <>
                    <br />
                    <small className="texto-discreto tabela__mono">{formatarCnpj(s.cnpj)}</small>
                  </>
                )}
              </td>
              <td>
                <EtiquetaIntegracao seguradora={s} />
              </td>
              <td className="tabela__num">
                {s.clientes.toLocaleString('pt-BR')} cliente(s)
                <br />
                <small className="texto-discreto">
                  {s.apolices.toLocaleString('pt-BR')} apólice(s)
                </small>
              </td>
              <td>
                {s.ativa ? (
                  <span className="etiqueta etiqueta--ok">Ativa</span>
                ) : (
                  <span className="etiqueta etiqueta--critico">Inativa</span>
                )}
              </td>
            </tr>
          ))}

          {visiveis.length === 0 && (
            <tr>
              <td colSpan={4} className="tabela__vazio">
                Nenhuma seguradora encontrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const NOMES_TIPO: Record<string, string> = {
  nenhuma: 'Sem integração',
  api: 'API',
  sftp: 'SFTP',
  portal: 'Portal (manual)',
};

function EtiquetaIntegracao({ seguradora }: { seguradora: Seguradora }): React.JSX.Element {
  const i = seguradora.integracao;

  if (!i || i.tipo === 'nenhuma') {
    return <span className="texto-discreto">Importação manual</span>;
  }

  return (
    <>
      {NOMES_TIPO[i.tipo] ?? i.tipo}
      {i.ambiente === 'homologacao' && (
        <span className="etiqueta etiqueta--atencao">homologação</span>
      )}
      <br />
      <small className="texto-discreto">
        {i.ativa ? 'ligada' : 'cadastrada, desligada'}
        {i.temSegredo ? ` · chave ${i.segredoDica ?? 'cadastrada'}` : ' · sem chave'}
      </small>
    </>
  );
}

export function formatarCnpj(digitos: string): string {
  return digitos.length === 14
    ? digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : digitos;
}
