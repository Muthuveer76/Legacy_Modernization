import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="auth-page single">
      <div className="auth-card center">
        <h1>Page not found</h1>
        <p className="muted">The page you are looking for does not exist or was removed.</p>
        <Link to="/" className="btn btn-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}
