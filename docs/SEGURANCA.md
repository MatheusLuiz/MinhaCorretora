# Segurança

Este documento registra as decisões de segurança do projeto e o motivo de cada uma.

## 1. Armazenamento de senhas

**Argon2id**, vencedor da Password Hashing Competition e recomendação atual da OWASP.

Parâmetros mínimos adotados (OWASP Password Storage Cheat Sheet):

| Parâmetro       | Valor    |
|-----------------|----------|
| `memoryCost`    | 19456 KiB (19 MiB) |
| `timeCost`      | 2        |
| `parallelism`   | 1        |
| `type`          | Argon2id |

Não usamos MD5, SHA-1, SHA-256 puro nem bcrypt legado.

## 2. SQL Injection

A defesa não é "escapar strings" — é **nunca construir SQL por concatenação**.

- Todo acesso ao banco passa por `mysql2/promise` com `connection.execute()`, que usa
  o protocolo de *prepared statements* do MySQL: a query e os dados trafegam separados,
  e o servidor jamais reinterpreta o dado como comando.
- `multipleStatements` fica **desligado** no pool (padrão do driver), impedindo que um
  `; DROP TABLE` sequer chegue a ser parseado.
- Identificadores dinâmicos (nome de coluna em `ORDER BY`, por exemplo) — que não podem
  ser parametrizados — são resolvidos por *allow-list* em código, nunca vindos do usuário.
- Toda entrada da API é validada com **Zod** antes de chegar ao repositório.

## 3. Privilégio mínimo no MySQL

O usuário da aplicação recebe apenas `SELECT, INSERT, UPDATE, DELETE` no schema do BI.
Sem `DROP`, `ALTER`, `CREATE`, `GRANT`, `FILE` ou `SUPER`. Migrations rodam com um
usuário administrativo separado, usado manualmente no deploy.

## 4. Sessão e tokens

- **Access token** JWT (HS256), vida curta (15 min), enviado no header `Authorization`.
- **Refresh token** opaco (256 bits de entropia via `crypto.randomBytes`), guardado no
  banco como **hash SHA-256** e entregue ao navegador em cookie
  `HttpOnly` + `Secure` + `SameSite=Strict`.
- **Rotação**: cada uso do refresh token invalida o anterior. Se um token já usado for
  reapresentado, toda a família de sessões daquele usuário é revogada (detecção de roubo).

## 5. Proteção contra força bruta

- Rate limit global e um limite específico e mais agressivo em `/auth/login`.
- Contador de tentativas falhas por usuário, com bloqueio temporário progressivo.
- Resposta de login é **genérica** ("credenciais inválidas") e com tempo de resposta
  equalizado, para não revelar se o e-mail existe.

## 6. Cabeçalhos e transporte

- `helmet` com CSP restritiva e HSTS.
- CORS com origem explícita em allow-list (nunca `*` com credenciais).
- Em produção, TLS obrigatório; cookies só com `Secure`.

## 7. Segredos

Nada de segredo em código. Tudo em `.env`, validado na subida da aplicação — se faltar
uma variável obrigatória ou o `JWT_SECRET` for curto demais, o processo **não inicia**.

As credenciais de integração com as seguradoras ficam exclusivamente no backend,
cifradas no cadastro da seguradora, e são redigidas de qualquer log.

## 8. Auditoria

Tabela `audit_log` registra login, logout, falha de autenticação, troca de senha e
alterações de permissão — com IP, user-agent e horário.

## 9. Permissões individuais

A permissão vem do **papel**. Quando alguém precisa de uma exceção, ela é
registrada como exceção — e continua visível como tal.

```
permissão efetiva = (permissões do papel − revogações) ∪ concessões
```

A fórmula vive na view `vw_permissoes_efetivas`, num lugar só. Ela é consultada
de três caminhos — login, `/auth/me` e a tela de gestão. Repetida em três
lugares, a primeira alteração faz as cópias divergirem, e a divergência aparece
para o usuário como *"a tela diz que eu posso, mas o sistema recusa"*.

### Por que exceção, e não papel novo

A saída fácil seria criar um papel para cada caso ("Operador que vê comissão").
Em pouco tempo há doze papéis, ninguém lembra a diferença entre eles, e mudar
uma política exige editar todos. Com exceções, o vínculo com o papel é
preservado: trocar o papel da pessoa traz as permissões novas dele, e só as
exceções explícitas sobrevivem.

### Ninguém edita as próprias permissões

`PUT /api/usuarios/:id/permissoes` recusa com **409** quando o alvo é quem está
chamando. Sem essa regra, quem tem `usuarios.gerenciar` se concede acesso total
em dois cliques, e a separação de papéis deixa de existir — um operador promovido
a gerente de usuários viraria administrador pleno sem que ninguém aprovasse.
Alterar o próprio acesso passa obrigatoriamente por outra pessoa.

### Alterar permissão encerra as sessões

As permissões viajam **dentro** do access token, assinado no login. Sem revogar
as sessões, a pessoa seguiria com o conjunto antigo por até 15 minutos — e uma
revogação feita por segurança levaria esse tempo para valer. Vale o mesmo para
troca de papel, desativação e redefinição de senha.

