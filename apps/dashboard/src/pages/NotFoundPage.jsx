import { useNavigate } from 'react-router-dom';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="text-center animate-fade-in">
        <p className="text-8xl font-black text-gradient select-none">404</p>
        <h1 className="text-2xl font-semibold text-text-primary mt-4">Page Not Found</h1>
        <p className="text-muted mt-2 text-sm">The route you requested doesn't exist.</p>
        <button className="btn-primary mt-8" onClick={() => navigate('/', { replace: true })}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
