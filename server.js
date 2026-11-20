/* =============================================================================
   Cuisine · Recetario en la nube
   -----------------------------------------------------------------------------
   Servidor con Node.js + Express + EJS.
   Base de datos:
     - Con la variable DATABASE_URL: PostgreSQL (Render o un PostgreSQL local).
     - Sin DATABASE_URL: SQLite en el archivo recetas.db (para probar rápido).
   La tabla "recetas" se crea sola al iniciar y, si está vacía, se llena con
   13 recetas de ejemplo.
   ============================================================================= */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const express = require('express');
const multer = require('multer');

const PUERTO = Number(process.env.PORT) || 3000;
// Cambia en cada despliegue para que el navegador pida el CSS y el JS nuevos
const VERSION = String(process.env.RENDER_GIT_COMMIT || process.env.RAILWAY_DEPLOYMENT_ID || Date.now().toString(36)).slice(0, 12);
const MAX_FOTO = 5 * 1024 * 1024; // 5 MB (el navegador la achica antes de subirla)
const MAX_ID = 2147483647; // el id más alto que cabe en una columna INTEGER de PostgreSQL

/* -----------------------------------------------------------------------------
   1. Catálogos del recetario
   ----------------------------------------------------------------------------- */
const TIPOS = [
  'Desayuno', 'Entrada', 'Botana', 'Antojito', 'Ensalada', 'Caldos y sopas',
  'Platillo fuerte', 'Guarnición', 'Salsas y aderezos', 'Postre', 'Bebida', 'Panadería',
];
const DIFICULTADES = ['Fácil', 'Media', 'Difícil'];
const ETIQUETAS = ['Vegetariana', 'Vegana', 'Sin gluten', 'Sin lácteos', 'Picante'];
const COCINAS = ['Mexicana', 'Italiana', 'Española', 'Peruana', 'Francesa', 'Japonesa', 'Estadounidense', 'Internacional'];

/* -----------------------------------------------------------------------------
   2. Utilidades
   ----------------------------------------------------------------------------- */
const quitarAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizar = (s) => quitarAcentos(s).toLowerCase().replace(/\s+/g, ' ').trim();
const slugDe = (s) => normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'receta';
const claveTipo = (t) => slugDe(t);
const lineas = (txt) => String(txt ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const esSubtitulo = (l) => /:$/.test(l) && l.length <= 60;
const etiquetasDe = (txt) => String(txt ?? '').split(',').map((e) => e.trim()).filter(Boolean);
const totalMin = (r) => (Number(r.tiempo_preparacion) || 0) + (Number(r.tiempo_coccion) || 0);
const numero = (id) => String(id).padStart(2, '0');
const urlReceta = (r) => `/recetas/${r.id}-${r.slug || slugDe(r.nombre)}`;
const primero = (v) => String([].concat(v ?? '')[0] ?? '');

function entero(valor, min, max) {
  const texto = String(valor ?? '').trim();
  if (!/^\d+$/.test(texto)) return null;
  const n = Number.parseInt(texto, 10);
  return n >= min && n <= max ? n : null;
}

function tiempoTexto(min) {
  const m = Number(min) || 0;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

function duracionISO(min) {
  const m = Number(min) || 0;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return `PT${h ? `${h}H` : ''}${resto || !h ? `${resto}M` : ''}`;
}

function fechaLarga(fecha = new Date()) {
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' }).format(fecha);
}

// El plato-reloj marca el tiempo como un reloj de cocina de 60 minutos
const LARGO_ARCO = 2 * Math.PI * 180;
function relojDe(min) {
  const m = Number(min) || 0;
  return {
    offset: (LARGO_ARCO * (1 - Math.min(m, 60) / 60)).toFixed(2),
    angulo: ((m / 60) * 360) % 360,
    minutero: (60 - Math.min(m, 60)).toFixed(2), // para los relojes chicos (pathLength = 60)
  };
}

// JSON seguro para meterlo dentro de <script type="application/json">
const jsonParaScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

// Texto en el que busca el recetario (sin acentos ni mayúsculas)
const textoBusqueda = (r) => normalizar([r.nombre, r.descripcion, r.tipo, r.cocina, r.etiquetas, r.ingredientes].join(' '));

// Videos: YouTube, Vimeo o un archivo .mp4/.webm
function videoDe(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) id = m[1];
    }
  }
  if (id && /^[\w-]{11}$/.test(id)) {
    return {
      tipo: 'youtube', id, sitio: 'YouTube',
      ver: `https://www.youtube.com/watch?v=${id}`,
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      portada: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(\d{6,12})/);
    if (m) return { tipo: 'vimeo', id: m[1], sitio: 'Vimeo', ver: `https://vimeo.com/${m[1]}`, embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, portada: null };
  }
  if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { tipo: 'archivo', sitio: 'video', ver: u.href, embed: u.href, portada: null };
  return null;
}

// Fotos: guardadas en la base de datos, enlace de Unsplash (se pide al tamaño justo) u otro enlace
const esUnsplash = (url) => /^https:\/\/images\.unsplash\.com\//.test(url || '');
const sello = (r) => new Date(r.actualizada_en || 0).getTime().toString(36);
function fotoDe(r, ancho = 800, alto = 600) {
  if (Number(r.tiene_imagen)) return `/recetas/${r.id}/imagen?v=${sello(r)}`;
  if (r.imagen_url) {
    return esUnsplash(r.imagen_url)
      ? `${r.imagen_url.split('?')[0]}?w=${ancho}&h=${alto}&fit=crop&q=72&auto=format`
      : r.imagen_url;
  }
  return '/img/sin-foto.svg';
}
function srcsetDe(r, proporcion = 0.75) {
  if (Number(r.tiene_imagen) || !esUnsplash(r.imagen_url)) return '';
  return [480, 800, 1200].map((w) => `${fotoDe(r, w, Math.round(w * proporcion))} ${w}w`).join(', ');
}
const tieneFoto = (r) => Boolean(Number(r.tiene_imagen) || r.imagen_url);

