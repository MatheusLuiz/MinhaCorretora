/*
 * Validação de CPF e CNPJ pelo dígito verificador: o documento é a chave natural
 * do cliente, e um dígito errado criaria um cadastro duplicado.
 */

/** Só os dígitos, que é a forma guardada no banco. */
export function limparDocumento(valor: string): string {
  return valor.replace(/\D/g, '');
}

/** Dígito repetido (`111.111.111-11`) passa no cálculo, mas é inválido pela Receita. */
function ehRepetido(digitos: string): boolean {
  return /^(\d)\1+$/.test(digitos);
}

export function cpfEhValido(valor: string): boolean {
  const d = limparDocumento(valor);

  if (d.length !== 11 || ehRepetido(d)) return false;

  for (let posicao = 9; posicao < 11; posicao += 1) {
    let soma = 0;

    for (let i = 0; i < posicao; i += 1) {
      soma += Number(d[i]) * (posicao + 1 - i);
    }

    const resto = (soma * 10) % 11;
    const esperado = resto === 10 || resto === 11 ? 0 : resto;

    if (esperado !== Number(d[posicao])) return false;
  }

  return true;
}

export function cnpjEhValido(valor: string): boolean {
  const d = limparDocumento(valor);

  if (d.length !== 14 || ehRepetido(d)) return false;

  // Pesos do CNPJ: ciclam de 2 a 9, da direita para a esquerda.
  const calcular = (tamanho: number): number => {
    let soma = 0;
    let peso = tamanho - 7;

    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(d[i]) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }

    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(12) === Number(d[12]) && calcular(13) === Number(d[13]);
}

/** CNPJ da MATRIZ a partir de qualquer filial: raiz (8 dígitos) + 0001 + verificadores. */
export function cnpjDaMatriz(raiz: string): string {
  const base = `${limparDocumento(raiz).slice(0, 8)}0001`;

  const digito = (numeros: string): number => {
    let soma = 0;
    let peso = numeros.length - 7;
    for (const n of numeros) {
      soma += Number(n) * peso;
      peso -= 1;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const primeiro = digito(base);
  return `${base}${primeiro}${digito(`${base}${primeiro}`)}`;
}

/** Aceita CPF ou CNPJ, decidindo pelo tamanho. */
export function documentoEhValido(valor: string): boolean {
  const d = limparDocumento(valor);

  if (d.length === 11) return cpfEhValido(d);
  if (d.length === 14) return cnpjEhValido(d);

  return false;
}

/** Aplica a máscara para exibição. Devolve como veio se não reconhecer. */
export function formatarDocumento(valor: string): string {
  const d = limparDocumento(valor);

  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  return valor;
}
