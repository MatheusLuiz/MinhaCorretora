import { Link } from 'react-router-dom';

export function SemAcessoPage(): React.JSX.Element {
  return (
    <main className="status">
      <h1>Sem acesso</h1>
      <p className="texto-discreto">
        Seu perfil não tem permissão para esta área. Se precisar dela, peça ao
        administrador do sistema.
      </p>
      <p>
        <Link to="/">Voltar ao painel</Link>
      </p>
    </main>
  );
}
