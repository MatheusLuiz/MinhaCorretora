import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { FiltroConsultor } from '@/components/FiltroConsultor';
import { CabecalhoPainel } from '@/components/Painel';
import { EncerradasDaSeguradora, type Desfecho } from '@/components/renovacao/EncerradasDaSeguradora';
import { FilaDeRenovacao } from '@/components/renovacao/FilaDeRenovacao';
import { ListaDaSeguradora } from '@/components/renovacao/ListaDaSeguradora';
import { VoltarPara } from '@/components/VoltarPara';
import { Pendente } from '@/widgets/Widget';
import { useCliente } from '@/hooks/useCliente';
import { usePaineis } from '@/hooks/usePaineis';

/** Fila de renovação. Mesmo payload dos painéis (`usePaineis`), para fila e dashboard nunca divergirem. */

const ABAS = [
  ['fila', 'Fila'],
  ['seguradora', 'Lista da seguradora'],
  ['encerradas', 'Encerradas'],
] as const;
type Aba = (typeof ABAS)[number][0];

const DESFECHOS: Desfecho[] = ['renovada', 'antes_do_prazo', 'sem_renovacao'];

export function FilaRenovacaoPage(): React.JSX.Element {
  const [parametros, setParametros] = useSearchParams();
  // O servidor recorta a carteira e recusa consultor fora da carteira de quem pede.
  const produtor = parametros.get('produtor') ?? '';
  const { dados, carregando, erro, recarregar } = usePaineis(produtor);
  const { abrir: abrirCliente } = useCliente();

  useEffect(() => {
    document.title = 'Fila de renovação — MinhaCorretora';
  }, []);

  const abaDaUrl = parametros.get('aba');
  const aba: Aba = ABAS.some(([chave]) => chave === abaDaUrl) ? (abaDaUrl as Aba) : 'fila';
  // Trocar de aba limpa os filtros da anterior; o consultor fica (é recorte da tela inteira).
  const trocarAba = (nova: Aba): void =>
    setParametros({ ...(nova === 'fila' ? {} : { aba: nova }), ...(produtor ? { produtor } : {}) });

  const contato = parametros.get('contato');
  const inicial: { prazo: string; seguradora: string; contato: '' | 'com' | 'sem' } = {
    prazo: parametros.get('prazo') ?? '',
    seguradora: parametros.get('seguradora') ?? '',
    contato: contato === 'com' || contato === 'sem' ? contato : '',
  };
  const desfechoDaUrl = parametros.get('desfecho');
  const desfecho = DESFECHOS.find((x) => x === desfechoDaUrl) ?? '';

  const listaSeguradora = Array.isArray(dados?.renovacoesSeguradora) ? dados.renovacoesSeguradora : [];
  const encerradas = Array.isArray(dados?.encerradasSeguradora) ? dados.encerradasSeguradora : [];

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Fila de renovação"
        descricao="Quem procurar, por urgência: apólice, vencimento e contato."
      />

      <div className="fila__topo">
        <VoltarPara
          para={produtor ? `/dashboards/renovacoes?produtor=${produtor}` : '/dashboards/renovacoes'}
          rotulo="Voltar ao dashboard de Renovações"
        />
        <div className="filtros-compactos">
          <FiltroConsultor
            valor={produtor}
            aoMudar={(p) => {
              const novo = new URLSearchParams(parametros);
              if (p) novo.set('produtor', p);
              else novo.delete('produtor');
              setParametros(novo, { replace: true });
            }}
          />
        </div>
      </div>

      <nav className="abas" aria-label="Seções da fila de renovação">
        {ABAS.map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            className={aba === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
            onClick={() => trocarAba(chave)}
            aria-current={aba === chave ? 'true' : undefined}
          >
            {rotulo}
            {chave === 'seguradora' && listaSeguradora.length > 0 && ` (${listaSeguradora.length})`}
            {chave === 'encerradas' && encerradas.length > 0 && ` (${encerradas.length})`}
          </button>
        ))}
      </nav>

      {carregando && <p className="texto-discreto">Carregando…</p>}

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}{' '}
          <button type="button" className="botao botao--discreto botao--compacto" onClick={recarregar}>
            Tentar de novo
          </button>
        </p>
      )}

      {dados && (
        <section className="cartao cartao--largo">
          {aba === 'fila' &&
            (dados.renovacoes.proximas.length === 0 ? (
              <p className="texto-discreto">Nenhuma apólice a vencer.</p>
            ) : (
              <FilaDeRenovacao
                // A chave troca com a URL: outro link da gaveta, com a tela aberta, reaplica os filtros.
                key={parametros.toString()}
                proximas={dados.renovacoes.proximas}
                total={dados.renovacoes.total}
                mostrarPremio={!dados.disponivel.medirEmApolices}
                abrirCliente={abrirCliente}
                inicial={inicial}
              />
            ))}

          {aba === 'seguradora' &&
            (listaSeguradora.length === 0 ? (
              <Pendente
                o="Nenhuma lista de renovação de seguradora importada."
                porque="O Bradesco não exporta carteira, mas o portal dele gera a lista de apólices a renovar, com o percentual de comissão de cada uma."
                quando="Importe em Importações → Importar arquivos → Bradesco — Apólices a renovar."
              />
            ) : (
              <ListaDaSeguradora lista={listaSeguradora} abrirCliente={abrirCliente} />
            ))}

          {aba === 'encerradas' &&
            (encerradas.length === 0 ? (
              <Pendente
                o="Nenhuma lista de apólices encerradas importada."
                porque="É ela que diz quais apólices acabaram. Cruzada com a placa das apólices novas, mostra quais voltaram."
                quando="Importe em Importações → Importar arquivos → Bradesco — Apólices encerradas."
              />
            ) : (
              <EncerradasDaSeguradora
                key={parametros.toString()}
                lista={encerradas}
                abrirCliente={abrirCliente}
                desfechoInicial={desfecho}
              />
            ))}
        </section>
      )}
    </div>
  );
}
