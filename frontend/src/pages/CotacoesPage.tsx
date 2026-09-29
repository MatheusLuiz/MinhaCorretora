import { useCallback, useEffect, useMemo, useState } from 'react';

import { SeletorTiposSeguro } from '@/components/cliente/SeletorTiposSeguro';
import { CabecalhoPainel } from '@/components/Painel';
import { useCliente } from '@/hooks/useCliente';
import { ApiError } from '@/lib/api';
import { clientesApi, type ClienteResumo, type Corretor } from '@/lib/clientes';
import {
  CLASSE_SITUACAO,
  cotacoesApi,
  ROTULO_SITUACAO,
  type CotacaoDetalhe,
  type CotacaoResumo,
  type NovaCotacao,
  type SituacaoCotacao,
} from '@/lib/cotacoes';
import { documentoValido } from '@/lib/documento';
import { formatarData, formatarReais } from '@/lib/formato';
import { seguradorasApi, type Seguradora } from '@/lib/seguradoras';
import { tiposSeguroApi, type TipoSeguro } from '@/lib/tiposSeguro';

/** Cotações: pré-cadastra o cliente (prospecto) e registra o que cada seguradora ofereceu. */

type Tela = { modo: 'lista' } | { modo: 'nova' } | { modo: 'detalhe'; id: string };

type Etapa = 'cliente' | 'tipos' | 'veiculo' | 'observacoes';

const FILTROS: [SituacaoCotacao | '', string][] = [
  ['', 'Todas'],
  ['em_cotacao', 'Em cotação'],
  ['enviada', 'Enviadas'],
  ['fechada', 'Fechadas'],
  ['perdida', 'Perdidas'],
];

/** `1.234,56` ou `1234.56` → número. Vazio → null; inválido → NaN. */
function paraNumero(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : NaN;
}

function mensagemDeErro(falha: unknown, padrao: string): string[] {
  const api = falha instanceof ApiError ? falha : null;
  return api?.mensagensDeValidacao.length ? api.mensagensDeValidacao : [api?.message ?? padrao];
}

export function CotacoesPage(): React.JSX.Element {
  const [tela, setTela] = useState<Tela>({ modo: 'lista' });
  const [tipos, setTipos] = useState<TipoSeguro[]>([]);
  const [seguradoras, setSeguradoras] = useState<Seguradora[]>([]);

  useEffect(() => {
    document.title = 'Cotações — MinhaCorretora';
    void tiposSeguroApi.listar().then((r) => setTipos(r.tipos.filter((t) => t.ativo))).catch(() => setTipos([]));
    void seguradorasApi.listar().then((r) => setSeguradoras(r.seguradoras)).catch(() => setSeguradoras([]));
  }, []);

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Cotações"
        descricao="Cote para cliente novo ou já cadastrado, e registre o que cada seguradora ofereceu."
      />

      {tela.modo === 'lista' && (
        <ListaCotacoes aoNova={() => setTela({ modo: 'nova' })} aoAbrir={(id) => setTela({ modo: 'detalhe', id })} />
      )}
      {tela.modo === 'nova' && (
        <FormNovaCotacao
          tipos={tipos}
          seguradoras={seguradoras}
          aoCancelar={() => setTela({ modo: 'lista' })}
          aoCriar={(id) => setTela({ modo: 'detalhe', id })}
        />
      )}
      {tela.modo === 'detalhe' && (
        <DetalheCotacao id={tela.id} aoVoltar={() => setTela({ modo: 'lista' })} />
      )}
    </div>
  );
}

// ─────────────────────────────── Lista ───────────────────────────────

