import { MenuUsuario } from '@/components/MenuUsuario';
import { SinoNotificacoes } from '@/components/SinoNotificacoes';
import { useAuth } from '@/hooks/useAuth';
import { useTitulo } from '@/hooks/useTitulo';

/** Barra superior: título da tela (informado pelo `CabecalhoPainel`) e menu do usuário. */
export function Topbar(): React.JSX.Element {
  const { usuario } = useAuth();
  const { atual } = useTitulo();

  return (
    <header className="topbar">
      <div className="topbar__titulo">
        {atual && (
          <>
            <h1>{atual.titulo}</h1>
            {atual.descricao && <p title={atual.descricao}>{atual.descricao}</p>}
          </>
        )}
      </div>

      {usuario?.precisaTrocarSenha && (
        <span className="etiqueta etiqueta--atencao">Senha provisória</span>
      )}

      <SinoNotificacoes />
      <MenuUsuario />
    </header>
  );
}
