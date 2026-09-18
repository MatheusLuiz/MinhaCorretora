import { useRef, useState } from 'react';

import { copiarTexto } from '@/lib/copiar';

interface Props {
  senha: string;
  aviso: string;
  titulo: string;
}

/** A senha temporária gerada pelo servidor: aparece UMA vez (no banco só há o hash). */
export function SenhaGerada({ senha, aviso, titulo }: Props): React.JSX.Element {
  const [estado, setEstado] = useState<'ocioso' | 'copiado' | 'falhou'>('ocioso');
  const caixa = useRef<HTMLElement>(null);

  async function copiar(): Promise<void> {
    if (await copiarTexto(senha)) {
      setEstado('copiado');
      window.setTimeout(() => setEstado('ocioso'), 2200);
      return;
    }

    // Sem área de transferência (ex.: HTTP): deixa a senha SELECIONADA e avisa, nunca falha calado.
    const alvo = caixa.current;
    if (alvo) {
      const intervalo = document.createRange();
      intervalo.selectNodeContents(alvo);
      const selecao = window.getSelection();
      selecao?.removeAllRanges();
      selecao?.addRange(intervalo);
    }
    setEstado('falhou');
  }

  return (
    <section className="senha-gerada" role="status">
      <h4>{titulo}</h4>

      <div className="senha-gerada__caixa">
        <code ref={caixa}>{senha}</code>
        <button type="button" className="botao botao--discreto botao--compacto" onClick={() => void copiar()}>
          {estado === 'copiado' ? 'Copiado ✓' : 'Copiar'}
        </button>
      </div>

      {estado === 'falhou' && (
        <p className="alerta alerta--aviso">
          O navegador não deixou copiar automaticamente. A senha está selecionada — tecle{' '}
          <kbd>Ctrl</kbd>+<kbd>C</kbd>.
        </p>
      )}

      <p className="texto-discreto">{aviso}</p>

      <p className="texto-discreto senha-gerada__nota">
        Ela não fica gravada em lugar nenhum — no banco existe apenas o hash. Se
        fechar sem copiar, será preciso gerar outra.
      </p>
    </section>
  );
}
