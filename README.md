# MinhaCorretora — BI para corretora de seguros

Painel web de indicadores para uma corretora de seguros: carteira de clientes,
apólices, parcelas, comissões, renovações, cancelamentos e sinistros, com
importação dos relatórios das seguradoras.

> Este repositório traz **só o código e a estrutura do banco**. Não há dados de
> clientes, apólices nem arquivos importados — o banco nasce vazio.

## Stack

| Camada     | Tecnologia                                           |
|------------|------------------------------------------------------|
| Backend    | Node.js 22+ · TypeScript · Express 5                 |
| Frontend   | React 19 · TypeScript · Vite 6                       |
| Banco      | MySQL 8.4 LTS                                        |
| Integração | Relatórios das seguradoras (xlsx/xls/csv/PDF)          |

## Estrutura

```
MinhaCorretora/
├── backend/            API Express + TypeScript
│   └── src/
│       ├── config/         variáveis de ambiente (validadas com Zod) e logger
│       ├── routes/         endpoints
│       ├── controllers/    HTTP ↔ domínio
│       ├── services/       regras de negócio e motor de importação
│       ├── repositories/   acesso ao MySQL — ÚNICO lugar com SQL
│       ├── seguradoras/    um diretório por companhia (layouts, leitores, API, tarefas)
│       ├── middlewares/    segurança, autenticação, validação, erros
│       ├── scripts/        migrations, seeds e rotinas de linha de comando
│       └── utils/          utilitários compartilhados
├── frontend/           SPA React (dashboards, filas de trabalho, configurações)
├── database/
│   ├── migrations/     evolução do schema, em ordem numérica
│   ├── seeds/          papéis, permissões e configuração base
│   └── security/       usuários de banco com privilégio mínimo
└── docs/               arquitetura, modelo de dados, segurança
```

## Como rodar localmente

### 1. Pré-requisitos

- Node.js 22 ou superior (veja `.nvmrc`)
- MySQL 8.4

### 2. Banco de dados

Crie o banco e os dois usuários — um só com DML para a aplicação
(`minhacorretora_bi_app`) e outro com DDL para as migrations (`minhacorretora_bi_migrator`).
O roteiro está em
[`database/security/001_usuario_aplicacao.sql`](database/security/001_usuario_aplicacao.sql)
— **troque as senhas antes de rodar**.

```sql
CREATE DATABASE minhacorretora_bi CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

### 3. Backend

```bash
cd backend
cp .env.example .env      # preencha banco, JWT, SMTP etc.
npm install
npm run db:migrate        # aplica migrations e seeds (controla _migrations por hash)
npm run db:seed:admin -- --nome "Seu Nome" --email voce@exemplo.com.br
npm run dev               # http://localhost:3333/api
```

### 4. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

## Scripts úteis

| Onde     | Comando                 | O que faz                                 |
|----------|-------------------------|-------------------------------------------|
| backend  | `npm run dev`           | API em modo watch                         |
| backend  | `npm test`              | Testes (`node:test` via tsx)              |
| backend  | `npm run lint`          | ESLint                                    |
| backend  | `npm run db:migrate`    | Aplica migrations e seeds                 |
| backend  | `npm run db:seed:admin` | Cria o primeiro administrador             |
| frontend | `npm run dev`           | Vite em modo desenvolvimento              |
| frontend | `npm run build`         | Typecheck + build de produção             |
| frontend | `npm run typecheck`     | Checagem de tipos (`tsc -b`)              |

## Princípios

- **SQL só nos repositórios**, sempre com placeholder `?`. Controller não
  conhece SQL; service não escreve SQL.
- **Migration aplicada não se edita** — crie uma nova.
- Senhas com **Argon2id**; access token JWT em memória e refresh token rotativo
  em cookie `HttpOnly` + `SameSite=strict`.
- **Permissão, nunca papel**: cada rota exige uma permissão (`exigirPermissao`);
  papéis são dados configuráveis.
- IDs internos `BIGINT`; o que sai na API é o `uuid` (`BIN_TO_UUID(x, 1)`).
- Segredos só no `.env`, que **nunca** vai para o git (veja `.gitignore`).

## Documentação

- [Arquitetura](docs/ARQUITETURA.md)
- [Modelo de dados](docs/DESIGN-DADOS.md)
- [Segurança](docs/SEGURANCA.md)
- [Backend](backend/README.md) · [Frontend](frontend/README.md) · [Banco](database/README.md)
- [Código por seguradora](backend/src/seguradoras/LEIA-ME.md)

## Publicando no GitHub

O repositório já vem inicializado no branch `main`. Crie um repositório
**vazio** no GitHub (sem README e sem .gitignore) e rode:

```bash
git remote add origin https://github.com/<seu-usuario>/MinhaCorretora.git
git push -u origin main
```