### O motivo é obrigatório na prática

O campo `motivo` acompanha cada exceção e vai para a auditoria. Não é
burocracia: sem o motivo escrito, em seis meses ninguém lembra por que a exceção
existe — e exceção que ninguém entende nunca é removida.

## 10. Redefinição de senha por e-mail

Quem esquece a senha pede um link em `/esqueci-senha`. O link chega no e-mail já
cadastrado e leva a `/redefinir-senha`, onde a pessoa escolhe a senha nova.

O e-mail é o segundo fator implícito do fluxo: a única prova de identidade é o
acesso à caixa de entrada. Tudo abaixo decorre disso.

### O token

- 256 bits de `crypto.randomBytes`, em `base64url`, opaco — mesma construção do
  refresh token, e pelo mesmo motivo: precisa ser revogável no servidor, e JWT é
  justamente o formato que continua valendo até expirar.
- Gravado como **SHA-256** em `tokens_redefinicao_senha.token_hash`. O valor em
  claro existe apenas dentro do e-mail.
- **Uso único** (`usado_em`), com a corrida entre dois cliques resolvida no
  `UPDATE ... AND usado_em IS NULL`.
- Validade curta (`RESET_SENHA_TTL_MIN`, padrão 30 min).
- Pedir um link novo **invalida o anterior**. Dois links válidos ao mesmo tempo
  dobrariam a superfície sem dar nada em troca.
- Concluída a redefinição, todos os outros tokens pendentes daquele usuário caem
  junto.

### Resposta única em `/auth/senha/esqueci`

O endpoint responde **sempre** a mesma coisa — e-mail cadastrado, inexistente,
conta desativada ou limite estourado. É o mesmo raciocínio do login, agravado:
aqui nem senha é preciso para interrogar o sistema, então uma resposta que
diferencie os casos entrega a lista de quem tem conta na corretora a quem
perguntar.

Pela mesma razão, **o envio do e-mail não é aguardado** antes de responder.
Esperar o SMTP faria o e-mail cadastrado responder um segundo depois do não
cadastrado, e essa diferença de tempo é um oráculo tão bom quanto a mensagem.

O que aconteceu de fato fica em `auditoria`, nas ações
`senha.redefinicao_solicitada`, `senha.redefinicao_solicitada_inexistente`,
`senha.redefinicao_negada_inativo` e `senha.redefinicao_limitada`.

### Dois limites, porque são dois ataques

- **Por IP** (`express-rate-limit`, 5 pedidos / 15 min): impede que o endpoint
  vire um remetente de spam gratuito assinado pelo domínio da corretora.
- **Por conta** (`RESET_SENHA_MAX_POR_HORA`, padrão 3): impede o assédio
  distribuído a um alvo só — muitos IPs contra a mesma caixa de entrada, que o
  limite por IP não enxerga. E cada pedido novo invalidaria o link legítimo que
  a pessoa está tentando usar.

### O que a redefinição faz além de trocar o hash

- **Revoga todas as sessões.** Se o motivo foi suspeita de invasão, deixar as
  sessões antigas de pé anularia o gesto.
- **Zera o bloqueio por tentativas.** A conta costuma estar bloqueada por causa
  das tentativas que antecederam o "esqueci minha senha"; sem isso, a pessoa
  definiria a senha nova e seria recusada por ela em seguida.
- **Avisa por e-mail** que a senha mudou. Este é o único aviso que chega ao dono
  quando a redefinição *não* foi ele — e chega também quando foi, porque um
  alerta que só aparece em caso de invasão não é notado por quem nunca o viu
  antes.

### Conta desativada não recebe link

Reativar é decisão do administrador. Um desligado que ainda redefine a própria
senha está a meio caminho de volta para dentro do sistema.

### O token não fica na URL

O link chega como `/redefinir-senha?token=…`, mas a página apaga a query string
assim que lê o valor (`history.replaceState` via `setSearchParams`). Enquanto o
token estiver na barra de endereços, ele vai para o histórico do navegador e
para o `Referer` de qualquer recurso externo que a página carregue.

Pela mesma razão a validação prévia do token vai por **POST** com o valor no
corpo, e não por `GET /auth/senha/validar-token/:token`: token em rota de GET
entra no log de acesso do servidor.

### SMTP

Configuração em `.env` (`SMTP_*`), genérica de propósito — Microsoft 365, Google
Workspace e relay interno falam o mesmo protocolo. `requireTLS` é ligado quando
não se usa TLS implícito, para que um servidor que anuncia STARTTLS e falha na
negociação não faça o envio seguir em texto puro com a credencial junto.

**Sem SMTP configurado o sistema não quebra**: o token é gerado e gravado
normalmente e o link vai para o log do backend (`warn` em dev, `error` em
produção). É o que permite desenvolver o fluxo sem caixa de saída — e o que
impede que um SMTP fora do ar transforme "esqueci a senha" em erro 500.

`APP_URL` monta o link e **precisa ser HTTPS em produção**: o link vale como
credencial temporária da conta, e a aplicação recusa subir com `http://`.
