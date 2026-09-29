import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api';
import { clientesApi, type ClienteCompleto, type NovaApolice as DadosNovaApolice, type VeiculoNovo } from '@/lib/clientes';
import { seguradorasApi, type Seguradora } from '@/lib/seguradoras';
import { FORMULARIOS, tiposSeguroApi, type TipoSeguro } from '@/lib/tiposSeguro';

/*
 * Seguradora antes do tipo: só aparecem os tipos habilitados para a companhia.
 * Só o formulário de Veículo tem onde gravar; os outros avisam que não têm campo.
 */

const COMBUSTIVEIS = ['FLEX', 'GASOLINA', 'ETANOL', 'DIESEL', 'ELÉTRICO', 'HÍBRIDO', 'GNV'];
const TIPOS_VEICULO = ['Passeio', 'SUV', 'Picape', 'Utilitário', 'Caminhão', 'Moto', 'Ônibus'];
const USOS = ['Particular', 'Comercial', 'Aplicativo de transporte', 'Transporte de carga', 'Táxi'];

type CamposVeiculo = Record<
  | 'placa' | 'chassi' | 'fabricante' | 'modelo' | 'anoFabricacao' | 'anoModelo' | 'codigoFipe'
  | 'combustivel' | 'tipoVeiculo' | 'uso' | 'antifurto' | 'cepPernoite' | 'pernoiteGaragem'
  | 'condutorNome' | 'condutorDocumento' | 'condutorNascimento' | 'observacoes',
  string
> & { zeroKm: boolean; kitGas: boolean };

const VEICULO_VAZIO: CamposVeiculo = {
  placa: '', chassi: '', fabricante: '', modelo: '', anoFabricacao: '', anoModelo: '', codigoFipe: '',
  combustivel: '', tipoVeiculo: '', uso: '', antifurto: '', cepPernoite: '', pernoiteGaragem: '',
  condutorNome: '', condutorDocumento: '', condutorNascimento: '', observacoes: '',
  zeroKm: false, kitGas: false,
};

/** `1.234,56` ou `1234.56` → 1234.56. Vazio → null. */
function paraNumero(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : NaN;
}

