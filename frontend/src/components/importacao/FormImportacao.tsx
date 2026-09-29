import { useEffect, useMemo, useRef, useState } from 'react';

import {
  agruparPorSeguradora,
  hoje,
  montarCatalogo,
  opcoesDaSeguradora,
  OUTRA,
  pasta,
  PROPRIA,
  type Opcao,
} from '@/components/importacao/catalogo';
import { Modal } from '@/components/Modal';
import { PainelPendencias } from '@/components/importacao/PainelPendencias';
import { ApiError } from '@/lib/api';
import { formatarReais } from '@/lib/formato';
import { arquivosApi, type Correcao, type Pendencia } from '@/lib/financeiro';
import { importacaoApi } from '@/lib/importacaoClientes';
import { seguradorasApi } from '@/lib/seguradoras';

type Fase = 'escolhendo' | 'analisando' | 'confirmando' | 'gravando' | 'concluido';

/** Resposta de qualquer família, normalizada na borda para a tela ter um caminho só. */
interface Conferencia {
  linhas: number;
  recusadas: number;
  motivosDeRecusa: Record<string, number>;
  linhasRecusadas: number[];
  colunasIgnoradas: string[];
  mapeamento: { origem: string; canonica: string | null }[];
  /** Números em destaque, já no vocabulário da família. */
  tiles: { rotulo: string; valor: string | number }[];
  /** O que a gravação apaga. Vazio em tudo que não é cadastro de cliente. */
  perdas: [string, number][];
  lote: string;
  duplicataDe: string | null;
  /** Frase do que foi gravado: os tiles têm os mesmos rótulos na prévia e na conclusão. */
  resumo?: string;
  /** O que precisa de gente, editável antes de gravar. */
  pendencias?: Pendencia[];
  pendenciasPorTipo?: Record<string, number>;
  pendenciasOcultas?: number;
  documentosJaCadastrados?: { linha: number; documento: string; cliente: string }[];
  /** Observações sobre a carga que não são recusa. */
  avisos?: string[];
}

const reais = formatarReais;

/**
 * Junta as conferências de vários arquivos: números somam pelo rótulo; arquivo
 * que falhou vira recusa. Pendências não atravessam — "linha 2" não diz de qual arquivo.
 */
function somarConferencias(
  partes: { nome: string; conferencia: Conferencia | null; erro?: string }[],
): Conferencia {
  const ok = partes.filter((p) => p.conferencia).map((p) => p.conferencia!);
  const falhas = partes.filter((p) => !p.conferencia);

  const tiles: Conferencia['tiles'] = [];
  for (const c of ok) {
    for (const t of c.tiles) {
      const existente = tiles.find((x) => x.rotulo === t.rotulo);
      if (!existente) tiles.push({ ...t });
      else if (typeof existente.valor === 'number' && typeof t.valor === 'number') {
        existente.valor += t.valor;
      }
    }
  }
  tiles.unshift({ rotulo: 'Arquivos', valor: partes.length });

  const motivos: Record<string, number> = {};
  for (const c of ok) {
    for (const [m, n] of Object.entries(c.motivosDeRecusa)) motivos[m] = (motivos[m] ?? 0) + n;
  }
  if (falhas.length > 0) motivos['arquivo não lido'] = falhas.length;

  return {
    linhas: ok.reduce((s, c) => s + c.linhas, 0),
    recusadas: ok.reduce((s, c) => s + c.recusadas, 0) + falhas.length,
    motivosDeRecusa: motivos,
    linhasRecusadas: [],
    colunasIgnoradas: [...new Set(ok.flatMap((c) => c.colunasIgnoradas))],
    mapeamento: ok[0]?.mapeamento ?? [],
    tiles,
    perdas: [],
    lote: ok.length === 1 ? ok[0]!.lote : `${ok.length} lotes`,
    duplicataDe: ok.find((c) => c.duplicataDe)?.duplicataDe ?? null,
    resumo: ok.every((c) => c.resumo)
      ? `${ok.length} de ${partes.length} arquivo(s) importado(s)`
      : undefined,
    avisos: [
      ...falhas.map((f) => `NÃO ENTROU: ${f.nome} — ${f.erro ?? 'erro desconhecido'}`),
      ...ok.flatMap((c) => c.avisos ?? []),
    ],
  };
}

/**
 * Tela de importação: seguradora → relatório → arquivo. A prévia é sempre
 * obrigatória; a confirmação escrita só quando a prévia acusa perda.
 */
