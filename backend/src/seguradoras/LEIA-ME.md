# Seguradoras

Tudo o que é de UMA companhia fica na pasta dela. O nome da pasta é a
`chave` do cadastro (`seguradoras.chave`): `porto-seguro`, `bradesco`,
`suhai`, `tokio-marine`, `yelum`; `comum` é o que serve a todas.

```
index.ts       a lista das pastas de seguradora (registro)
<chave>/
  index.ts     os layouts que a pasta declara (a lista que a importação usa)
  modelos/     layouts de importação dos relatórios dela
               (carteira.ts, financeiro.ts, apolices.ts)
  importacao/  leitores próprios, quando o relatório não cabe num layout
               (PDF do Bradesco, analítico de comissão da Porto…)
  api/         cliente da API da seguradora
  tarefas/     rotinas que as tarefas agendadas executam
               (Configurações › Tarefas) — contrato em comum/rotina.ts
comum/
  rotina.ts    o contrato de uma rotina de tarefa
  catalogo.ts  acha as rotinas de <chave>/tarefas e comum/tarefas
  tarefas/     rotinas genéricas (verificar-integracao)
```

- **Layout novo:** crie o objeto em `<chave>/modelos/<catálogo>.ts` e
  ponha-o no `<chave>/index.ts` — a ordem ali é a da tela (o primeiro é o
  sugerido). As listas de `services/modelos*.ts` se montam sozinhas.
- **Seguradora nova:** a pasta com `modelos/` e `index.ts`, e uma linha em
  `seguradoras/index.ts`.
- **Rotina nova:** um arquivo em `<chave>/tarefas/<rotina>.ts` (ou
  `comum/tarefas/` se servir a qualquer seguradora) exportando
  `export const rotina: Rotina` (`nome`, `descricao`, `executar`). Reiniciou
  o backend, ela aparece na tela. Falha = `throw new Error('mensagem')`;
  `log()` a cada passo (a tela mostra ao vivo), nunca credencial; dado
  importado passa pelos mesmos serviços das cargas manuais — nunca SQL aqui.
- O que é comum a todas (o motor de importação, o tipo de cada layout, as
  colunas canônicas) continua em `services/`.