// Íconos de línea con el mismo grosor fino del logo
const svg = (contenido) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${contenido}</svg>`;
const ICONOS = {
  buscar: svg('<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5 5"/>'),
  flecha: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  mas: svg('<path d="M12 5v14M5 12h14"/>'),
  menu: svg('<path d="M4 8h16M4 16h16"/>'),
  cerrar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  editar: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>'),
  eliminar: svg('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
  personas: svg('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="9.5" r="2.2"/><path d="M16 14.6c2.3.1 3.9 1.4 4.5 3.9"/>'),
  play: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
  compartir: svg('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>'),
  imprimir: svg('<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8" rx="2"/><path d="M7 13.5h10v7H7z"/>'),
  foto: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8.5 8"/>'),
  video: svg('<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3z"/>'),
  girar: svg('<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.5V9h-4.5"/>'),
  arriba: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
};

/* -----------------------------------------------------------------------------
   3. Base de datos: PostgreSQL o SQLite, con la misma forma de usarse
   ----------------------------------------------------------------------------- */
const COLUMNAS = `id, slug, nombre, descripcion, tipo, cocina, dificultad, tiempo_preparacion, tiempo_coccion,
  porciones, ingredientes, pasos, etiquetas, consejo, autor, imagen_url, video_url, destacada, es_ejemplo,
  creada_en, actualizada_en, CASE WHEN imagen_datos IS NULL THEN 0 ELSE 1 END AS tiene_imagen`;

const esquema = (pg) => `CREATE TABLE IF NOT EXISTS recetas (
  id ${pg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
  slug TEXT NOT NULL DEFAULT '',
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'Platillo fuerte',
  cocina TEXT NOT NULL DEFAULT '',
  dificultad TEXT NOT NULL DEFAULT 'Fácil',
  tiempo_preparacion INTEGER NOT NULL DEFAULT 0,
  tiempo_coccion INTEGER NOT NULL DEFAULT 0,
  porciones INTEGER NOT NULL DEFAULT 4,
  ingredientes TEXT NOT NULL DEFAULT '',
  pasos TEXT NOT NULL DEFAULT '',
  etiquetas TEXT NOT NULL DEFAULT '',
  consejo TEXT NOT NULL DEFAULT '',
  autor TEXT NOT NULL DEFAULT '',
  imagen_url TEXT NOT NULL DEFAULT '',
  imagen_datos ${pg ? 'BYTEA' : 'BLOB'},
  imagen_tipo TEXT,
  video_url TEXT NOT NULL DEFAULT '',
  destacada INTEGER NOT NULL DEFAULT 0,
  es_ejemplo INTEGER NOT NULL DEFAULT 0,
  creada_en TEXT NOT NULL,
  actualizada_en TEXT NOT NULL
)`;

// Fallas de conexión que se arreglan solas al reintentar: la base se está despertando (en algunos
// planes gratis se duerme cuando nadie la usa), se reinició o la red privada todavía no está lista.
const CODIGOS_DE_CONEXION = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006',
]);
const esFallaDeConexion = (e) => Boolean(e) && (CODIGOS_DE_CONEXION.has(e.code)
  || /Connection terminated|timeout exceeded when trying to connect|connection error/i.test(String(e.message)));
const esperar = (ms) => new Promise((listo) => { setTimeout(listo, ms); });
const ESPERA_CONSULTA = 20000; // milisegundos que una consulta espera a que la base responda

// Repite la operación mientras la falla sea de conexión y no se pase la hora límite
async function conReintentos(operacion, hasta, alFallar) {
  for (let intento = 1; ; intento += 1) {
    try {
      return await operacion();
    } catch (e) {
      if (!esFallaDeConexion(e) || Date.now() >= hasta) throw e;
      if (alFallar) alFallar(e, intento);
      await esperar(Math.min(500 * 2 ** (intento - 1), 5000));
    }
  }
}

function adaptadorPg(pool) {
  // Las consultas se escriben con "?" y aquí se convierten a $1, $2...
  const convertir = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const consulta = (sql, p = []) => {
    const texto = convertir(sql);
    const hasta = Date.now() + ESPERA_CONSULTA;
    const unaVez = async () => {
      const cliente = await conReintentos(() => pool.connect(), hasta); // conectar siempre se puede repetir
      let falla = null;
      try {
        return await cliente.query(texto, p);
      } catch (e) {
        falla = e;
        throw e;
      } finally {
        cliente.release(falla && esFallaDeConexion(falla) ? falla : undefined); // una conexión rota no vuelve al grupo
      }
    };
    // Un INSERT no se repite si la conexión se cortó a medio camino: así no se duplica una receta
    return /^\s*insert/i.test(sql) ? unaVez() : conReintentos(unaVez, hasta);
  };
  return {
    tipo: 'PostgreSQL',
    esPg: true,
    all: async (sql, p) => (await consulta(sql, p)).rows,
    get: async (sql, p) => (await consulta(sql, p)).rows[0],
    run: async (sql, p) => ({ cambios: (await consulta(sql, p)).rowCount }),
    cerrar: () => pool.end(),
  };
}

function adaptadorSqlite3(sqlite3, archivo) {
  const db = new sqlite3.Database(archivo);
  db.configure('busyTimeout', 5000);
  const all = (sql, p = []) => new Promise((ok, mal) => db.all(sql, p, (e, filas) => (e ? mal(e) : ok(filas))));
  return {
    tipo: 'SQLite (sqlite3)',
    esPg: false,
    all,
    get: async (sql, p = []) => (await all(sql, p))[0],
    run: (sql, p = []) => new Promise((ok, mal) => db.run(sql, p, function alTerminar(e) { if (e) mal(e); else ok({ cambios: this.changes }); })),
    cerrar: () => new Promise((ok) => db.close(() => ok())),
  };
}

// Respaldo: si el paquete sqlite3 no se pudo instalar, se usa el SQLite que ya trae Node (22.5 o más)
function adaptadorNodeSqlite(archivo) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(archivo);
  const fila = (f) => {
    if (!f) return f;
    const copia = { ...f };
    for (const k of Object.keys(copia)) if (copia[k] instanceof Uint8Array && !Buffer.isBuffer(copia[k])) copia[k] = Buffer.from(copia[k]);
    return copia;
  };
  return {
    tipo: 'SQLite (node:sqlite)',
    esPg: false,
    all: async (sql, p = []) => db.prepare(sql).all(...p).map(fila),
    get: async (sql, p = []) => fila(db.prepare(sql).get(...p)),
    run: async (sql, p = []) => ({ cambios: Number(db.prepare(sql).run(...p).changes) }),
    cerrar: async () => db.close(),
  };
}

async function conectarBase() {
  const url = String(process.env.DATABASE_URL || '').trim();
  if (url) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?\//i.test(url);
    const sinSsl = local || /sslmode=disable/i.test(url) || String(process.env.DATABASE_SSL).toLowerCase() === 'false';
    // El SSL se decide aquí; se quita sslmode de la URL para que no se contradigan
    const limpia = url.replace(/([?&])sslmode=[^&]*(&|$)/i, '$1').replace(/[?&]$/, '');
    const crear = (conSsl) => {
      const pool = new Pool({
        connectionString: limpia,
        ssl: conSsl ? { rejectUnauthorized: false } : false,
        max: 5,
        connectionTimeoutMillis: 10000, // si la base no contesta, no se queda esperando para siempre
        idleTimeoutMillis: 10000,
        keepAlive: true,
      });
      // Si la base se reinicia o se duerme, una conexión inactiva se corta: se anota y el sitio sigue en pie
      pool.on('error', (e) => console.warn('[cuisine] PostgreSQL cerró una conexión inactiva:', e.message));
      return pool;
    };
    let conSsl = !sinSsl;
    const hasta = Date.now() + 90000; // al arrancar espera hasta 90 s a que la base esté lista
    for (;;) {
      const pool = crear(conSsl);
      try {
        await conReintentos(() => pool.query('SELECT 1'), hasta, (e, n) => {
          console.warn(`[cuisine] La base de datos todavía no responde (${e.code || e.message}). Reintento ${n}…`);
        });
        return adaptadorPg(pool);
      } catch (e) {
        await pool.end().catch(() => {});
        if (!conSsl || !/ssl/i.test(String(e.message))) throw e;
        conSsl = false; // el servidor no acepta SSL (por ejemplo, en una red privada): se conecta sin SSL
      }
    }
  }
  const archivo = path.resolve(__dirname, process.env.SQLITE_ARCHIVO || 'recetas.db');
  try {
    return adaptadorSqlite3(require('sqlite3'), archivo);
  } catch (e) {
    console.warn('[cuisine] No se pudo cargar el paquete sqlite3; uso el SQLite que ya trae Node.');
    return adaptadorNodeSqlite(archivo);
  }
}

let db; // se asigna al arrancar

const listarRecetas = () => db.all(`SELECT ${COLUMNAS} FROM recetas ORDER BY creada_en DESC, id DESC`);
const buscarReceta = (id) => db.get(`SELECT ${COLUMNAS} FROM recetas WHERE id = ?`, [id]);

async function crearReceta(d, foto, extra = {}) {
  const ahora = extra.fecha || new Date().toISOString();
  const fila = await db.get(
    `INSERT INTO recetas (slug, nombre, descripcion, tipo, cocina, dificultad, tiempo_preparacion, tiempo_coccion,
      porciones, ingredientes, pasos, etiquetas, consejo, autor, imagen_url, imagen_datos, imagen_tipo, video_url,
      destacada, es_ejemplo, creada_en, actualizada_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [
      slugDe(d.nombre), d.nombre, d.descripcion, d.tipo, d.cocina, d.dificultad, d.tiempo_preparacion, d.tiempo_coccion,
      d.porciones, d.ingredientes, d.pasos, d.etiquetas, d.consejo, d.autor, foto ? '' : d.imagen_url,
      foto ? foto.buffer : null, foto ? foto.mimetype : null, d.video_url, d.destacada ? 1 : 0, extra.ejemplo ? 1 : 0,
      ahora, ahora,
    ],
  );
  return Number(fila.id);
}