function ListaCotacoes({
  aoNova,
  aoAbrir,
}: {
  aoNova: () => void;
  aoAbrir: (id: string) => void;
}): React.JSX.Element {
  const [filtro, setFiltro] = useState<SituacaoCotacao | ''>('');
  const [cotacoes, setCotacoes] = useState<CotacaoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    void cotacoesApi
      .listar(filtro || undefined)
      .then((r) => {
        if (!cancelado) setCotacoes(r.cotacoes);
      })
      .catch((falha: unknown) => {
        if (!cancelado) setErro(mensagemDeErro(falha, 'Não foi possível carregar as cotações.')[0]!);
      });
    return () => {
      cancelado = true;
    };
  }, [filtro]);

  return (
    <section className="cartao cartao--largo">
      <div className="cartao__corpo">
        <div className="cotacoes__barra">
          <div className="segmentado" role="group" aria-label="Situação">
            {FILTROS.map(([chave, rotulo]) => (
              <button
                key={chave || 'todas'}
                type="button"
                className={filtro === chave ? 'segmentado__opcao segmentado__opcao--ativa' : 'segmentado__opcao'}
                aria-pressed={filtro === chave}
                onClick={() => setFiltro(chave)}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <button type="button" className="botao botao--principal botao--compacto" onClick={aoNova}>
            Nova cotação
          </button>
        </div>

        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        )}

        {!cotacoes && !erro && <p className="texto-discreto">Carregando…</p>}

        {cotacoes && cotacoes.length === 0 && (
          <p className="texto-discreto">
            Nenhuma cotação {filtro ? 'nesta situação' : 'ainda'}. Comece por <strong>Nova cotação</strong>.
          </p>
        )}

        {cotacoes && cotacoes.length > 0 && (
          <div className="tabela-rolante">
            <table className="tabela tabela--densa tabela--clicavel">
              <thead>
                <tr>
                  <th scope="col">Criada em</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Tipos</th>
                  <th scope="col">Corretor</th>
                  <th scope="col" className="tabela__num">Propostas</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {cotacoes.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => aoAbrir(c.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        aoAbrir(c.id);
                      }
                    }}
                  >
                    <td>{formatarData(c.criadaEm.slice(0, 10))}</td>
                    <td>
                      {c.cliente.nome}
                      <br />
                      <small className="texto-discreto tabela__mono">{c.cliente.cpfCnpj ?? ''}</small>
                    </td>
                    <td>{c.tipos.join(', ')}</td>
                    <td>{c.corretor ?? <span className="texto-discreto">—</span>}</td>
                    <td className="tabela__num">
                      {c.propostas}
                      {c.menorPremio !== null && (
                        <>
                          <br />
                          <small className="texto-discreto">a partir de {formatarReais(c.menorPremio)}</small>
                        </>
                      )}
                    </td>
                    <td>
                      <span className={`etiqueta ${CLASSE_SITUACAO[c.situacao]}`}>{ROTULO_SITUACAO[c.situacao]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────── Nova ───────────────────────────────

const VEICULO_VAZIO = {
  placa: '', chassi: '', fabricante: '', modelo: '', anoFabricacao: '', anoModelo: '', codigoFipe: '',
  uso: '', cepPernoite: '', condutorNome: '', condutorDocumento: '', condutorNascimento: '', zeroKm: false,
};

function FormNovaCotacao({
  tipos,
  seguradoras,
  aoCancelar,
  aoCriar,
}: {
  tipos: TipoSeguro[];
  seguradoras: Seguradora[];
  aoCancelar: () => void;
  aoCriar: (id: string) => void;
}): React.JSX.Element {
  const [origem, setOrigem] = useState<'novo' | 'existente'>('novo');
  const [novo, setNovo] = useState({ cpfCnpj: '', nome: '', telefone: '', email: '' });
  const [busca, setBusca] = useState('');
  const [encontrados, setEncontrados] = useState<ClienteResumo[]>([]);
  const [cliente, setCliente] = useState<ClienteResumo | null>(null);
  const [corretores, setCorretores] = useState<{ atual: Corretor; podeEscolher: boolean; corretores: Corretor[] } | null>(null);
  const [corretor, setCorretor] = useState('');
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [veiculo, setVeiculo] = useState(VEICULO_VAZIO);
  const [observacoes, setObservacoes] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);

  useEffect(() => {
    void clientesApi.corretores().then(setCorretores).catch(() => setCorretores(null));
  }, []);

  useEffect(() => {
    if (origem !== 'existente' || busca.trim().length < 3) {
      setEncontrados([]);
      return;
    }
    const t = setTimeout(() => {
      void clientesApi
        .listar({ busca: busca.trim(), limite: 8 })
        .then((r) => setEncontrados(r.clientes))
        .catch(() => setEncontrados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busca, origem]);

  const escolhidos = tipos.filter((t) => selecionados.includes(t.id));
  const pedeVeiculo = escolhidos.some((t) => t.formulario === 'veiculo');
  const nomeSeguradora = useMemo(() => new Map(seguradoras.map((s) => [s.id, s.nome])), [seguradoras]);
  const mudarVeiculo = (campo: keyof typeof VEICULO_VAZIO, valor: string | boolean): void =>
    setVeiculo((v) => ({ ...v, [campo]: valor }));

  // "Veículo" só existe quando algum tipo marcado pede veículo.
  const [etapa, setEtapa] = useState<Etapa>('cliente');
  const etapas: [Etapa, string][] = [
    ['cliente', 'Cliente'],
    ['tipos', 'Tipos de seguro'],
    ...(pedeVeiculo ? ([['veiculo', 'Veículo']] as [Etapa, string][]) : []),
    ['observacoes', 'Observações'],
  ];
  const indice = Math.max(0, etapas.findIndex(([e]) => e === etapa));
  const ultima = indice === etapas.length - 1;

  /** O que falta na etapa para poder sair dela. Vazio = pode avançar. */
  function pendencias(de: Etapa): string[] {
    if (de === 'cliente') {
      if (origem === 'existente') return cliente ? [] : ['Escolha o cliente na busca.'];
      const faltas: string[] = [];
      if (!documentoValido(novo.cpfCnpj.replace(/\D/g, ''))) faltas.push('CPF ou CNPJ inválido — confira os dígitos.');
      if (novo.nome.trim().length < 2) faltas.push('Informe o nome do cliente.');
      return faltas;
    }
    if (de === 'tipos') return selecionados.length > 0 ? [] : ['Marque ao menos um tipo de seguro.'];
    return [];
  }

  function irPara(destino: Etapa): void {
    const alvo = etapas.findIndex(([e]) => e === destino);
    for (let i = indice; i < alvo; i += 1) {
      const faltas = pendencias(etapas[i]![0]);
      if (faltas.length > 0) {
        setErros(faltas);
        setEtapa(etapas[i]![0]);
        return;
      }
    }
    setErros([]);
    setEtapa(destino);
  }

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    setErros([]);

    const dados: NovaCotacao = {
      tipos: selecionados,
      ...(corretor ? { corretor } : {}),
      ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
    };
    if (origem === 'existente') {
      if (!cliente) {
        setErros(['Escolha o cliente na busca.']);
        return;
      }
      dados.clienteId = cliente.id;
    } else {
      dados.novoCliente = {
        cpfCnpj: novo.cpfCnpj,
        nome: novo.nome.trim(),
        ...(novo.telefone.trim() ? { telefone: novo.telefone } : {}),
        ...(novo.email.trim() ? { email: novo.email.trim() } : {}),
      };
    }
    if (pedeVeiculo) {
      const ano = (s: string): number | null => (s.trim() ? Number(s) : null);
      const txt = (s: string): string | null => (s.trim() ? s.trim() : null);
      dados.veiculo = {
        placa: txt(veiculo.placa), chassi: txt(veiculo.chassi), fabricante: txt(veiculo.fabricante),
        modelo: txt(veiculo.modelo), anoFabricacao: ano(veiculo.anoFabricacao), anoModelo: ano(veiculo.anoModelo),
        codigoFipe: txt(veiculo.codigoFipe), uso: txt(veiculo.uso), cepPernoite: txt(veiculo.cepPernoite),
        condutorNome: txt(veiculo.condutorNome), condutorDocumento: txt(veiculo.condutorDocumento),
        condutorNascimento: txt(veiculo.condutorNascimento), zeroKm: veiculo.zeroKm ? true : null,
      };
    }

    setEnviando(true);
    try {
      const { cotacao } = await cotacoesApi.criar(dados);
      aoCriar(cotacao.id);
    } catch (falha) {
      setErros(mensagemDeErro(falha, 'Não foi possível criar a cotação.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao cartao--largo">
      <div className="cartao__corpo">
        <form
          className="formulario"
          onSubmit={(e) => {
            if (ultima) {
              void enviar(e);
            } else {
              e.preventDefault();
              irPara(etapas[indice + 1]![0]);
            }
          }}
          noValidate
        >
          <nav className="abas" aria-label="Etapas da cotação">
            {etapas.map(([chave, rotulo], i) => (
              <button
                key={chave}
                type="button"
                className={etapa === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
                onClick={() => irPara(chave)}
                aria-current={etapa === chave ? 'step' : undefined}
              >
                {i + 1}. {rotulo}
              </button>
            ))}
          </nav>

          {erros.length > 0 && (
            <div className="alerta alerta--erro" role="alert">
              {erros.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          {etapa === 'cliente' && (
          <section className="bloco">
            <header className="bloco__cabecalho">
              <h4>Cliente</h4>
              <div className="segmentado" role="group" aria-label="Cliente">
                <button
                  type="button"
                  className={origem === 'novo' ? 'segmentado__opcao segmentado__opcao--ativa' : 'segmentado__opcao'}
                  aria-pressed={origem === 'novo'}
                  onClick={() => setOrigem('novo')}
                >
                  Pré-cadastro
                </button>
                <button
                  type="button"
                  className={origem === 'existente' ? 'segmentado__opcao segmentado__opcao--ativa' : 'segmentado__opcao'}
                  aria-pressed={origem === 'existente'}
                  onClick={() => setOrigem('existente')}
                >
                  Já é cliente
                </button>
              </div>
            </header>

            {origem === 'novo' ? (
              <>
                <p className="texto-discreto">
                  Vira cliente <strong>prospecto</strong> na sua carteira. Se o CPF/CNPJ já estiver
                  cadastrado, a cotação vai para o cadastro existente.
                </p>
                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>CPF ou CNPJ <em>obrigatório</em></span>
                    <input
                      value={novo.cpfCnpj}
                      onChange={(e) => setNovo((n) => ({ ...n, cpfCnpj: e.target.value }))}
                      inputMode="numeric"
                      autoComplete="off"
                      autoFocus
                    />
                  </label>
                  <label className="campo-form">
                    <span>Nome <em>obrigatório</em></span>
                    <input
                      value={novo.nome}
                      onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))}
                      maxLength={150}
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Telefone</span>
                    <input
                      value={novo.telefone}
                      onChange={(e) => setNovo((n) => ({ ...n, telefone: e.target.value }))}
                      inputMode="tel"
                      placeholder="(41) 99999-9999"
                    />
                  </label>
                  <label className="campo-form">
                    <span>E-mail</span>
                    <input
                      type="email"
                      value={novo.email}
                      onChange={(e) => setNovo((n) => ({ ...n, email: e.target.value }))}
                    />
                  </label>
                </div>
              </>
            ) : cliente ? (
              <p>
                <strong>{cliente.nome}</strong> <span className="texto-discreto">{cliente.cpfCnpj}</span>{' '}
                <button type="button" className="botao botao--discreto botao--compacto" onClick={() => setCliente(null)}>
                  Trocar
                </button>
              </p>
            ) : (
              <>
                <label className="campo-form">
                  <span>Buscar por nome ou CPF/CNPJ</span>
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus autoComplete="off" />
                </label>
                {encontrados.length > 0 && (
                  <ul className="cotacoes__encontrados">
                    {encontrados.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setCliente(c)}>
                          <strong>{c.nome}</strong> <span className="texto-discreto">{c.cpfCnpj}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {busca.trim().length >= 3 && encontrados.length === 0 && (
                  <p className="texto-discreto">Nenhum cliente encontrado. Use o pré-cadastro.</p>
                )}
              </>
            )}

            <label className="campo-form">
              <span>Corretor</span>
              {corretores?.podeEscolher ? (
                <select value={corretor} onChange={(e) => setCorretor(e.target.value)}>
                  <option value="">{corretores.atual.nome} (você)</option>
                  {corretores.corretores
                    .filter((c) => c.id !== corretores.atual.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                </select>
              ) : (
                <input value={corretores?.atual.nome ?? 'Você'} readOnly disabled />
              )}
            </label>
          </section>
          )}

          {etapa === 'tipos' && (
          <section className="bloco">
            <SeletorTiposSeguro
              tipos={tipos}
              selecionados={selecionados}
              aoMudar={setSelecionados}
              legenda="O que cotar"
              descricao="Marque um ou mais tipos."
            />

            {escolhidos.length > 0 && (
              <div className="tabela-rolante">
                <table className="tabela tabela--densa">
                  <thead>
                    <tr>
                      <th scope="col">Tipo</th>
                      <th scope="col">Seguradoras que oferecem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {escolhidos.map((t) => (
                      <tr key={t.id}>
                        <td>{t.nome}</td>
                        <td>
                          {t.seguradoras.length === 0 ? (
                            <span className="texto-discreto">
                              nenhuma habilitada — Configurações › Tipos de seguro
                            </span>
                          ) : (
                            t.seguradoras.map((id) => nomeSeguradora.get(id)).filter(Boolean).join(', ')
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          )}

          {etapa === 'veiculo' && pedeVeiculo && (
            <section className="bloco">
              <header className="bloco__cabecalho">
                <div>
                  <h4>Veículo</h4>
                  <p className="texto-discreto">O que tiver agora; placa e chassi podem ficar para depois.</p>
                </div>
              </header>
              <div className="formulario__linha">
                <label className="campo-form">
                  <span>Placa</span>
                  <input value={veiculo.placa} onChange={(e) => mudarVeiculo('placa', e.target.value.toUpperCase())} maxLength={8} />
                </label>
                <label className="campo-form">
                  <span>Chassi</span>
                  <input value={veiculo.chassi} onChange={(e) => mudarVeiculo('chassi', e.target.value.toUpperCase())} maxLength={17} />
                </label>
                <label className="campo-form">
                  <span>Código FIPE</span>
                  <input value={veiculo.codigoFipe} onChange={(e) => mudarVeiculo('codigoFipe', e.target.value)} maxLength={10} />
                </label>
              </div>
              <div className="formulario__linha">
                <label className="campo-form">
                  <span>Fabricante</span>
                  <input value={veiculo.fabricante} onChange={(e) => mudarVeiculo('fabricante', e.target.value)} maxLength={60} />
                </label>
                <label className="campo-form">
                  <span>Modelo</span>
                  <input value={veiculo.modelo} onChange={(e) => mudarVeiculo('modelo', e.target.value)} maxLength={120} />
                </label>
                <label className="campo-form">
                  <span>Ano fab.</span>
                  <input type="number" value={veiculo.anoFabricacao} onChange={(e) => mudarVeiculo('anoFabricacao', e.target.value)} />
                </label>
                <label className="campo-form">
                  <span>Ano modelo</span>
                  <input type="number" value={veiculo.anoModelo} onChange={(e) => mudarVeiculo('anoModelo', e.target.value)} />
                </label>
              </div>
              <div className="formulario__linha">
                <label className="campo-form">
                  <span>Uso</span>
                  <select value={veiculo.uso} onChange={(e) => mudarVeiculo('uso', e.target.value)}>
                    <option value="">—</option>
                    {['Particular', 'Comercial', 'Aplicativo de transporte', 'Transporte de carga', 'Táxi'].map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo-form">
                  <span>CEP de pernoite</span>
                  <input value={veiculo.cepPernoite} onChange={(e) => mudarVeiculo('cepPernoite', e.target.value)} inputMode="numeric" maxLength={9} />
                </label>
              </div>
              <label className="campo-check">
                <input type="checkbox" checked={veiculo.zeroKm} onChange={(e) => mudarVeiculo('zeroKm', e.target.checked)} />
                <span>Zero km</span>
              </label>
              <div className="formulario__linha">
                <label className="campo-form">
                  <span>Condutor principal</span>
                  <input value={veiculo.condutorNome} onChange={(e) => mudarVeiculo('condutorNome', e.target.value)} maxLength={150} />
                </label>
                <label className="campo-form">
                  <span>CPF do condutor</span>
                  <input value={veiculo.condutorDocumento} onChange={(e) => mudarVeiculo('condutorDocumento', e.target.value)} inputMode="numeric" maxLength={14} />
                </label>
                <label className="campo-form">
                  <span>Nascimento do condutor</span>
                  <input type="date" value={veiculo.condutorNascimento} onChange={(e) => mudarVeiculo('condutorNascimento', e.target.value)} />
                </label>
              </div>
            </section>
          )}

          {etapa === 'observacoes' && (
            <section className="bloco">
              <header className="bloco__cabecalho">
                <div>
                  <h4>Observações</h4>
                  <p className="texto-discreto">
                    {origem === 'existente' ? cliente?.nome : novo.nome.trim() || 'Cliente'} ·{' '}
                    {escolhidos.map((t) => t.nome).join(', ')}
                  </p>
                </div>
              </header>
              <label className="campo-form campo-form--largo">
                <span>O que o cliente pediu <em>opcional</em></span>
                <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={1000} rows={4} />
              </label>
              <p className="texto-discreto">
                Ao criar, a cotação abre para você registrar a proposta de cada seguradora.
              </p>
            </section>
          )}

          <div className="formulario__acoes">
            <button
              type="button"
              className="botao botao--discreto botao--compacto"
              onClick={indice === 0 ? aoCancelar : () => irPara(etapas[indice - 1]![0])}
              disabled={enviando}
            >
              {indice === 0 ? 'Cancelar' : 'Voltar'}
            </button>
            {ultima ? (
              <button type="submit" className="botao botao--principal botao--compacto" disabled={enviando}>
                {enviando ? 'Criando…' : 'Criar cotação'}
              </button>
            ) : (
              <button
                type="button"
                className="botao botao--principal botao--compacto"
                onClick={() => irPara(etapas[indice + 1]![0])}
              >
                Avançar
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

// ─────────────────────────────── Detalhe ───────────────────────────────

function DetalheCotacao({ id, aoVoltar }: { id: string; aoVoltar: () => void }): React.JSX.Element {
  const { abrir } = useCliente();
  const [cotacao, setCotacao] = useState<CotacaoDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erros, setErros] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const [proposta, setProposta] = useState({ tipoSeguroId: '', seguradoraId: '', premio: '', franquia: '', formaPagamento: '', observacao: '' });
  const [fechando, setFechando] = useState<number | null>(null);
  const [perdendo, setPerdendo] = useState(false);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async (): Promise<void> => {
    try {
      setCotacao((await cotacoesApi.detalhar(id)).cotacao);
    } catch (falha) {
      setErro(mensagemDeErro(falha, 'Não foi possível abrir a cotação.')[0]!);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function acao(fn: () => Promise<{ cotacao: CotacaoDetalhe }>, depois?: () => void): Promise<void> {
    setOcupado(true);
    setErros([]);
    try {
      setCotacao((await fn()).cotacao);
      depois?.();
    } catch (falha) {
      setErros(mensagemDeErro(falha, 'Não foi possível salvar.'));
    } finally {
      setOcupado(false);
    }
  }

  if (erro) {
    return (
      <p className="alerta alerta--erro" role="alert">
        {erro}{' '}
        <button type="button" className="botao botao--discreto botao--compacto" onClick={aoVoltar}>
          Voltar
        </button>
      </p>
    );
  }
  if (!cotacao) return <p className="texto-discreto">Carregando cotação…</p>;

  const encerrada = cotacao.situacao === 'fechada' || cotacao.situacao === 'perdida';
  const tipoDaProposta = Number(proposta.tipoSeguroId) || cotacao.tiposDetalhe[0]?.id || 0;
  const seguradorasDoTipo = cotacao.seguradorasPorTipo.find((x) => x.tipoSeguroId === tipoDaProposta)?.seguradoras ?? [];
  const v = cotacao.veiculo;

  function incluirProposta(evento: React.FormEvent): void {
    evento.preventDefault();
    const premio = paraNumero(proposta.premio);
    const franquia = paraNumero(proposta.franquia);
    if (premio === null || Number.isNaN(premio) || Number.isNaN(franquia)) {
      setErros(['Prêmio e franquia no formato 1.234,56.']);
      return;
    }
    void acao(
      () =>
        cotacoesApi.adicionarProposta(cotacao!.id, {
          tipoSeguroId: tipoDaProposta,
          seguradoraId: Number(proposta.seguradoraId),
          premio,
          franquia,
          ...(proposta.formaPagamento.trim() ? { formaPagamento: proposta.formaPagamento.trim() } : {}),
          ...(proposta.observacao.trim() ? { observacao: proposta.observacao.trim() } : {}),
        }),
      () => setProposta((p) => ({ ...p, seguradoraId: '', premio: '', franquia: '', formaPagamento: '', observacao: '' })),
    );
  }

  return (
    <>
      <button type="button" className="botao botao--discreto botao--compacto cotacoes__voltar" onClick={aoVoltar}>
        ← Cotações
      </button>

      {erros.length > 0 && (
        <div className="alerta alerta--erro" role="alert">
          {erros.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <section className="cartao cartao--largo">
        <header className="cartao__cabecalho">
          <div>
            <h2>
              <button type="button" className="botao-cliente botao-cliente--inline" onClick={() => abrir(cotacao.cliente.id)}>
                {cotacao.cliente.nome}
              </button>{' '}
              <span className={`etiqueta ${CLASSE_SITUACAO[cotacao.situacao]}`}>{ROTULO_SITUACAO[cotacao.situacao]}</span>
            </h2>
            <p className="texto-discreto">
              {cotacao.cliente.cpfCnpj} · {cotacao.tipos.join(', ')} · corretor {cotacao.corretor ?? '—'} · criada em{' '}
              {formatarData(cotacao.criadaEm.slice(0, 10))}
            </p>
          </div>
        </header>
        <div className="cartao__corpo">
          {v && (
            <p>
              <strong>Veículo:</strong>{' '}
              {[v.fabricante, v.modelo, v.anoModelo, v.placa ?? (v.zeroKm ? 'zero km' : null), v.uso]
                .filter(Boolean)
                .join(' · ') || 'sem dados'}
              {v.condutorNome && <> · condutor {v.condutorNome}</>}
            </p>
          )}
          {cotacao.observacoes && <p className="texto-discreto">{cotacao.observacoes}</p>}
          {cotacao.situacao === 'perdida' && cotacao.motivoPerda && (
            <p className="alerta alerta--aviso">Perdida: {cotacao.motivoPerda}</p>
          )}

          <h3 className="cotacoes__subtitulo">Propostas das seguradoras</h3>
          {cotacao.propostas.length === 0 ? (
            <p className="texto-discreto">Nenhuma proposta registrada ainda.</p>
          ) : (
            <div className="tabela-rolante">
              <table className="tabela tabela--densa">
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Seguradora</th>
                    <th scope="col" className="tabela__num">Prêmio</th>
                    <th scope="col" className="tabela__num">Franquia</th>
                    <th scope="col">Pagamento</th>
                    <th scope="col"><span className="visualmente-oculto">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cotacao.propostas.map((p) => (
                    <tr key={p.id}>
                      <td>{p.tipoSeguro}</td>
                      <td>
                        {p.seguradora}
                        {p.escolhida && <span className="etiqueta etiqueta--ok">fechou</span>}
                        {p.observacao && (
                          <>
                            <br />
                            <small className="texto-discreto">{p.observacao}</small>
                          </>
                        )}
                      </td>
                      <td className="tabela__num">
                        <strong>{formatarReais(p.premio)}</strong>
                      </td>
                      <td className="tabela__num">{p.franquia === null ? '—' : formatarReais(p.franquia)}</td>
                      <td>{p.formaPagamento ?? '—'}</td>
                      <td>
                        {!encerrada && (
                          <>
                            <button
                              type="button"
                              className="botao botao--discreto botao--compacto"
                              disabled={ocupado}
                              onClick={() => setFechando(p.id)}
                            >
                              Fechar com esta
                            </button>{' '}
                            <button
                              type="button"
                              className="botao botao--discreto botao--compacto"
                              disabled={ocupado}
                              onClick={() => void acao(() => cotacoesApi.removerProposta(cotacao.id, p.id))}
                              aria-label={`Remover proposta da ${p.seguradora}`}
                            >
                              Remover
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {fechando !== null && (
            <p className="alerta alerta--aviso">
              Fechar a cotação com a proposta da{' '}
              <strong>{cotacao.propostas.find((p) => p.id === fechando)?.seguradora}</strong>?{' '}
              <button
                type="button"
                className="botao botao--principal botao--compacto"
                disabled={ocupado}
                onClick={() =>
                  void acao(
                    () => cotacoesApi.definirSituacao(cotacao.id, { situacao: 'fechada', propostaEscolhidaId: fechando }),
                    () => setFechando(null),
                  )
                }
              >
                Confirmar
              </button>{' '}
              <button type="button" className="botao botao--discreto botao--compacto" onClick={() => setFechando(null)}>
                Cancelar
              </button>
            </p>
          )}

          {!encerrada && (
            <form className="formulario cotacoes__proposta" onSubmit={incluirProposta}>
              <h3 className="cotacoes__subtitulo">Registrar proposta</h3>
              <div className="formulario__linha">
                <label className="campo-form">
                  <span>Tipo</span>
                  <select
                    value={tipoDaProposta}
                    onChange={(e) => setProposta((p) => ({ ...p, tipoSeguroId: e.target.value, seguradoraId: '' }))}
                  >
                    {cotacao.tiposDetalhe.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo-form">
                  <span>Seguradora</span>
                  <select
                    value={proposta.seguradoraId}
                    onChange={(e) => setProposta((p) => ({ ...p, seguradoraId: e.target.value }))}
                    required
                  >
                    <option value="">{seguradorasDoTipo.length ? 'Escolha…' : 'Nenhuma oferece este tipo'}</option>
                    {seguradorasDoTipo.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="formulario__linha">
                <label className="campo-form">
                  <span>Prêmio</span>
                  <input value={proposta.premio} onChange={(e) => setProposta((p) => ({ ...p, premio: e.target.value }))} inputMode="decimal" placeholder="0,00" required />
                </label>
                <label className="campo-form">
                  <span>Franquia <em>opcional</em></span>
                  <input value={proposta.franquia} onChange={(e) => setProposta((p) => ({ ...p, franquia: e.target.value }))} inputMode="decimal" placeholder="0,00" />
                </label>
                <label className="campo-form">
                  <span>Forma de pagamento</span>
                  <input value={proposta.formaPagamento} onChange={(e) => setProposta((p) => ({ ...p, formaPagamento: e.target.value }))} placeholder="10x sem juros no cartão" maxLength={80} />
                </label>
              </div>
              <label className="campo-form campo-form--largo">
                <span>Observação <em>opcional</em></span>
                <input value={proposta.observacao} onChange={(e) => setProposta((p) => ({ ...p, observacao: e.target.value }))} maxLength={300} />
              </label>
              <div className="formulario__acoes">
                <button type="submit" className="botao botao--principal botao--compacto" disabled={ocupado || !proposta.seguradoraId || !proposta.premio}>
                  Incluir proposta
                </button>
              </div>
            </form>
          )}

          <div className="cotacoes__situacao">
            {cotacao.situacao === 'em_cotacao' && (
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                disabled={ocupado || cotacao.propostas.length === 0}
                title={cotacao.propostas.length === 0 ? 'Registre ao menos uma proposta antes' : undefined}
                onClick={() => void acao(() => cotacoesApi.definirSituacao(cotacao.id, { situacao: 'enviada' }))}
              >
                Marcar como enviada ao cliente
              </button>
            )}
            {!encerrada && !perdendo && (
              <button type="button" className="botao botao--discreto botao--compacto" disabled={ocupado} onClick={() => setPerdendo(true)}>
                Marcar como perdida
              </button>
            )}
            {!encerrada && perdendo && (
              <>
                <label className="campo-form">
                  <span>Por que foi perdida?</span>
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Preço, fechou com outro corretor, desistiu…" autoFocus />
                </label>
                <button
                  type="button"
                  className="botao botao--principal botao--compacto"
                  disabled={ocupado || !motivo.trim()}
                  onClick={() =>
                    void acao(
                      () => cotacoesApi.definirSituacao(cotacao.id, { situacao: 'perdida', motivoPerda: motivo.trim() }),
                      () => {
                        setPerdendo(false);
                        setMotivo('');
                      },
                    )
                  }
                >
                  Confirmar perda
                </button>
                <button type="button" className="botao botao--discreto botao--compacto" onClick={() => setPerdendo(false)}>
                  Cancelar
                </button>
              </>
            )}
            {encerrada && (
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                disabled={ocupado}
                onClick={() => void acao(() => cotacoesApi.definirSituacao(cotacao.id, { situacao: 'em_cotacao' }))}
              >
                Reabrir cotação
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
