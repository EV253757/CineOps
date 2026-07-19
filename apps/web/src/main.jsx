import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const Icon = ({ name }) => {
  const paths = {
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></>,
    library: <><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 4 14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    play: <path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="none"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
};

function formatSize(bytes) {
  const value = Number(bytes || 0);
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(0)} MB`;
}

function palette(seed = '') {
  const palettes = [
    ['#ef4444', '#450a0a'], ['#8b5cf6', '#1e123e'], ['#06b6d4', '#083344'],
    ['#f59e0b', '#451a03'], ['#10b981', '#052e2b'], ['#ec4899', '#500724'],
    ['#3b82f6', '#172554'], ['#f97316', '#431407']
  ];
  const score = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palettes[score % palettes.length];
}

function MovieArtwork({ movie, large = false, token = '' }) {
  const colors = palette(movie?.title);
  const imageType = large && movie?.has_backdrop ? 'Backdrop' : 'Primary';
  const hasImage = imageType === 'Backdrop' ? movie?.has_backdrop : movie?.has_image;
  return (
    <div className={`artwork ${large ? 'large' : ''}`} style={{ '--accent': colors[0], '--deep': colors[1] }}>
      {hasImage && <img src={`${API_URL}/api/movies/${movie.id}/image?type=${imageType}&width=${large ? 1600 : 500}&access_token=${encodeURIComponent(token)}`} alt="" />}
      <div className="art-glow" />
      {!hasImage && <span className="art-letter">{movie?.title?.[0] || 'C'}</span>}
      <span className="format">{movie?.extension?.toUpperCase() || 'VIDEO'}</span>
      <div className="film-lines" />
    </div>
  );
}

function App() {
  const [movies, setMovies] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [featured, setFeatured] = useState(null);
  const [status, setStatus] = useState('loading');
  const [activeLibrary, setActiveLibrary] = useState('Todas');
  const [session, setSession] = useState(null);
  const [accessToken, setAccessToken] = useState('');
  const [requests, setRequests] = useState([]);

  async function bootstrapSession() {
    try {
      const identityResponse = await fetch('/api/auth/token', { cache: 'no-store' });
      if (!identityResponse.ok) throw new Error('Microsoft no autenticado');
      const identity = await identityResponse.json();
      const exchange = await fetch(`${API_URL}/api/auth/exchange`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: identity.token })
      });
      if (!exchange.ok) throw new Error('No se pudo crear la sesión');
      const data = await exchange.json();
      setSession(data);
      setAccessToken(data.access_token);
    } catch (error) {
      setSession({ status: 'error', error: error.message });
    }
  }

  async function loadRequests(token = accessToken) {
    if (!token) return;
    const response = await fetch(`${API_URL}/api/admin/requests`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setRequests((await response.json()).items);
  }

  async function approve(email) {
    const response = await fetch(`${API_URL}/api/admin/requests/${encodeURIComponent(email)}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.ok) loadRequests();
  }

  async function loadMovies(query = '') {
    setStatus('loading');
    try {
      const response = await fetch(`${API_URL}/api/movies?limit=500&search=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('API no disponible');
      const data = await response.json();
      setMovies(data.items);
      setFeatured((current) => current || data.items[0]);
      setStatus('ready');
    } catch {
      setStatus('offline');
    }
  }

  useEffect(() => { bootstrapSession(); }, []);
  useEffect(() => {
    if (session?.status === 'approved' && accessToken) loadMovies();
    if (session?.role === 'admin' && accessToken) loadRequests(accessToken);
  }, [session?.status, accessToken]);
  useEffect(() => {
    if (session?.status !== 'approved' || !accessToken) return undefined;
    const timer = setTimeout(() => loadMovies(search), 300);
    return () => clearTimeout(timer);
  }, [search, session?.status, accessToken]);

  const libraries = useMemo(() => ['Todas', ...new Set(movies.map((movie) => movie.library))], [movies]);
  const visibleMovies = useMemo(
    () => activeLibrary === 'Todas' ? movies : movies.filter((movie) => movie.library === activeLibrary),
    [movies, activeLibrary]
  );
  const totalSize = useMemo(() => movies.reduce((sum, movie) => sum + Number(movie.size_bytes), 0), [movies]);

  if (!session) return <div className="access-screen"><div className="access-card"><span className="access-logo">C</span><h1>Preparando tu sesión</h1><p>Verificando identidad con Microsoft…</p><div className="access-loader" /></div></div>;
  if (session.status !== 'approved') return <div className="access-screen"><div className="access-card"><span className="access-logo">C</span><small>SOLICITUD RECIBIDA</small><h1>Acceso pendiente</h1><p>{session.status === 'error' ? session.error : `Hola ${session.name || session.email}. Tu solicitud llegó al administrador de CineOps. Podrás entrar cuando sea aprobada.`}</p><button onClick={bootstrapSession}>Comprobar aprobación</button><a href="/.auth/logout">Usar otra cuenta</a></div></div>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="logo" href="/"><span>C</span><b>CINEOPS</b></a>
        <nav className="side-nav">
          <p>MENÚ</p>
          <a className="active" href="#inicio"><Icon name="home" /> Inicio</a>
          <a href="#catalogo"><Icon name="compass" /> Explorar</a>
          <a href="#bibliotecas"><Icon name="library" /> Mi biblioteca</a>
        </nav>
        {session.role === 'admin' && <div className="approval-card"><span>{requests.length}</span><div><strong>Solicitudes</strong><small>pendientes de aprobación</small></div></div>}
        <div className="storage-card">
          <span className="storage-icon"><Icon name="library" /></span>
          <div><strong>{formatSize(totalSize)}</strong><small>Biblioteca indexada</small></div>
        </div>
        <a className="side-logout" href="/.auth/logout"><Icon name="logout" /> Cerrar sesión</a>
      </aside>

      <div className="content">
        <header className="topbar">
          <a className="mobile-logo logo" href="/"><span>C</span><b>CINEOPS</b></a>
          <label className="global-search">
            <Icon name="search" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en tu colección" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="profile"><span>{(session.name || session.email).slice(0, 2).toUpperCase()}</span><div><strong>{session.name || session.email}</strong><small>{session.role === 'admin' ? 'Administrador' : 'Usuario'}</small></div></div>
        </header>

        <main>
          <section className="hero" id="inicio">
            <div className="hero-background"><MovieArtwork movie={featured} large token={accessToken} /></div>
            <div className="hero-shade" />
            <div className="hero-content">
              <span className="featured-label"><i /> DESTACADA DE TU COLECCIÓN</span>
              <h1>{featured?.title || 'Tu cine, a tu manera'}</h1>
              <p>{featured?.overview || 'Disponible en tu biblioteca privada. Reproduce en cualquier dispositivo autorizado y continúa donde lo dejaste.'}</p>
              <div className="hero-meta"><span>{featured?.year || 'TU COLECCIÓN'}</span><i /> <span>{featured?.extension?.toUpperCase() || 'VIDEO'}</span><i /> <span>{featured?.rating ? `★ ${featured.rating.toFixed(1)}` : formatSize(featured?.size_bytes)}</span></div>
              <div className="hero-actions">
                <button className="primary" onClick={() => featured && setSelected(featured)}><Icon name="play" /> Reproducir</button>
                <button className="secondary" onClick={() => document.querySelector('#catalogo')?.scrollIntoView({ behavior: 'smooth' })}><Icon name="info" /> Ver catálogo</button>
              </div>
            </div>
            <div className="hero-count"><strong>{movies.length}</strong><span>TÍTULOS</span></div>
          </section>

          {session.role === 'admin' && requests.length > 0 && <section className="requests-panel"><div><span className="overline">ADMINISTRACIÓN</span><h2>Solicitudes de acceso</h2></div>{requests.map((request) => <article key={request.email}><div><strong>{request.display_name}</strong><span>{request.email} · Microsoft</span></div><button onClick={() => approve(request.email)}>Aprobar como usuario</button></article>)}</section>}

          <section className="catalog" id="catalogo">
            <div className="section-heading">
              <div><span className="overline">TU COLECCIÓN</span><h2>Películas y videos</h2></div>
              <span className={`connection ${status}`}><i />{status === 'ready' ? 'Biblioteca conectada' : status === 'loading' ? 'Sincronizando…' : 'Servidor local desconectado'}</span>
            </div>

            <div className="filter-row" id="bibliotecas">
              <div className="filters">
                {libraries.map((library) => <button key={library} className={library === activeLibrary ? 'active' : ''} onClick={() => setActiveLibrary(library)}>{library}</button>)}
              </div>
              <span className="view-button"><Icon name="grid" /></span>
            </div>

            {status === 'loading' && <div className="movie-grid">{Array.from({ length: 10 }, (_, i) => <div className="skeleton" key={i} />)}</div>}
            {status === 'offline' && <div className="empty-state"><span>◌</span><h3>Tu servidor está descansando</h3><p>Enciende Docker Desktop y comprueba que CineOps API esté disponible.</p><button onClick={() => loadMovies(search)}>Reintentar conexión</button></div>}
            {status === 'ready' && (
              <div className="movie-grid">
                {visibleMovies.map((movie) => (
                  <article className="movie-card" key={movie.id} onClick={() => setSelected(movie)}>
                    <MovieArtwork movie={movie} token={accessToken} />
                    <button className="card-play" aria-label={`Reproducir ${movie.title}`}><Icon name="play" /></button>
                    <div className="movie-copy"><h3>{movie.title}</h3><p><span>{movie.year || movie.extension.toUpperCase()}</span> {movie.rating ? `★ ${movie.rating.toFixed(1)} · ` : ''}{movie.library}</p></div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {selected && (
        <div className="player-modal" role="dialog" aria-modal="true">
          <div className="player-card">
            <button className="modal-close" onClick={() => setSelected(null)}><Icon name="close" /></button>
            <video controls autoPlay src={`${API_URL}/api/movies/${selected.id}/stream?access_token=${encodeURIComponent(accessToken)}`} />
            <div className="player-info"><div><span>REPRODUCIENDO AHORA</span><h2>{selected.title}</h2><p>{selected.overview}</p></div><div className="player-links"><p>{selected.library} · {formatSize(selected.size_bytes)}</p>{selected.jellyfin_url && <a href={selected.jellyfin_url} target="_blank" rel="noreferrer">Abrir en Jellyfin para transcodificar</a>}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
