import { useCallback, useEffect, useState } from 'react';

import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { ApiError } from '@/lib/api';
import {
  FORMULARIOS,
  tiposSeguroApi,
  type Formulario,
  type TipoSeguro,
} from '@/lib/tiposSeguro';

/** Sem acento e sem caixa, para a busca. */
const comparavel = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u{300}-\u{36f}]/gu, '')
    .toLowerCase();

/**
 * Catálogo de tipos de seguro. Tipo é cadastro; formulário é código. Quem vende
 * cada tipo se marca na ficha da seguradora.
 */
export function PainelTiposSeguro(): React.JSX.Element {
  const [tipos, setTipos] = useState<TipoSeguro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<TipoSeguro | 'novo' | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroFormulario, setFiltroFormulario] = useState<Formulario | ''>('');
  const [filtroSituacao, setFiltroSituacao] = useState<'' | 'ativo' | 'inativo'>('');

  const termo = comparavel(busca.trim());
  const filtrados = tipos.filter(
    (t) =>
      (!termo || comparavel(t.nome).includes(termo) || comparavel(t.descricao ?? '').includes(termo)) &&
      (!filtroFormulario || t.formulario === filtroFormulario) &&
      (!filtroSituacao || t.ativo === (filtroSituacao === 'ativo')),
  );
  const pagina = usePaginacao(filtrados, [busca, filtroFormulario, filtroSituacao], 5);

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

  const trocarTipo = (salvo: TipoSeguro): void =>
    setTipos((antes) =>
      (antes.some((t) => t.id === salvo.id)
        ? antes.map((t) => (t.id === salvo.id ? salvo : t))
        : [...antes, salvo]
      ).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')),
    );

  async function alternarAtivo(tipo: TipoSeguro): Promise<void> {
    setOcupado(`ativo:${tipo.id}`);
    setAviso(null);
    try {
      trocarTipo((await tiposSeguroApi.definirSituacao(tipo.id, !tipo.ativo)).tipo);
    } catch (falha) {
      setAviso(falha instanceof ApiError ? falha.message : 'Não foi possível salvar a mudança.');
    } finally {
      setOcupado(null);
    }
  }

  if (editando !== null) {
    return (
      <FormularioTipo
        tipo={editando === 'novo' ? null : editando}
        aoVoltar={() => setEditando(null)}
        aoSalvar={(salvo) => {
          trocarTipo(salvo);
          setEditando(null);
        }}
      />
    );
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

  return (
    <div className="usuarios tipos-seguro">
      <div className="tipos-seguro__barra">
        <input
          type="search"
          className="tipos-seguro__busca"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Pesquisar tipo…"
          aria-label="Pesquisar tipo de seguro"
        />
        <select
          value={filtroFormulario}
          onChange={(e) => setFiltroFormulario(e.target.value as Formulario | '')}
          aria-label="Filtrar por formulário"
        >
          <option value="">Todos os formulários</option>
          {(Object.keys(FORMULARIOS) as Formulario[]).map((f) => (
            <option key={f} value={f}>
              {FORMULARIOS[f].rotulo}
            </option>
          ))}
        </select>
        <select
          value={filtroSituacao}
          onChange={(e) => setFiltroSituacao(e.target.value as '' | 'ativo' | 'inativo')}
          aria-label="Filtrar por situação"
        >
          <option value="">Ativos e inativos</option>
          <option value="ativo">Só ativos</option>
          <option value="inativo">Só inativos</option>
        </select>
        <button
          type="button"
          className="botao botao--principal botao--compacto"
          onClick={() => setEditando('novo')}
        >
          Novo tipo
        </button>
      </div>

      {aviso && (
        <div className="alerta alerta--erro" role="alert">
          <p>{aviso}</p>
        </div>
      )}

      {filtrados.length === 0 ? (
        <p className="texto-discreto">Nenhum tipo com esses filtros.</p>
      ) : (
      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Formulário</th>
              <th scope="col" className="tabela__num" title="Quantas seguradoras vendem o tipo">
                Seguradoras
              </th>
              <th scope="col" className="tabela__num">Apólices</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {pagina.visiveis.map((t) => (
              <tr key={t.id} className={t.ativo ? undefined : 'tabela__linha--inativa'}>
                <td>
                  <button
                    type="button"
                    className="tipos-seguro__nome"
                    onClick={() => setEditando(t)}
                    title={t.descricao ? `Editar o tipo · ${t.descricao}` : 'Editar o tipo'}
                  >
                    {t.nome}
                  </button>
                </td>
                <td
                  className="texto-discreto"
                  title={`Pede: ${FORMULARIOS[t.formulario].pede}${FORMULARIOS[t.formulario].pronto ? '' : ' (campos do bem em breve)'}`}
                >
                  {FORMULARIOS[t.formulario].rotulo}
                </td>
                <td className="tabela__num">{t.seguradoras.length.toLocaleString('pt-BR')}</td>
                <td className="tabela__num">{t.apolices.toLocaleString('pt-BR')}</td>
                <td>
                  <button
                    type="button"
                    className="botao botao--discreto botao--compacto"
                    disabled={ocupado === `ativo:${t.id}`}
                    onClick={() => void alternarAtivo(t)}
                    title={t.ativo ? 'Parar de oferecer na nova apólice' : 'Voltar a oferecer'}
                  >
                    {t.ativo ? 'Ativo' : 'Inativo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <Paginacao p={pagina} />

    </div>
  );
}

function FormularioTipo({
  tipo,
  aoVoltar,
  aoSalvar,
}: {
  tipo: TipoSeguro | null;
  aoVoltar: () => void;
  aoSalvar: (salvo: TipoSeguro) => void;
}): React.JSX.Element {
  const [nome, setNome] = useState(tipo?.nome ?? '');
  const [formulario, setFormulario] = useState<Formulario>(tipo?.formulario ?? 'generico');
  const [descricao, setDescricao] = useState(tipo?.descricao ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setSalvando(true);
    setErros([]);
    try {
      const dados = { nome, formulario, descricao };
      const { tipo: salvo } = tipo
        ? await tiposSeguroApi.atualizar(tipo.id, { ...dados, ordem: tipo.ordem })
        : await tiposSeguroApi.criar(dados);
      aoSalvar(salvo);
    } catch (falha) {
      const api = falha instanceof ApiError ? falha : null;
      setErros(
        api?.mensagensDeValidacao.length
          ? api.mensagensDeValidacao
          : [api?.message ?? 'Não foi possível salvar. Tente de novo.'],
      );
    } finally {
      setSalvando(false);
    }
  }

  // Trocar o formulário não move os dados já gravados (o veículo fica na tabela de veículos).
  const trocaFormularioComApolices =
    tipo !== null && tipo.apolices > 0 && formulario !== tipo.formulario;

  return (
    <form className="formulario" onSubmit={(e) => void enviar(e)}>
      <button type="button" className="botao botao--discreto botao--compacto tipos-seguro__voltar" onClick={aoVoltar}>
        ← Tipos de seguro
      </button>

      <h3 className="formulario__titulo">{tipo ? `Editar ${tipo.nome}` : 'Novo tipo de seguro'}</h3>

      {erros.length > 0 && (
        <div className="alerta alerta--erro" role="alert">
          {erros.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <div className="formulario__linha">
        <label className="campo-form">
          <span>Nome</span>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            required
            autoFocus
            placeholder="Ex.: Seguro Celular"
          />
        </label>

        <label className="campo-form">
          <span>Formulário da nova apólice</span>
          <select value={formulario} onChange={(e) => setFormulario(e.target.value as Formulario)}>
            {(Object.keys(FORMULARIOS) as Formulario[]).map((f) => (
              <option key={f} value={f}>
                {FORMULARIOS[f].rotulo}
                {!FORMULARIOS[f].pronto && ' (em breve)'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="formulario__nota texto-discreto">
        Pede: {FORMULARIOS[formulario].pede}.
        {!FORMULARIOS[formulario].pronto &&
          ' Enquanto o formulário não fica pronto, a apólice deste tipo se cadastra só com os dados gerais.'}
      </p>

      <label className="campo-form campo-form--largo">
        <span>Descrição <em>opcional</em></span>
        <input
          type="text"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
        />
      </label>

      {trocaFormularioComApolices && (
        <p className="alerta alerta--aviso" role="note">
          {tipo.apolices} apólice(s) já usam este tipo. Trocar o formulário muda o que a nova
          apólice pede daqui em diante; o que já foi gravado continua onde está.
        </p>
      )}

      <div className="formulario__acoes">
        <button type="button" className="botao botao--discreto botao--compacto" onClick={aoVoltar} disabled={salvando}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--principal botao--compacto" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
