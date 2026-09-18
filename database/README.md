# Banco de dados — MinhaCorretora BI

MySQL **8.4 LTS**. Guarda os usuários do painel, papéis, permissões, sessões,
auditoria e os dados de cliente, apólice, parcela, comissão e sinistro
importados dos relatórios das seguradoras.

## Estrutura da pasta

```
database/
├── migrations/   evolução do schema, em ordem numérica
├── seeds/        dados base (papéis e permissões)
└── security/     criação dos usuários de banco com privilégio mínimo
```

## Ordem de execução

```bash
# 1. Usuários de banco (como root/DBA) — TROQUE as senhas no arquivo antes de rodar
mysql -u root -p < security/001_usuario_aplicacao.sql

# 2. Migrations e seeds, com o usuário de migration (o da aplicação não faz DDL):
#    DB_MIGRATOR_USER / DB_MIGRATOR_PASSWORD no backend/.env
npm run db:migrate

# 3. Primeiro administrador (hash Argon2id gerado pelo backend — nunca senha em SQL)
npm run db:seed:admin
```

`db:migrate` controla o que já foi aplicado em `_migrations`, com hash do
arquivo: **migration aplicada não se edita** — crie uma nova.

## Tabelas principais

| Tabela             | Para quê                                                    |
|--------------------|-------------------------------------------------------------|
| `usuarios`         | Pessoas com acesso ao painel                                |
| `papeis`           | Perfis de acesso                                            |
| `permissoes`       | Permissões granulares                                       |
| `papel_permissoes` | Quais permissões cada papel tem                             |
| `sessoes`          | Refresh tokens, com rotação e detecção de reuso             |
| `tentativas_login` | Histórico de tentativas, para análise de força bruta        |
| `auditoria`        | Trilha de ações sensíveis                                   |
| `tokens_redefinicao_senha` | Links de uso único do "esqueci minha senha"         |
| `clientes`         | Núcleo do cadastro, de qualquer procedência                 |
| `telefones`        | Telefones do cliente (celular, residencial, comercial…)     |
| `emails`           | E-mails do cliente (pessoal, comercial)                     |
| `enderecos`        | Endereços do cliente, apontando para `municipios`           |
| `segurados`        | Co-titulares e segurados ligados ao cliente                 |
| `seguradoras_clientes` | Em quais seguradoras o cliente tem seguro               |
| `seguradoras` `ramos` `modalidades` | Dimensões do produto                  |
| `produtores` `estruturas_venda` | Vendedor e filial responsáveis             |
| `municipios` `profissoes` `origens_clientes` | Dimensões de cadastro         |
| `faixas_renda` `estados_civis` | Dimensões de perfil                         |
| `apolices`         | Apólices, com ou sem cliente vinculado                       |
| `apolice_movimentos` | Cada emissão informada pela seguradora                     |
| `produtos`         | Produtos comerciais das seguradoras                         |
| `situacoes_cliente` | Prospecto, ativo, inadimplente, inativo                     |
| `importacoes`      | Trilha das cargas de base externa (quando, o quê, quantas)  |

## Convenções

- **`id` interno + `uuid` público.** A API nunca devolve o `id` sequencial
  (permitiria enumerar registros). O `uuid` é `BINARY(16)` com
  `UUID_TO_BIN(UUID(), 1)` — a flag `1` deixa o prefixo crescente no tempo e
  não é opcional.
- **Refresh token como SHA-256** (`sessoes.token_hash`). Hash rápido basta: o
  token tem 256 bits aleatórios; senha usa Argon2id.
- **`familia` nas sessões.** Token já usado que reaparece revoga a família
  inteira (`reuso_detectado`).
- **IP em `VARBINARY(16)`** via `INET6_ATON()`: serve a IPv4 e IPv6.
- **Privilégio mínimo.** `minhacorretora_bi_app` tem só `SELECT, INSERT,
  UPDATE, DELETE` no schema — sem `DROP`, `GRANT` nem `FILE`. Migrations rodam
  com `minhacorretora_bi_migrator`, só no deploy. Em produção, os dois com
  `REQUIRE SSL`.

## Importação de clientes

```bash
# Conferir o arquivo SEM gravar nada:
npm run db:importar:clientes -- --arquivo "caminho/clientes_import.csv" --simular

# Importar (com o usuário da aplicação):
npm run db:importar:clientes -- --arquivo "caminho/clientes_import.csv" --origem manual
```

- Cada cliente leva `origem_sistema` (`seguradora` ou `manual`) e o
  `origem_lote` da execução — o lote permite desfazer uma carga inteira.
- A chave natural é `cpf_cnpj_numeros`: reimportar **atualiza** em vez de
  duplicar.
- Linha recusada só por: sem CPF/CNPJ, documento fora de 11/14 dígitos ou sem
  nome. O resto é opcional; e-mail malformado vira `NULL` e é contado no
  relatório final.
- A planilha de cadastro **espelha** a origem: os satélites do cliente
  (telefones, e-mails, endereços) são apagados e reinseridos a cada carga.

## Manutenção

Sessões expiradas podem ser limpas periodicamente:

```sql
DELETE FROM sessoes
 WHERE expira_em < NOW() - INTERVAL 30 DAY
 LIMIT 5000;
```

`tentativas_login` e `auditoria` seguem a política de retenção da corretora —
não apague auditoria sem checá-la.
