# Backend — MinhaCorretora

API em Node.js + TypeScript (Express 5) que autentica os usuários do BI,
importa os relatórios das seguradoras e serve os painéis.

## Requisitos

- Node.js 24 (ver `.nvmrc` na raiz)
- MySQL 8.4 (a partir da etapa de autenticação)

## Primeiros passos

```bash
cd backend
cp .env.example .env     # preencha os valores
npm install
npm run dev
```

A API sobe em `http://localhost:3333/api`.

Teste rápido:

```bash
curl http://localhost:3333/api/health
```

## Scripts

| Script              | O que faz                                      |
|---------------------|------------------------------------------------|
| `npm run dev`       | Sobe em modo watch (tsx)                       |
| `npm run build`     | Compila TypeScript para `dist/`                |
| `npm start`         | Roda o build de produção                       |
| `npm run typecheck` | Checagem de tipos sem gerar arquivos           |
| `npm run db:migrate` | Aplica migrations e seeds (precisa de DDL)    |
| `npm run db:seed:admin` | Cria o primeiro administrador              |
| `npm run db:importar:clientes` | Importa base de clientes de um CSV  |

## Organização

```
src/
├── config/        env (validado com Zod) e logger
├── routes/        definição dos endpoints
├── controllers/   tradução HTTP ↔ domínio
├── services/      regra de negócio
├── repositories/  acesso ao MySQL — único lugar com SQL
├── seguradoras/   layouts, leitores, API e rotinas de cada companhia
├── middlewares/   segurança, autenticação, validação, erros
└── utils/         utilitários compartilhados
```

## Notas de segurança já aplicadas no bootstrap

- `helmet` com CSP restritiva; HSTS ligado só em produção.
- CORS por allow-list explícita, com `credentials: true`.
- Corpo de requisição limitado a 100 KB.
- Rate limit global.
- Logger com redação automática de `authorization`, `cookie`, `senha` e tokens.
- `x-powered-by` desligado; `trust proxy` limitado a 1 salto.
- Variáveis de ambiente validadas na subida — falta algo, o processo não inicia.

## Endpoints de autenticação

| Método | Rota                | Auth | Para quê                                  |
|--------|---------------------|------|-------------------------------------------|
| POST   | `/api/auth/login`   | —    | Autentica e abre a sessão                 |
| POST   | `/api/auth/refresh` | cookie | Rotaciona o refresh token               |
| POST   | `/api/auth/logout`  | cookie | Revoga a sessão                         |
| GET    | `/api/auth/me`      | Bearer | Perfil e permissões do usuário logado   |
| POST   | `/api/auth/senha`   | Bearer | Troca a senha (derruba todas as sessões)|
| POST   | `/api/auth/senha/esqueci`       | — | Pede o link de redefinição por e-mail |
| POST   | `/api/auth/senha/validar-token` | — | Confere o link antes de mostrar o formulário |
| POST   | `/api/auth/senha/redefinir`     | — | Consome o link e grava a senha nova |

### Preparando o banco

```bash
npm run db:migrate              # aplica database/migrations e database/seeds
npm run db:seed:admin -- --nome "Seu Nome" --email voce@corretora.com.br
```

O `db:seed:admin` gera uma senha aleatória, mostra **uma única vez** no terminal
e marca a conta para troca no primeiro acesso. A senha não é aceita por
argumento de propósito: linha de comando fica no histórico do shell e aparece na
lista de processos da máquina.

### Como a sessão funciona

```
login  ──► access token (JWT, 15 min)  ──► header Authorization
       └─► refresh token (opaco, 7 d)  ──► cookie HttpOnly + Secure + SameSite=Strict
```

O access token fica no header e não em cookie: cookie o navegador manda sozinho
em toda requisição ao domínio, o que abre CSRF. O refresh é a exceção — precisa
sobreviver a um F5, e em `localStorage` qualquer XSS o levaria embora.

Cada refresh **rotaciona**: o token antigo é consumido e um novo nasce. Se um
token já consumido reaparecer, a família inteira de sessões é revogada. Não dá
para distinguir "cliente repetiu a requisição" de "alguém copiou o token", então
tratamos como roubo: o custo do falso positivo é um login a mais.

### Esqueci minha senha

O usuário pede o link em `/esqueci-senha`, recebe por e-mail um endereço
`/redefinir-senha?token=…` e escolhe a senha nova ali. O token vale 30 minutos,
serve uma vez, e usá-lo revoga todas as sessões e libera o bloqueio por
tentativas da conta.

