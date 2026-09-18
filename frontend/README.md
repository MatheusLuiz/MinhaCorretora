# Frontend — MinhaCorretora

SPA em React 19 + TypeScript, empacotada com Vite.

## Primeiros passos

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Abre em `http://localhost:5173`. O backend precisa estar rodando na porta 3333.

## Scripts

| Script              | O que faz                                |
|---------------------|------------------------------------------|
| `npm run dev`       | Servidor de desenvolvimento com HMR      |
| `npm run build`     | Checagem de tipos + build de produção    |
| `npm run preview`   | Serve o build localmente                 |
| `npm run typecheck` | Só a checagem de tipos                   |

## Proxy de desenvolvimento

O Vite encaminha `/api` para `http://localhost:3333`. Isso não é só conveniência:
faz o navegador ver front e API na **mesma origem**, então o cookie `HttpOnly` do
refresh token se comporta em dev exatamente como em produção — sem CORS no meio e
sem precisar afrouxar `SameSite`.

## Atenção com variáveis de ambiente

Tudo que começa com `VITE_` é embutido no bundle e **fica visível para qualquer
pessoa** que abrir o DevTools. Nunca coloque aqui credencial de seguradora, string de
conexão de banco ou segredo de JWT — esses vivem só no `.env` do backend.

## Organização

```
src/
├── components/  componentes reutilizáveis
├── pages/       telas
├── hooks/       hooks customizados
├── lib/         cliente HTTP e utilitários
├── styles/      CSS global e de tela
└── types/       tipos compartilhados
```

## Como a sessão é guardada

O access token fica **apenas em memória** (uma variável de módulo em
`src/lib/api.ts`), nunca em `localStorage` ou `sessionStorage`. Qualquer script
injetado na página lê `localStorage`; uma variável de módulo morre com a aba e
não é alcançável por um `<script>` de terceiros.

O custo disso é que um F5 apaga o token — e é exatamente para isso que existe o
cookie `HttpOnly` de refresh: ao abrir a página, o `AuthProvider` chama
`/auth/refresh` e, se o cookie ainda vale, a sessão volta sem o usuário perceber.

Um detalhe que costuma passar batido: as chamadas concorrentes compartilham a
**mesma promessa** de refresh. Sem isso, cinco widgets carregando juntos
dispararIam cinco refreshes, e a rotação de token no servidor trataria quatro
deles como reuso — derrubando a sessão do próprio usuário.

## Guarda de rota não é segurança

`<RotaProtegida>` existe para usabilidade. Esconder a tela não protege dado
algum: qualquer pessoa chama a API direto. A checagem que vale é a do backend,
em `exigirPermissao`. Aqui só evitamos mostrar uma tela que renderizaria vazia.

## Acesso pela rede local

O servidor de desenvolvimento escuta em `0.0.0.0`, então outra máquina da rede
abre pelo IP desta:

```
http://<ip-desta-maquina>:5173
```

O Vite mostra o endereço em "Network" ao subir. Para desligar, coloque
`VITE_EXPOR_NA_REDE=false` no `.env` — em rede pública (cafeteria, coworking),
escutar em `0.0.0.0` entrega o servidor a qualquer um no mesmo Wi-Fi.

### Só isso não basta: o Windows Firewall

Na primeira vez, o Windows costuma bloquear a porta. Num PowerShell **como
administrador**:

```powershell
New-NetFirewallRule -DisplayName "MinhaCorretora BI (dev 5173)" `
  -Direction Inbound -Protocol TCP -LocalPort 5173 `
  -Action Allow -Profile Domain,Private
```

`-Profile Domain,Private` de propósito: a regra vale na rede da empresa e em
rede doméstica, e **não** em rede pública.

Para remover depois: `Remove-NetFirewallRule -DisplayName "MinhaCorretora BI (dev 5173)"`.

### O backend não precisa de regra

Quem vem pela rede chama `/api` no **mesmo** endereço da página, e é o Vite —
rodando nesta máquina — que repassa ao backend em `localhost:3333`. O navegador
do colega nunca fala direto com a porta 3333.

### Por que o proxy encaminha `X-Forwarded-For`

Sem `xfwd: true`, toda requisição chegaria ao backend como `127.0.0.1`: quem
abre a conexão é o proxy, não o navegador. Na máquina do desenvolvedor isso é
indiferente; em rede quebra duas coisas:

- o rate limit de login por IP passa a contar todo mundo junto — dez senhas
  erradas **somadas entre as pessoas** e a equipe inteira fica 15 minutos
  trancada;
- a auditoria grava `127.0.0.1` em todo acesso, perdendo justamente de onde a
  ação partiu.

## Isto é desenvolvimento, não implantação

O tráfego vai em **HTTP puro**: senha de login e cookie de sessão atravessam a
rede em texto claro, legíveis por quem estiver capturando pacotes no mesmo
segmento. Serve para mostrar a tela a um colega; não serve para uso real.

Para valer, o caminho é `npm run build` servido por um servidor com HTTPS, e
`NODE_ENV=production` no backend — que aí exige cookie `Secure` e recusa subir
sem ele.