/** Vigência anual começa e termina no mesmo dia. */
function umAnoDepois(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return '';
  return `${a + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function veiculoParaEnviar(v: CamposVeiculo): VeiculoNovo {
  const texto = (s: string): string | null => (s.trim() ? s.trim() : null);
  const ano = (s: string): number | null => (s.trim() ? Number(s) : null);
  return {
    placa: texto(v.placa),
    chassi: texto(v.chassi),
    fabricante: texto(v.fabricante),
    modelo: texto(v.modelo),
    anoFabricacao: ano(v.anoFabricacao),
    anoModelo: ano(v.anoModelo),
    codigoFipe: texto(v.codigoFipe),
    combustivel: texto(v.combustivel),
    tipoVeiculo: texto(v.tipoVeiculo),
    uso: texto(v.uso),
    // Caixa desmarcada não afirma "usado" nem "sem kit": fica em branco.
    zeroKm: v.zeroKm ? true : null,
    kitGas: v.kitGas ? true : null,
    antifurto: texto(v.antifurto),
    cepPernoite: texto(v.cepPernoite),
    pernoiteGaragem: v.pernoiteGaragem === '' ? null : v.pernoiteGaragem === 'sim',
    condutorNome: texto(v.condutorNome),
    condutorDocumento: texto(v.condutorDocumento),
    condutorNascimento: texto(v.condutorNascimento),
    observacoes: texto(v.observacoes),
  };
}

export function NovaApolice({
  cliente,
  aoSalvar,
  aoCancelar,
}: {
  cliente: ClienteCompleto;
  aoSalvar: (atualizado: ClienteCompleto) => void;
  aoCancelar: () => void;
}): React.JSX.Element {
  const [seguradoras, setSeguradoras] = useState<Seguradora[]>([]);
  const [tipos, setTipos] = useState<TipoSeguro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhaAoCarregar, setFalhaAoCarregar] = useState<string | null>(null);

  const [seguradoraId, setSeguradoraId] = useState('');
  const [tipoId, setTipoId] = useState('');
  const [numero, setNumero] = useState('');
  const [produto, setProduto] = useState('');
  const [emitidaEm, setEmitidaEm] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [tipoNegocio, setTipoNegocio] = useState('');
  const [premioTotal, setPremioTotal] = useState('');
  const [premioLiquido, setPremioLiquido] = useState('');
  const [veiculo, setVeiculo] = useState<CamposVeiculo>(VEICULO_VAZIO);

  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);

  useEffect(() => {
    let cancelado = false;
    void Promise.all([seguradorasApi.listar(), tiposSeguroApi.listar()])
      .then(([s, t]) => {
        if (cancelado) return;
        setSeguradoras(s.seguradoras);
        setTipos(t.tipos.filter((x) => x.ativo));
      })
      .catch((falha: unknown) => {
        if (!cancelado) {
          setFalhaAoCarregar(
            falha instanceof ApiError ? falha.message : 'Não foi possível carregar seguradoras e tipos.',
          );
        }
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const tiposDaSeguradora = useMemo(
    () => (seguradoraId ? tipos.filter((t) => t.seguradoras.includes(Number(seguradoraId))) : []),
    [tipos, seguradoraId],
  );
  const tipo = tiposDaSeguradora.find((t) => String(t.id) === tipoId) ?? null;
  const formulario = tipo ? FORMULARIOS[tipo.formulario] : null;
  const pedeVeiculo = tipo?.formulario === 'veiculo';
  const pessoaFisica = cliente.tipoPessoa !== 'Jurídica';

  const mudarVeiculo = <K extends keyof CamposVeiculo>(campo: K, valor: CamposVeiculo[K]): void =>
    setVeiculo((antes) => ({ ...antes, [campo]: valor }));

  function trocarSeguradora(id: string): void {
    setSeguradoraId(id);
    // O tipo escolhido pode não existir na companhia nova.
    if (!tipos.some((t) => String(t.id) === tipoId && t.seguradoras.includes(Number(id)))) {
      setTipoId('');
    }
  }

  function trocarInicio(iso: string): void {
    // Não sobrescreve um fim digitado à mão.
    if (!fim || fim === umAnoDepois(inicio)) setFim(iso ? umAnoDepois(iso) : '');
    setInicio(iso);
  }

  function condutorEhOSegurado(): void {
    setVeiculo((antes) => ({
      ...antes,
      condutorNome: cliente.nome,
      condutorDocumento: cliente.cpfCnpj.replace(/\D/g, ''),
      condutorNascimento: cliente.dataNascimento ?? '',
    }));
  }

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (salvando || !tipo) return;

    const total = paraNumero(premioTotal);
    const liquido = paraNumero(premioLiquido);
    if (Number.isNaN(total) || Number.isNaN(liquido)) {
      setErros(['Prêmio inválido. Use o formato 1.234,56.']);
      return;
    }

    const dados: DadosNovaApolice = {
      seguradoraId: Number(seguradoraId),
      tipoSeguroId: tipo.id,
      numero: numero.trim(),
      ...(produto.trim() ? { produto: produto.trim() } : {}),
      ...(emitidaEm ? { emitidaEm } : {}),
      vigenciaInicio: inicio,
      vigenciaFim: fim,
      tipoNegocio: tipoNegocio === 'novo' || tipoNegocio === 'renovacao' ? tipoNegocio : null,
      premioTotal: total,
      premioLiquido: liquido,
      ...(pedeVeiculo ? { veiculo: veiculoParaEnviar(veiculo) } : {}),
    };

    setSalvando(true);
    setErros([]);
    try {
      const { cliente: atualizado } = await clientesApi.criarApolice(cliente.id, dados);
      aoSalvar(atualizado);
    } catch (falha) {
      const api = falha instanceof ApiError ? falha : null;
      setErros(
        api?.mensagensDeValidacao.length
          ? api.mensagensDeValidacao
          : [api?.message ?? 'Não foi possível cadastrar a apólice. Tente de novo.'],
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <header className="ficha-cliente__topo">
        <div>
          <span className="ficha-cliente__tipo">Nova apólice</span>
          <h2>{cliente.nome}</h2>
          <p>{cliente.cpfCnpj}</p>
        </div>

        <button
          type="button"
          className="ficha-cliente__fechar"
          onClick={aoCancelar}
          disabled={salvando}
          aria-label="Cancelar a nova apólice"
          title="Cancelar a nova apólice"
        >
          ×
        </button>
      </header>

      <div className="ficha-cliente__corpo">
        {carregando && <p className="texto-discreto">Carregando seguradoras e tipos…</p>}

        {falhaAoCarregar && (
          <div className="alerta alerta--erro" role="alert">
            <p>{falhaAoCarregar}</p>
          </div>
        )}

        {!carregando && !falhaAoCarregar && (
          <form className="formulario" onSubmit={(e) => void enviar(e)}>
            {erros.length > 0 && (
              <div className="alerta alerta--erro" role="alert">
                {erros.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </div>
            )}

            <section className="bloco">
              <header className="bloco__cabecalho">
                <h4>Seguro</h4>
              </header>

              <div className="formulario__linha">
                <label className="campo-form">
                  <span>Seguradora</span>
                  <select
                    value={seguradoraId}
                    onChange={(e) => trocarSeguradora(e.target.value)}
                    required
                    autoFocus
                  >
                    <option value="">Escolha…</option>
                    {seguradoras.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="campo-form">
                  <span>Tipo de seguro</span>
                  <select
                    value={tipoId}
                    onChange={(e) => setTipoId(e.target.value)}
                    required
                    disabled={!seguradoraId || tiposDaSeguradora.length === 0}
                  >
                    <option value="">{seguradoraId ? 'Escolha…' : 'Escolha a seguradora antes'}</option>
                    {tiposDaSeguradora.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {seguradoraId && tiposDaSeguradora.length === 0 && (
                <p className="alerta alerta--aviso" role="note">
                  Nenhum tipo de seguro habilitado para esta seguradora. Habilite em Configurações ›
                  Tipos de seguro.
                </p>
              )}

              {tipo && formulario && !formulario.pronto && (
                <p className="alerta alerta--aviso" role="note">
                  Os dados do bem de <strong>{tipo.nome}</strong> ({formulario.pede}) ainda não têm
                  campo no sistema. A apólice se cadastra com os dados gerais abaixo.
                </p>
              )}
            </section>

            {tipo && (
              <section className="bloco">
                <header className="bloco__cabecalho">
                  <h4>Dados da apólice</h4>
                </header>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Número da apólice</span>
                    <input
                      type="text"
                      value={numero}
                      onChange={(e) => setNumero(e.target.value)}
                      maxLength={40}
                      required
                    />
                  </label>

                  <label className="campo-form">
                    <span>Produto <em>opcional</em></span>
                    <input
                      type="text"
                      value={produto}
                      onChange={(e) => setProduto(e.target.value)}
                      maxLength={120}
                      placeholder="Como a seguradora chama"
                    />
                  </label>
                </div>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Início da vigência</span>
                    <input type="date" value={inicio} onChange={(e) => trocarInicio(e.target.value)} required />
                  </label>

                  <label className="campo-form">
                    <span>Fim da vigência</span>
                    <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} required />
                  </label>

                  <label className="campo-form">
                    <span>Emissão <em>opcional</em></span>
                    <input type="date" value={emitidaEm} onChange={(e) => setEmitidaEm(e.target.value)} />
                  </label>
                </div>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Prêmio total <em>opcional</em></span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={premioTotal}
                      onChange={(e) => setPremioTotal(e.target.value)}
                      placeholder="0,00"
                    />
                  </label>

                  <label className="campo-form">
                    <span>Prêmio líquido <em>opcional</em></span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={premioLiquido}
                      onChange={(e) => setPremioLiquido(e.target.value)}
                      placeholder="0,00"
                    />
                  </label>

                  <label className="campo-form">
                    <span>Negócio</span>
                    <select value={tipoNegocio} onChange={(e) => setTipoNegocio(e.target.value)}>
                      <option value="">Não informado</option>
                      <option value="novo">Seguro novo</option>
                      <option value="renovacao">Renovação</option>
                    </select>
                  </label>
                </div>
              </section>
            )}

            {pedeVeiculo && (
              <section className="bloco">
                <header className="bloco__cabecalho">
                  <div>
                    <h4>Veículo</h4>
                    <p className="texto-discreto">Placa ou chassi é obrigatório; o resto, se tiver.</p>
                  </div>
                </header>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Placa</span>
                    <input
                      type="text"
                      value={veiculo.placa}
                      onChange={(e) => mudarVeiculo('placa', e.target.value.toUpperCase())}
                      maxLength={8}
                      placeholder="ABC1D23"
                      autoComplete="off"
                    />
                  </label>

                  <label className="campo-form">
                    <span>Chassi</span>
                    <input
                      type="text"
                      value={veiculo.chassi}
                      onChange={(e) => mudarVeiculo('chassi', e.target.value.toUpperCase())}
                      maxLength={17}
                      autoComplete="off"
                    />
                  </label>
                </div>

                <label className="campo-check">
                  <input
                    type="checkbox"
                    checked={veiculo.zeroKm}
                    onChange={(e) => mudarVeiculo('zeroKm', e.target.checked)}
                  />
                  <span>Zero km (sem placa ainda, informe o chassi)</span>
                </label>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Fabricante</span>
                    <input
                      type="text"
                      value={veiculo.fabricante}
                      onChange={(e) => mudarVeiculo('fabricante', e.target.value)}
                      maxLength={60}
                      placeholder="Ex.: FIAT"
                    />
                  </label>

                  <label className="campo-form">
                    <span>Modelo</span>
                    <input
                      type="text"
                      value={veiculo.modelo}
                      onChange={(e) => mudarVeiculo('modelo', e.target.value)}
                      maxLength={120}
                      placeholder="Ex.: NIVUS HIGHLINE"
                    />
                  </label>
                </div>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Ano de fabricação</span>
                    <input
                      type="number"
                      value={veiculo.anoFabricacao}
                      onChange={(e) => mudarVeiculo('anoFabricacao', e.target.value)}
                      min={1950}
                      max={new Date().getFullYear() + 2}
                    />
                  </label>

                  <label className="campo-form">
                    <span>Ano do modelo</span>
                    <input
                      type="number"
                      value={veiculo.anoModelo}
                      onChange={(e) => mudarVeiculo('anoModelo', e.target.value)}
                      min={1950}
                      max={new Date().getFullYear() + 2}
                    />
                  </label>

                  <label className="campo-form">
                    <span>Código FIPE</span>
                    <input
                      type="text"
                      value={veiculo.codigoFipe}
                      onChange={(e) => mudarVeiculo('codigoFipe', e.target.value)}
                      maxLength={10}
                    />
                  </label>
                </div>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Combustível</span>
                    <select value={veiculo.combustivel} onChange={(e) => mudarVeiculo('combustivel', e.target.value)}>
                      <option value="">—</option>
                      {COMBUSTIVEIS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="campo-form">
                    <span>Tipo de veículo</span>
                    <select value={veiculo.tipoVeiculo} onChange={(e) => mudarVeiculo('tipoVeiculo', e.target.value)}>
                      <option value="">—</option>
                      {TIPOS_VEICULO.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="campo-form">
                    <span>Uso</span>
                    <select value={veiculo.uso} onChange={(e) => mudarVeiculo('uso', e.target.value)}>
                      <option value="">—</option>
                      {USOS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Antifurto / rastreador</span>
                    <input
                      type="text"
                      value={veiculo.antifurto}
                      onChange={(e) => mudarVeiculo('antifurto', e.target.value)}
                      maxLength={80}
                    />
                  </label>

                  <label className="campo-form">
                    <span>CEP de pernoite</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={veiculo.cepPernoite}
                      onChange={(e) => mudarVeiculo('cepPernoite', e.target.value)}
                      maxLength={9}
                      placeholder="00000-000"
                    />
                  </label>

                  <label className="campo-form">
                    <span>Pernoita em garagem</span>
                    <select
                      value={veiculo.pernoiteGaragem}
                      onChange={(e) => mudarVeiculo('pernoiteGaragem', e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="sim">Sim</option>
                      <option value="nao">Não</option>
                    </select>
                  </label>
                </div>

                <label className="campo-check">
                  <input
                    type="checkbox"
                    checked={veiculo.kitGas}
                    onChange={(e) => mudarVeiculo('kitGas', e.target.checked)}
                  />
                  <span>Tem kit gás</span>
                </label>

                <header className="bloco__cabecalho">
                  <h4>Condutor principal</h4>
                  {pessoaFisica && (
                    <button
                      type="button"
                      className="botao botao--discreto botao--compacto"
                      onClick={condutorEhOSegurado}
                    >
                      É o próprio segurado
                    </button>
                  )}
                </header>

                <div className="formulario__linha">
                  <label className="campo-form">
                    <span>Nome</span>
                    <input
                      type="text"
                      value={veiculo.condutorNome}
                      onChange={(e) => mudarVeiculo('condutorNome', e.target.value)}
                      maxLength={150}
                    />
                  </label>

                  <label className="campo-form">
                    <span>CPF</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={veiculo.condutorDocumento}
                      onChange={(e) => mudarVeiculo('condutorDocumento', e.target.value)}
                      maxLength={14}
                    />
                  </label>

                  <label className="campo-form">
                    <span>Nascimento</span>
                    <input
                      type="date"
                      value={veiculo.condutorNascimento}
                      onChange={(e) => mudarVeiculo('condutorNascimento', e.target.value)}
                    />
                  </label>
                </div>

                <label className="campo-form campo-form--largo">
                  <span>Observações <em>opcional</em></span>
                  <input
                    type="text"
                    value={veiculo.observacoes}
                    onChange={(e) => mudarVeiculo('observacoes', e.target.value)}
                    maxLength={500}
                  />
                </label>
              </section>
            )}

            <div className="formulario__acoes">
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={aoCancelar}
                disabled={salvando}
              >
                Cancelar
              </button>
              <button type="submit" className="botao botao--principal botao--compacto" disabled={salvando || !tipo}>
                {salvando ? 'Cadastrando…' : 'Cadastrar apólice'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
