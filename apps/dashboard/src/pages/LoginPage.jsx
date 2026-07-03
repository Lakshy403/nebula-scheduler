import { useNavigate }  from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { api } from '@/lib/api';
import { useState }     from 'react';
import { Layers, Lock } from 'lucide-react';

/** Login page backed by the real /auth/login API. */
export default function LoginPage() {
  const login    = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const [email,    setEmail]    = useState('admin@nebula.com');
  const [password, setPassword] = useState('password123');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!email || !password) {
        setError('Please enter your email and password.');
        return;
      }

      const { data } = await api.post('/auth/login', { email, password });
      login(data.data.token);
      navigate('/', { replace: true });
    } catch {
      setError('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 dot-grid opacity-40 pointer-events-none" aria-hidden="true" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-brand-500/5 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="relative w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center shadow-glow-brand mb-4">
            <Layers className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Nebula Scheduler</h1>
          <p className="text-sm text-muted mt-1">Sign in to your dashboard</p>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-5">
          {error && (
            <div className="rounded-lg bg-danger-muted border border-danger/20 px-4 py-3">
              <p className="text-sm text-danger-text">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-muted-subtle mb-1.5 uppercase tracking-wider">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-muted-subtle mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                className="input"
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-2.5 mt-2"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Signing inâ€¦
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Sign In
                </span>
              )}
            </button>
          </form>

          <p className="text-center text-xs text-muted-subtle">
            Use the account created through /auth/register</p>
        </div>
      </div>
    </div>
  );
}

