import { Fragment, useMemo, useState } from 'react';

import { Atendimentos } from '@/components/cliente/Atendimentos';
import { Dado } from '@/components/cliente/FichaCliente';
import { useCliente } from '@/hooks/useCliente';
import type { ClienteCompleto, ClienteDoGrupo, SinistroFicha, VeiculoFicha } from '@/lib/clientes';
import { formatarData, formatarReais } from '@/lib/formato';
import { Pendente } from '@/widgets/Widget';

type Aba = 'cadastro' | 'atendimentos' | 'apolices' | 'sinistros' | 'comercial' | 'segurados';

/**
 * Ficha de um cliente da base importada. Mostra só o que existe e declara o
 * que falta, em vez de exibir zeros que parecem apurados.
 */
export function FichaClienteImportado({
  cliente,
  aoFechar,
  abaInicial = 'cadastro',
}: {
  cliente: ClienteCompleto;
  aoFechar: () => void;
  /** Depois de cadastrar uma apólice, a ficha volta mostrando-a. */
  abaInicial?: Aba;
}): React.JSX.Element {
  const [aba, setAba] = useState<Aba>(abaInicial);
  const temApolices = cliente.apolices.length > 0;
  // `Array.isArray`: backend numa versão anterior não manda o campo.
  const sinistros = Array.isArray(cliente.sinistros) ? cliente.sinistros : [];
  // Sem relatório da companhia, lista vazia é falta de dado, não "não acionou".
  const temRelatorioSinistros = cliente.disponibilidade.sinistros;

  const anosDeCasa = useMemo(() => anosDesde(cliente.clienteDesde), [cliente.clienteDesde]);
  const idade = useMemo(() => anosDesde(cliente.dataNascimento), [cliente.dataNascimento]);

  return (
    <>
      <header className="ficha-cliente__topo">
        <div>
          <span className="ficha-cliente__tipo">Pessoa {cliente.tipoPessoa.toLowerCase()}</span>
          {cliente.grupoCliente && (
            <span className="ficha-cliente__tipo" title="Grupo de cliente">
              {cliente.grupoCliente.nome}
            </span>
          )}
          {cliente.vip && (
            <span className="ficha-cliente__tipo ficha-cliente__tipo--vip">VIP</span>
          )}
          {cliente.grupo?.matriz && <span className="ficha-cliente__tipo">Filial</span>}
          {(cliente.grupo?.filiais.length ?? 0) > 0 && (
            <span className="ficha-cliente__tipo">Matriz</span>
          )}
          <h2>{cliente.nome}</h2>
          <p>
            {cliente.cpfCnpj}
            {cliente.clienteDesde && (
              <>
                {' · cliente desde '}
                {formatarData(cliente.clienteDesde)}
                {anosDeCasa !== null && ` (${anosDeCasa} ano${anosDeCasa === 1 ? '' : 's'})`}
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          className="ficha-cliente__fechar"
          onClick={aoFechar}
          aria-label="Fechar ficha"
        >
          ×
        </button>
      </header>

      {!temApolices && (
        <p className="aviso-ficticio" role="note">
          <strong>Somente cadastro.</strong> Nenhuma apólice importada para este
          cliente. Os dados abaixo vieram do {rotuloOrigem(cliente.origem)}.
        </p>
      )}

      <nav className="abas" aria-label="Seções da ficha">
        {(
          [
            ['cadastro', 'Cadastro'],
            ['atendimentos', 'Atendimentos'],
            ...(temApolices
              ? ([['apolices', `Apólices (${cliente.apolices.length})`]] as [Aba, string][])
              : []),
            ['sinistros', sinistros.length > 0 ? `Sinistros (${sinistros.length})` : 'Sinistros'],
            ['comercial', 'Comercial'],
            [
              'segurados',
              `Segurados${cliente.segurados.length > 0 ? ` (${cliente.segurados.length})` : ''}`,
            ],
          ] as [Aba, string][]
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            className={aba === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
            onClick={() => setAba(chave)}
            aria-current={aba === chave ? 'true' : undefined}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      <div className="ficha-cliente__corpo">
        {aba === 'cadastro' && <Cadastro cliente={cliente} idade={idade} />}
        {aba === 'atendimentos' && <Atendimentos cliente={cliente} />}
        {aba === 'apolices' && <Apolices cliente={cliente} />}
        {aba === 'sinistros' && (
          <Sinistros sinistros={sinistros} temRelatorio={temRelatorioSinistros} />
        )}
        {aba === 'comercial' && <Comercial cliente={cliente} />}
        {aba === 'segurados' && <Segurados cliente={cliente} />}
      </div>
    </>
  );
}

function anosDesde(iso: string | null): number | null {
  if (!iso) return null;
  const quando = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(quando.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - quando.getTime()) / (365.25 * 24 * 3600 * 1000)));
}

function rotuloOrigem(origem: string): string {
  const ROTULOS: Record<string, string> = {
    seguradora: 'arquivo da seguradora',
    manual: 'cadastro manual',
  };

  return ROTULOS[origem] ?? origem;
}

function Cadastro({
  cliente,
  idade,
}: {
  cliente: ClienteCompleto;
  idade: number | null;
}): React.JSX.Element {
  return (
    <>
      <GrupoEmpresarial cliente={cliente} />

      {/* Data de abertura da empresa mora na mesma coluna do nascimento. */}
      {cliente.tipoPessoa === 'Jurídica' ? (
        <>
          <Responsaveis cliente={cliente} />

          <section className="bloco">
            <header className="bloco__cabecalho">
              <h4>Dados da empresa</h4>
            </header>
            <div className="cartoes-dado">
              {cliente.nomeSocial && <Dado rotulo="Razão social" valor={cliente.nomeCivil} largo />}
              <Dado
                rotulo="Data de abertura"
                valor={
                  cliente.dataNascimento
                    ? `${formatarData(cliente.dataNascimento)}${idade !== null ? ` (${idade} ano${idade === 1 ? '' : 's'} de empresa)` : ''}`
                    : null
                }
              />
            </div>
          </section>
        </>
      ) : (
        <section className="bloco">
          <header className="bloco__cabecalho">
            <h4>Dados pessoais</h4>
          </header>
          <div className="cartoes-dado">
            {cliente.nomeSocial && <Dado rotulo="Nome civil" valor={cliente.nomeCivil} largo />}
            <Dado
              rotulo="Nascimento"
              valor={
                cliente.dataNascimento
                  ? `${formatarData(cliente.dataNascimento)}${idade !== null ? ` (${idade} anos)` : ''}`
                  : null
              }
            />
            <Dado
              rotulo="Sexo"
              valor={cliente.sexo === 'M' ? 'Masculino' : cliente.sexo === 'F' ? 'Feminino' : null}
            />
            <Dado rotulo="Estado civil" valor={cliente.estadoCivil} />
            <Dado rotulo="Profissão" valor={cliente.profissao} largo />
          </div>
        </section>
      )}

      <section className="bloco">
        <header className="bloco__cabecalho">
          <h4>{cliente.enderecos.length > 1 ? 'Endereços' : 'Endereço'}</h4>
        </header>

        {cliente.enderecos.length === 0 ? (
          <p className="texto-discreto">Nenhum endereço no cadastro.</p>
        ) : (
          cliente.enderecos.map((e) => (
            // `logradouro` é opcional: backend anterior só manda `linha`.
            <div key={e.tipo} className="cartoes-dado">
              <Dado
                rotulo={cliente.enderecos.length > 1 ? `${e.rotulo} — logradouro` : 'Logradouro'}
                valor={e.logradouro ?? e.linha}
                largo
              />
              {e.logradouro !== undefined && (
                <>
                  <Dado rotulo="Número" valor={e.numero ?? (e.logradouro ? 'S/N' : null)} />
                  <Dado rotulo="Complemento" valor={e.complemento ?? null} />
                </>
              )}
              <Dado rotulo="Bairro" valor={e.bairro} />
              <Dado
                rotulo="Cidade"
                valor={e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : null}
              />
              <Dado rotulo="CEP" valor={e.cep} />
            </div>
          ))
        )}
      </section>

      <section className="bloco">
        <header className="bloco__cabecalho">
          <h4>Contato</h4>
        </header>

        {cliente.telefones.length === 0 && cliente.emails.length === 0 ? (
          <p className="texto-discreto">Nenhum contato no cadastro.</p>
        ) : (
          <div className="cartoes-dado">
            {/* Chave pelo valor, não pelo tipo: cabem dois celulares no mesmo cadastro. */}
            {cliente.emails.map((e) => (
              <Dado
                key={`email-${e.endereco}`}
                rotulo={`E-mail ${e.rotulo.toLowerCase()}${e.principal ? ' · principal' : ''}${e.observacao ? ` · ${e.observacao}` : ''}`}
                valor={e.endereco}
                largo
              />
            ))}
            {cliente.telefones.map((t) => (
              <Dado
                key={`tel-${t.numero}`}
                rotulo={`${t.rotulo}${t.principal ? ' · principal' : ''}${t.observacao ? ` · ${t.observacao}` : ''}`}
                valor={t.numero}
              />
            ))}
          </div>
        )}

        <p className={cliente.autorizaContato ? 'alerta alerta--ok' : 'alerta alerta--aviso'}>
          {cliente.autorizaContato
            ? 'O cliente autorizou contato.'
            : 'O cliente NÃO autorizou contato. Não incluir em campanha ou disparo.'}
        </p>
      </section>

    </>
  );
}

function Responsaveis({ cliente }: { cliente: ClienteCompleto }): React.JSX.Element {
  const lista = Array.isArray(cliente.responsaveis) ? cliente.responsaveis : [];

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>Responsáveis de contato</h4>
          <p className="texto-discreto">Quem responde pela empresa — o primeiro é o principal.</p>
        </div>
      </header>

      {lista.length === 0 ? (
        <p className="texto-discreto">
          Nenhum responsável cadastrado. Use “Corrigir cadastro” para incluir.
        </p>
      ) : (
        <div className="tabela-rolante">
          <table className="tabela tabela--densa">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Cargo</th>
                <th scope="col">Telefone</th>
                <th scope="col">E-mail</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r, i) => (
                <tr key={`${r.nome}-${i}`}>
                  <td>
                    {r.nome}
                    {i === 0 && lista.length > 1 && <span className="texto-discreto"> · principal</span>}
                  </td>
                  <td>{r.cargo ?? '—'}</td>
                  <td className="tabela__mono">{r.telefone ?? '—'}</td>
                  <td>{r.email ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Matriz e filiais da mesma empresa; clicar abre a ficha dela no lugar desta. */
function GrupoEmpresarial({ cliente }: { cliente: ClienteCompleto }): React.JSX.Element | null {
  const { abrir } = useCliente();
  const matriz = cliente.grupo?.matriz ?? null;
  const filiais = Array.isArray(cliente.grupo?.filiais) ? cliente.grupo.filiais : [];

  if (!matriz && filiais.length === 0) return null;

  const linha = (g: ClienteDoGrupo, rotulo?: string): React.JSX.Element => (
    <tr
      key={g.id}
      className="tabela__linha--clicavel"
      onClick={() => abrir(g.id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          abrir(g.id);
        }
      }}
    >
      <td>
        {rotulo && <span className="texto-discreto">{rotulo} · </span>}
        {g.nome}
      </td>
      <td className="tabela__mono">{g.cpfCnpj}</td>
      <td className="tabela__num">
        {g.apolicesEmVigor} de {g.apolices}
      </td>
      <td>{g.situacao ?? '—'}</td>
    </tr>
  );

  return (
    <section className="bloco">
      <header className="bloco__cabecalho">
        <div>
          <h4>{matriz ? 'Matriz desta filial' : `Filiais (${filiais.length})`}</h4>
          <p className="texto-discreto">
            {matriz
              ? 'As apólices desta filial ficam com ela; a matriz reúne a empresa.'
              : 'A mesma empresa (raiz do CNPJ). Cada apólice fica com a filial que a contratou.'}
          </p>
        </div>
      </header>

      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Empresa</th>
              <th scope="col">CNPJ</th>
              <th scope="col" className="tabela__num">Apólices em vigor</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {matriz ? linha(matriz, 'Matriz') : filiais.map((f) => linha(f))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const CLASSE_SITUACAO: Record<string, string> = {
  vigente: 'etiqueta--ok',
  a_vencer: 'etiqueta--tranquilo',
  vencida: 'etiqueta--critico',
  indefinida: 'etiqueta--atencao',
};

const ROTULO_SITUACAO: Record<string, string> = {
  vigente: 'Vigente',
  a_vencer: 'A iniciar',
  vencida: 'Vencida',
  indefinida: 'Sem vigência',
};

/**
 * Prêmio em branco não é zero: o relatório não trazia a emissão original.
 * "Sem vigência" não é vencida — chamá-la assim a tiraria das renovações.
 */
function Apolices({ cliente }: { cliente: ClienteCompleto }): React.JSX.Element {
  const vinculoFragil = cliente.apolices.some((a) => a.vinculoOrigem === 'nome');
  // Uma aberta por vez: a ficha é estreita.
  const [aberta, setAberta] = useState<string | null>(null);

  return (
    <>
      {vinculoFragil && (
        <p className="alerta alerta--aviso" role="note">
          Ao menos uma destas apólices foi ligada a este cliente por{' '}
          <strong>semelhança de nome</strong>, porque o relatório da seguradora
          não trazia CPF/CNPJ. Confira antes de usar em cobrança ou campanha.
        </p>
      )}

      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Apólice</th>
              <th scope="col">Seguradora</th>
              <th scope="col">Tipo e produto</th>
              <th scope="col">Vigência</th>
              <th scope="col">Situação</th>
              <th scope="col" className="tabela__num">Prêmio</th>
            </tr>
          </thead>
          <tbody>
            {cliente.apolices.map((a) => {
              const veiculo = a.veiculo ?? null;
              const expandida = aberta === a.id;
              const alternar = (): void => setAberta(expandida ? null : a.id);
              return (
                <Fragment key={a.id}>
                  <tr
                    className={veiculo ? 'tabela__linha--clicavel' : undefined}
                    onClick={veiculo ? alternar : undefined}
                    tabIndex={veiculo ? 0 : undefined}
                    aria-expanded={veiculo ? expandida : undefined}
                    title={veiculo ? (expandida ? 'Fechar o veículo' : 'Ver o veículo') : undefined}
                    onKeyDown={
                      veiculo
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              alternar();
                            }
                          }
                        : undefined
                    }
                  >
                    <td className={a.numeroProvisorio ? undefined : 'tabela__mono'}>
                      {/* O `PROV-` cru não aparece: alguém o citaria à seguradora. */}
                      {a.numeroProvisorio ? (
                        <span
                          className="etiqueta etiqueta--atencao"
                          title="O número desta apólice se perdeu na exportação do relatório (o Excel converteu para notação científica). O contrato, a vigência e o prêmio estão corretos. Reexportar o relatório sem abrir no Excel recupera o número."
                        >
                          número não recuperado
                        </span>
                      ) : (
                        a.numero
                      )}
                      {a.movimentos > 1 && (
                        <span className="texto-discreto"> · {a.movimentos} mov.</span>
                      )}
                    </td>
                    <td>{a.seguradora}</td>
                    <td>
                      {a.tipoSeguro ? (
                        <strong>{a.tipoSeguro}</strong>
                      ) : (
                        <span className="texto-discreto">sem tipo</span>
                      )}
                      {a.produto && (
                        <>
                          <br />
                          <small className="texto-discreto">{a.produto}</small>
                        </>
                      )}
                      {veiculo && (
                        <>
                          <br />
                          <small>{resumoVeiculo(veiculo)}</small>
                        </>
                      )}
                    </td>
                    <td>
                      {a.vigenciaInicio
                        ? `${formatarData(a.vigenciaInicio)} a ${a.vigenciaFim ? formatarData(a.vigenciaFim) : '—'}`
                        : '—'}
                    </td>
                    <td>
                      <span className={`etiqueta ${CLASSE_SITUACAO[a.situacao] ?? ''}`}>
                        {ROTULO_SITUACAO[a.situacao] ?? a.situacao}
                      </span>
                    </td>
                    <td className="tabela__num">
                      {a.premioTotal === null ? (
                        <span
                          className="texto-discreto"
                          title="A emissão original não veio no arquivo importado"
                        >
                          —
                        </span>
                      ) : (
                        formatarReais(a.premioTotal)
                      )}
                    </td>
                  </tr>
                  {veiculo && expandida && (
                    <tr>
                      <td colSpan={6}>
                        <FichaVeiculo veiculo={veiculo} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** `FIAT PULSE DRIVE 2021 · BET7G07`: o que se fala ao telefone. */
function resumoVeiculo(v: VeiculoFicha): string {
  const carro = [v.fabricante, v.modelo, v.anoModelo].filter(Boolean).join(' ');
  const placa = v.placa ? formatarPlaca(v.placa) : v.zeroKm ? 'zero km, sem placa' : 'sem placa';
  return carro ? `${carro} · ${placa}` : placa;
}

/** Placa antiga ganha hífen (`ABC-1234`); Mercosul fica como é (`ABC1D23`). */
function formatarPlaca(placa: string): string {
  return /^[A-Z]{3}\d{4}$/.test(placa) ? `${placa.slice(0, 3)}-${placa.slice(3)}` : placa;
}

function simOuNao(v: boolean | null): string | null {
  return v === null ? null : v ? 'Sim' : 'Não';
}

function FichaVeiculo({ veiculo: v }: { veiculo: VeiculoFicha }): React.JSX.Element {
  const cpf =
    v.condutorDocumento?.length === 11
      ? v.condutorDocumento.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
      : v.condutorDocumento;
  const cep = v.cepPernoite?.replace(/^(\d{5})(\d{3})$/, '$1-$2') ?? null;

  return (
    <div className="ficha-veiculo">
      <div className="cartoes-dado">
        <Dado rotulo="Placa" valor={v.placa ? formatarPlaca(v.placa) : null} />
        <Dado rotulo="Chassi" valor={v.chassi} />
        <Dado rotulo="Fabricante" valor={v.fabricante} />
        <Dado rotulo="Modelo" valor={v.modelo} />
        <Dado
          rotulo="Ano fab./modelo"
          valor={v.anoFabricacao || v.anoModelo ? `${v.anoFabricacao ?? '—'}/${v.anoModelo ?? '—'}` : null}
        />
        <Dado rotulo="Código FIPE" valor={v.codigoFipe} />
        <Dado rotulo="Combustível" valor={v.combustivel} />
        <Dado rotulo="Tipo" valor={v.tipoVeiculo} />
        <Dado rotulo="Uso" valor={v.uso} />
        <Dado rotulo="Zero km" valor={simOuNao(v.zeroKm)} />
        <Dado rotulo="Antifurto" valor={v.antifurto} />
        <Dado rotulo="Kit gás" valor={simOuNao(v.kitGas)} />
        <Dado rotulo="CEP de pernoite" valor={cep} />
        <Dado rotulo="Pernoita em garagem" valor={simOuNao(v.pernoiteGaragem)} />
        <Dado rotulo="Condutor principal" valor={v.condutorNome} largo />
        <Dado rotulo="CPF do condutor" valor={cpf} />
        <Dado
          rotulo="Nascimento do condutor"
          valor={v.condutorNascimento ? formatarData(v.condutorNascimento) : null}
        />
        {v.observacoes && <Dado rotulo="Observações" valor={v.observacoes} largo />}
      </div>
      <p className="texto-discreto">
        {v.origem === 'manual'
          ? 'Digitado na ficha.'
          : 'Veio do documento da seguradora. Modelo e fabricante podem vir cortados pelo próprio PDF.'}
      </p>
    </div>
  );
}

/** Sinistros e assistências na mesma lista, contados em separado. */
function Sinistros({
  sinistros,
  temRelatorio,
}: {
  sinistros: SinistroFicha[];
  temRelatorio: boolean;
}): React.JSX.Element {
  if (sinistros.length === 0) {
    return temRelatorio ? (
      <p className="texto-discreto">
        Nenhum sinistro nem assistência nos relatórios importados das
        seguradoras deste cliente.
      </p>
    ) : (
      <Pendente
        o="Sem relatório de sinistros das seguradoras deste cliente."
        porque="Sem o relatório da companhia não dá para dizer se ele acionou o seguro — lista vazia aqui não é “nunca acionou”."
        quando="Importe o relatório de sinistros da seguradora em Importações → Importar arquivos."
      />
    );
  }

  const deSinistro = sinistros.filter((s) => s.tipo === 'sinistro').length;
  const deAssistencia = sinistros.length - deSinistro;
  const emAberto = sinistros.filter((s) => (s.reserva ?? 0) > 0);
  const porNome = sinistros.some((s) => s.vinculoOrigem === 'nome');

  return (
    <>
      <p>
        <strong>{deSinistro}</strong> sinistro{deSinistro === 1 ? '' : 's'} e{' '}
        <strong>{deAssistencia}</strong> assistência{deAssistencia === 1 ? '' : 's'}
        {emAberto.length > 0 && (
          <>
            {' · '}
            {formatarReais(emAberto.reduce((s, x) => s + (x.reserva ?? 0), 0))} reservados em{' '}
            {emAberto.length} em aberto
          </>
        )}
      </p>

      {porNome && (
        <p className="alerta alerta--aviso" role="note">
          Ao menos um acionamento é de uma apólice do <strong>período anterior</strong>,
          que não está na base, e foi ligado a este cliente pelo nome do segurado.
        </p>
      )}

      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Ocorrência</th>
              <th scope="col">Tipo</th>
              <th scope="col">Cobertura</th>
              <th scope="col">Apólice</th>
              <th scope="col">Status</th>
              <th scope="col" className="tabela__num">Reserva</th>
            </tr>
          </thead>
          <tbody>
            {sinistros.map((s) => (
              <tr key={`${s.seguradora}-${s.numero}`}>
                <td>{s.ocorridoEm ? formatarData(s.ocorridoEm) : '—'}</td>
                <td>
                  <span
                    className={`etiqueta ${s.tipo === 'sinistro' ? 'etiqueta--critico' : 'etiqueta--tranquilo'}`}
                  >
                    {s.tipo === 'sinistro' ? 'Sinistro' : 'Assistência'}
                  </span>
                </td>
                <td title={s.causa ?? undefined}>
                  {s.cobertura ?? '—'}
                  {s.causa && s.tipo === 'sinistro' && (
                    <span className="texto-discreto"> · {s.causa}</span>
                  )}
                </td>
                <td className="tabela__mono" title={s.veiculo ?? undefined}>
                  {s.apolice}
                  {s.vinculoOrigem === 'nome' && (
                    <span className="texto-discreto"> · anterior</span>
                  )}
                </td>
                <td>{s.status ?? '—'}</td>
                <td className="tabela__num">
                  {s.reserva && s.reserva > 0 ? formatarReais(s.reserva) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="texto-discreto">
        Reserva é o valor que a seguradora separou para o sinistro em aberto. O
        valor efetivamente pago não vem nos relatórios.
      </p>
    </>
  );
}

function Comercial({ cliente }: { cliente: ClienteCompleto }): React.JSX.Element {
  // `Array.isArray`: backend anterior não manda o campo.
  const interesses = Array.isArray(cliente.tiposInteresse) ? cliente.tiposInteresse : [];

  return (
    <>
      <section className="bloco">
        <header className="bloco__cabecalho">
          <div>
            <h4>Tipos de seguro de interesse</h4>
            <p className="texto-discreto">Marcados no cadastro ou nas cotações do cliente.</p>
          </div>
        </header>
        {interesses.length === 0 ? (
          <p className="texto-discreto">Nenhum marcado.</p>
        ) : (
          <p>
            {interesses.map((t) => (
              <span key={t} className="etiqueta">
                {t}
              </span>
            ))}
          </p>
        )}
      </section>

      <section className="bloco">
        <header className="bloco__cabecalho">
          <div>
            <h4>Seguradoras</h4>
            <p className="texto-discreto">
              Onde o cliente tem seguro, segundo o relatório de origem — não é a
              carteira de apólices.
            </p>
          </div>
        </header>

        {cliente.seguradoras.length === 0 ? (
          <p className="texto-discreto">Nenhum vínculo com seguradora no cadastro.</p>
        ) : (
          <div className="tabela-rolante">
            <table className="tabela tabela--densa">
              <thead>
                <tr>
                  <th scope="col">Seguradora</th>
                  <th scope="col">Ramo</th>
                  <th scope="col">Modalidade</th>
                </tr>
              </thead>
              <tbody>
                {cliente.seguradoras.map((v) => (
                  <tr key={`${v.seguradora}-${v.ramo ?? ''}-${v.modalidade ?? ''}`}>
                    <td>{v.seguradora}</td>
                    <td>{v.ramo ?? '—'}</td>
                    <td>{v.modalidade ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bloco">
        <header className="bloco__cabecalho">
          <h4>Atendimento</h4>
        </header>
        <div className="cartoes-dado">
          <Dado rotulo="Produtor" valor={cliente.produtor} />
          <Dado
            rotulo="Estrutura de vendas"
            valor={
              cliente.estruturaVendas
                ? `${cliente.estruturaCodigo ? `${cliente.estruturaCodigo} — ` : ''}${cliente.estruturaVendas}`
                : null
            }
            largo
          />
          <Dado rotulo="Como chegou" valor={cliente.origemCliente} />
        </div>
      </section>

      <section className="bloco">
        <header className="bloco__cabecalho">
          <h4>Perfil financeiro</h4>
        </header>
        <div className="cartoes-dado">
          <Dado rotulo="Faixa de renda" valor={cliente.renda} />
          <Dado
            rotulo="Faturamento anual"
            valor={cliente.faturamentoAnual ? formatarReais(cliente.faturamentoAnual) : null}
          />
        </div>
      </section>

      <section className="bloco">
        <header className="bloco__cabecalho">
          <div>
            <h4>Procedência do cadastro</h4>
            <p className="texto-discreto">De onde esta linha veio e quando</p>
          </div>
        </header>
        <div className="cartoes-dado">
          <Dado rotulo="Sistema de origem" valor={rotuloOrigem(cliente.origem)} />
          <Dado rotulo="Arquivo" valor={cliente.origemArquivo} largo />
          <Dado
            rotulo="Importado em"
            valor={
              cliente.importadoEm
                ? new Date(cliente.importadoEm).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : null
            }
          />
          <Dado
            rotulo="Última alteração na origem"
            valor={
              cliente.ultimaAlteracaoNaOrigem ? formatarData(cliente.ultimaAlteracaoNaOrigem) : null
            }
          />
        </div>
      </section>
    </>
  );
}

function Segurados({ cliente }: { cliente: ClienteCompleto }): React.JSX.Element {
  if (cliente.segurados.length === 0) {
    return (
      <p className="texto-discreto">
        Nenhum segurado ou co-titular ligado a este cliente no cadastro.
      </p>
    );
  }

  return (
    <>
      {cliente.segurados.map((s) => (
        <section key={s.ordem} className="bloco">
          <header className="bloco__cabecalho">
            <h4>{s.nome ?? `Segurado ${s.ordem}`}</h4>
          </header>
          <div className="cartoes-dado">
            <Dado rotulo="CPF" valor={s.cpf} />
            <Dado rotulo="RG" valor={s.rg} />
            <Dado rotulo="E-mail" valor={s.email} largo />
            <Dado rotulo="Celular" valor={s.celular} />
            <Dado rotulo="Telefone" valor={s.telefone} />
            <Dado rotulo="Endereço" valor={s.endereco} largo />
            <Dado
              rotulo="Cidade"
              valor={s.cidade ? `${s.cidade}${s.uf ? `/${s.uf}` : ''}` : null}
            />
          </div>
        </section>
      ))}
    </>
  );
}