export function FormImportacao(): React.JSX.Element {
  const [catalogo, setCatalogo] = useState<Opcao[]>([]);
  const [ativas, setAtivas] = useState<string[]>([]);
  /** Distingue "vazio" de "carregando". */
  const [carregado, setCarregado] = useState(false);
  const [seguradora, setSeguradora] = useState('');
  const [outroNome, setOutroNome] = useState('');
  const [opcaoId, setOpcaoId] = useState('');

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>('escolhendo');
  const [previa, setPrevia] = useState<Conferencia | null>(null);
  const [resultado, setResultado] = useState<Conferencia | null>(null);
  const [erros, setErros] = useState<string[]>([]);

  /** Modal de conclusão: um cartão no topo passava despercebido longe da rolagem. */
  const [conclusaoVisivel, setConclusaoVisivel] = useState(false);

  /** Layouts ocultos e o motivo — sumir em silêncio pareceria defeito. */
  const [ocultos, setOcultos] = useState<
    { nome: string; seguradora: string; motivo: 'inativa' | 'nao_cadastrada' }[]
  >([]);
  const [confirmacao, setConfirmacao] = useState('');
  const [marcarInadimplentes, setMarcarInadimplentes] = useState(true);

  /** Correções por linha; vive aqui para sobreviver ao "reconferir". */
  const [correcoes, setCorrecoes] = useState<Map<number, Correcao>>(new Map());

  const entrada = useRef<HTMLInputElement>(null);

  // allSettled: se um catálogo falhar, o outro ainda serve.
  useEffect(() => {
    void Promise.allSettled([
      arquivosApi.layouts(),
      importacaoApi.modelos(),
      seguradorasApi.listar(true),
    ]).then(
      ([resLayouts, resModelos, resSeguradoras]) => {
        const layouts =
          resLayouts.status === 'fulfilled'
            ? resLayouts.value
            : { apolices: [], financeiro: [], ocultos: [] };
        const modelos = resModelos.status === 'fulfilled' ? resModelos.value.modelos : [];

        if (resLayouts.status === 'rejected' || resModelos.status === 'rejected') {
          setErros(['Parte do catálogo de importação não carregou. Recarregue a página.']);
        }

        const registro =
          resSeguradoras.status === 'fulfilled' ? resSeguradoras.value.seguradoras : [];

        const nomesAtivos = registro.filter((s) => s.ativa).map((s) => s.nome);

        setAtivas(nomesAtivos);
        setCarregado(true);

        if (resSeguradoras.status === 'rejected') {
          setErros(['O cadastro de seguradoras não carregou, e sem ele nenhuma importação é oferecida. Recarregue a página.']);
        }

        setOcultos(layouts.ocultos ?? []);

        const lista = montarCatalogo(layouts, modelos);
        setCatalogo(lista);

        // Mesma regra do select, para a seleção inicial nunca ser opção invisível.
        const primeiroGrupo = agruparPorSeguradora(lista, nomesAtivos)[0];
        const primeira = primeiroGrupo
          ? opcoesDaSeguradora(lista, primeiroGrupo.valor)[0]
          : undefined;

        if (primeiroGrupo && primeira) {
          setSeguradora(primeiroGrupo.valor);
          setOpcaoId(primeira.id);
        }
      },
    );
  }, []);

  const grupos = useMemo(
    () => agruparPorSeguradora(catalogo, ativas),
    [catalogo, ativas],
  );
  const opcoes = useMemo(
    () => (seguradora ? opcoesDaSeguradora(catalogo, seguradora) : []),
    [catalogo, seguradora],
  );
  const opcao = opcoes.find((o) => o.id === opcaoId) ?? null;

  useEffect(() => {
    if (fase === 'concluido') setConclusaoVisivel(true);
  }, [fase]);

  /** Fecha o aviso e prepara para o próximo arquivo (topo e foco no campo). */
  function fecharConclusao(): void {
    limpar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Depois do render: enquanto a modal está aberta o campo está inerte.
    requestAnimationFrame(() => entrada.current?.focus({ preventScroll: true }));
  }

  function limpar(): void {
    setArquivo(null);
    setArquivos([]);
    setProgresso(null);
    setPrevia(null);
    setResultado(null);
    setConclusaoVisivel(false);
    setErros([]);
    setConfirmacao('');
    setCorrecoes(new Map());
    setFase('escolhendo');
    if (entrada.current) entrada.current.value = '';
  }

  function trocarSeguradora(nova: string): void {
    setSeguradora(nova);

    const primeira = opcoesDaSeguradora(catalogo, nova)[0];
    setOpcaoId(primeira?.id ?? '');
    limpar();
  }

  const nomeDaPasta =
    seguradora === OUTRA
      ? outroNome.trim()
      : seguradora === PROPRIA
        ? ''
        : seguradora;

  const faltaNome = seguradora === OUTRA && nomeDaPasta === '';
  const ocupado = fase === 'analisando' || fase === 'gravando';

  async function enviar(escolhido: File, simular: boolean): Promise<Conferencia> {
    if (!opcao) throw new Error('Escolha um relatório.');

    if (opcao.familia === 'clientes') {
      const texto = await escolhido.text();
      const r = simular
        ? await importacaoApi.previa(texto, escolhido.name, opcao.chave)
        : await importacaoApi.executar(texto, escolhido.name, opcao.chave, nomeDaPasta || null);

      return {
        linhas: r.lidas,
        recusadas: r.recusadas,
        motivosDeRecusa: r.motivosDeRecusa,
        linhasRecusadas: r.recusas.slice(0, 10).map((x) => x.linha),
        colunasIgnoradas: r.colunasIgnoradas,
        mapeamento: r.mapeamento,
        tiles: simular
          ? [
              { rotulo: 'Linhas na planilha', valor: r.lidas },
              { rotulo: 'Cadastros novos', valor: r.impacto?.novos ?? 0 },
              { rotulo: 'Serão sobrescritos', valor: r.impacto?.existentes ?? 0 },
              { rotulo: 'Recusadas', valor: r.recusadas },
            ]
          : [
              { rotulo: 'Inseridos', valor: r.inseridas },
              { rotulo: 'Atualizados', valor: r.atualizadas },
              { rotulo: 'Recusados', valor: r.recusadas },
              { rotulo: 'Telefones', valor: r.satelites.telefones },
            ],
        perdas: r.impacto
          ? Object.entries(r.impacto.perdem).filter(([, n]) => n > 0)
          : [],
        lote: r.lote,
        duplicataDe: r.duplicataDe ?? null,
        resumo: simular
          ? undefined
          : `${r.inseridas} cadastro(s) inserido(s) · ${r.atualizadas} atualizado(s)`,
      };
    }

    if (opcao.familia === 'carteira') {
      // As correções viajam por bilhete: o corpo do pedido é o arquivo.
      const lista = [...correcoes.values()].filter(
        (c) => c.documento?.trim() || c.produtor?.trim() || c.ignorar,
      );

      const bilhete =
        lista.length > 0 ? (await arquivosApi.guardarCorrecoes(lista)).bilhete : undefined;

      const r = await arquivosApi.importarCarteira(
        escolhido,
        opcao.chave,
        simular,
        nomeDaPasta,
        bilhete,
      );

      const motivos = { ...r.motivosDeRecusa };

      // Não barram a linha (o cliente entra), mas sem contar aqui a apólice some sem explicação.
      if (r.apolices.numeroIlegivel > 0) {
        motivos['número de apólice destruído pelo Excel (notação científica)'] =
          r.apolices.numeroIlegivel;
      }
      if (r.apolices.semNumero > 0) {
        motivos['linha sem número de apólice'] = r.apolices.semNumero;
      }

      return {
        linhas: r.linhas,
        recusadas: r.recusadas,
        motivosDeRecusa: motivos,
        linhasRecusadas: [],
        colunasIgnoradas: r.colunasIgnoradas,
        mapeamento: r.mapeamento,
        tiles: [
          { rotulo: 'Linhas', valor: r.linhas },
          { rotulo: 'Clientes novos', valor: r.clientes.novos },
          { rotulo: 'Clientes já na base', valor: r.clientes.existentes },
          { rotulo: 'Apólices novas', valor: r.apolices.novas },
          { rotulo: 'Apólices já na base', valor: r.apolices.existentes },
          { rotulo: 'Apólices sem número', valor: r.apolices.semNumero + r.apolices.numeroIlegivel },
          ...(r.pdf
            ? [{ rotulo: 'Parcelas', valor: simular ? r.pdf.parcelas : r.pdf.parcelasGravadas }]
            : []),
        ],
        perdas: [],
        lote: r.lote,
        duplicataDe: r.duplicataDe ?? null,
        resumo: simular
          ? undefined
          : [
              `${r.clientes.gravados} cliente(s) gravado(s)`,
              `${r.apolices.gravadas} apólice(s)`,
              ...(r.clientes.emails > 0 ? [`${r.clientes.emails} e-mail(s)`] : []),
              ...(r.clientes.telefones > 0 ? [`${r.clientes.telefones} telefone(s)`] : []),
            ].join(' · '),
        pendencias: r.pendencias,
        pendenciasPorTipo: r.pendenciasPorTipo,
        pendenciasOcultas: r.pendenciasOcultas,
        documentosJaCadastrados: r.documentosJaCadastrados,
        avisos: [
          ...(r.pdf?.avisos ?? []),
          ...(r.codificacao === 'windows-1252'
            ? ['O arquivo está em windows-1252 — sinal de que passou pelo Excel. A acentuação foi lida corretamente, mas é no Excel que o número de apólice longo vira notação científica.']
            : []),
          ...(r.apolices.numeroIlegivel > 0
            ? [`${r.apolices.numeroIlegivel} linha(s) têm o número da apólice destruído (${r.amostraIlegivel.slice(0, 3).join(', ')}). O cliente entra; a apólice não, porque números diferentes colapsaram no mesmo texto. Para recuperá-las, exporte de novo sem abrir no Excel.`]
            : []),
          ...(r.seguradorasNovas.length > 0
            ? [`${r.seguradorasNovas.length} seguradora(s) serão cadastradas: ${r.seguradorasNovas.slice(0, 8).join(', ')}${r.seguradorasNovas.length > 8 ? '…' : ''}. Confira em Configurações → Seguradoras depois.`]
            : []),
        ],
      };
    }

    const r =
      opcao.familia === 'apolices'
        ? await arquivosApi.importarApolices(escolhido, opcao.chave, simular, nomeDaPasta)
        : await arquivosApi.importarFinanceiro(
            escolhido,
            opcao.chave,
            simular,
            nomeDaPasta,
            marcarInadimplentes,
          );

    // Conferência de extrato não importa nada nem tem `linhas`/`lote`: sai antes do caminho comum.
    if (r.ordensNoExtrato !== undefined) {
      const faltando = r.faltando ?? [];

      return {
        linhas: r.ordensNoExtrato,
        recusadas: 0,
        motivosDeRecusa: {},
        linhasRecusadas: [],
        colunasIgnoradas: [],
        mapeamento: [],
        tiles: [
          { rotulo: 'Ordens no extrato', valor: r.ordensNoExtrato },
          { rotulo: 'Conferidas', valor: r.conferidas ?? 0 },
          { rotulo: 'Faltando importar', valor: faltando.length },
          { rotulo: 'Diferença', valor: reais(r.diferencaBruta ?? 0) },
        ],
        perdas: [],
        lote: '—',
        duplicataDe: null,
        resumo:
          faltando.length === 0
            ? `Tudo confere: as ${r.ordensNoExtrato} ordens do extrato estão no sistema, somando ${reais(r.totalExtrato?.bruto ?? 0)} de comissão bruta.`
            : `Faltam ${faltando.length} ordem(ns), somando ${reais(r.diferencaBruta ?? 0)}. Baixe o analítico delas no portal e importe.`,
        avisos: [
          ...faltando.map(
            (f: { ordem: string; pagoEm: string | null; bruto: number }) =>
              `FALTA a ordem ${f.ordem}${f.pagoEm ? ` de ${f.pagoEm.split('-').reverse().join('/')}` : ''} — ${reais(f.bruto)}`,
          ),
          ...(r.divergentes ?? []).map(
            (d: { ordem: string; extrato: number; sistema: number }) =>
              `DIVERGE a ordem ${d.ordem}: extrato ${reais(d.extrato)}, sistema ${reais(d.sistema)}`,
          ),
          ...(r.sobrando ?? []).map(
            (s: { ordem: string; bruto: number }) =>
              `A ordem ${s.ordem} (${reais(s.bruto)}) está no sistema e não neste extrato — confira se é de outro mês.`,
          ),
        ],
      };
    }

    const tiles: { rotulo: string; valor: string | number }[] = [
      { rotulo: 'Linhas', valor: r.linhas },
    ];

    if (opcao.familia === 'apolices') {
      tiles.push({ rotulo: 'Apólices', valor: r.apolices ?? 0 });
      if ((r.movimentos ?? 0) > 0) tiles.push({ rotulo: 'Movimentos', valor: r.movimentos ?? 0 });
    } else if (r.entidade === 'parcelas') {
      tiles.push({ rotulo: 'Apólices criadas', valor: r.apolicesCriadas ?? 0 });
      if ((r.nomesDesmascarados ?? 0) > 0) {
        tiles.push({ rotulo: 'Nomes desmascarados', valor: r.nomesDesmascarados ?? 0 });
      }
      if ((r.telefonesGanhos ?? 0) > 0) {
        tiles.push({ rotulo: 'Telefones novos', valor: r.telefonesGanhos ?? 0 });
      }
      if (r.corretoresAvisados !== undefined) {
        tiles.push({ rotulo: 'Corretores avisados', valor: r.corretoresAvisados });
      }
      if ((r.primeiroAtrasoSemCorretor ?? 0) > 0) {
        tiles.push({ rotulo: '1º atraso sem corretor', valor: r.primeiroAtrasoSemCorretor ?? 0 });
      }
    } else if (r.entidade === 'sinistros') {
      tiles.push({ rotulo: 'Sinistros', valor: r.sinistros ?? 0 });
      tiles.push({ rotulo: 'Assistências', valor: r.assistencias ?? 0 });
      // Só existe depois de gravar: a simulação não liga nada.
      if (r.sinistrosSemCliente !== undefined) {
        tiles.push({ rotulo: 'Sem cliente na base', valor: r.sinistrosSemCliente });
      }
    } else if (r.entidade === 'encerradas') {
      tiles.push({ rotulo: 'Apólices encerradas', valor: r.encerradas ?? 0 });
      tiles.push({ rotulo: 'Antes do prazo', valor: r.encerradasAntesDoPrazo ?? 0 });
      if (r.encerradasRenovadas !== undefined) {
        tiles.push({ rotulo: 'Renovadas (mesmo veículo)', valor: r.encerradasRenovadas });
      }
      if (r.encerradasSemCliente !== undefined) {
        tiles.push({ rotulo: 'Sem cliente na base', valor: r.encerradasSemCliente });
      }
    } else if (r.entidade === 'renovacoes') {
      tiles.push({ rotulo: 'Apólices a renovar', valor: r.renovacoes ?? 0 });
      tiles.push({ rotulo: 'Com prêmio calculado', valor: r.renovacoesComPremio ?? 0 });
      if (r.renovacoesSemCliente !== undefined) {
        tiles.push({ rotulo: 'Sem cliente na base', valor: r.renovacoesSemCliente });
      }
      if ((r.renovacoesComissaoNaApolice ?? 0) > 0) {
        tiles.push({ rotulo: '% de comissão levado à apólice', valor: r.renovacoesComissaoNaApolice ?? 0 });
      }
    } else {
      tiles.push({ rotulo: 'Competência', valor: r.competencia ?? '—' });
      tiles.push({ rotulo: 'Total líquido', valor: reais(r.totalLiquido ?? 0) });
    }

    tiles.push({ rotulo: 'Recusadas', valor: r.recusadas });

    return {
      linhas: r.linhas,
      recusadas: r.recusadas,
      motivosDeRecusa: r.motivosDeRecusa,
      linhasRecusadas: [],
      colunasIgnoradas: r.colunasIgnoradas,
      mapeamento: r.mapeamento,
      tiles,
      perdas: [],
      lote: r.lote,
      duplicataDe: r.duplicataDe ?? null,
    };
  }

  /**
   * Em sequência, não em paralelo: o servidor limita envios por minuto, e dois
   * PDFs do mesmo cliente ao mesmo tempo disputariam o mesmo cadastro.
   */
  async function enviarTodos(lista: File[], simular: boolean): Promise<Conferencia> {
    if (lista.length === 1) return enviar(lista[0]!, simular);

    const partes: { nome: string; conferencia: Conferencia | null; erro?: string }[] = [];
    for (const [i, f] of lista.entries()) {
      setProgresso(`${i + 1} de ${lista.length}`);
      try {
        partes.push({ nome: f.name, conferencia: await enviar(f, simular) });
      } catch (falha) {
        partes.push({ nome: f.name, conferencia: null, erro: mensagens(falha).join(' ') });
      }
    }
    setProgresso(null);

    if (partes.every((p) => !p.conferencia)) {
      throw new Error(`Nenhum dos ${lista.length} arquivos pôde ser lido. ${partes[0]?.erro ?? ''}`);
    }
    return somarConferencias(partes);
  }

  async function aoEscolher(evento: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const lista = [...(evento.target.files ?? [])];
    const escolhido = lista[0];
    if (!escolhido || !opcao) return;

    setArquivo(escolhido);
    setArquivos(lista);
    setErros([]);
    setPrevia(null);
    setResultado(null);
    setConfirmacao('');
    setFase('analisando');

    try {
      setPrevia(await enviarTodos(lista, true));
      setFase('confirmando');
    } catch (falha) {
      setErros(mensagens(falha));
      setFase('escolhendo');
    }
  }

  function corrigir(linha: number, mudanca: Partial<Correcao>): void {
    setCorrecoes((antes) => {
      const proximo = new Map(antes);
      proximo.set(linha, { ...(proximo.get(linha) ?? { linha }), ...mudanca, linha });
      return proximo;
    });
  }

  /** Refaz a prévia (ainda simulação) com as correções preenchidas. */
  async function reconferir(): Promise<void> {
    if (!arquivo) return;

    setFase('analisando');
    setErros([]);

    try {
      setPrevia(await enviarTodos(arquivos.length > 0 ? arquivos : [arquivo], true));
      setFase('confirmando');
    } catch (falha) {
      setErros(mensagens(falha));
      setFase('confirmando');
    }
  }

  async function gravar(): Promise<void> {
    if (!arquivo) return;

    setFase('gravando');
    setErros([]);

    try {
      setResultado(await enviarTodos(arquivos.length > 0 ? arquivos : [arquivo], false));
      setFase('concluido');
    } catch (falha) {
      setErros(mensagens(falha));
      setFase('confirmando');
    }
  }

  const temPerda = (previa?.perdas.length ?? 0) > 0;
  const confirmacaoOk = !temPerda || confirmacao.trim().toUpperCase() === 'APAGAR';

  return (
    <>
      {ocultos.length > 0 && (
        <p className="texto-discreto">
          {ocultos.length === 1 ? 'Um layout não aparece' : `${ocultos.length} layouts não aparecem`}
          {' porque a companhia está '}
          {ocultos.every((o) => o.motivo === 'inativa')
            ? 'inativa'
            : ocultos.every((o) => o.motivo === 'nao_cadastrada')
              ? 'sem cadastro'
              : 'inativa ou sem cadastro'}
          {': '}
          {[...new Set(ocultos.map((o) => o.seguradora))].join(', ')}. Ajuste em
          Configurações → Seguradoras.
        </p>
      )}

      {carregado && grupos.length === 0 && (
        <div className="alerta alerta--aviso" role="status">
          <p>
            Nenhuma seguradora cadastrada tem importação disponível. Cadastre a
            companhia em Configurações → Seguradoras para liberar os relatórios dela.
          </p>
        </div>
      )}

      {erros.length > 0 && (
        <div className="alerta alerta--erro" role="alert">
          {erros.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      <section className="cartao cartao--inteiro">
        <div className="cartao__corpo">
          <div className="grade-form linha-importacao">
            <div className="campo">
              <label htmlFor="seguradora">Seguradora</label>
              <select
                id="seguradora"
                value={seguradora}
                onChange={(e) => trocarSeguradora(e.target.value)}
                disabled={ocupado}
              >
                {(['sistema', 'companhia', 'especial'] as const).map((tipo) => {
                  const doTipo = grupos.filter((g) => g.grupo === tipo);
                  if (doTipo.length === 0) return null;

                  const rotulo =
                    tipo === 'sistema'
                      ? 'Sistemas — arquivo com várias companhias'
                      : tipo === 'companhia'
                        ? 'Seguradoras'
                        : 'Outros';

                  return (
                    <optgroup key={tipo} label={rotulo}>
                      {doTipo.map((g) => (
                        <option key={g.valor} value={g.valor}>
                          {g.rotulo}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>

              {seguradora === OUTRA && (
                <input
                  className="campo__extra"
                  value={outroNome}
                  onChange={(e) => setOutroNome(e.target.value)}
                  placeholder="Nome da companhia"
                  maxLength={60}
                  autoComplete="off"
                  aria-label="Nome da companhia"
                  disabled={ocupado}
                />
              )}

              <p className="campo__dica">
                Arquiva em{' '}
                <span className="tabela__mono">
                  {pasta(nomeDaPasta)}/{hoje()}/
                </span>
              </p>
            </div>

            <div className="campo">
              <label htmlFor="relatorio">Tipo de relatório</label>
              <select
                id="relatorio"
                value={opcaoId}
                onChange={(e) => {
                  setOpcaoId(e.target.value);
                  limpar();
                }}
                disabled={ocupado || opcoes.length === 0}
              >
                {opcoes.length === 0 && <option value="">—</option>}
                {opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
              {opcao ? (
                <p className="campo__dica">{opcao.descricao}</p>
              ) : (
                <p className="campo__dica">
                  Nenhum layout de importação cadastrado para esta companhia
                  ainda. Envie um arquivo de exemplo para que ele seja criado.
                </p>
              )}
            </div>

            <div className="campo campo--largo">
              <label htmlFor="arquivo">Arquivo</label>
              <input
                id="arquivo"
                ref={entrada}
                type="file"
                accept={opcao?.aceita ?? '.xlsx,.csv'}
                multiple={opcao?.multiplos === true}
                onChange={(e) => void aoEscolher(e)}
                disabled={!opcao || faltaNome || ocupado}
              />
              <p className="campo__dica">
                {progresso
                  ? `${fase === 'gravando' ? 'Gravando' : 'Conferindo'} arquivo ${progresso}…`
                  : fase === 'analisando'
                    ? 'Conferindo a planilha…'
                    : faltaNome
                      ? 'Escreva o nome da companhia antes de enviar.'
                      : arquivos.length > 1
                        ? `${arquivos.length} arquivos · ${Math.max(1, Math.round(arquivos.reduce((s, f) => s + f.size, 0) / 1024))} kB`
                        : arquivo
                          ? `${arquivo.name} · ${Math.max(1, Math.round(arquivo.size / 1024))} kB`
                          : opcao?.multiplos
                            ? 'PDF como veio do portal. Selecione vários de uma vez (Ctrl+A na pasta).'
                            : opcao?.familia === 'clientes'
                              ? '.csv — no Excel, “CSV UTF-8”. Vírgula ou ponto e vírgula.'
                              : opcao?.aceita?.startsWith('.xls,')
                                ? '.xls como veio do portal — não abra no Excel para salvar de novo.'
                                : '.xlsx direto da seguradora, sem converter para CSV.'}
              </p>
            </div>
          </div>

          {opcao && (
            <>
              {opcao.colunas && (
                <div className="barra-filtros barra-filtros--acoes">
                  <button
                    type="button"
                    className="botao botao--discreto botao--compacto"
                    onClick={() => void importacaoApi.baixarModelo(opcao.chave)}
                  >
                    ↓ Baixar modelo «{opcao.nome}»
                  </button>
                  <button
                    type="button"
                    className="botao botao--discreto botao--compacto"
                    onClick={() => void importacaoApi.exportar()}
                    title="Baixa a base atual já no formato que o importador lê"
                  >
                    ↓ Exportar base atual
                  </button>
                </div>
              )}

              {(opcao.observacoes.length > 0 || opcao.colunas) && (
                <details className="colunas-modelo">
                  <summary>
                    O que este arquivo traz
                    {opcao.colunas ? ` (${opcao.colunas.length} colunas)` : ''}
                  </summary>
                  {opcao.observacoes.length > 0 && (
                    <ul className="observacoes">
                      {opcao.observacoes.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  )}
                  {opcao.colunas && <p className="tabela__mono">{opcao.colunas.join(', ')}</p>}
                </details>
              )}
            </>
          )}
        </div>
      </section>

      {previa && fase !== 'concluido' && (
        <section className="cartao cartao--inteiro">
          <header className="cartao__cabecalho">
            <div>
              <h2>Confira antes de gravar</h2>
              <p className="texto-discreto">Nada foi alterado até aqui.</p>
            </div>
          </header>

          <div className="cartao__corpo">
            <Tiles itens={previa.tiles} />

            {temPerda && (
              <div className="alerta alerta--erro" role="alert">
                <p>
                  <strong>Esta planilha vai APAGAR dados.</strong> A importação
                  de cadastro espelha o arquivo: as colunas que ele não traz são
                  gravadas como vazias.
                </p>
                {previa.perdas.map(([tipo, n]) => (
                  <p key={tipo}>
                    {n} cadastro(s) perderão <strong>{tipo}</strong>
                  </p>
                ))}
                <p className="texto-discreto">
                  Para atualizar sem perder nada: exporte a base, edite a coluna
                  que interessa e reimporte o arquivo completo.
                </p>
              </div>
            )}

            {previa.avisos?.map((a) => (
              <p className="alerta alerta--aviso" key={a}>
                {a}
              </p>
            ))}

            {previa.colunasIgnoradas.length > 0 && (
              <p className="alerta alerta--aviso">
                <strong>{previa.colunasIgnoradas.length} coluna(s) não entraram:</strong>{' '}
                {previa.colunasIgnoradas.join(', ')}. Se alguma deveria entrar, o
                relatório escolhido não é o deste arquivo.
              </p>
            )}

            {previa.recusadas > 0 && (
              <p className="alerta alerta--aviso">
                <strong>{previa.recusadas} linha(s) não serão importadas:</strong>{' '}
                {Object.entries(previa.motivosDeRecusa)
                  .map(([m, n]) => `${n} × ${m}`)
                  .join(' · ')}
                {previa.linhasRecusadas.length > 0 && (
                  <span className="texto-discreto">
                    {' '}
                    (linhas {previa.linhasRecusadas.join(', ')})
                  </span>
                )}
              </p>
            )}

            <MapaDeColunas mapeamento={previa.mapeamento} />

            {previa.pendencias && previa.pendencias.length > 0 && (
              <PainelPendencias
                pendencias={previa.pendencias}
                porTipo={previa.pendenciasPorTipo ?? {}}
                ocultas={previa.pendenciasOcultas ?? 0}
                jaCadastrados={previa.documentosJaCadastrados ?? []}
                correcoes={correcoes}
                aoCorrigir={corrigir}
                aoReconferir={() => void reconferir()}
                ocupado={ocupado}
              />
            )}

            {opcao?.entidade === 'parcelas' && (
              <label className="campo-check">
                <input
                  type="checkbox"
                  checked={marcarInadimplentes}
                  onChange={(e) => setMarcarInadimplentes(e.target.checked)}
                />
                <span>
                  Marcar como <strong>inadimplentes</strong> os clientes com parcela em atraso
                  <br />
                  <span className="texto-discreto">
                    Só atinge quem está <em>ativo</em>. Não mexe em prospecto nem em quem já saiu.
                  </span>
                </span>
              </label>
            )}

            {temPerda && (
              <div className="campo">
                <label htmlFor="confirmar">
                  Digite <strong>APAGAR</strong> para confirmar que entendeu a perda
                </label>
                <input
                  id="confirmar"
                  type="text"
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  autoComplete="off"
                />
              </div>
            )}

            <div className="barra-filtros barra-filtros--acoes">
              <button
                type="button"
                className="botao botao--principal botao--compacto"
                onClick={() => void gravar()}
                disabled={fase === 'gravando' || !confirmacaoOk || previa.linhas === 0}
              >
                {fase === 'gravando' ? 'Gravando…' : `Importar ${previa.linhas} linha(s)`}
              </button>
              <button
                type="button"
                className="botao botao--discreto botao--compacto"
                onClick={limpar}
                disabled={fase === 'gravando'}
              >
                Cancelar
              </button>
            </div>
          </div>
        </section>
      )}

      {resultado && (
        <Modal
          aberto={conclusaoVisivel}
          aoFechar={fecharConclusao}
          titulo="Importação concluída"
          descricao={`Lote ${resultado.lote}`}
        >
          <div className="modal__conteudo">
            {resultado.resumo && <p className="alerta alerta--sucesso">{resultado.resumo}</p>}

            <Tiles itens={resultado.tiles} />

            {resultado.duplicataDe && (
              <p className="alerta alerta--aviso">
                Um arquivo <strong>idêntico</strong> já tinha sido importado no lote{' '}
                <span className="tabela__mono">{resultado.duplicataDe.slice(0, 8)}…</span>. A carga é
                idempotente, então nada foi duplicado — mas confira se era mesmo para rodar de novo.
              </p>
            )}

            <p className="texto-discreto">
              Uma cópia do arquivo ficou guardada em <strong>Auditoria de importações</strong>, com
              hash de integridade — de lá dá para baixar o original ou desfazer esta carga inteira.
            </p>

            {/* Ao fechar, a tela é limpa: os avisos só ficam aqui. */}
            {resultado.avisos?.map((a) => (
              <p className="alerta alerta--aviso" key={a}>
                {a}
              </p>
            ))}

            <div className="barra-filtros barra-filtros--acoes">
              <button type="button" className="botao botao--principal botao--compacto" onClick={fecharConclusao}>
                Fechar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Tiles({ itens }: { itens: { rotulo: string; valor: string | number }[] }): React.JSX.Element {
  return (
    <div className="tiles">
      {itens.map((t) => (
        <article className="tile" key={t.rotulo}>
          <h3 className="tile__rotulo">{t.rotulo}</h3>
          <p className="tile__valor">
            {typeof t.valor === 'number' ? t.valor.toLocaleString('pt-BR') : t.valor}
          </p>
        </article>
      ))}
    </div>
  );
}

/** Como cada coluna do cabeçalho foi traduzida. */
function MapaDeColunas({
  mapeamento,
}: {
  mapeamento: { origem: string; canonica: string | null }[];
}): React.JSX.Element {
  const linhas = mapeamento.filter((c) => c.origem !== '');

  return (
    <details className="colunas-modelo">
      <summary>
        Como as colunas foram entendidas ({linhas.filter((c) => c.canonica).length} de{' '}
        {linhas.length})
      </summary>

      <div className="tabela-rolante">
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th scope="col">Coluna na planilha</th>
              <th scope="col">Entrou como</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((c) => (
              <tr key={c.origem}>
                <td>{c.origem}</td>
                <td className={c.canonica ? 'tabela__mono' : undefined}>
                  {c.canonica ?? <span className="texto-discreto">ignorada</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function mensagens(falha: unknown): string[] {
  if (falha instanceof ApiError) {
    const detalhes = falha.mensagensDeValidacao;
    return detalhes.length > 0 ? [falha.message, ...detalhes] : [falha.message];
  }

  return ['Não foi possível processar o arquivo. Verifique sua conexão.'];
}
