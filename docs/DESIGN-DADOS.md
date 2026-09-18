# Design dos painéis

Regras dos gráficos do BI. Existem para que dois painéis feitos por pessoas
diferentes, em meses diferentes, sejam lidos do mesmo jeito.

## Paleta de séries

As cores **não foram escolhidas a olho**. São os slots 1 e 2 de uma paleta
categórica validada por script contra as duas superfícies do sistema.

| Slot | Matiz | Claro (fundo `#ffffff`) | Escuro (fundo `#171b21`) |
|------|-------|-------------------------|--------------------------|
| 1 | azul | `#2a78d6` | `#3987e5` |
| 2 | laranja | `#eb6834` | `#d95926` |

Os tons do modo escuro são os **mesmos matizes re-escalonados** para a superfície
escura, não um clareamento automático dos valores do modo claro — inverter
luminosidade quebra tanto o contraste quanto a separação entre as cores.

### O que a validação checou

| Verificação | Claro | Escuro |
|---|---|---|
| Banda de luminosidade | passa | passa |
| Piso de croma | passa | passa |
| Separação para daltonismo (ΔE OKLab×100) | 9,1 (protan) | 8,4 (protan) |
| Piso de visão normal | 22,9 | 19,8 |
| Contraste contra o fundo | **aviso** | passa |

O aviso no modo claro tem consequência prática: tons abaixo de 3:1 contra o
branco **obrigam alívio** — rótulo direto visível ou tabela. Por isso todo
gráfico deste projeto tem um dos dois. Não é opcional nem estético.

Para revalidar depois de mexer em qualquer cor:

```bash
node <skill>/scripts/validate_palette.js "#2a78d6,#eb6834" --mode light --surface "#ffffff"
node <skill>/scripts/validate_palette.js "#3987e5,#d95926" --mode dark  --surface "#171b21"
```

## Regras que não se negociam

**Um eixo Y, sempre.** Duas medidas de escalas diferentes viram dois gráficos,
nunca dois eixos no mesmo. Um segundo eixo deixa o autor escolher onde as linhas
se cruzam, e a "correlação" que o leitor enxerga é a que a escala inventou.

**Cor segue a entidade, nunca a posição.** Se um filtro reduz de sete
seguradoras para três, as três que sobraram mantêm as cores que tinham.

**Texto em tinta de texto.** Valores, rótulos e legendas ficam em
`--text`/`--text-muted`. Quem carrega identidade é a marca colorida ao lado,
nunca a cor da fonte.

**Cor nunca sozinha.** Toda etiqueta de status traz a palavra junto
("Urgente", "Atenção"). Toda variação em KPI traz seta e sinal. Some a cor,
continua legível — para quem não distingue os tons e para quem imprime.

**Legenda a partir de duas séries; nenhuma com uma só.** Com uma série, o título
já diz o que está plotado, e a caixa de legenda vira ruído.

## Escolha da forma

| A pergunta é… | A forma é |
|---|---|
| Um número do momento presente | Tile de KPI — não é gráfico |
| Comparar magnitude entre categorias | Barras horizontais |
| Evolução no tempo | Linha |
| Encontrar/agir sobre um registro | Tabela |

**Barras horizontais, e não verticais**, quando o rótulo é um nome: na vertical
teria de ser girado ou truncado, e texto inclinado é bem mais lento de ler.

**Barras, e não pizza.** Comparar comprimento é mais preciso do que comparar
ângulo, e a pizza fica ilegível acima de umas quatro fatias.

**Tabela quando o dado é acionável.** Na tela de renovações o usuário vai ligar
para o cliente: plotar sete apólices esconderia o número da apólice e o nome,
que são justamente o que ele precisa.

## Linha de base zero: depende da forma

**Barra: sempre no zero.** O comprimento é que codifica o valor; cortar a base
mente sobre a proporção.

**Linha: não necessariamente.** Quem codifica é a inclinação. A produção oscila
numa faixa alta e nunca chega perto de zero — ancorar no zero jogaria boa parte
da área em espaço morto e achataria o vão entre realizado e meta, que é a mensagem
do gráfico. Os rótulos do eixo dizem com todas as letras onde a escala começa.

## Especificação das marcas

- Linha de 2px, ponta e junta arredondadas.
- Marcador com raio ≥ 5px, e **só no ponto sob o cursor** — um círculo em cada
  mês de cada série empasta a linha e some com a tendência.
- Anel de 2px na cor da superfície em cima do marcador: separa marcador e linha
  onde as séries se cruzam.
- Barra arredondada **só na ponta do dado**; a base fica reta, ancorada no eixo.
  Arredondar os dois lados faz a barra parecer flutuar.
- Grade recessiva, só horizontal. Verticais em série temporal viram ruído.
- Série de referência (meta, limite) é tracejada — é referência, não medição.

## Interação

Gráfico em SVG que ignora o mouse desperdiça o meio.

- **Linha**: régua vertical que acompanha o cursor + tooltip com todas as séries
  do mês, para comparar sem precisar mirar num ponto de 10px.
- **Barras**: realce da linha inteira no hover e no foco, com a área de acerto
  maior que a barra.
- Tudo alcançável por teclado: as linhas de barra têm `tabIndex` e respondem a
  `focus`, não só a `hover`.

## Dados fictícios

Enquanto as telas estiverem em avaliação visual, os números vêm de
`src/mocks/dadosFicticios.ts` e **toda tela exibe a faixa de aviso**. Um
dashboard que parece real e não é acaba citado numa reunião, e a correção chega
sempre tarde demais.

As telas de **consulta** (clientes, apólices, sinistros) ficam propositalmente
vazias, e não preenchidas com registros falsos: ali o usuário vem procurar UM
cliente, e um nome plausível que não existe custa mais tempo do que uma tela
vazia que diz o que falta.
