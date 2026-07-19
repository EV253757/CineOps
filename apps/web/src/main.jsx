import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function formatSize(bytes) {
  if (!bytes) return '0 GB';
  return `${(Number(bytes) / 1024 ** 3).toFixed(2)} GB`;
}

function App() {
  const [movies, setMovies] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('Cargando biblioteca…');

  async function loadMovies(query = '') {
    setStatus('Cargando biblioteca…');
    try {
      const response = await fetch(`${API_URL}/api/movies?limit=500&search=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('API no disponible');
      const data = await response.json();
      setMovies(data.items);
      setStatus(`${data.count} títulos disponibles`);
    } catch {
      setStatus('No se pudo conectar con la biblioteca local');
    }
  }

  useEffect(() => { loadMovies(); }, []);
  useEffect(() => {
    const timer = setTimeout(() => loadMovies(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const totalSize = useMemo(
    () => movies.reduce((total, movie) => total + Number(movie.size_bytes), 0),
    [movies]
  );

  return (
    <main>
      <header className="hero">
        <nav>
          <a className="brand" href="/">CINE<span>OPS</span></a>
          <div className="nav-actions">
            <span className="private-badge">Biblioteca privada</span>
            <a className="logout" href="/.auth/logout">Salir</a>
          </div>
        </nav>
        <div className="hero-copy">
          <p className="eyebrow">TU COLECCIÓN, EN UN SOLO LUGAR</p>
          <h1>Tu cine.<br /><em>Sin límites.</em></h1>
          <p className="subtitle">Explora y reproduce tu biblioteca personal desde cualquier dispositivo autorizado.</p>
        </div>
      </header>

      <section className="catalog">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">CATÁLOGO</p>
            <h2>Biblioteca local</h2>
            <p className="status">{status} · {formatSize(totalSize)} mostrados</p>
          </div>
          <label className="search">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar película…" />
          </label>
        </div>

        <div className="grid">
          {movies.map((movie, index) => (
            <button className="movie-card" key={movie.id} onClick={() => setSelected(movie)}>
              <div className={`poster tone-${index % 5}`}>
                <span>{movie.extension.toUpperCase()}</span>
                <strong>{movie.title.slice(0, 1)}</strong>
              </div>
              <div className="movie-info">
                <h3>{movie.title}</h3>
                <p>{movie.library} · {formatSize(movie.size_bytes)}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <div className="player-shell" role="dialog" aria-modal="true">
          <button className="close" onClick={() => setSelected(null)} aria-label="Cerrar">×</button>
          <video controls autoPlay src={`${API_URL}/api/movies/${selected.id}/stream`} />
          <div><h2>{selected.title}</h2><p>{selected.library} · {formatSize(selected.size_bytes)}</p></div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
