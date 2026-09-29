import { useState } from 'react';

import { CaixasEmail } from '@/components/configuracoes/email/CaixasEmail';
import { LayoutsEmail } from '@/components/configuracoes/email/LayoutsEmail';

/** E-mail de disparo: caixas de saída e layouts. */
export function PainelEmail(): React.JSX.Element {
  const [aba, setAba] = useState<'caixas' | 'layouts'>('caixas');

  return (
    <div className="email">
      <nav className="abas" aria-label="E-mail de disparo">
        {(
          [
            ['caixas', 'Caixas de saída'],
            ['layouts', 'Layouts'],
          ] as const
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            className={aba === chave ? 'abas__item abas__item--ativa' : 'abas__item'}
            onClick={() => setAba(chave)}
            aria-current={aba === chave ? 'true' : undefined}
          >
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === 'caixas' ? <CaixasEmail /> : <LayoutsEmail />}
    </div>
  );
}
