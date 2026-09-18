import { Modal } from '@/components/Modal';
import type { TemaVisivel } from '@/lib/tema';

/** Cores escritas aqui, não tokens (que valem só para o tema ativo): mudou `global.css`, mude aqui. */
export const OPCOES_TEMA: { tema: TemaVisivel; nome: string; descricao: string; cores: [string, string, string] }[] = [
  { tema: 'claro', nome: 'Claro', descricao: 'Branco e verde-água, o padrão.', cores: ['#e8f4f1', '#ffffff', '#0b7466'] },
  { tema: 'escuro', nome: 'Escuro', descricao: 'Para ambiente com pouca luz.', cores: ['#101317', '#171b21', '#2bb8a0'] },
  { tema: 'rosa', nome: 'Rosa', descricao: 'Claro, em branco e rosa.', cores: ['#fbe8ef', '#ffffff', '#c2185b'] },
];

interface Props {
  aberto: boolean;
  atual: TemaVisivel;
  aoEscolher: (tema: TemaVisivel) => void;
  aoFechar: () => void;
}

/** Modal de temas; escolher aplica na hora, com o resultado visível atrás. */
export function SeletorTema({ aberto, atual, aoEscolher, aoFechar }: Props): React.JSX.Element | null {
  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Tema" tamanho="pequeno">
      <div className="modal__conteudo seletor-tema" role="radiogroup" aria-label="Tema da interface">
        {OPCOES_TEMA.map((o) => (
          <button
            key={o.tema}
            type="button"
            role="radio"
            aria-checked={atual === o.tema}
            className={`seletor-tema__opcao${atual === o.tema ? ' seletor-tema__opcao--ativa' : ''}`}
            onClick={() => aoEscolher(o.tema)}
          >
            <span className="seletor-tema__amostra" aria-hidden="true" style={{ background: o.cores[0] }}>
              <span style={{ background: o.cores[1] }} />
              <span style={{ background: o.cores[2] }} />
            </span>
            <span className="seletor-tema__texto">
              <strong>{o.nome}</strong>
              <small>{o.descricao}</small>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