async function actualizarReceta(actual, d, foto) {
  const ahora = new Date().toISOString();
  const campos = [
    ['slug', slugDe(d.nombre)], ['nombre', d.nombre], ['descripcion', d.descripcion], ['tipo', d.tipo],
    ['cocina', d.cocina], ['dificultad', d.dificultad], ['tiempo_preparacion', d.tiempo_preparacion],
    ['tiempo_coccion', d.tiempo_coccion], ['porciones', d.porciones], ['ingredientes', d.ingredientes],
    ['pasos', d.pasos], ['etiquetas', d.etiquetas], ['consejo', d.consejo], ['autor', d.autor],
    ['video_url', d.video_url], ['destacada', d.destacada ? 1 : 0], ['actualizada_en', ahora],
  ];
  // Foto: una nueva gana; luego "quitar"; luego un enlace distinto; si no, se queda la actual
  if (foto) campos.push(['imagen_datos', foto.buffer], ['imagen_tipo', foto.mimetype], ['imagen_url', '']);
  else if (d.quitar_imagen) campos.push(['imagen_datos', null], ['imagen_tipo', null], ['imagen_url', '']);
  else if (d.imagen_url && d.imagen_url !== actual.imagen_url) campos.push(['imagen_datos', null], ['imagen_tipo', null], ['imagen_url', d.imagen_url]);
  await db.run(`UPDATE recetas SET ${campos.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [...campos.map(([, v]) => v), actual.id]);
}

const eliminarReceta = (id) => db.run('DELETE FROM recetas WHERE id = ?', [id]);

/* -----------------------------------------------------------------------------
   4. Formulario: leer y validar lo que llega
   ----------------------------------------------------------------------------- */
function leerFormulario(body = {}, problemaSubida = null) {
  const texto = (campo, max) => primero(body[campo]).trim().slice(0, max);
  const valores = {
    nombre: texto('nombre', 120),
    descripcion: texto('descripcion', 320),
    tipo: texto('tipo', 40),
    cocina: texto('cocina', 40),
    dificultad: texto('dificultad', 20) || 'Fácil',
    tiempo_preparacion: texto('tiempo_preparacion', 6),
    tiempo_coccion: texto('tiempo_coccion', 6),
    porciones: texto('porciones', 4),
    ingredientes: primero(body.ingredientes).trim().slice(0, 6000),
    pasos: primero(body.pasos).trim().slice(0, 12000),
    etiquetas: [].concat(body.etiquetas ?? []).map(String).filter((e) => ETIQUETAS.includes(e)),
    consejo: texto('consejo', 600),
    autor: texto('autor', 60),
    imagen_url: texto('imagen_url', 800),
    video_url: texto('video_url', 300),
    destacada: body.destacada ? 1 : 0,
    quitar_imagen: body.quitar_imagen ? 1 : 0,
  };
  const errores = {};
  if (valores.nombre.length < 2) errores.nombre = 'Escribe el nombre de la receta.';
  if (!TIPOS.includes(valores.tipo)) errores.tipo = 'Elige el tipo de platillo.';
  if (!DIFICULTADES.includes(valores.dificultad)) valores.dificultad = 'Fácil';
  const prep = entero(valores.tiempo_preparacion, 0, 1440);
  if (prep === null) errores.tiempo_preparacion = 'Escribe los minutos de preparación (de 0 a 1440).';
  const coccion = valores.tiempo_coccion === '' ? 0 : entero(valores.tiempo_coccion, 0, 1440);
  if (coccion === null) errores.tiempo_coccion = 'Los minutos de cocción van de 0 a 1440.';
  const porciones = entero(valores.porciones, 1, 100);
  if (porciones === null) errores.porciones = 'Indica para cuántas porciones rinde (de 1 a 100).';
  if (!lineas(valores.ingredientes).some((l) => !esSubtitulo(l))) errores.ingredientes = 'Agrega al menos un ingrediente, uno por renglón.';
  if (!lineas(valores.pasos).length) errores.pasos = 'Agrega al menos un paso, uno por renglón.';
  if (valores.imagen_url && !/^https?:\/\/\S+$/i.test(valores.imagen_url)) errores.imagen_url = 'El enlace de la foto debe empezar con http:// o https://.';
  if (valores.video_url && !videoDe(valores.video_url)) errores.video_url = 'Pega un enlace de YouTube, de Vimeo o de un video .mp4.';
  if (problemaSubida) {
    // Si el formulario llegó cortado, solo se avisa de eso: los campos que venían después no se marcan como vacíos
    if (problemaSubida.incompleto) Object.keys(errores).forEach((k) => { delete errores[k]; });
    errores[problemaSubida.campo] = problemaSubida.texto;
  }
  const datos = {
    ...valores,
    ingredientes: lineas(valores.ingredientes).join('\n'),
    pasos: lineas(valores.pasos).join('\n'),
    tiempo_preparacion: prep, tiempo_coccion: coccion, porciones,
    etiquetas: valores.etiquetas.join(', '),
  };
  return { valores, datos, errores, ok: Object.keys(errores).length === 0 };
}

const valoresDe = (r) => ({
  nombre: r.nombre, descripcion: r.descripcion, tipo: r.tipo, cocina: r.cocina, dificultad: r.dificultad,
  tiempo_preparacion: String(r.tiempo_preparacion), tiempo_coccion: String(r.tiempo_coccion), porciones: String(r.porciones),
  ingredientes: r.ingredientes, pasos: r.pasos, etiquetas: etiquetasDe(r.etiquetas), consejo: r.consejo, autor: r.autor,
  imagen_url: r.imagen_url, video_url: r.video_url, destacada: Number(r.destacada), quitar_imagen: 0,
});

// Subida de la foto: en memoria y de ahí a la base de datos (Render borra los archivos del servidor
// en cada despliegue y cada vez que el servicio se duerme)
const multerFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FOTO, files: 1, fields: 40, fieldSize: 64 * 1024 },
  fileFilter: (req, archivo, listo) => {
    const ok = /^image\/(jpeg|png|webp|gif|avif)$/.test(archivo.mimetype);
    if (!ok) req.fotoRechazada = true;
    listo(null, ok);
  },
}).single('imagen');

function subirFoto(req, res, siguiente) {
  multerFoto(req, res, (err) => {
    req.body = req.body || {};
    if (err && !(err instanceof multer.MulterError)) return siguiente(err);
    if (err) {
      // multer deja de leer el formulario en cuanto algo pasa del límite
      const avisos = {
        LIMIT_FILE_SIZE: ['imagen', 'La foto pesa más de 5 MB. Prueba con otra más ligera.'],
        LIMIT_FIELD_VALUE: [err.field || 'imagen', 'Este texto es demasiado largo.'],
      };
      const [campo, texto] = avisos[err.code] || ['imagen', 'No se pudo leer el formulario completo. Inténtalo de nuevo.'];
      req.problemaSubida = { campo, texto, incompleto: true };
    } else if (req.fotoRechazada) {
      req.problemaSubida = { campo: 'imagen', texto: 'La foto debe ser JPG, PNG, WebP, GIF o AVIF.' };
    }
    if (req.file && !req.file.size) req.file = undefined; // campo vacío
    return siguiente();
  });
}

/* -----------------------------------------------------------------------------
   5. Lo que necesita cada página
   ----------------------------------------------------------------------------- */
function filtrosDe(query) {
  const tipos = TIPOS.map(claveTipo);
  const tipo = primero(query.tipo);
  const tiempo = Number(primero(query.tiempo));
  const orden = primero(query.orden);
  return {
    q: primero(query.q).trim().slice(0, 80),
    tipo: tipos.includes(tipo) ? tipo : '',
    tiempo: [30, 60].includes(tiempo) ? tiempo : 0,
    orden: ['tiempo', 'az'].includes(orden) ? orden : 'recientes',
  };
}

function aplicarFiltros(recetas, f) {
  const palabras = normalizar(f.q).split(' ').filter(Boolean);
  const marcadas = recetas.map((r) => {
    const texto = textoBusqueda(r);
    const visible = palabras.every((p) => texto.includes(p))
      && (!f.tipo || claveTipo(r.tipo) === f.tipo)
      && (!f.tiempo || totalMin(r) <= f.tiempo);
    return { ...r, visible };
  });
  if (f.orden === 'tiempo') marcadas.sort((a, b) => totalMin(a) - totalMin(b) || a.nombre.localeCompare(b.nombre, 'es'));
  if (f.orden === 'az') marcadas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return marcadas;
}

function resumenDe(todas) {
  const porTipo = Object.fromEntries(TIPOS.map((t) => [claveTipo(t), 0]));
  for (const r of todas) if (claveTipo(r.tipo) in porTipo) porTipo[claveTipo(r.tipo)] += 1;
  return {
    porTipo,
    cifras: {
      total: todas.length,
      tipos: Object.values(porTipo).filter(Boolean).length,
      video: todas.filter((r) => videoDe(r.video_url)).length,
      rapidas: todas.filter((r) => totalMin(r) <= 30).length,
    },
  };
}

function elegirDestacada(todas) {
  const marcadas = todas.filter((r) => Number(r.destacada)).sort((a, b) => String(b.actualizada_en).localeCompare(String(a.actualizada_en)));
  return marcadas[0] || todas.find((r) => videoDe(r.video_url) && tieneFoto(r)) || todas[0] || null;
}

// Platos que sirve la portada: las recetas con foto más recientes (una nueva aparece primero)
function elegirPlatos(todas) {
  return todas.filter(tieneFoto).slice(0, 8).map((r) => ({
    id: r.id, n: numero(r.id), tipo: r.tipo, nombre: r.nombre, min: totalMin(r), dif: r.dificultad,
    url: urlReceta(r), foto: fotoDe(r, 900, 900), foto520: fotoDe(r, 520, 520), alt: `${r.nombre} servido en plato`,
  }));
}

function urlBase(req) {
  if (process.env.URL_PUBLICA) return process.env.URL_PUBLICA.replace(/\/+$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `${req.protocol}://${req.get('host')}`;
}
const absoluta = (req, ruta) => (/^https?:\/\//.test(ruta) ? ruta : `${urlBase(req)}${ruta}`);
const quiereJson = (req) => /application\/json/.test(req.get('accept') || '');

function avisoDe(query) {
  if (query.nueva) return { tipo: 'ok', texto: 'Listo: tu receta ya está en el recetario.' };
  if (query.eliminada) return { tipo: 'ok', texto: `«${primero(query.eliminada).slice(0, 80)}» se eliminó del recetario.` };
  if (query.restauradas) return { tipo: 'ok', texto: `Se cargaron ${Number(primero(query.restauradas)) || 0} recetas de ejemplo.` };
  if (query.guardada) return { tipo: 'ok', texto: 'Cambios guardados.' };
  return null;
}

async function datosInicio(req, extra = {}) {
  const todas = await listarRecetas();
  const filtros = filtrosDe(req.query);
  const recetas = aplicarFiltros(todas, filtros);
  const { porTipo, cifras } = resumenDe(todas);
  const base = urlBase(req);
  return {
    pagina: 'inicio',
    titulo: 'Cuisine | Recetas caseras paso a paso para cocinar hoy',
    descripcion: 'Busca recetas caseras por platillo, ingrediente o tiempo: chilaquiles, pozole, flan y más. Cocínalas paso a paso o comparte la tuya en Cuisine.',
    canonica: `${base}/`,
    ogImagen: `${base}/img/og-imagen.jpg`,
    recetas,
    total: todas.length,
    visibles: recetas.filter((r) => r.visible).length,
    filtros,
    porTipo,
    cifras,
    hoy: fechaLarga(),
    destacada: elegirDestacada(todas),
    platos: elegirPlatos(todas),
    aviso: avisoDe(req.query),
    agregarAbierto: primero(req.query.agregar) === '1',
    valores: { dificultad: 'Fácil', tipo: '', etiquetas: [] },
    errores: {},
    ...extra,
  };
}

const renderizar = (vista, datos) => new Promise((ok, mal) => app.render(vista, datos, (e, html) => (e ? mal(e) : ok(html))));

/* -----------------------------------------------------------------------------
   6. Aplicación y rutas
   ----------------------------------------------------------------------------- */
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

Object.assign(app.locals, {
  VERSION, TIPOS, DIFICULTADES, ETIQUETAS, COCINAS, LARGO_ARCO, ICONOS, MAX_FOTO,
  claveTipo, tiempoTexto, totalMin, numero, urlReceta, fotoDe, srcsetDe, tieneFoto, lineas, esSubtitulo,
  etiquetasDe, videoDe, relojDe, textoBusqueda, jsonParaScript, duracionISO, esUnsplash,
  pagina: '', noIndexar: false, ogTipo: 'website', aviso: null,
});

app.use((req, res, siguiente) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  siguiente();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
// GSAP y Lenis se sirven desde node_modules: versión exacta, sin depender de otro servidor
app.use('/vendor/gsap', express.static(path.join(__dirname, 'node_modules', 'gsap', 'dist'), { maxAge: '30d' }));
app.use('/vendor/lenis', express.static(path.join(__dirname, 'node_modules', 'lenis', 'dist'), { maxAge: '30d' }));

// Portada y recetario
app.get('/', async (req, res) => {
  res.render('index', await datosInicio(req));
});

// Agregar receta (desde la ventana; con o sin JavaScript)
app.post('/recetas', subirFoto, async (req, res) => {
  const { valores, datos, errores, ok } = leerFormulario(req.body, req.problemaSubida);
  if (!ok) {
    if (quiereJson(req)) return res.status(422).json({ ok: false, errores });
    return res.status(422).render('index', await datosInicio(req, { agregarAbierto: true, valores, errores }));
  }
  const id = await crearReceta(datos, req.file);
  const receta = await buscarReceta(id);
  if (quiereJson(req)) {
    const html = await renderizar('index', { ...app.locals, parte: 'tarjetas', soloTarjetas: [{ ...receta, visible: true }] });
    return res.status(201).json({ ok: true, id, nombre: receta.nombre, url: urlReceta(receta), html });
  }
  return res.redirect(303, `/?nueva=${id}#receta-${id}`);
});

// Volver a cargar las recetas de ejemplo que falten
app.post('/recetas/ejemplo', async (req, res) => {
  const n = await cargarEjemplos(true);
  if (quiereJson(req)) return res.json({ ok: true, cargadas: n });
  return res.redirect(303, `/?restauradas=${n}#recetario`);
});

// Foto guardada en la base de datos
app.get('/recetas/:id/imagen', async (req, res) => {
  const id = entero(req.params.id, 1, MAX_ID);
  const fila = id ? await db.get('SELECT imagen_datos, imagen_tipo FROM recetas WHERE id = ?', [id]) : null;
  if (!fila || !fila.imagen_datos) return res.status(404).end();
  res.set('Content-Type', fila.imagen_tipo || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res.send(Buffer.from(fila.imagen_datos));
});

// Editar
app.get('/recetas/:id/editar', async (req, res) => {
  const id = entero(req.params.id, 1, MAX_ID);
  const receta = id ? await buscarReceta(id) : null;
  if (!receta) return noEncontrada(req, res);
  return res.render('editar', datosEditar(req, receta, valoresDe(receta), {}));
});

app.post('/recetas/:id/editar', subirFoto, async (req, res) => {
  const id = entero(req.params.id, 1, MAX_ID);
  const receta = id ? await buscarReceta(id) : null;
  if (!receta) {
    if (quiereJson(req)) return res.status(404).json({ ok: false, mensaje: 'Esa receta ya no existe.' });
    return noEncontrada(req, res);
  }
  const { valores, datos, errores, ok } = leerFormulario(req.body, req.problemaSubida);
  if (!ok) {
    if (quiereJson(req)) return res.status(422).json({ ok: false, errores });
    return res.status(422).render('editar', datosEditar(req, receta, valores, errores));
  }
  await actualizarReceta(receta, datos, req.file);
  const guardada = await buscarReceta(id);
  if (quiereJson(req)) return res.json({ ok: true, id, url: urlReceta(guardada) });
  return res.redirect(303, `${urlReceta(guardada)}?guardada=1`);
});

// Eliminar
app.post('/recetas/:id/eliminar', express.urlencoded({ extended: false }), async (req, res) => {
  const id = entero(req.params.id, 1, MAX_ID);
  const receta = id ? await buscarReceta(id) : null;
  if (receta) await eliminarReceta(id);
  if (quiereJson(req)) return res.json({ ok: Boolean(receta), id, nombre: receta ? receta.nombre : '' });
  return res.redirect(303, `/?eliminada=${encodeURIComponent(receta ? receta.nombre : 'La receta')}#recetario`);
});

// Página de una receta: /recetas/7-flan-napolitano
app.get('/recetas/:clave', async (req, res) => {
  const id = entero((/^\d+/.exec(req.params.clave) || [''])[0], 1, MAX_ID);
  const receta = id ? await buscarReceta(id) : null;
  if (!receta) return noEncontrada(req, res);
  const canonica = urlReceta(receta);
  if (req.path !== canonica) {
    const consulta = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect(301, canonica + consulta);
  }
  const todas = await listarRecetas();
  const otras = todas.filter((r) => r.id !== receta.id);
  const relacionadas = [...otras.filter((r) => r.tipo === receta.tipo), ...otras.filter((r) => r.tipo !== receta.tipo)].slice(0, 3);
  const descripcion = (receta.descripcion || `Receta de ${receta.nombre}: ingredientes y preparación paso a paso.`).slice(0, 160);
  const titulo = `${receta.nombre}: receta paso a paso | Cuisine`;
  return res.render('receta', {
    pagina: 'receta',
    titulo: titulo.length <= 62 ? titulo : `${receta.nombre} | Cuisine`,
    descripcion,
    canonica: absoluta(req, canonica),
    ogImagen: absoluta(req, fotoDe(receta, 1200, 630)),
    ogTipo: 'article',
    receta: { ...receta, visible: true },
    relacionadas: relacionadas.map((r) => ({ ...r, visible: true })),
    video: videoDe(receta.video_url),
    confirmarEliminar: primero(req.query.eliminar) === '1',
    aviso: avisoDe(req.query),
    urlAbsoluta: absoluta(req, canonica),
    fotoAbsoluta: absoluta(req, fotoDe(receta, 1200, 900)),
  });
});

function datosEditar(req, receta, valores, errores) {
  return {
    pagina: 'editar',
    titulo: `Editar: ${receta.nombre} | Cuisine`,
    descripcion: `Edita la receta de ${receta.nombre} en Cuisine.`,
    canonica: absoluta(req, `/recetas/${receta.id}/editar`),
    ogImagen: absoluta(req, '/img/og-imagen.jpg'),
    noIndexar: true,
    receta,
    valores,
    errores,
    aviso: null,
  };
}

function noEncontrada(req, res) {
  return res.status(404).render('receta', {
    pagina: 'receta',
    titulo: 'Receta no encontrada | Cuisine',
    descripcion: 'Esta receta ya no está en el recetario de Cuisine.',
    canonica: absoluta(req, req.path),
    ogImagen: absoluta(req, '/img/og-imagen.jpg'),
    noIndexar: true,
    receta: null,
    relacionadas: [],
    aviso: null,
  });
}

// Salud (Render la usa para saber si el sitio está vivo: Health Check Path = /salud)
app.get('/salud', async (req, res) => {
  const fila = await db.get('SELECT COUNT(*) AS n FROM recetas');
  res.json({ ok: true, base: db.tipo, recetas: Number(fila.n) });
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /recetas/*/editar\nSitemap: ${urlBase(req)}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res) => {
  const base = urlBase(req);
  const recetas = await listarRecetas();
  const urls = [`  <url><loc>${base}/</loc></url>`,
    ...recetas.map((r) => `  <url><loc>${base}${urlReceta(r)}</loc><lastmod>${String(r.actualizada_en).slice(0, 10)}</lastmod></url>`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});

// Algunos navegadores piden /favicon.ico aunque la página indique otro ícono
app.get('/favicon.ico', (req, res) => res.redirect(301, '/img/favicon.png'));

app.use((req, res) => noEncontrada(req, res));

// Errores: mensaje claro sin mostrar detalles internos
app.use((err, req, res, siguiente) => {
  console.error('[cuisine] Error:', err);
  if (res.headersSent) return siguiente(err);
  if (quiereJson(req)) return res.status(500).json({ ok: false, mensaje: 'Algo falló en el servidor. Intenta de nuevo en un momento.' });
  return res.status(500).type('html').send(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Algo falló | Cuisine</title><link rel="stylesheet" href="/styles.css?v=${VERSION}"></head><body class="pagina-error"><main class="contenedor error-caja"><h1 class="h2">Algo falló en la cocina</h1><p>Intenta de nuevo en un momento.</p><p><a class="btn btn--linea" href="/">Volver al recetario</a></p></main></body></html>`);
});

/* -----------------------------------------------------------------------------
   7. Recetas de ejemplo (13). Fotos de Unsplash y tres videos de YouTube.
   ----------------------------------------------------------------------------- */
const UNSPLASH = (id) => `https://images.unsplash.com/${id}`;
const EJEMPLOS = [
  {
    nombre: 'Chilaquiles verdes',
    descripcion: 'Totopos crujientes bañados en salsa verde de tomatillo, con pollo deshebrado, crema, queso fresco y cebolla morada.',
    tipo: 'Desayuno', cocina: 'Mexicana', dificultad: 'Fácil', tiempo_preparacion: 15, tiempo_coccion: 20, porciones: 4,
    ingredientes: `Para la salsa:
500 g de tomate verde sin cáscara
2 chiles serranos
1/4 de cebolla blanca
1 diente de ajo
1/2 taza de cilantro fresco
1 taza de caldo de pollo
1 cucharada de aceite
Sal al gusto
Para servir:
400 g de totopos de maíz
2 tazas de pollo cocido y deshebrado
1/2 taza de crema
100 g de queso fresco desmoronado
1/4 de cebolla morada en rodajas finas`,
    pasos: `Hierve los tomates verdes, los chiles, la cebolla y el ajo en agua durante 10 minutos, hasta que los tomates cambien a verde oscuro.
Licúa todo con el cilantro y el caldo de pollo hasta obtener una salsa tersa.
Calienta el aceite en una cacerola amplia, vierte la salsa y cocínala 5 minutos a fuego medio. Sazona con sal.
Agrega los totopos y muévelos con cuidado para que se cubran de salsa sin romperse.
Sirve de inmediato con el pollo, la crema, el queso y la cebolla morada encima.`,
    etiquetas: 'Picante',
    consejo: 'Si te gustan crujientes, sirve la salsa en el plato y pon los totopos encima justo antes de comer.',
    imagen_url: UNSPLASH('photo-1780283210587-29e03acf30d9'),
    video_url: 'https://www.youtube.com/watch?v=wp5wIZtmlfw',
  },
  {
    nombre: 'Guacamole en molcajete',
    descripcion: 'Aguacate machacado en molcajete con chile serrano, cebolla, jitomate y limón. Se acompaña con totopos.',
    tipo: 'Botana', cocina: 'Mexicana', dificultad: 'Fácil', tiempo_preparacion: 15, tiempo_coccion: 0, porciones: 4,
    ingredientes: `3 aguacates maduros
1 chile serrano
1/4 de cebolla blanca picada finamente
1 jitomate sin semillas, en cubos
2 cucharadas de cilantro picado
El jugo de 1 limón
Sal de grano al gusto
Totopos para acompañar`,
    pasos: `Muele en el molcajete el chile serrano con la cebolla y una pizca de sal hasta formar una pasta.
Agrega la pulpa de los aguacates y machácala con el tejolote, dejando algunos trozos.
Incorpora el jitomate, el cilantro y el jugo de limón. Prueba y ajusta la sal.
Sirve en el mismo molcajete con totopos alrededor.`,
    etiquetas: 'Vegetariana, Vegana, Sin gluten, Sin lácteos',
    consejo: 'Deja el hueso dentro del guacamole y cúbrelo con plástico pegado a la superficie: así tarda más en oscurecerse.',
    imagen_url: UNSPLASH('photo-1680992071073-cb1696ba8d3e'),
  },
  {
    nombre: 'Esquites con chile y limón',
    descripcion: 'Granos de elote cocidos con epazote y mantequilla, servidos en vaso con mayonesa, queso cotija, chile y limón.',
    tipo: 'Antojito', cocina: 'Mexicana', dificultad: 'Fácil', tiempo_preparacion: 10, tiempo_coccion: 20, porciones: 4,
    ingredientes: `4 tazas de granos de elote
2 cucharadas de mantequilla
1/4 de cebolla picada
1 chile serrano picado
2 ramas de epazote
1 taza de agua
Sal al gusto
Para servir:
4 cucharadas de mayonesa
80 g de queso cotija rallado
Chile en polvo al gusto
2 limones en cuartos`,
    pasos: `Derrite la mantequilla en una olla y sofríe la cebolla y el chile serrano durante 2 minutos.
Agrega los granos de elote, el epazote, el agua y sal. Tapa y cocina a fuego medio-bajo 15 minutos, hasta que el elote esté suave.
Sirve los esquites calientes en vasos, con un poco de su caldo.
Corona con mayonesa, queso cotija, chile en polvo y un chorrito de limón.`,
    etiquetas: 'Vegetariana, Sin gluten, Picante',
    consejo: 'Con elote blanco tierno el caldo queda más dulce y no hace falta agregar azúcar.',
    imagen_url: UNSPLASH('photo-1768716574889-e9af8e7f7ae8'),
  },
  {
    nombre: 'Ceviche de atún con mango',
    descripcion: 'Cubos de atún fresco con mango, pepino y cebolla morada, curados en limón y servidos sobre tostada.',
    tipo: 'Entrada', cocina: 'Mexicana', dificultad: 'Fácil', tiempo_preparacion: 25, tiempo_coccion: 0, porciones: 4,
    ingredientes: `400 g de atún fresco en cubos
1 mango maduro en cubos
1 pepino sin semillas, en cubos
1/4 de cebolla morada picada
1 chile serrano finamente picado
El jugo de 4 limones
2 cucharadas de jugo de naranja
2 cucharadas de cilantro picado
1 aguacate en cubos
Sal y pimienta al gusto
Tostadas para servir`,
    pasos: `Mezcla el atún con el jugo de limón y de naranja, la cebolla morada y el chile. Refrigera 15 minutos.
Agrega el mango, el pepino y el cilantro. Sazona con sal y pimienta.
Justo antes de servir, incorpora el aguacate con movimientos suaves.
Sirve frío sobre tostadas.`,
    etiquetas: 'Sin gluten, Sin lácteos, Picante',
    consejo: 'Compra el atún el mismo día y pide que sea apto para comerse crudo.',
    imagen_url: UNSPLASH('photo-1769830644804-0ede2ee32a62'),
  },
  {
    nombre: 'Ensalada César',
    descripcion: 'La clásica nacida en Tijuana: lechuga orejona, aderezo cremoso de anchoa y parmesano, y crotones dorados.',
    tipo: 'Ensalada', cocina: 'Mexicana', dificultad: 'Media', tiempo_preparacion: 20, tiempo_coccion: 10, porciones: 4,
    ingredientes: `2 lechugas orejonas lavadas y secas
2 tazas de pan en cubos
2 cucharadas de aceite de oliva
Para el aderezo:
1 yema de huevo
2 filetes de anchoa
1 diente de ajo
1 cucharadita de mostaza Dijon
1 cucharada de jugo de limón
1 cucharadita de salsa inglesa
1/2 taza de aceite de oliva
1/2 taza de queso parmesano rallado
Pimienta negra al gusto`,
    pasos: `Hornea los cubos de pan con el aceite de oliva a 180 °C durante 10 minutos, hasta que estén dorados.
Machaca las anchoas con el ajo. Agrega la yema, la mostaza, el limón y la salsa inglesa, y bate.
Incorpora el aceite en hilo sin dejar de batir hasta que el aderezo espese. Agrega la mitad del parmesano y pimienta.
Mezcla las hojas de lechuga con el aderezo, añade los crotones y termina con el resto del parmesano.`,
    etiquetas: '',
    consejo: 'Si prefieres no usar yema cruda, cámbiala por dos cucharadas de mayonesa.',
    imagen_url: UNSPLASH('photo-1746211108786-ca20c8f80ecd'),
  },
  {
    nombre: 'Pozole rojo',
    descripcion: 'Caldo de maíz cacahuazintle con carne de cerdo y chiles guajillo y ancho. Se sirve con lechuga, rábano, orégano y tostadas.',
    tipo: 'Caldos y sopas', cocina: 'Mexicana', dificultad: 'Media', tiempo_preparacion: 30, tiempo_coccion: 150, porciones: 8,
    ingredientes: `1 kg de maíz pozolero precocido, enjuagado
1 kg de carne de cerdo (maciza y espinazo)
1 cabeza de ajo
1 cebolla blanca
6 chiles guajillo sin semillas
2 chiles anchos sin semillas
2 dientes de ajo
1 cucharadita de comino
1 cucharada de aceite
Sal al gusto
Para servir:
Lechuga picada
Rábanos en rodajas
Cebolla picada
Orégano seco
Chile piquín
Limones
Tostadas`,
    pasos: `Cuece la carne en una olla grande con agua, la cabeza de ajo, media cebolla y sal durante 1 hora 30 minutos, retirando la espuma.
Mientras, hidrata los chiles en agua caliente 15 minutos y licúalos con los 2 dientes de ajo, la otra media cebolla, el comino y un poco del agua de remojo.
Cuela la salsa y fríela en el aceite durante 5 minutos.
Agrega a la olla el maíz y la salsa. Cocina 1 hora más a fuego bajo, hasta que el maíz se abra. Ajusta la sal.
Sirve bien caliente y que cada quien agregue lechuga, rábano, cebolla, orégano, chile y limón.`,
    etiquetas: 'Sin gluten, Sin lácteos',
    consejo: 'Sabe mejor de un día para otro. Guarda las guarniciones aparte para que no se marchiten.',
    imagen_url: UNSPLASH('photo-1730243338482-78d6ffd943df'),
    video_url: 'https://www.youtube.com/watch?v=00PQth78T2A',
    destacada: 1,
  },
  {
    nombre: 'Sopa de tortilla',
    descripcion: 'Caldo de jitomate y chile pasilla con tiras de tortilla doradas, aguacate, queso y crema.',
    tipo: 'Caldos y sopas', cocina: 'Mexicana', dificultad: 'Fácil', tiempo_preparacion: 15, tiempo_coccion: 25, porciones: 4,
    ingredientes: `8 tortillas de maíz en tiras
4 jitomates
1/4 de cebolla
1 diente de ajo
2 chiles pasilla sin semillas
1 litro de caldo de pollo
1 rama de epazote
Aceite para freír
Sal al gusto
Para servir:
1 aguacate en cubos
100 g de queso panela en cubos
Crema al gusto`,
    pasos: `Fríe las tiras de tortilla en aceite caliente hasta que estén doradas y escúrrelas sobre papel absorbente.
Pasa los chiles pasilla unos segundos por el mismo aceite, sin quemarlos. Guarda uno para decorar.
Licúa los jitomates con la cebolla, el ajo y un chile pasilla.
Fríe la salsa en una olla 5 minutos, agrega el caldo y el epazote, y cocina 15 minutos. Sazona con sal.
Sirve el caldo sobre las tiras de tortilla y agrega aguacate, queso, crema y el chile reservado en trocitos.`,
    etiquetas: 'Sin gluten',
    consejo: 'Pon las tiras de tortilla en el plato justo antes de servir para que lleguen crujientes a la mesa.',
    imagen_url: UNSPLASH('photo-1730409261374-6f8a89051fd2'),
  },
  {
    nombre: 'Tacos al pastor en sartén',
    descripcion: 'Cerdo marinado en adobo de guajillo y achiote, dorado en sartén con piña. Necesita 2 horas de marinado antes.',
    tipo: 'Platillo fuerte', cocina: 'Mexicana', dificultad: 'Media', tiempo_preparacion: 20, tiempo_coccion: 20, porciones: 4,
    ingredientes: `800 g de bistec de cerdo delgado
1/2 piña en rebanadas
16 tortillas de maíz
Para el adobo:
4 chiles guajillo sin semillas, hidratados
50 g de pasta de achiote
1/2 taza de jugo de piña
2 cucharadas de vinagre blanco
2 dientes de ajo
1/2 cucharadita de comino
1/2 cucharadita de orégano
Sal al gusto
Para servir:
Cebolla picada
Cilantro picado
Salsa verde
Limones`,
    pasos: `Licúa los ingredientes del adobo hasta que quede espeso y terso.
Unta el adobo en los bisteces y déjalos marinar en el refrigerador al menos 2 horas.
Dora las rebanadas de piña en un sartén caliente, pícalas y resérvalas.
Cocina la carne en el mismo sartén a fuego alto, por tandas, 3 minutos por lado. Pícala finamente y regresa todo al sartén con la piña.
Calienta las tortillas y sirve la carne con cebolla, cilantro, salsa y limón.`,
    etiquetas: 'Sin gluten, Sin lácteos',
    consejo: 'No llenes el sartén: si la carne se encima suelta jugo y se cuece en lugar de dorarse.',
    imagen_url: UNSPLASH('photo-1660180750968-4fbc84789a96'),
  },
  {
    nombre: 'Enchiladas suizas',
    descripcion: 'Tortillas rellenas de pollo, bañadas en salsa verde cremosa y gratinadas con queso manchego.',
    tipo: 'Platillo fuerte', cocina: 'Mexicana', dificultad: 'Media', tiempo_preparacion: 25, tiempo_coccion: 25, porciones: 4,
    ingredientes: `12 tortillas de maíz
3 tazas de pollo cocido y deshebrado
250 g de queso manchego rallado
Aceite para suavizar las tortillas
Para la salsa:
500 g de tomate verde
2 chiles serranos
1/4 de cebolla
1 diente de ajo
1/2 taza de cilantro
1 taza de crema
Sal al gusto`,
    pasos: `Hierve los tomates verdes, los chiles, la cebolla y el ajo 10 minutos. Licúalos con el cilantro y la crema. Sazona con sal.
Precalienta el horno a 200 °C.
Pasa las tortillas por aceite caliente unos segundos para suavizarlas.
Rellena cada tortilla con pollo, enróllala y acomódala en un refractario.
Baña con la salsa, cubre con el queso y hornea 15 minutos, hasta que el queso se dore.`,
    etiquetas: 'Sin gluten',
    consejo: 'Si no tienes horno, gratínalas en un sartén tapado a fuego bajo hasta que el queso se derrita.',
    imagen_url: UNSPLASH('photo-1674135529596-cb1f707d231d'),
  },
  {
    nombre: 'Risotto de champiñones',
    descripcion: 'Arroz arborio cremoso, cocido poco a poco en caldo, con champiñones dorados, parmesano y perejil.',
    tipo: 'Platillo fuerte', cocina: 'Italiana', dificultad: 'Media', tiempo_preparacion: 10, tiempo_coccion: 30, porciones: 4,
    ingredientes: `1 1/2 tazas de arroz arborio
400 g de champiñones rebanados
1 litro de caldo de verduras caliente
1/2 cebolla picada finamente
2 dientes de ajo picados
1/2 taza de vino blanco
3 cucharadas de mantequilla
2 cucharadas de aceite de oliva
60 g de queso parmesano rallado
Perejil picado
Sal y pimienta al gusto`,
    pasos: `Dora los champiñones en el aceite de oliva a fuego alto, sazónalos y resérvalos.
En la misma olla, derrite 1 cucharada de mantequilla y acitrona la cebolla y el ajo.
Agrega el arroz y tuéstalo 2 minutos sin dejar de mover. Vierte el vino y deja que se evapore.
Añade el caldo caliente de cucharón en cucharón, moviendo y esperando a que se absorba antes de agregar más. Tarda unos 18 minutos.
Incorpora los champiñones, el resto de la mantequilla y el parmesano. Tapa 2 minutos, ajusta la sal y sirve con perejil.`,
    etiquetas: 'Vegetariana, Sin gluten',
    consejo: 'Está listo cuando el arroz está suave por fuera y apenas firme al centro; debe quedar fluido, no seco.',
    imagen_url: UNSPLASH('photo-1680420574628-225def8eea0a'),
  },
  {
    nombre: 'Arroz rojo',
    descripcion: 'Arroz frito y cocido en caldo de jitomate, suelto y esponjoso, con zanahoria y chícharos.',
    tipo: 'Guarnición', cocina: 'Mexicana', dificultad: 'Fácil', tiempo_preparacion: 10, tiempo_coccion: 25, porciones: 6,
    ingredientes: `1 1/2 tazas de arroz blanco
2 jitomates
1/4 de cebolla
1 diente de ajo
3 tazas de caldo de pollo caliente
1 zanahoria en cubos pequeños
1/2 taza de chícharos
1 chile serrano entero
3 cucharadas de aceite
Sal al gusto`,
    pasos: `Remoja el arroz en agua caliente 5 minutos, enjuágalo y escúrrelo muy bien.
Fríe el arroz en el aceite a fuego medio, moviendo, hasta que se vea dorado claro.
Licúa los jitomates con la cebolla y el ajo, cuela y agrega al arroz. Cocina hasta que se reseque.
Añade el caldo caliente, la zanahoria, los chícharos, el chile y sal. Cuando hierva, tapa y baja el fuego al mínimo 15 minutos.
Apaga y deja reposar tapado 5 minutos antes de esponjarlo con un tenedor.`,
    etiquetas: 'Sin gluten, Sin lácteos',
    consejo: 'No destapes ni muevas el arroz mientras se cuece: así queda suelto.',
    imagen_url: UNSPLASH('photo-1666190092689-e3968aa0c32c'),
  },
  {
    nombre: 'Flan napolitano',
    descripcion: 'Cremoso, con caramelo oscuro y un toque de vainilla. Se hornea a baño María y se sirve bien frío.',
    tipo: 'Postre', cocina: 'Mexicana', dificultad: 'Media', tiempo_preparacion: 20, tiempo_coccion: 60, porciones: 8,
    ingredientes: `1 taza de azúcar para el caramelo
1 lata de leche condensada (387 g)
1 lata de leche evaporada (360 ml)
190 g de queso crema
5 huevos
1 cucharadita de extracto de vainilla`,
    pasos: `Derrite el azúcar en un sartén a fuego medio, sin mover, hasta que tenga color ámbar. Viértelo en el molde y cubre el fondo.
Precalienta el horno a 180 °C.
Licúa las leches, el queso crema, los huevos y la vainilla hasta que no queden grumos. Vierte sobre el caramelo.
Tapa el molde con papel aluminio y hornea a baño María 1 hora, hasta que al centro esté firme pero tiemble un poco.
Deja enfriar y refrigera al menos 4 horas. Desmolda pasando un cuchillo por la orilla.`,
    etiquetas: 'Vegetariana, Sin gluten',
    consejo: 'Para desmoldarlo sin batallar, pon el molde unos segundos sobre agua caliente antes de voltearlo.',
    imagen_url: UNSPLASH('photo-1702728052103-69473aa7ed77'),
    video_url: 'https://www.youtube.com/watch?v=HhNiEkn_Bws',
  },
  {
    nombre: 'Agua de jamaica',
    descripcion: 'Infusión de flor de jamaica, fresca y ligeramente ácida, endulzada al gusto y servida con mucho hielo.',
    tipo: 'Bebida', cocina: 'Mexicana', dificultad: 'Fácil', tiempo_preparacion: 5, tiempo_coccion: 15, porciones: 8,
    ingredientes: `1 taza de flor de jamaica seca
2 litros de agua
1/2 taza de azúcar, o al gusto
1 raja de canela (opcional)
Hielo
Rodajas de limón para servir`,
    pasos: `Enjuaga la flor de jamaica para quitarle el polvo.
Hierve 1 litro de agua con la jamaica y la canela durante 10 minutos.
Cuela, aplastando las flores para sacar todo el color, y agrega el azúcar mientras está caliente.
Completa con el otro litro de agua fría y refrigera.
Sirve con hielo y una rodaja de limón.`,
    etiquetas: 'Vegetariana, Vegana, Sin gluten, Sin lácteos',
    consejo: 'Las flores ya cocidas se pueden guisar con cebolla y chile como relleno para tacos.',
    imagen_url: UNSPLASH('photo-1765118527329-6ed7fa0d10ac'),
  },
];

// Inserta las recetas de ejemplo. Con soloFaltantes, solo las que ya no están.
async function cargarEjemplos(soloFaltantes = false) {
  const existentes = soloFaltantes ? new Set((await db.all('SELECT slug FROM recetas')).map((f) => f.slug)) : new Set();
  const ahora = Date.now();
  let cargadas = 0;
  for (const [i, e] of EJEMPLOS.entries()) {
    if (existentes.has(slugDe(e.nombre))) continue;
    // La primera de la lista queda como la más reciente: así abre el recetario
    const fecha = new Date(ahora - i * 60 * 1000).toISOString();
    await crearReceta({ consejo: '', autor: '', video_url: '', destacada: 0, imagen_url: '', ...e }, null, { ejemplo: true, fecha });
    cargadas += 1;
  }
  return cargadas;
}

/* -----------------------------------------------------------------------------
   8. Arranque
   ----------------------------------------------------------------------------- */
async function iniciar() {
  db = await conectarBase();
  await db.run(esquema(db.esPg));
  const fila = await db.get('SELECT COUNT(*) AS n FROM recetas');
  if (Number(fila.n) === 0 && String(process.env.CARGAR_EJEMPLOS).toLowerCase() !== 'false') {
    const n = await cargarEjemplos(false);
    console.log(`[cuisine] Recetario vacío: cargué ${n} recetas de ejemplo.`);
  }
  if (!db.esPg && (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID)) {
    console.warn('[cuisine] AVISO: estás en la nube sin DATABASE_URL. SQLite se borra cada vez que el servidor se reinicia o se duerme. Agrega la variable DATABASE_URL con la URL de tu base PostgreSQL.');
  }
  const servidor = app.listen(PUERTO, () => {
    console.log(`[cuisine] Recetario listo en http://localhost:${PUERTO} · Base de datos: ${db.tipo}`);
  });
  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`[cuisine] El puerto ${PUERTO} ya lo usa otro programa. Ciérralo o arranca en otro puerto (por ejemplo PORT=3001).`);
      process.exit(1);
    }
    throw e;
  });
  const cerrar = () => {
    setTimeout(() => process.exit(0), 8000).unref(); // por si alguna conexión tarda en cerrarse
    servidor.close(async () => { await db.cerrar().catch(() => {}); process.exit(0); });
  };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

// Una promesa que falle sin que nadie la atienda no debe tumbar el sitio: se anota y el servidor sigue
process.on('unhandledRejection', (e) => console.error('[cuisine] Error sin atender:', e));

iniciar().catch((e) => {
  console.error('[cuisine] No pude arrancar el servidor:', e.message);
  if (process.env.DATABASE_URL) console.error('[cuisine] Revisa que DATABASE_URL sea correcta y que la base de datos esté encendida.');
  process.exit(1);
});
