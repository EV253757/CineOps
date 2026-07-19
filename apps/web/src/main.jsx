import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const Icon = ({ name }) => {
  const paths = {
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </>
    ),
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
      </>
    ),
    library: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="10" y="4" width="5" height="16" rx="1" />
        <path d="m17 5 4 14" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    play: <path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="none" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    logout: (
      <>
        <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />
      </>
    ),
    grid: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
};

function formatSize(bytes) {
  const value = Number(bytes || 0);
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${(value / 1024 ** 2).toFixed(0)} MB`;
}

function palette(seed = "") {
  const palettes = [
    ["#ef4444", "#450a0a"],
    ["#8b5cf6", "#1e123e"],
    ["#06b6d4", "#083344"],
    ["#f59e0b", "#451a03"],
    ["#10b981", "#052e2b"],
    ["#ec4899", "#500724"],
    ["#3b82f6", "#172554"],
    ["#f97316", "#431407"],
  ];
  const score = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palettes[score % palettes.length];
}

function MovieArtwork({ movie, large = false, token = "" }) {
  const colors = palette(movie?.title);
  const imageType = large && movie?.has_backdrop ? "Backdrop" : "Primary";
  const hasImage =
    imageType === "Backdrop" ? movie?.has_backdrop : movie?.has_image;
  return (
    <div
      className={`artwork ${large ? "large" : ""}`}
      style={{ "--accent": colors[0], "--deep": colors[1] }}
    >
      {hasImage && (
        <img
          src={`${API_URL}/api/movies/${movie.id}/image?type=${imageType}&width=${large ? 1600 : 500}&access_token=${encodeURIComponent(token)}`}
          alt=""
        />
      )}
      <div className="art-glow" />
      {!hasImage && (
        <span className="art-letter">{movie?.title?.[0] || "C"}</span>
      )}
      <span className="format">
        {movie?.extension?.toUpperCase() || "VIDEO"}
      </span>
      <div className="film-lines" />
    </div>
  );
}

function App() {
  const [movies, setMovies] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [featured, setFeatured] = useState(null);
  const [status, setStatus] = useState("loading");
  const [activeGenre, setActiveGenre] = useState("Todas");
  const [session, setSession] = useState(null);
  const [accessToken, setAccessToken] = useState("");
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cloudLibrary, setCloudLibrary] = useState({
    items: [],
    used_bytes: 0,
    limit_bytes: 100 * 1024 ** 3,
  });
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cloudMessage, setCloudMessage] = useState("");
  const [libraryAvailability, setLibraryAvailability] = useState({
    local: true,
    azure: false,
  });

  async function bootstrapSession() {
    try {
      const identityResponse = await fetch("/api/auth/token", {
        cache: "no-store",
      });
      if (!identityResponse.ok) throw new Error("Microsoft no autenticado");
      const identity = await identityResponse.json();
      const exchange = await fetch(`${API_URL}/api/auth/exchange`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: identity.token }),
      });
      if (!exchange.ok) throw new Error("No se pudo crear la sesión");
      const data = await exchange.json();
      setSession(data);
      setAccessToken(data.access_token);
    } catch (error) {
      setSession({ status: "error", error: error.message });
    }
  }

  async function loadRequests(token = accessToken) {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [requestResponse, usersResponse, cloudResponse] = await Promise.all([
      fetch(`${API_URL}/api/admin/requests`, { headers }),
      fetch(`${API_URL}/api/admin/users`, { headers }),
      fetch(`${API_URL}/api/admin/cloud`, { headers }),
    ]);
    if (requestResponse.ok) setRequests((await requestResponse.json()).items);
    if (usersResponse.ok) setUsers((await usersResponse.json()).items);
    if (cloudResponse.ok) setCloudLibrary(await cloudResponse.json());
  }

  async function uploadCloudMovie(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCloudMessage("Preparando carga…");
    setUploadProgress(0);
    try {
      const authorization = await fetch(
        `${API_URL}/api/admin/cloud/upload-url`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: file.name, size: file.size }),
        },
      );
      const grant = await authorization.json();
      if (!authorization.ok)
        throw new Error(grant.error || "No se pudo autorizar la carga");
      setCloudMessage(`Subiendo ${file.name}…`);
      const { BlockBlobClient } = await import("@azure/storage-blob");
      const client = new BlockBlobClient(grant.upload_url);
      await client.uploadBrowserData(file, {
        blockSize: 8 * 1024 * 1024,
        concurrency: 4,
        blobHTTPHeaders: {
          blobContentType: file.type || "application/octet-stream",
        },
        onProgress: ({ loadedBytes }) =>
          setUploadProgress(Math.round((loadedBytes / file.size) * 100)),
      });
      const finalize = await fetch(`${API_URL}/api/admin/cloud/finalize`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ blob_name: grant.blob_name, title: file.name }),
      });
      if (!finalize.ok)
        throw new Error(
          "El archivo subió, pero no se pudo finalizar el catálogo",
        );
      setCloudMessage("Película disponible en Azure.");
      await Promise.all([loadRequests(), loadMovies(search)]);
    } catch (error) {
      setCloudMessage(error.message);
    }
  }

  async function deleteCloudMovie(movie) {
    if (!window.confirm(`¿Eliminar ${movie.title} de Azure?`)) return;
    const response = await fetch(
      `${API_URL}/api/admin/cloud/${encodeURIComponent(movie.id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (response.ok) {
      setCloudMessage("Película eliminada; el espacio quedó disponible.");
      await Promise.all([loadRequests(), loadMovies(search)]);
    } else setCloudMessage("No se pudo eliminar la película.");
  }

  async function approve(email) {
    const response = await fetch(
      `${API_URL}/api/admin/requests/${encodeURIComponent(email)}/approve`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (response.ok) loadRequests();
  }

  async function reject(email) {
    await fetch(
      `${API_URL}/api/admin/requests/${encodeURIComponent(email)}/reject`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    loadRequests();
  }

  async function setUserStatus(email, status) {
    await fetch(
      `${API_URL}/api/admin/users/${encodeURIComponent(email)}/status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      },
    );
    loadRequests();
  }

  async function deleteUser(email) {
    if (
      !window.confirm(
        `¿Eliminar el acceso de ${email}? Tendrá que solicitar acceso nuevamente.`,
      )
    )
      return;
    const response = await fetch(
      `${API_URL}/api/admin/users/${encodeURIComponent(email)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (response.ok) loadRequests();
  }

  async function loadMovies(query = "") {
    setStatus("loading");
    try {
      const response = await fetch(
        `${API_URL}/api/movies?limit=500&search=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) throw new Error("API no disponible");
      const data = await response.json();
      setMovies(data.items);
      setLibraryAvailability(
        data.availability || { local: true, azure: false },
      );
      setFeatured((current) => current || data.items[0]);
      setStatus("ready");
    } catch {
      setStatus("offline");
    }
  }

  useEffect(() => {
    bootstrapSession();
  }, []);
  useEffect(() => {
    if (session?.status === "approved" && accessToken) loadMovies();
    if (session?.role === "admin" && accessToken) loadRequests(accessToken);
  }, [session?.status, accessToken]);
  useEffect(() => {
    if (session?.status !== "approved" || !accessToken) return undefined;
    const timer = setTimeout(() => loadMovies(search), 300);
    return () => clearTimeout(timer);
  }, [search, session?.status, accessToken]);

  const genres = useMemo(
    () =>
      ["Todas", ...new Set(movies.flatMap((movie) => movie.genres || []))].sort(
        (a, b) =>
          a === "Todas" ? -1 : b === "Todas" ? 1 : a.localeCompare(b, "es"),
      ),
    [movies],
  );
  const visibleMovies = useMemo(
    () =>
      activeGenre === "Todas"
        ? movies
        : movies.filter((movie) => movie.genres?.includes(activeGenre)),
    [movies, activeGenre],
  );
  const totalSize = useMemo(
    () => movies.reduce((sum, movie) => sum + Number(movie.size_bytes), 0),
    [movies],
  );

  if (!session)
    return (
      <div className="access-screen">
        <div className="access-card">
          <span className="access-logo">C</span>
          <h1>Preparando tu sesión</h1>
          <p>Verificando identidad con Microsoft…</p>
          <div className="access-loader" />
        </div>
      </div>
    );
  if (session.status !== "approved")
    return (
      <div className="access-screen">
        <div className="access-card">
          <span className="access-logo">C</span>
          <small>SOLICITUD RECIBIDA</small>
          <h1>Acceso pendiente</h1>
          <p>
            {session.status === "error"
              ? session.error
              : `Hola ${session.name || session.email}. Tu solicitud llegó al administrador de CineOps. Podrás entrar cuando sea aprobada.`}
          </p>
          <button onClick={bootstrapSession}>Comprobar aprobación</button>
          <a href="/.auth/logout">Usar otra cuenta</a>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="logo" href="/">
          <span>C</span>
          <b>CINEOPS</b>
        </a>
        <nav className="side-nav">
          <p>MENÚ</p>
          <a className="active" href="#inicio">
            <Icon name="home" /> Inicio
          </a>
          <a href="#catalogo">
            <Icon name="compass" /> Explorar
          </a>
          <a href="#bibliotecas">
            <Icon name="library" /> Mi biblioteca
          </a>
          {session.role === "admin" && (
            <button
              className="maintenance-nav"
              onClick={() => {
                setMaintenanceOpen(true);
                loadRequests();
              }}
            >
              <Icon name="settings" /> Mantenimiento{" "}
              {requests.length > 0 && <b>{requests.length}</b>}
            </button>
          )}
        </nav>
        {session.role === "admin" && (
          <div className="approval-card">
            <span>{requests.length}</span>
            <div>
              <strong>Solicitudes</strong>
              <small>pendientes de aprobación</small>
            </div>
          </div>
        )}
        <div className="storage-card">
          <span className="storage-icon">
            <Icon name="library" />
          </span>
          <div>
            <strong>{formatSize(totalSize)}</strong>
            <small>Biblioteca indexada</small>
          </div>
        </div>
        <a className="side-logout" href="/.auth/logout">
          <Icon name="logout" /> Cerrar sesión
        </a>
      </aside>

      <div className="content">
        <header className="topbar">
          <a className="mobile-logo logo" href="/">
            <span>C</span>
            <b>CINEOPS</b>
          </a>
          <label className="global-search">
            <Icon name="search" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar en tu colección"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            {session.role === "admin" && (
              <button
                className="top-maintenance"
                onClick={() => {
                  setMaintenanceOpen(true);
                  loadRequests();
                }}
              >
                <Icon name="settings" />
                {requests.length > 0 && <b>{requests.length}</b>}
              </button>
            )}
            <div className="profile-menu">
              <button
                className="profile"
                onClick={() => setProfileOpen((open) => !open)}
                aria-expanded={profileOpen}
              >
                <span>
                  {(session.name || session.email).slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{session.name || session.email}</strong>
                  <small>
                    {session.role === "admin" ? "Administrador" : "Usuario"}
                  </small>
                </div>
                <span
                  className={`profile-chevron ${profileOpen ? "open" : ""}`}
                >
                  ⌄
                </span>
              </button>
              {profileOpen && (
                <div className="profile-dropdown">
                  <div>
                    <strong>{session.name || session.email}</strong>
                    <span>{session.email}</span>
                  </div>
                  <a href="/.auth/logout">
                    <Icon name="logout" /> Cerrar sesión
                  </a>
                </div>
              )}
            </div>
          </div>
        </header>

        <main>
          <section className="hero" id="inicio">
            <div className="hero-background">
              <MovieArtwork movie={featured} large token={accessToken} />
            </div>
            <div className="hero-shade" />
            <div className="hero-content">
              <span className="featured-label">
                <i /> DESTACADA DE TU COLECCIÓN
              </span>
              <h1>{featured?.title || "Tu cine, a tu manera"}</h1>
              <p>
                {featured?.overview ||
                  "Disponible en tu biblioteca privada. Reproduce en cualquier dispositivo autorizado y continúa donde lo dejaste."}
              </p>
              <div className="hero-meta">
                <span>{featured?.year || "TU COLECCIÓN"}</span>
                <i />{" "}
                <span>{featured?.extension?.toUpperCase() || "VIDEO"}</span>
                <i />{" "}
                <span>
                  {featured?.rating
                    ? `★ ${featured.rating.toFixed(1)}`
                    : formatSize(featured?.size_bytes)}
                </span>
              </div>
              <div className="hero-actions">
                <button
                  className="primary"
                  onClick={() => featured && setSelected(featured)}
                >
                  <Icon name="play" /> Reproducir
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    document
                      .querySelector("#catalogo")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  <Icon name="info" /> Ver catálogo
                </button>
              </div>
            </div>
            <div className="hero-count">
              <strong>{movies.length}</strong>
              <span>TÍTULOS</span>
            </div>
          </section>

          <section className="catalog" id="catalogo">
            <div className="section-heading">
              <div>
                <span className="overline">TU COLECCIÓN</span>
                <h2>Películas y videos</h2>
              </div>
              <span className={`connection ${status}`}>
                <i />
                {status === "ready"
                  ? "Biblioteca conectada"
                  : status === "loading"
                    ? "Sincronizando…"
                    : "Biblioteca no disponible"}
              </span>
            </div>

            <div className="filter-row" id="bibliotecas">
              <div className="filters">
                {genres.map((genre) => (
                  <button
                    key={genre}
                    className={genre === activeGenre ? "active" : ""}
                    onClick={() => setActiveGenre(genre)}
                  >
                    {genre}
                  </button>
                ))}
              </div>
              <span className="view-button">
                <Icon name="grid" />
              </span>
            </div>

            {status === "loading" && (
              <div className="movie-grid">
                {Array.from({ length: 10 }, (_, i) => (
                  <div className="skeleton" key={i} />
                ))}
              </div>
            )}
            {status === "offline" && (
              <div className="empty-state">
                <span>◌</span>
                <h3>Tu servidor está descansando</h3>
                <p>
                  Enciende Docker Desktop y comprueba que CineOps API esté
                  disponible.
                </p>
                <button onClick={() => loadMovies(search)}>
                  Reintentar conexión
                </button>
              </div>
            )}
            {status === "ready" && (
              <div className="movie-grid">
                {visibleMovies.map((movie) => (
                  <article
                    className="movie-card"
                    key={movie.id}
                    onClick={() => setSelected(movie)}
                  >
                    <MovieArtwork movie={movie} token={accessToken} />
                    <button
                      className="card-play"
                      aria-label={`Reproducir ${movie.title}`}
                    >
                      <Icon name="play" />
                    </button>
                    <div className="movie-copy">
                      <h3>{movie.title}</h3>
                      <p>
                        <span>
                          {movie.year || movie.extension.toUpperCase()}
                        </span>{" "}
                        {movie.rating ? `★ ${movie.rating.toFixed(1)} · ` : ""}
                        {movie.genres?.slice(0, 2).join(" · ") || "Sin género"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {maintenanceOpen && session.role === "admin" && (
        <div className="maintenance-modal" role="dialog" aria-modal="true">
          <div className="maintenance-shell">
            <header>
              <div>
                <span className="overline">CINEOPS ADMIN</span>
                <h2>Mantenimiento</h2>
                <p>
                  Administra solicitudes, usuarios, permisos y la biblioteca
                  Azure.
                </p>
              </div>
              <button
                className="modal-close"
                onClick={() => setMaintenanceOpen(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            {!libraryAvailability.local && (
              <div className="admin-warning">
                <strong>Servidor local desconectado</strong>
                <span>
                  Azure sigue disponible. Revisa Docker, Jellyfin o Tailscale.
                </span>
              </div>
            )}
            <div className="admin-stats">
              <div>
                <strong>{requests.length}</strong>
                <span>Solicitudes pendientes</span>
              </div>
              <div>
                <strong>
                  {users.filter((user) => user.status === "approved").length}
                </strong>
                <span>Usuarios activos</span>
              </div>
              <div>
                <strong>
                  {users.filter((user) => user.status === "blocked").length}
                </strong>
                <span>Usuarios bloqueados</span>
              </div>
            </div>
            <section>
              <div className="cloud-heading">
                <div>
                  <h3>Biblioteca Azure</h3>
                  <p>
                    {formatSize(cloudLibrary.used_bytes)} de{" "}
                    {formatSize(cloudLibrary.limit_bytes)} usados
                  </p>
                </div>
                <label className="cloud-upload">
                  Subir película
                  <input
                    type="file"
                    accept="video/*,.mkv,.m2ts"
                    onChange={uploadCloudMovie}
                    disabled={uploadProgress > 0 && uploadProgress < 100}
                  />
                </label>
              </div>
              <div className="cloud-meter">
                <i
                  style={{
                    width: `${Math.min(100, (cloudLibrary.used_bytes / cloudLibrary.limit_bytes) * 100)}%`,
                  }}
                />
              </div>
              {cloudMessage && (
                <p className="cloud-message">
                  {cloudMessage}
                  {uploadProgress > 0 && uploadProgress < 100
                    ? ` ${uploadProgress}%`
                    : ""}
                </p>
              )}
              {cloudLibrary.items.length === 0 ? (
                <p className="admin-empty">
                  Todavía no hay películas en Azure.
                </p>
              ) : (
                cloudLibrary.items.map((movie) => (
                  <article className="admin-row" key={movie.id}>
                    <div className="admin-avatar">
                      <Icon name="play" />
                    </div>
                    <div className="admin-identity">
                      <strong>{movie.title}</strong>
                      <span>{formatSize(movie.size_bytes)} · Azure Hot</span>
                    </div>
                    <div className="admin-actions">
                      <button
                        className="delete"
                        onClick={() => deleteCloudMovie(movie)}
                      >
                        Eliminar
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>
            <section>
              <h3>Solicitudes pendientes</h3>
              {requests.length === 0 ? (
                <p className="admin-empty">No hay solicitudes pendientes.</p>
              ) : (
                requests.map((request) => (
                  <article className="admin-row" key={request.email}>
                    <div className="admin-avatar">
                      {request.display_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="admin-identity">
                      <strong>{request.display_name}</strong>
                      <span>{request.email} · Microsoft</span>
                    </div>
                    <div className="admin-actions">
                      <button
                        className="approve"
                        onClick={() => approve(request.email)}
                      >
                        Aprobar
                      </button>
                      <button onClick={() => reject(request.email)}>
                        Rechazar
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>
            <section>
              <h3>Inventario de usuarios</h3>
              {users.map((user) => (
                <article className="admin-row" key={user.email}>
                  <div className="admin-avatar">
                    {user.display_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="admin-identity">
                    <strong>
                      {user.display_name} <em>{user.role}</em>
                    </strong>
                    <span>{user.email}</span>
                  </div>
                  <span className={`user-status ${user.status}`}>
                    {user.status === "approved" ? "Activo" : "Bloqueado"}
                  </span>
                  {user.role !== "admin" && (
                    <div className="admin-actions">
                      <button
                        onClick={() =>
                          setUserStatus(
                            user.email,
                            user.status === "approved" ? "blocked" : "approved",
                          )
                        }
                      >
                        {user.status === "approved" ? "Bloquear" : "Reactivar"}
                      </button>
                      <button
                        className="delete"
                        onClick={() => deleteUser(user.email)}
                      >
                        Eliminar
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </section>
          </div>
        </div>
      )}

      {selected && (
        <div className="player-modal" role="dialog" aria-modal="true">
          <div className="player-card">
            <button className="modal-close" onClick={() => setSelected(null)}>
              <Icon name="close" />
            </button>
            <video
              controls
              autoPlay
              src={`${API_URL}/api/movies/${selected.id}/stream?access_token=${encodeURIComponent(accessToken)}`}
            />
            <div className="player-info">
              <div>
                <span>REPRODUCIENDO AHORA</span>
                <h2>{selected.title}</h2>
                <p>{selected.overview}</p>
              </div>
              <div className="player-links">
                <p>
                  {selected.genres?.join(" · ") || "Sin género"} ·{" "}
                  {formatSize(selected.size_bytes)}
                </p>
                {session.role === "admin" && selected.jellyfin_url && (
                  <a
                    href={selected.jellyfin_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir diagnóstico en Jellyfin
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