`/api/auth/senha/esqueci` responde **sempre a mesma coisa**, exista o e-mail ou
não — e não espera o SMTP antes de responder, senão o tempo de resposta
denunciaria quais e-mails estão cadastrados. Os detalhes estão em
[docs/SEGURANCA.md](../docs/SEGURANCA.md#10-redefinição-de-senha-por-e-mail).

**Sem SMTP configurado o fluxo continua funcionando**: o link aparece no log do
backend em vez de sair por e-mail. É assim que se testa em desenvolvimento.
Para enviar de verdade, preencha `SMTP_HOST`, `SMTP_FROM` e as credenciais no
`.env`, e aponte `APP_URL` para o endereço que o usuário realmente abre.

## Setup do banco, do zero

```bash
# 1. Com credencial administrativa no .env (DB_USER=root):
npm run db:migrate          # cria o schema, tabelas, papéis e permissões
npm run db:criar-usuario    # cria minhacorretora_bi_app e IMPRIME a senha gerada

# 2. Cole DB_USER/DB_PASSWORD impressos acima no .env e então:
npm run db:seed:admin -- --nome "Seu Nome" --email voce@minhacorretora.com.br
```

O `db:criar-usuario` existe para que ninguém precise editar a senha à mão dentro
de `database/security/001_usuario_aplicacao.sql` — que é como senha real acaba
comitada por engano. Ele gera uma aleatória, aplica os mesmos privilégios do
arquivo e imprime `SHOW GRANTS` para conferência.

## Endpoints de gestão de usuários

| Método | Rota                                  | Para quê                              |
|--------|---------------------------------------|---------------------------------------|
| GET    | `/api/usuarios`                       | Lista todos                           |
| GET    | `/api/usuarios/papeis`                | Papéis e política de senha            |
| GET    | `/api/usuarios/:id`                   | Ficha completa com permissões         |
| POST   | `/api/usuarios`                       | Cadastra (senha gerada pelo servidor) |
| PATCH  | `/api/usuarios/:id`                   | Edita nome, sobrenome, nascimento, papel |
| PATCH  | `/api/usuarios/:id/situacao`          | Ativa ou desativa                     |
| POST   | `/api/usuarios/:id/redefinir-senha`   | Gera nova senha provisória            |

Todas exigem `usuarios.gerenciar`.

### Quem cadastra não escolhe a senha

O `POST /api/usuarios` **recusa** um campo `senha` no corpo. O servidor gera 16
caracteres aleatórios e os devolve uma única vez na resposta. Dois motivos:

1. Senha escolhida por terceiro é fraca e repetida entre cadastros — vira
   "Corretora@2026" para a equipe inteira.
2. Enquanto quem cadastrou souber a senha, não há como distinguir uma ação do
   dono da conta de uma ação de quem a criou. Com senha aleatória trocada no
   primeiro acesso, a conta passa a ter dono único e a auditoria significa algo.

### Bloqueio até a troca da senha provisória

O middleware `exigirTrocaDeSenha` recusa **toda** rota interna com
`403 SENHA_PROVISORIA` enquanto a senha não for trocada. Só `/auth/*` passa —
é por lá que a pessoa troca a senha, renova a sessão e sai.

Ele só funciona depois do `autenticar`, porque decide a partir de `req.usuario`.
Por isso os dois são exportados juntos em `middlewares/rotaProtegida.ts`: registrado
sozinho e antes, o guard recebe `req.usuario` indefinido e deixa passar.

### Travas aplicadas no servidor

- Ninguém desativa a própria conta.
- O último administrador ativo não pode ser desativado nem rebaixado.
- Desativar, rebaixar ou redefinir senha **revoga todas as sessões** da pessoa na
  hora. Sem isso, ela seguiria navegando com o access token que já tem, e o corte
  de acesso só valeria quando o token vencesse.

## Importação da base de clientes

```bash
# Confere o arquivo inteiro sem gravar nada — é aqui que se descobre
# um CEP inválido ANTES de ele entrar no banco.
npm run db:importar:clientes -- --arquivo "C:\caminho\clientes_import.csv" --simular

# Importa marcando a procedência.
npm run db:importar:clientes -- --arquivo "C:\caminho\clientes_import.csv" --origem manual
```

`--origem` aceita `seguradora` e `manual`, e fica gravada
em cada linha junto com um `origem_lote` (UUID da execução). É o que permite
responder "de onde veio este cadastro?" e desfazer uma carga inteira pelo lote.

A carga é **repetível**: a chave é o CPF/CNPJ, então rodar de novo atualiza as
mesmas linhas em vez de duplicar a base.

Detalhes das regras de recusa e do desfazimento estão em
[database/README.md](../database/README.md#importação-de-base-externa).

## Endpoints de clientes

| Método | Rota                     | Auth | Permissão      |
|--------|--------------------------|------|----------------|
| GET    | `/api/clientes`          | Bearer | `clientes.ler` |
| GET    | `/api/clientes/filtros`  | Bearer | `clientes.ler` |
| GET    | `/api/clientes/:id`      | Bearer | `clientes.ler` |

Filtros da listagem, todos opcionais: `busca` (nome, CPF/CNPJ ou e-mail), `uf`,
`seguradora`, `produtor`, `origem`, `pagina`, `limite` (máx. 200).

A busca é no **servidor**, não na tela. São milhares de clientes: carregar tudo para
filtrar no navegador mandaria a base inteira — com CPF, e-mail e telefone — para
a máquina de quem abriu a página, inclusive os registros que ela nunca vai
procurar.

Listagem e ficha devolvem formas **diferentes** de propósito. A listagem traz só
o que a tabela mostra; data de nascimento, renda e endereço completo só saem na
ficha, uma pessoa por vez.

## Importação de clientes pela tela

`Barra lateral → Importar clientes` (exige a permissão `clientes.gerenciar`,
que admin e gestor têm).

| Método | Rota | Para quê |
|---|---|---|
| GET  | `/api/clientes/importacao/modelos` | Lista os modelos e as situações |
| GET  | `/api/clientes/importacao/modelos/:chave` | Baixa o CSV do modelo |
| POST | `/api/clientes/importacao/previa` | Lê a planilha e diz o que a gravação faria |
| POST | `/api/clientes/importacao` | Grava |
| GET  | `/api/clientes/exportar` | Base atual no formato que o importador lê |
| GET  | `/api/clientes/painel` | Números do painel de clientes |

A planilha vai como `text/csv` cru, não `multipart/form-data`: é sempre um
arquivo só, de texto, e o `FileReader` do navegador já entrega o conteúdo
pronto. Evita uma dependência de parser de upload.

### A prévia é obrigatória

A importação **espelha** o arquivo — coluna que ele não traz é gravada como
vazia e apaga o que havia. Uma lista de inadimplentes com três colunas zera o
telefone de todo mundo que ela contém, e não há desfazer.

Por isso o fluxo tem dois passos. O primeiro lê a planilha inteira no servidor,
sem gravar nada, e devolve quantos cadastros perderiam cada tipo de dado. Só
depois o botão de gravar aparece — e quando há perda, ele exige que a pessoa
digite `APAGAR`.

O caminho sem perda é **exportar, editar e reimportar**: a exportação sai com os
mesmos nomes de coluna que o importador lê, então o ciclo é fechado. Está
testado: 69 colunas, 69 reconhecidas, zero perdas.

### Modelos

| Modelo | Para quê | Situação padrão |
|---|---|---|
| Novos prospectos | Quem ainda não é cliente | `prospecto` |
| Clientes em atraso | Marca quem está devendo | `inadimplente` |
| Clientes perdidos | Quem deixou a carteira | `inativo` |
| Cadastro completo | Todas as colunas conhecidas | `ativo` |

O CSV do modelo sai com separador `;` e BOM, por causa do Excel em português —
que usa vírgula como separador decimal e, sem BOM, lê o arquivo como Latin-1 e
transforma "João" em "JoÃ£o". Na volta, o importador aceita os dois separadores.

### O mesmo código na CLI e na tela

`services/importacaoClientes.service.ts` é o núcleo; o script
`db:importar:clientes` e as rotas HTTP são cascas sobre ele. Com duas leituras
de CSV, a primeira divergência apareceria como "pela tela funcionou e pelo
terminal não".

Use a CLI para carga grande (arquivos de vários MB) e a tela para planilha
manual.

### Layouts por seguradora

Os modelos têm **dois eixos**:

- **Por finalidade** — você monta a planilha (prospectos, inadimplentes, perdidos).
- **Por seguradora** — você recebeu o arquivo pronto da companhia, e o layout
  traduz os nomes de coluna dela para os do sistema.

A tradução acontece em `services/colunasImportacao.ts`, em quatro passos:
normaliza o nome (minúsculas, sem acento, pontuação vira `_`), procura no mapa
**do layout**, depois no mapa **global**, e por fim aceita o nome canônico.

O mapa global cobre as variações comuns — `CPF`, `Nome do Cliente`, `E-mail`,
`Município`, `Corretor`, `Nº do Documento` e mais três dezenas. Num teste com
cabeçalho em estilo de seguradora, **10 de 12 colunas foram mapeadas sem
configuração nenhuma**. O mapa por seguradora só precisa listar o que sobrar.

#### Como acrescentar o layout de uma seguradora

1. Suba o arquivo pela tela (ou rode a CLI com `--simular`).
2. A prévia mostra **como cada coluna foi entendida** e quais não entraram. Se
   faltarem as obrigatórias, o erro lista a chave normalizada de cada coluna —
   é ela que entra no mapa.
3. Acrescente uma entrada em `POR_SEGURADORA`, em
   `services/modelosImportacao.ts`, com `aliases: { chave_normalizada: 'coluna_do_sistema' }`.
4. `seguradoraPadrao` preenche o vínculo quando o arquivo não traz a coluna —
   um arquivo da Porto é todo de clientes Porto, e sem isso os vínculos viriam
   vazios.
5. Repita o passo 1 até a lista de ignoradas conter só o que é para descartar.

Os layouts vivem em código, e não em tabela, de propósito: um layout errado não
gera erro — ele grava dado na coluna trocada, e isso aparece meses depois. Em
código há revisão, histórico e a chance de testar contra um arquivo real.

## Importação de apólices

```bash
npm run db:importar:apolices -- --arquivo "C:\...\arquivo.xlsx" --layout yelum-busca-apolices --simular
npm run db:importar:apolices -- --arquivo "C:\...\arquivo.xlsx" --layout yelum-busca-apolices --vincular
```

Aceita **.xlsx e .csv**. As seguradoras exportam planilha, e pedir que a equipe
converta cada arquivo é atrito que vira erro — alguém salva com o separador
errado e o problema aparece como "a importação comeu dados". O leitor de xlsx
está em `utils/xlsx.ts`, sem dependência externa: descompacta o zip e percorre o
XML da primeira aba.

### O arquivo é de MOVIMENTOS, não de apólices

Cada linha é uma emissão: a apólice original, um endosso, uma fatura. A mesma
apólice aparece várias vezes — e pode aparecer **sem** a linha original, quando
foi emitida antes do período filtrado.

No export da Yelum, um mesmo arquivo mistura emissões originais, endossos e
faturas — e **parte das apólices não tem a emissão original no arquivo.**

Por isso são duas tabelas. `apolices` guarda a identidade;
`apolice_movimentos` guarda cada emissão. O cabeçalho da apólice é **derivado**:

| Campo | De onde vem |
|---|---|
| `premio_total`, `premio_liquido`, `emitida_em` | Só do movimento `apolice` |
| `vigencia_inicio`, `vigencia_fim` | Do `apolice`; na falta, do `endosso` |
| — | **Fatura nunca alimenta o cabeçalho** |

A regra da fatura não é detalhe: a vigência de uma fatura é o **mês cobrado**.
Copiá-la para a apólice trocaria a vigência pela competência da cobrança — erro
que não dá sintoma, só número errado no relatório de renovações.

Na reimportação, os campos derivados usam `COALESCE(VALUES(x), x)`: uma janela
que só traz faturas não apaga a vigência que uma carga anterior já apurou.

### Apólice sem cliente é o caso normal

O relatório da Yelum **não traz CPF/CNPJ** — o único identificador do segurado é
o nome. Poucos segurados casam com um cliente da base e a maioria não existe
nela; e a base tem nomes repetidos (homônimos).

Então `apolices.cliente_id` é nulo por padrão e `nome_segurado` guarda o que a
origem deu. `--vincular` liga apenas onde o nome casa com **exatamente um**
cliente, e grava `vinculo_origem = 'nome'` — para que esses vínculos possam ser
revisados e desfeitos quando o documento aparecer por outra via.

A view `vw_apolices_sem_cliente` é a fila de conciliação: mostra cada órfã e
quantos clientes têm aquele nome (`0` = cliente novo, `1` = a confirmar,
`>1` = homônimo, só o CPF resolve).
