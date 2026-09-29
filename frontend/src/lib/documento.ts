/** Valida CPF/CNPJ no dígito, igual ao servidor (`utils/documento.ts`) — aqui só como feedback imediato. */
export function documentoValido(digitos: string): boolean {
  if (/^(\d)\1+$/.test(digitos)) return false;

  if (digitos.length === 11) {
    for (let posicao = 9; posicao < 11; posicao += 1) {
      let soma = 0;
      for (let i = 0; i < posicao; i += 1) soma += Number(digitos[i]) * (posicao + 1 - i);
      const resto = (soma * 10) % 11;
      if ((resto === 10 || resto === 11 ? 0 : resto) !== Number(digitos[posicao])) return false;
    }
    return true;
  }

  if (digitos.length === 14) {
    const calcular = (tamanho: number): number => {
      let soma = 0;
      let peso = tamanho - 7;
      for (let i = 0; i < tamanho; i += 1) {
        soma += Number(digitos[i]) * peso;
        peso -= 1;
        if (peso < 2) peso = 9;
      }
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    return calcular(12) === Number(digitos[12]) && calcular(13) === Number(digitos[13]);
  }

  return false;
}
