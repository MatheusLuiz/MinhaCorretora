# Arquitetura

## Visão geral

```
┌────────────┐   HTTPS/JSON   ┌──────────────┐   upload de relatórios   ┌────────────────────┐
│  Frontend  │ ─────────────► │   Backend    │ ◄─────────────────────── │ Portais das        │
│ React+Vite │ ◄───────────── │ Node+Express │ ─ API (tarefas, opc.) ─► │ seguradoras        │
└────────────┘                └──────┬───────┘                          └────────────────────┘
                                     │ mysql2 (prepared statements)
                                     ▼
                              ┌──────────────┐
                              │  MySQL 8.4   │  clientes, apólices, parcelas, comissões,
                              └──────────────┘  usuários, papéis, sessões, auditoria
```

## De onde vêm os dados

Dos relatórios que cada SEGURADORA entrega no portal dela (xlsx, xls, csv,
PDF), importados pela tela de Importação ou pela linha de comando, e de
planilhas de clientes montadas pela própria corretora. Cada companhia tem a
sua pasta em `backend/src/seguradoras/<chave>/` com os layouts e leitores
próprios; o motor de importação é comum.

Toda carga guarda uma cópia do arquivo original (com SHA-256) e é desfeita por
lote. Integração por API, quando a seguradora oferece, roda como TAREFA
agendada no próprio backend, com a credencial cifrada no cadastro da
seguradora.

## Por que o backend intermedia tudo

O frontend **nunca** fala com o portal ou a API de uma seguradora:

1. Credencial de API de seguradora é segredo da corretora inteira; no navegador,
   qualquer usuário logado a teria.
2. Os relatórios chegam em formatos heterogêneos (planilha HTML, BIFF, PDF,
   codificações misturadas); o backend normaliza tudo antes de gravar.
3. O backend aplica o escopo de carteira de cada usuário antes de devolver
   qualquer número.

## Camadas do backend

| Camada        | Responsabilidade                                                |
|---------------|-----------------------------------------------------------------|
| `routes/`     | Definição de endpoints HTTP e middlewares de rota                |
| `controllers/`| Tradução HTTP ↔ domínio (sem regra de negócio)                   |
| `services/`   | Regra de negócio (autenticação, importação, agregações de BI)    |
| `repositories/`| Acesso ao MySQL — **único lugar** que escreve SQL                |
| `seguradoras/<chave>/` | Layouts, leitores, cliente de API e rotinas de cada companhia |
| `middlewares/`| Segurança, autenticação, validação, tratamento de erro           |
| `config/`     | Carga e validação de variáveis de ambiente                       |

## Separação de identidades

São dois conceitos distintos e independentes:

- **Usuário do BI** — pessoa que faz login no sistema. Vive no MySQL, autenticada com
  Argon2id + JWT. É quem tem papel/permissão no dashboard.
- **Credencial de integração** — usuário/senha ou chave de API de uma seguradora.
  Fica cifrada (AES-256-GCM) no cadastro da seguradora e nunca volta para a tela.

## Fluxo de dados de BI

1. Alguém importa o relatório da seguradora (ou uma tarefa o busca pela API).
2. O leitor da companhia converte o arquivo para as colunas canônicas.
3. O motor de importação grava clientes, apólices, parcelas e comissões.
4. Os repositórios agregam (prêmio, comissão, renovações, cancelamentos) e o
   frontend renderiza os indicadores.

## Conferência de cliente (drill-down)

De qualquer painel onde apareça um cliente, o nome é clicável e abre a ficha
completa num painel lateral: dados cadastrais, todas as apólices (vigentes e
histórico), sinistros, linha do tempo do relacionamento e a probabilidade de
renovação com os fatores que a compõem.

### Por que painel lateral

O uso é percorrer uma lista — olhar as apólices que vencem no mês, entrar numa,
conferir, voltar, entrar na próxima. Uma página nova perderia a rolagem e o
filtro a cada volta; um modal centralizado cobriria a lista e faria sumir o
contexto de onde se veio. O painel entra pela direita, deixa a lista visível
atrás e fecha sem sair do lugar.

### Onde a origem real se encaixa

Tudo passa por **`buscarCliente(id)`**, em `src/mocks/clientes.ts`. Quando a base
for importada — de arquivo ou direto de uma seguradora —, essa função
vira uma chamada ao backend e mais nada muda: a tela conhece o tipo
`ClienteCompleto`, não a origem. A assinatura já é assíncrona por isso.

O tipo foi desenhado para o que uma corretora de fato tem: um cliente com várias
apólices, de seguradoras diferentes, em ramos diferentes, com histórico de
sinistro e de renovação. Se a importação trouxer menos, os campos ficam nulos e a
tela mostra "não informado" — melhor que inventar.

### A ponte temporária

Os painéis carregam hoje o **nome** do cliente, não o id, porque é o que os dados
fictícios têm. `idPorNome()` faz a ligação. Casar por nome é frágil de propósito:
deixa explícito que é ponte, não modelagem. Com a base importada, os painéis
passam a carregar o id e essa função sai.

Nome sem ficha renderiza texto simples, não um botão — oferecer o clique e
entregar "não encontrado" é pior do que não oferecer.
