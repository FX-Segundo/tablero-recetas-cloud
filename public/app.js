/* =============================================================================
   Cuisine · app.js
   Funciones del recetario (filtros, agregar, editar, eliminar) y el movimiento
   de la marca. Todo lo funcional sirve aunque no carguen las librerías o la
   persona pida menos movimiento; las animaciones son un extra.
   ============================================================================= */
(() => {
  'use strict';

  /* ---------- 1. Ayudantes, banderas y movimiento de la marca ---------- */
  const d = document;
  const html = d.documentElement;
  const $ = (s, c = d) => (c ? c.querySelector(s) : null);
  const $$ = (s, c = d) => (c ? [...c.querySelectorAll(s)] : []);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasGSAP = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';
  const safe = (fn) => { try { return fn(); } catch (e) { console.warn('[cuisine]', e); return undefined; } };
  // Cuisine se mueve cálida, precisa y elegante
  const M = { ease: 'power3.out', easeIO: 'power3.inOut', pop: 'back.out(1.35)', dur: 1.05, stagger: 0.085, dist: 26, lerp: 0.085 };
  const C_ARCO = 2 * Math.PI * 180;
  const MAX_FOTO = 5 * 1024 * 1024;

  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tiempoTexto = (min) => {
    const m = Number(min) || 0;
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  };
  const leerJSON = (id) => safe(() => JSON.parse(d.getElementById(id).textContent)) || [];
  const guardar = { leer: (k) => safe(() => JSON.parse(localStorage.getItem(k) || 'null')), poner: (k, v) => safe(() => localStorage.setItem(k, JSON.stringify(v))) };

  if (!hasGSAP) html.classList.remove('js');
  else {
    gsap.registerPlugin(ScrollTrigger);
    if (window.SplitText) gsap.registerPlugin(SplitText);
    if (window.Flip) gsap.registerPlugin(Flip);
    ScrollTrigger.config({ ignoreMobileResize: true });
  }
  const animar = hasGSAP && !RM;

  /* ---------- 2. Scroll suave con Lenis ---------- */
  let lenis = null;
  if (animar && window.Lenis && M.lerp) {
    lenis = new Lenis({ lerp: M.lerp, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const altoNav = () => ($('[data-nav]') ? $('[data-nav]').offsetHeight : 0);
  const irA = (el, inmediato) => {
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: -(altoNav() + 12), duration: inmediato ? 0 : 1.3, immediate: !!inmediato });
    else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - altoNav() - 12, behavior: RM || inmediato ? 'auto' : 'smooth' });
  };
  const pausarScroll = (si) => { if (lenis) { if (si) lenis.stop(); else lenis.start(); } };

  /* ---------- 3. Funciones que sirven siempre ---------- */

  // 3.1 Avisos
  const avisos = $('[data-avisos]');
  const cerrarAviso = (p) => {
    if (!p || !p.isConnected) return;
    if (animar) gsap.to(p, { autoAlpha: 0, y: 10, duration: 0.35, ease: 'power2.in', onComplete: () => p.remove() });
    else p.remove();
  };
  const avisar = (texto, opciones = {}) => {
    if (!avisos) return;
    const p = d.createElement('p');
    p.className = `aviso-toast aviso-toast--${opciones.tipo || 'ok'}`;
    p.setAttribute('role', opciones.tipo === 'error' ? 'alert' : 'status');
    const punto = d.createElement('span');
    punto.className = 'punto';
    punto.setAttribute('aria-hidden', 'true');
    const txt = d.createElement('span');
    txt.textContent = texto;
    p.append(punto, txt);
    if (opciones.enlace) {
      const a = d.createElement('a');
      a.href = opciones.enlace.href;
      a.textContent = opciones.enlace.texto;
      p.append(a);
    }
    avisos.append(p);
    if (animar) {
      gsap.fromTo(p, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: M.ease });
      gsap.fromTo(punto, { y: -18, scale: 0.4 }, { y: 0, scale: 1, duration: 0.7, ease: 'bounce.out', delay: 0.08 });
    }
    setTimeout(() => cerrarAviso(p), opciones.tipo === 'error' ? 7000 : 5200);
  };
  $$('.aviso-toast', avisos).forEach((p) => setTimeout(() => cerrarAviso(p), 5200));
  // Quita de la dirección los avisos de una sola vez (?nueva=, ?eliminada=...)
  safe(() => {
    const u = new URL(location.href);
    let cambio = false;
    ['nueva', 'eliminada', 'restauradas', 'guardada', 'agregar', 'eliminar'].forEach((k) => {
      if (u.searchParams.has(k) && !(k === 'eliminar' && $('#eliminar'))) { u.searchParams.delete(k); cambio = true; }
    });
    if (cambio) history.replaceState(null, '', u.pathname + u.search + u.hash);
  });

  // 3.2 Menú del celular
  const nav = $('[data-nav]');
  const botonMenu = $('[data-menu]');
  const panelMenu = $('#nav-panel');
  const cerrarMenu = () => {
    if (!botonMenu || !panelMenu) return;
    panelMenu.hidden = true;
    botonMenu.setAttribute('aria-expanded', 'false');
    botonMenu.setAttribute('aria-label', 'Abrir menú');
  };
  safe(() => {
    if (!botonMenu || !panelMenu) return;
    botonMenu.addEventListener('click', () => {
      const abierto = botonMenu.getAttribute('aria-expanded') === 'true';
      if (abierto) { cerrarMenu(); return; }
      panelMenu.hidden = false;
      botonMenu.setAttribute('aria-expanded', 'true');
      botonMenu.setAttribute('aria-label', 'Cerrar menú');
      if (animar) gsap.fromTo($$('a', panelMenu), { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.05, ease: M.ease });
    });
    $$('a', panelMenu).forEach((a) => a.addEventListener('click', cerrarMenu));
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenu(); });
  });

  // El menú se esconde al bajar y vuelve al subir
  safe(() => {
    if (!nav) return;
    let ultimo = window.scrollY;
    const revisar = (y) => {
      const abierto = panelMenu && !panelMenu.hidden;
      if (y > ultimo + 6 && y > 420 && !abierto) nav.classList.add('nav--oculto');
      else if (y < ultimo - 6 || y < 120) nav.classList.remove('nav--oculto');
      ultimo = y;
    };
    if (lenis) lenis.on('scroll', (l) => revisar(l.scroll));
    else window.addEventListener('scroll', () => revisar(window.scrollY), { passive: true });
    nav.addEventListener('focusin', () => nav.classList.remove('nav--oculto'));
  });

  // Marca en el menú la sección que se está viendo
  safe(() => {
    const enlaces = $$('[data-espia]');
    if (!enlaces.length || !('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (!en.isIntersecting) return;
        enlaces.forEach((a) => a.setAttribute('aria-current', String(a.dataset.espia === en.target.id)));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    enlaces.forEach((a) => { const s = d.getElementById(a.dataset.espia); if (s && $('[data-portada]')) obs.observe(s); });
    if ($('[data-portada]')) obs.observe($('[data-portada]')); // en la portada no se marca ninguna
  });

  // 3.3 Recetario: buscar, filtrar y ordenar al instante
  const grid = $('[data-grid]');
  const formFiltros = $('[data-filtros]');
  const inputQ = $('[data-q]', formFiltros);
  const selTiempo = $('[data-filtro-tiempo]', formFiltros);
  const selOrden = $('[data-filtro-orden]', formFiltros);
  const tarjetas = () => $$('[data-receta]', grid);
  let revelarPendientes = null; // se define en la parte de movimiento

  const ponerCifra = (k, v) => $$(`[data-cifra="${k}"]`).forEach((n) => { n.textContent = v; });
  const actualizarConteo = () => {
    if (!grid) return;
    const lista = tarjetas();
    const visibles = lista.filter((t) => !t.hidden).length;
    const porTipo = {};
    lista.forEach((t) => { porTipo[t.dataset.tipo] = (porTipo[t.dataset.tipo] || 0) + 1; });
    $$('[data-visibles]').forEach((n) => { n.textContent = visibles; });
    $$('[data-total]').forEach((n) => { n.textContent = lista.length; });
    $$('[data-total-palabra]').forEach((n) => { n.textContent = lista.length === 1 ? 'receta' : 'recetas'; });
    $$('[data-n-total]').forEach((n) => { n.textContent = lista.length; });
    $$('[data-chip-tipo]').forEach((c) => {
      const n = porTipo[c.dataset.chipTipo] || 0;
      $('[data-n]', c).textContent = n;
      c.hidden = n === 0 && !$('input', c).checked;
    });
    const vf = $('[data-vacio-filtros]');
    const vt = $('[data-vacio-total]');
    if (vf) vf.hidden = !(lista.length > 0 && visibles === 0);
    if (vt) vt.hidden = lista.length !== 0;
    ponerCifra('total', lista.length);
    ponerCifra('tipos', Object.keys(porTipo).length);
    ponerCifra('rapidas', lista.filter((t) => Number(t.dataset.tiempo) <= 30).length);
    ponerCifra('video', lista.filter((t) => t.dataset.video === '1').length);
  };

  const estadoFiltros = () => ({
    q: inputQ ? inputQ.value : '',
    tipo: (formFiltros && formFiltros.querySelector('input[name="tipo"]:checked') || {}).value || '',
    tiempo: selTiempo ? Number(selTiempo.value) || 0 : 0,
    orden: selOrden ? selOrden.value || 'recientes' : 'recientes',
  });

  const ordenarTarjetas = (lista, orden) => {
    const c = [...lista];
    const az = (a, b) => a.dataset.az.localeCompare(b.dataset.az, 'es');
    if (orden === 'tiempo') c.sort((a, b) => Number(a.dataset.tiempo) - Number(b.dataset.tiempo) || az(a, b));
    else if (orden === 'az') c.sort(az);
    else c.sort((a, b) => b.dataset.creada.localeCompare(a.dataset.creada) || Number(b.dataset.id) - Number(a.dataset.id));
    return c;
  };

  const actualizarUrl = (f) => safe(() => {
    const u = new URL(location.href);
    ['q', 'tipo', 'tiempo', 'orden'].forEach((k) => u.searchParams.delete(k));
    if (f.q.trim()) u.searchParams.set('q', f.q.trim());
    if (f.tipo) u.searchParams.set('tipo', f.tipo);
    if (f.tiempo) u.searchParams.set('tiempo', f.tiempo);
    if (f.orden !== 'recientes') u.searchParams.set('orden', f.orden);
    history.replaceState(null, '', u.pathname + u.search + (u.hash || '#recetario'));
  });

  const filtrar = (opciones = {}) => {
    if (!grid) return;
    const f = estadoFiltros();
    const palabras = normalizar(f.q).split(' ').filter(Boolean);
    const lista = tarjetas();
    const usarFlip = opciones.animado !== false && animar && window.Flip;
    if (revelarPendientes) revelarPendientes();
    const antes = usarFlip ? Flip.getState(lista) : null;
    ordenarTarjetas(lista, f.orden).forEach((t) => {
      t.hidden = !(palabras.every((p) => t.dataset.busqueda.includes(p))
        && (!f.tipo || t.dataset.tipo === f.tipo)
        && (!f.tiempo || Number(t.dataset.tiempo) <= f.tiempo));
      grid.append(t);
    });
    actualizarConteo();
    if (antes) {
      Flip.from(antes, {
        duration: 0.6, ease: M.easeIO, absolute: true, prune: true,
        onEnter: (els) => gsap.fromTo(els, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: M.ease }),
        onLeave: (els) => gsap.to(els, { autoAlpha: 0, scale: 0.94, duration: 0.3, ease: 'power2.in' }),
        onComplete: () => ScrollTrigger.refresh(),
      });
    } else if (hasGSAP) ScrollTrigger.refresh();
    if (opciones.url !== false) actualizarUrl(f);
  };

  const limpiarFiltros = () => {
    if (!formFiltros) return;
    if (inputQ) inputQ.value = '';
    const todas = formFiltros.querySelector('input[name="tipo"][value=""]');
    if (todas) todas.checked = true;
    if (selTiempo) selTiempo.value = '';
    if (selOrden) selOrden.value = 'recientes';
  };

  safe(() => {
    if (!grid || !formFiltros) return;
    let espera;
    inputQ.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => filtrar(), 180); });
    formFiltros.addEventListener('change', (e) => { if (e.target !== inputQ) filtrar(); });
    formFiltros.addEventListener('submit', (e) => { e.preventDefault(); filtrar(); if (matchMedia('(max-width: 759px)').matches) inputQ.blur(); });
    $$('[data-quitar-filtros]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); limpiarFiltros(); filtrar(); irA($('#recetario')); }));
    // Buscador de la portada: lleva la búsqueda al recetario
    const formPortada = $('[data-buscador-portada]');
    if (formPortada) {
      formPortada.addEventListener('submit', (e) => {
        e.preventDefault();
        inputQ.value = $('input', formPortada).value;
        filtrar();
        irA($('#recetario'));
      });
    }
    // Atajos de la portada
    $$('[data-atajo-tipo], [data-atajo-tiempo]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      limpiarFiltros();
      if (a.dataset.atajoTipo) { const r = formFiltros.querySelector(`input[name="tipo"][value="${a.dataset.atajoTipo}"]`); if (r) r.checked = true; }
      if (a.dataset.atajoTiempo) selTiempo.value = a.dataset.atajoTiempo;
      filtrar();
      irA($('#recetario'));
    }));
    actualizarConteo();
  });

  // 3.4 Anclas suaves, "Buscar receta" y "Volver arriba"
  const enInicio = Boolean($('[data-portada]'));
  const enfocarBusqueda = () => setTimeout(() => { if (inputQ) inputQ.focus({ preventScroll: true }); }, lenis ? 900 : 450);
  d.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.hasAttribute('data-arriba')) {
      e.preventDefault();
      if (lenis) lenis.scrollTo(0, { duration: 1.4 }); else window.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' });
      return;
    }
    const href = a.getAttribute('href') || '';
    const hash = href.startsWith('#') ? href : (enInicio && href.startsWith('/#') ? href.slice(1) : '');
    if (!hash || hash === '#') return;
    const destino = d.getElementById(hash.slice(1));
    if (!destino) return;
    e.preventDefault();
    cerrarMenu();
    irA(destino);
    safe(() => history.replaceState(null, '', location.pathname + location.search + hash));
    if (a.hasAttribute('data-ir-buscar')) enfocarBusqueda();
  });

  // 3.5 "Otra idea": el plato de la portada sirve otra receta
  const platos = leerJSON('datos-platos');
  const platoPortada = $('[data-plato]');
  let iPlato = 0;
  let cambiandoPlato = false;
  const pintarFicha = (p) => {
    const img = $('[data-plato-img]', platoPortada);
    img.removeAttribute('srcset');
    img.src = p.foto;
    img.alt = p.alt;
    $('[data-ficha-num]', platoPortada).textContent = `Nº ${p.n} · ${p.tipo}`;
    const nombre = $('[data-ficha-nombre]', platoPortada);
    nombre.textContent = p.nombre;
    nombre.href = p.url;
    $('[data-ficha-meta]', platoPortada).textContent = `${tiempoTexto(p.min)} · ${p.dif}`;
    $('[data-ficha-enlace]', platoPortada).href = p.url;
  };
  const arcoDe = (min) => C_ARCO * (1 - Math.min(min, 60) / 60);
  const anguloDe = (min) => (min / 60) * 360;
  const relojQuieto = (caja, min) => {
    const arco = $('[data-arco]', caja);
    const aguja = $('[data-aguja]', caja);
    if (arco) arco.style.strokeDashoffset = arcoDe(min);
    if (!aguja) return;
    if (animar) gsap.set(aguja, { rotation: anguloDe(min) % 360, svgOrigin: '200 200' });
    else aguja.setAttribute('transform', `rotate(${anguloDe(min) % 360} 200 200)`);
  };
  safe(() => {
    if (!platoPortada || platos.length < 2) return;
    platos.slice(1).forEach((p) => { const im = new Image(); im.src = p.foto; });
    $('[data-otra-idea]', platoPortada).addEventListener('click', () => {
      if (cambiandoPlato) return;
      iPlato = (iPlato + 1) % platos.length;
      const p = platos[iPlato];
      if (!animar) { pintarFicha(p); relojQuieto(platoPortada, p.min); return; }
      cambiandoPlato = true;
      const foto = $('.plato__foto', platoPortada);
      const ficha = $('[data-ficha]', platoPortada);
      const arco = $('[data-arco]', platoPortada);
      const aguja = $('[data-aguja]', platoPortada);
      gsap.timeline({ defaults: { ease: M.ease }, onComplete: () => { cambiandoPlato = false; } })
        .to(foto, { rotation: 34, scale: 0.9, autoAlpha: 0, duration: 0.42, ease: 'power2.in' }, 0)
        .to(ficha, { autoAlpha: 0, y: -8, duration: 0.3, ease: 'power2.in' }, 0)
        .to(arco, { strokeDashoffset: C_ARCO, duration: 0.42, ease: 'power2.in' }, 0)
        .to(aguja, { rotation: 0, duration: 0.42, ease: 'power2.in' }, 0)
        .add(() => pintarFicha(p), 0.43)
        .fromTo(foto, { rotation: -34, scale: 0.9, autoAlpha: 0 }, { rotation: 0, scale: 1, autoAlpha: 1, duration: 0.95 }, 0.46)
        .add(barrerReloj(arco, aguja, p.min, false), 0.5)
        .fromTo(ficha, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.6 }, 0.7);
    });
  });

  // El reloj del plato barre hasta los minutos de la receta
  function barrerReloj(arco, aguja, min, desdeCero = true) {
    const vueltas = anguloDe(min);
    const dur = gsap.utils.clamp(1, 2, 0.95 + (vueltas / 360) * 0.32);
    const tl = gsap.timeline();
    if (desdeCero) tl.set(aguja, { rotation: 0 }, 0).set(arco, { strokeDashoffset: C_ARCO }, 0);
    tl.to(aguja, { rotation: vueltas, duration: dur, ease: 'power2.inOut' }, 0)
      .to(arco, { strokeDashoffset: arcoDe(min), duration: Math.min(dur, 1.15), ease: 'power2.inOut' }, 0)
      .add(() => gsap.set(aguja, { rotation: vueltas % 360 }));
    return tl;
  }

  // 3.6 Formulario de receta (ventana "Agregar receta" y página de editar)
  function videoDe(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/); if (m) id = m[1]; }
    }
    if (id && /^[\w-]{11}$/.test(id)) return { tipo: 'youtube', portada: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, texto: 'Video de YouTube listo' };
    if ((host === 'vimeo.com' || host === 'player.vimeo.com') && /\d{6,12}/.test(u.pathname)) return { tipo: 'vimeo', portada: null, texto: 'Video de Vimeo listo' };
    if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) return { tipo: 'archivo', portada: null, texto: 'Video listo' };
    return null;
  }

  const REGLAS = {
    nombre: (v) => v.trim().length >= 2 || 'Escribe el nombre de la receta.',
    tipo: (v) => Boolean(v) || 'Elige el tipo de platillo.',
    tiempo_preparacion: (v) => (/^\d+$/.test(v.trim()) && Number(v) <= 1440) || 'Escribe los minutos de preparación (de 0 a 1440).',
    tiempo_coccion: (v) => v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v) <= 1440) || 'Los minutos de cocción van de 0 a 1440.',
    porciones: (v) => (/^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 100) || 'Indica para cuántas porciones rinde (de 1 a 100).',
    ingredientes: (v) => v.split('\n').some((l) => l.trim() && !/:$/.test(l.trim())) || 'Agrega al menos un ingrediente, uno por renglón.',
    pasos: (v) => v.split('\n').some((l) => l.trim()) || 'Agrega al menos un paso, uno por renglón.',
    imagen_url: (v) => !v.trim() || /^https?:\/\/\S+$/i.test(v.trim()) || 'El enlace de la foto debe empezar con http:// o https://.',
    video_url: (v) => !v.trim() || Boolean(videoDe(v.trim())) || 'Pega un enlace de YouTube, de Vimeo o de un video .mp4.',
  };

  // Achica la foto en el navegador (máximo 1600 px, WebP) para que suba rápido y quepa en la base de datos
  const achicarFoto = (archivo) => new Promise((listo) => {
    if (!/^image\/(jpeg|png|webp|avif)$/.test(archivo.type)) { listo(null); return; }
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = d.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => {
        if (b && b.type === 'image/webp') listo(b);
        else c.toBlob((j) => listo(j), 'image/jpeg', 0.84);
      }, 'image/webp', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); listo(null); };
    img.src = url;
  });

  function iniciarFormulario(form) {
    form.noValidate = true;
    const modo = form.dataset.modo;
    const resumen = $('[data-resumen-errores]', form);
    const boton = $('[data-enviar]', form);
    const textoBoton = $('[data-enviar-texto]', form);
    const textoOriginal = textoBoton ? textoBoton.textContent : '';
    let fotoLista = null; // la foto ya achicada
    let fotoPromesa = null; // mientras se achica

    const mostrarError = (nombre, mensaje) => {
      const p = $(`[data-error="${nombre}"]`, form);
      const campo = form.elements[nombre];
      const caja = p ? p.closest('.campo') : null;
      if (p) p.textContent = mensaje || '';
      if (caja) caja.classList.toggle('campo--error', Boolean(mensaje));
      if (campo && campo.setAttribute) { if (mensaje) campo.setAttribute('aria-invalid', 'true'); else campo.removeAttribute('aria-invalid'); }
    };
    const limpiarErrores = () => { $$('[data-error]', form).forEach((p) => mostrarError(p.dataset.error, '')); if (resumen) resumen.hidden = true; };
    const mostrarErrores = (errores) => {
      Object.entries(errores).forEach(([k, m]) => mostrarError(k, m));
      if (resumen) resumen.hidden = false;
      const primero = Object.keys(errores).map((k) => form.elements[k]).find(Boolean);
      const destino = primero && primero.focus ? primero : resumen;
      if (destino) {
        destino.focus({ preventScroll: true });
        (destino.closest('.campo') || destino).scrollIntoView({ block: 'center', behavior: RM ? 'auto' : 'smooth' });
      }
    };
    const validar = () => {
      const errores = {};
      Object.entries(REGLAS).forEach(([k, regla]) => {
        const campo = form.elements[k];
        if (!campo || campo.disabled) return;
        const r = regla(String(campo.value || ''));
        if (r !== true) errores[k] = r;
      });
      const f = $('[data-foto-input]', form);
      if (f && f.files[0] && !fotoLista && f.files[0].size > MAX_FOTO) errores.imagen = 'La foto pesa más de 5 MB y no se pudo achicar. Prueba con otra.';
      return errores;
    };

    // Quita el error de un campo en cuanto se corrige
    form.addEventListener('input', (e) => {
      const n = e.target.name;
      if (!n || !REGLAS[n]) return;
      if (REGLAS[n](String(e.target.value || '')) === true) mostrarError(n, '');
    });

    // Contador de la descripción
    $$('[data-contador]', form).forEach((t) => {
      const cuenta = $('[data-cuenta]', t.closest('.campo'));
      t.addEventListener('input', () => { if (cuenta) cuenta.textContent = t.value.length; });
    });

    // Tiempo total con su minirreloj
    const totalTexto = $('[data-total-texto]', form);
    const totalArco = $('[data-total-arco]', form);
    const pintarTotal = () => {
      const minutos = $$('[data-tiempo-campo]', form).reduce((s, i) => s + (/^\d+$/.test(i.value.trim()) ? Number(i.value) : 0), 0);
      const hay = $$('[data-tiempo-campo]', form).some((i) => i.value.trim() !== '');
      if (totalTexto) totalTexto.textContent = hay ? tiempoTexto(minutos) : 'escribe los minutos';
      if (totalArco) totalArco.setAttribute('stroke-dashoffset', String(60 - Math.min(minutos, 60)));
    };
    $$('[data-tiempo-campo]', form).forEach((i) => i.addEventListener('input', pintarTotal));
    pintarTotal();

    // Foto: vista previa, arrastrar y soltar, y achicar
    const inputFoto = $('[data-foto-input]', form);
    const vista = $('[data-foto-vista]', form);
    const nombreFoto = $('[data-foto-nombre]', form);
    const textoFotoOriginal = nombreFoto ? nombreFoto.textContent : '';
    const soltar = $('[data-soltar]', form);
    const ponerVista = (archivo) => {
      if (!vista) return;
      vista.textContent = '';
      if (!archivo) { vista.hidden = true; if (nombreFoto) nombreFoto.textContent = textoFotoOriginal; return; }
      const img = d.createElement('img');
      img.alt = '';
      img.src = URL.createObjectURL(archivo);
      img.onload = () => URL.revokeObjectURL(img.src);
      vista.append(img);
      vista.hidden = false;
      if (nombreFoto) nombreFoto.textContent = archivo.name || 'Foto lista';
    };
    if (inputFoto) {
      inputFoto.addEventListener('change', async () => {
        const archivo = inputFoto.files[0];
        fotoLista = null;
        mostrarError('imagen', '');
        if (!archivo) { ponerVista(null); return; }
        if (!/^image\//.test(archivo.type)) { mostrarError('imagen', 'Elige una imagen JPG, PNG o WebP.'); inputFoto.value = ''; ponerVista(null); return; }
        ponerVista(archivo);
        fotoPromesa = achicarFoto(archivo);
        const chica = await fotoPromesa;
        fotoPromesa = null;
        if (inputFoto.files[0] !== archivo) return; // ya eligió otra
        if (chica && chica.size < archivo.size) fotoLista = chica;
        if (!fotoLista && archivo.size > MAX_FOTO) mostrarError('imagen', 'La foto pesa más de 5 MB. Prueba con otra más ligera.');
      });
      if (soltar) {
        ['dragenter', 'dragover'].forEach((ev) => soltar.addEventListener(ev, (e) => { e.preventDefault(); soltar.classList.add('arrastrando'); }));
        ['dragleave', 'drop'].forEach((ev) => soltar.addEventListener(ev, () => soltar.classList.remove('arrastrando')));
        soltar.addEventListener('drop', (e) => {
          e.preventDefault();
          const archivo = e.dataTransfer && e.dataTransfer.files[0];
          if (!archivo) return;
          safe(() => { const dt = new DataTransfer(); dt.items.add(archivo); inputFoto.files = dt.files; });
          inputFoto.dispatchEvent(new Event('change'));
        });
      }
    }

    // Video: confirma el enlace y muestra su portada
    const inputVideo = $('[data-video-input]', form);
    const previa = $('[data-video-previa]', form);
    const pintarVideo = () => {
      if (!inputVideo || !previa) return;
      const v = inputVideo.value.trim() ? videoDe(inputVideo.value.trim()) : null;
      previa.hidden = !v;
      if (!v) return;
      $('[data-video-texto]', previa).textContent = v.texto;
      const portada = $('[data-video-portada]', previa);
      portada.style.backgroundImage = v.portada ? `url("${v.portada}")` : '';
      portada.hidden = !v.portada;
    };
    if (inputVideo) { inputVideo.addEventListener('input', pintarVideo); inputVideo.addEventListener('blur', () => { if (inputVideo.value.trim() && !videoDe(inputVideo.value.trim())) mostrarError('video_url', REGLAS.video_url(inputVideo.value)); }); pintarVideo(); }

    // Enviar
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiarErrores();
      if (fotoPromesa) await fotoPromesa.catch(() => null);
      const errores = validar();
      if (Object.keys(errores).length) { mostrarErrores(errores); return; }
      const datos = new FormData(form);
      if (fotoLista) datos.set('imagen', fotoLista, fotoLista.type === 'image/webp' ? 'foto.webp' : 'foto.jpg');
      else if (inputFoto && !inputFoto.files[0]) datos.delete('imagen');
      if (boton) { boton.disabled = true; boton.setAttribute('aria-busy', 'true'); }
      if (textoBoton) textoBoton.textContent = 'Guardando…';
      try {
        const r = await fetch(form.action, { method: 'POST', body: datos, headers: { Accept: 'application/json' } });
        const j = await r.json().catch(() => ({}));
        if (r.status === 422 && j.errores) { mostrarErrores(j.errores); return; }
        if (!r.ok || !j.ok) { avisar(j.mensaje || 'No se pudo guardar. Inténtalo de nuevo en un momento.', { tipo: 'error' }); return; }
        if (modo === 'editar') { location.href = `${j.url}?guardada=1`; return; }
        alAgregar(j, form);
        form.reset();
        fotoLista = null;
        ponerVista(null);
        pintarTotal();
        pintarVideo();
        $$('[data-cuenta]', form).forEach((c) => { c.textContent = '0'; });
      } catch (err) {
        avisar('No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.', { tipo: 'error' });
      } finally {
        if (boton) { boton.disabled = false; boton.removeAttribute('aria-busy'); }
        if (textoBoton) textoBoton.textContent = textoOriginal;
      }
    });
  }
  $$('[data-formulario-receta]').forEach((f) => safe(() => iniciarFormulario(f)));

  // 3.7 Ventana "Agregar receta"
  const ventana = $('[data-ventana-agregar]');
  const abrirAgregar = () => {
    if (!ventana) { location.href = '/?agregar=1#agregar'; return; }
    cerrarMenu();
    if (ventana.open && !ventana.matches(':modal')) ventana.close();
    if (!ventana.open) ventana.showModal();
    html.classList.add('ventana-abierta');
    pausarScroll(true);
    const marco = $('.ventana__marco', ventana);
    if (marco) marco.scrollTop = 0;
    if (animar) {
      gsap.fromTo(marco, { autoAlpha: 0, y: 34, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, ease: M.ease });
      gsap.fromTo($$('.ventana__cab .punto', ventana), { y: -16, scale: 0.4 }, { y: 0, scale: 1, duration: 0.7, ease: 'bounce.out', delay: 0.15 });
    }
    setTimeout(() => { const n = ventana.querySelector('input[name="nombre"]'); if (n) n.focus({ preventScroll: true }); }, 80);
  };
  const cerrarVentana = (v) => {
    if (!v || !v.open) return;
    const caja = $('.ventana__marco, .ventana__caja', v);
    if (animar && caja) gsap.to(caja, { autoAlpha: 0, y: 24, duration: 0.3, ease: 'power2.in', onComplete: () => { v.close(); gsap.set(caja, { clearProps: 'all' }); } });
    else v.close();
  };
  safe(() => {
    $$('[data-abrir-agregar]').forEach((a) => a.addEventListener('click', (e) => {
      if (!ventana) return;
      e.preventDefault();
      abrirAgregar();
    }));
    if (!ventana) return;
    $$('[data-cerrar]', ventana).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); cerrarVentana(ventana); }));
    ventana.addEventListener('close', () => { html.classList.remove('ventana-abierta'); pausarScroll(false); });
    // El servidor la dejó abierta (llegó con ?agregar=1 o con errores): ábrela como ventana
    if (ventana.hasAttribute('open')) { ventana.close(); abrirAgregar(); }
  });

  // Cuando se agrega una receta: la tarjeta aparece en el recetario
  function alAgregar(respuesta, form) {
    if (form.closest('dialog')) cerrarVentana(form.closest('dialog'));
    if (!grid) { location.href = `/?nueva=${respuesta.id}#receta-${respuesta.id}`; return; }
    const tmp = d.createElement('div');
    tmp.innerHTML = respuesta.html.trim();
    const card = tmp.firstElementChild;
    limpiarFiltros();
    grid.prepend(card);
    filtrar({ animado: false });
    medirTarjetas([card]);
    card.classList.add('receta--nueva');
    setTimeout(() => card.classList.remove('receta--nueva'), 4200);
    setTimeout(() => {
      irA(card);
      if (animar) emplatar([card]);
    }, 360);
    avisar(`«${respuesta.nombre}» ya está en el recetario.`, { enlace: { href: respuesta.url, texto: 'Ver receta' } });
  }

  // 3.8 Eliminar con confirmación
  const ventanaEliminar = $('[data-ventana-eliminar]');
  let porEliminar = null;
  safe(() => {
    if (!ventanaEliminar) return;
    d.addEventListener('click', (e) => {
      const a = e.target.closest('[data-eliminar]');
      if (!a) return;
      e.preventDefault();
      porEliminar = { id: a.dataset.eliminar, nombre: a.dataset.nombre || 'esta receta', volver: a.dataset.volver || '', card: a.closest('[data-receta]') };
      $('[data-eliminar-nombre]', ventanaEliminar).textContent = porEliminar.nombre;
      $('[data-form-eliminar]', ventanaEliminar).action = `/recetas/${porEliminar.id}/eliminar`;
      if (ventana && ventana.open) cerrarVentana(ventana);
      ventanaEliminar.showModal();
      pausarScroll(true);
      if (animar) gsap.fromTo($('.ventana__caja', ventanaEliminar), { autoAlpha: 0, y: 20, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: M.ease });
      setTimeout(() => { const c = $('[data-cerrar]', ventanaEliminar); if (c) c.focus(); }, 60);
    });
    $$('[data-cerrar]', ventanaEliminar).forEach((b) => b.addEventListener('click', () => cerrarVentana(ventanaEliminar)));
    ventanaEliminar.addEventListener('close', () => { if (!(ventana && ventana.open)) pausarScroll(false); });
    $('[data-form-eliminar]', ventanaEliminar).addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!porEliminar) return;
      const boton = $('[data-confirmar-eliminar]', ventanaEliminar);
      boton.disabled = true;
      try {
        const r = await fetch(`/recetas/${porEliminar.id}/eliminar`, { method: 'POST', headers: { Accept: 'application/json' } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('No se pudo eliminar.');
        const nombre = j.nombre || porEliminar.nombre;
        cerrarVentana(ventanaEliminar);
        if (porEliminar.volver || !porEliminar.card) {
          location.href = `/?eliminada=${encodeURIComponent(nombre)}#recetario`;
          return;
        }
        const card = porEliminar.card;
        const quitar = () => { card.remove(); actualizarConteo(); if (hasGSAP) ScrollTrigger.refresh(); };
        if (animar) gsap.to(card, { autoAlpha: 0, scale: 0.92, duration: 0.45, ease: 'power2.in', onComplete: () => {
          const resto = tarjetas().filter((t) => t !== card);
          const antes = window.Flip ? Flip.getState(resto) : null;
          quitar();
          if (antes) Flip.from(antes, { duration: 0.6, ease: M.easeIO });
        } });
        else quitar();
        avisar(`«${nombre}» se eliminó del recetario.`);
      } catch (err) {
        avisar('No se pudo eliminar la receta. Inténtalo de nuevo.', { tipo: 'error' });
      } finally {
        boton.disabled = false;
        porEliminar = null;
      }
    });
  });

  // 3.9 Página de receta: palomear, pasos, video, compartir e imprimir
  const paginaReceta = $('[data-receta-pagina]');
  safe(() => {
    if (!paginaReceta) return;
    const clave = `cuisine:receta:${paginaReceta.dataset.id}`;
    const marcados = new Set(guardar.leer(clave) || []);
    const checks = $$('[data-check]', paginaReceta);
    const puntoPasos = $('[data-punto-receta]', paginaReceta);
    const moverPunto = () => {
      if (!puntoPasos) return;
      const hechos = $$('.paso-receta input:checked', paginaReceta);
      const ultimo = hechos[hechos.length - 1];
      puntoPasos.classList.toggle('visible', Boolean(ultimo));
      if (!ultimo) return;
      const num = ultimo.closest('label').querySelector('.paso-receta__num');
      const caja = puntoPasos.parentElement.getBoundingClientRect();
      const y = num.getBoundingClientRect().top - caja.top + num.offsetHeight + 6;
      puntoPasos.style.translate = `0 ${Math.round(y)}px`;
    };
    checks.forEach((c) => {
      c.checked = marcados.has(c.dataset.check);
      c.addEventListener('change', () => {
        if (c.checked) marcados.add(c.dataset.check); else marcados.delete(c.dataset.check);
        guardar.poner(clave, [...marcados]);
        moverPunto();
        if (animar && c.checked) {
          const n = c.closest('label').querySelector('.paso-receta__num, .check__caja');
          if (n) gsap.fromTo(n, { scale: 0.7 }, { scale: 1, duration: 0.5, ease: M.pop });
        }
      });
    });
    moverPunto();
    addEventListener('resize', moverPunto);

    $$('[data-video]', paginaReceta).forEach((caja) => {
      const boton = $('.video__play', caja);
      boton.addEventListener('click', () => {
        const embed = caja.dataset.embed;
        let medio;
        if (caja.dataset.videoTipo === 'archivo') {
          medio = d.createElement('video');
          Object.assign(medio, { src: embed, controls: true, autoplay: true, playsInline: true });
        } else {
          medio = d.createElement('iframe');
          medio.src = embed;
          medio.title = 'Video de la preparación';
          medio.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
          medio.allowFullscreen = true;
        }
        caja.textContent = '';
        caja.append(medio);
      });
    });

    const compartir = $('[data-compartir]', paginaReceta);
    if (compartir) compartir.addEventListener('click', async () => {
      const url = location.origin + location.pathname;
      const titulo = compartir.dataset.titulo || d.title;
      if (navigator.share) { try { await navigator.share({ title: titulo, text: `${titulo} en Cuisine`, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); avisar('Enlace copiado. Ya puedes pegarlo donde quieras.'); }
      catch { avisar(`Copia este enlace: ${url}`); }
    });
    const imprimir = $('[data-imprimir]', paginaReceta);
    if (imprimir) imprimir.addEventListener('click', () => window.print());
  });

  // 3.10 Barra del celular: "Buscar receta" a un pulgar de distancia
  safe(() => {
    const barra = $('[data-barra-movil]');
    const inicio = $('[data-portada]') || $('.receta-portada');
    if (!barra || !inicio || !('IntersectionObserver' in window)) return;
    const fin = $('[data-filtros]');
    let pasado = false;
    let enFiltros = false;
    const actualizar = () => {
      const on = pasado && !enFiltros;
      barra.classList.toggle('visible', on);
      barra.setAttribute('aria-hidden', String(!on));
      $$('a', barra).forEach((a) => { a.tabIndex = on ? 0 : -1; });
    };
    new IntersectionObserver(([e]) => { pasado = !e.isIntersecting && e.boundingClientRect.top < 0; actualizar(); }).observe(inicio);
    if (fin) new IntersectionObserver(([e]) => { enFiltros = e.isIntersecting; actualizar(); }).observe(fin);
    actualizar();
  });

  // El punto de cada tarjeta rueda hasta la flecha: mide el largo de "Ver receta"
  function medirTarjetas(lista) {
    lista.forEach((card) => {
      const acciones = $('.receta__acciones', card);
      const enlace = $('.enlace-flecha', card);
      if (acciones && enlace) acciones.style.setProperty('--ancho', `${enlace.offsetWidth}px`);
    });
  }
  safe(() => medirTarjetas($$('[data-receta]')));

  /* ---------- 4. Movimiento (solo con GSAP y sin "Reducir movimiento") ---------- */
  if (!hasGSAP) return;
  if (RM) { html.classList.add('firma-lista'); return; }

  // Los relojes de los platos pasan a manos de GSAP
  $$('[data-aguja]').forEach((aguja) => {
    const min = Number(aguja.dataset.min) || 0;
    aguja.removeAttribute('transform');
    gsap.set(aguja, { svgOrigin: '200 200', rotation: anguloDe(min) % 360 });
  });

  // FIRMA: el punto cae, rueda trazando la línea y se vuelve el botón de buscar
  function firmaPunto(caja) {
    const bola = $('[data-bola]', caja);
    const linea = $('[data-linea]', caja);
    const base = $('[data-base]', caja);
    const icono = $('[data-bola-icono]', caja);
    gsap.set(bola, { clearProps: 'transform' });
    const fr = caja.getBoundingClientRect();
    const br = bola.getBoundingClientRect();
    const s = 0.3;
    const r = (br.width * s) / 2;
    const bx = br.left + br.width / 2 - fr.left;
    const by = br.top + br.height / 2 - fr.top;
    const yLinea = fr.height - 1 - r - by;
    const x0 = r - bx;
    const x1 = fr.width - r - bx;
    const prog = { v: 0 };
    return gsap.timeline()
      .set(linea, { scaleX: 0, transformOrigin: '0% 50%' }, 0)
      .set(icono, { autoAlpha: 0 }, 0)
      .fromTo(base, { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, duration: 0.6, ease: M.easeIO }, 0)
      .fromTo(bola, { x: x0, y: yLinea - 70, scale: s, autoAlpha: 0 }, { y: yLinea, autoAlpha: 1, duration: 0.34, ease: 'power2.in' }, 0.12)
      .to(bola, { y: yLinea - 9, duration: 0.13, ease: 'power1.out' }, 0.46)
      .to(bola, { y: yLinea, duration: 0.13, ease: 'power1.in' }, 0.59)
      .fromTo(prog, { v: 0 }, { v: 1, duration: 0.8, ease: 'power2.inOut', onUpdate: () => { gsap.set(linea, { scaleX: prog.v }); gsap.set(bola, { x: x0 + (x1 - x0) * prog.v }); } }, 0.7)
      .to(bola, { x: 0, y: 0, scale: 1, duration: 0.55, ease: M.pop }, 1.48)
      .fromTo(icono, { autoAlpha: 0, scale: 0.4, rotation: -40, transformOrigin: '50% 50%' }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.45, ease: M.pop }, 1.76);
  }

  // Piezas del plato que entran girando
  const piezasPlato = (raiz) => ({
    foto: $('.plato__foto', raiz),
    marcas: $('.reloj__marcas', raiz),
    borde: $$('.reloj__borde, .reloj__filo', raiz),
    arco: $('[data-arco]', raiz),
    aguja: $('[data-aguja]', raiz),
    especias: $$('.especia', raiz),
  });
  const servirPlato = (raiz, tl, t0 = 0) => {
    const p = piezasPlato(raiz);
    const min = p.aguja ? Number(p.aguja.dataset.min) || 0 : 0;
    const caja = $('.plato__caja', raiz).getBoundingClientRect();
    const hacia = p.especias.map((e) => { const r = e.getBoundingClientRect(); return { x: caja.left + caja.width / 2 - (r.left + r.width / 2), y: caja.top + caja.height / 2 - (r.top + r.height / 2) }; });
    p.especias.forEach((e) => e.classList.remove('flota'));
    tl.fromTo(p.foto, { autoAlpha: 0, scale: 0.84, rotation: -30 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 1.35, ease: M.ease }, t0)
      .fromTo(p.borde, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9 }, t0 + 0.1)
      .fromTo(p.marcas, { autoAlpha: 0, rotation: -70, svgOrigin: '200 200' }, { autoAlpha: 1, rotation: 0, duration: 1.4, ease: M.ease }, t0 + 0.1)
      .fromTo(p.aguja, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, t0 + 0.6)
      .add(barrerReloj(p.arco, p.aguja, min), t0 + 0.75);
    if (p.especias.length) {
      tl.fromTo(p.especias, { x: (i) => hacia[i].x * 0.55, y: (i) => hacia[i].y * 0.55, scale: 0, autoAlpha: 0 },
        { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 1.1, stagger: 0.05, ease: 'power2.out' }, t0 + 0.75)
        .add(() => p.especias.forEach((e) => e.classList.add('flota')));
    }
    return tl;
  };

  // Entrada de la portada (la misma de la hoja de muestra)
  function firmaPortada(root) {
    const tl = gsap.timeline({ defaults: { ease: M.ease } });
    tl.fromTo($('.ceja__linea', root), { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: M.easeIO }, 0)
      .fromTo($$('.ceja > :not(.ceja__linea)', root), { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.7, stagger: 0.08 }, 0.2)
      .fromTo($$('.hero__line-in', root), { yPercent: 120 }, { yPercent: 0, duration: M.dur * 1.12, stagger: 0.11 }, 0.08)
      .fromTo($('.portada__sub', root), { autoAlpha: 0, y: M.dist * 0.6 }, { autoAlpha: 1, y: 0, duration: M.dur }, 0.42);
    const buscador = $('[data-buscador-portada]', root);
    if (buscador) {
      tl.add(firmaPunto(buscador), 0.5)
        .fromTo($('input', buscador), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 1.25);
    }
    tl.fromTo($$('.atajos > li', root), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.045 }, 1.85);
    const plato = $('[data-plato]', root);
    if (plato) {
      servirPlato(plato, tl, 0.2);
      tl.fromTo($('.plato__ficha', plato), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.85 }, 1.55);
    }
    return tl;
  }

  // Entrada de la página de una receta
  function entradaReceta(root) {
    const tl = gsap.timeline({ defaults: { ease: M.ease } });
    tl.fromTo($$('.hero__line-in', root), { yPercent: 120 }, { yPercent: 0, duration: M.dur * 1.1 }, 0.05)
      .fromTo($('.ceja__linea', root), { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: M.easeIO }, 0)
      .fromTo($$('.receta-portada__texto > [data-hero-in]', root), { autoAlpha: 0, y: M.dist * 0.6 }, { autoAlpha: 1, y: 0, duration: M.dur, stagger: M.stagger }, 0.18);
    const plato = $('[data-plato-receta]', root);
    if (plato) {
      tl.fromTo(plato, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0.1);
      servirPlato(plato, tl, 0.15);
      tl.fromTo($('.plato__tiempo', plato), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 1.3);
    }
    return tl;
  }

  // Estados iniciales: la portada espera a la firma sin parpadear
  const portada = $('[data-portada]');
  const recetaPortada = $('.receta-portada');
  safe(() => {
    const ocultar = [];
    const raiz = portada || recetaPortada;
    if (raiz) {
      gsap.set($$('.hero__line-in', raiz), { yPercent: 120, y: 0 });
      if (portada) ocultar.push(...$$('.ceja > :not(.ceja__linea)', raiz), $('.portada__sub', raiz), ...$$('.atajos > li', raiz), $('#q-portada'), $('[data-buscador-portada] [data-bola]'), $('.plato__ficha', raiz));
      else ocultar.push(...$$('.receta-portada__texto > [data-hero-in]', raiz));
      $$('[data-plato], [data-plato-receta]', raiz).forEach((pl) => { const p = piezasPlato(pl); ocultar.push(p.foto, p.marcas, p.aguja, ...p.borde, ...p.especias); });
      if (recetaPortada) ocultar.push($('.plato__tiempo', raiz));
      gsap.set(ocultar.filter(Boolean), { autoAlpha: 0 });
      gsap.set([$('.ceja__linea', raiz), $('[data-buscador-portada] [data-base]'), $('[data-buscador-portada] [data-linea]')].filter(Boolean), { scaleX: 0 });
      $$('[data-arco]', raiz).forEach((a) => gsap.set(a, { strokeDashoffset: C_ARCO }));
      $$('[data-aguja]', raiz).forEach((a) => gsap.set(a, { rotation: 0 }));
    }
  });
  html.classList.add('firma-lista');

  // Lo que entra al bajar: solo se esconde lo que todavía no se ve
  const abajo = (el) => el.getBoundingClientRect().top > window.innerHeight * 0.92;
  const pendientes = new Set();
  safe(() => {
    const revelar = $$('[data-reveal]').filter(abajo);
    gsap.set(revelar, { autoAlpha: 0, y: M.dist });
    ScrollTrigger.batch(revelar, {
      start: 'top 90%', once: true,
      onEnter: (lote) => gsap.to(lote, { autoAlpha: 1, y: 0, duration: M.dur, ease: M.ease, stagger: Math.min(M.stagger, 0.6 / lote.length), overwrite: true, clearProps: 'transform' }),
    });
  });

  // Cada tarjeta se destapa en círculo, como un plato con tapa
  function emplatar(cards) {
    const tl = gsap.timeline();
    cards.forEach((card, i) => {
      const t = i * Math.min(0.09, 0.6 / cards.length);
      const marco = $('.receta__foto', card);
      const img = $('img', marco);
      const cuerpo = $$('.receta__cuerpo > *', card);
      tl.fromTo(card, { autoAlpha: 0, y: M.dist }, { autoAlpha: 1, y: 0, duration: M.dur * 0.85, ease: M.ease, clearProps: 'transform' }, t)
        .fromTo(marco, { clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(72% at 50% 50%)', duration: M.dur * 1.1, ease: M.easeIO, clearProps: 'clipPath' }, t + 0.06)
        .fromTo(img, { scale: 1.16 }, { scale: 1, duration: M.dur * 1.5, ease: M.ease, clearProps: 'transform' }, t + 0.06)
        .fromTo(cuerpo, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: M.dur * 0.8, stagger: 0.05, ease: M.ease, clearProps: 'transform' }, t + 0.3);
    });
    return tl;
  }
  safe(() => {
    const cards = $$('[data-receta]').filter((c) => !c.hidden && abajo(c));
    cards.forEach((c) => pendientes.add(c));
    gsap.set(cards, { autoAlpha: 0 });
    ScrollTrigger.batch(cards, {
      start: 'top 88%', once: true,
      onEnter: (lote) => { lote.forEach((c) => pendientes.delete(c)); emplatar(lote); },
    });
  });
  // Si alguien filtra antes de bajar, las tarjetas pendientes se muestran de inmediato
  revelarPendientes = () => {
    if (!pendientes.size) return;
    gsap.set([...pendientes], { autoAlpha: 1, clearProps: 'transform' });
    pendientes.clear();
  };

  // La línea con el gorro se dibuja desde el centro
  safe(() => {
    $$('[data-regla]').filter(abajo).forEach((regla) => {
      const [izq, der] = $$('.regla__lado', regla);
      const gorro = $('img', regla);
      gsap.set([izq, der], { scaleX: 0 });
      gsap.set(gorro, { autoAlpha: 0, scale: 0.6, y: 6, rotation: -10 });
      ScrollTrigger.create({
        trigger: regla, start: 'top 88%', once: true,
        onEnter: () => gsap.timeline()
          .to(gorro, { autoAlpha: 1, scale: 1, y: 0, rotation: 0, duration: 0.7, ease: M.pop }, 0)
          .to(izq, { scaleX: 1, transformOrigin: '100% 50%', duration: M.dur, ease: M.easeIO }, 0.12)
          .to(der, { scaleX: 1, transformOrigin: '0% 50%', duration: M.dur, ease: M.easeIO }, 0.12),
      });
    });
  });

  // Títulos que suben por líneas
  const titulos = () => safe(() => {
    if (!window.SplitText) return;
    $$('[data-split]').filter(abajo).forEach((el) => {
      SplitText.create(el, {
        type: 'lines', mask: 'lines', linesClass: 'linea', autoSplit: true,
        onSplit: (self) => gsap.from(self.lines, { yPercent: 125, duration: M.dur, stagger: M.stagger, ease: M.ease, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }),
      });
    });
  });

  // Receta destacada: el plato gira y los ingredientes caen uno por uno
  safe(() => {
    const plato = $('[data-plato-destacada]');
    if (!plato || !abajo(plato)) return;
    const p = piezasPlato(plato);
    gsap.set([p.foto, p.marcas, p.aguja, ...p.borde], { autoAlpha: 0 });
    gsap.set(p.arco, { strokeDashoffset: C_ARCO });
    const items = $$('[data-ingredientes-destacada] li');
    gsap.set(items, { autoAlpha: 0, y: -14 });
    ScrollTrigger.create({
      trigger: plato, start: 'top 75%', once: true,
      onEnter: () => {
        servirPlato(plato, gsap.timeline(), 0);
        gsap.to(items, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08, ease: 'bounce.out', delay: 0.4 });
      },
    });
  });

  // Cómo funciona: el punto recorre la línea de los pasos con el scroll
  safe(() => {
    const pasos = $('[data-pasos-como]');
    if (!pasos) return;
    const traza = $('[data-traza]', pasos);
    const punto = $('[data-punto-pasos]', pasos);
    const mm = gsap.matchMedia();
    const crear = (horizontal) => {
      const largo = () => (horizontal ? traza.offsetWidth : traza.offsetHeight);
      gsap.timeline({ scrollTrigger: { trigger: pasos, start: 'top 75%', end: 'bottom 60%', scrub: true, invalidateOnRefresh: true } })
        .fromTo(traza, { [horizontal ? 'scaleX' : 'scaleY']: 0 }, { [horizontal ? 'scaleX' : 'scaleY']: 1, ease: 'none' }, 0)
        .fromTo(punto, { [horizontal ? 'x' : 'y']: 0 }, { [horizontal ? 'x' : 'y']: () => largo(), ease: 'none' }, 0);
    };
    mm.add('(min-width: 860px)', () => crear(true));
    mm.add('(max-width: 859px)', () => crear(false));
    // Cifras reales que cuentan al aparecer (solo las que tienen recorrido)
    $$('[data-cifra]').forEach((el) => {
      const fin = Number(el.textContent);
      if (!(fin >= 10)) return;
      const o = { v: 0 };
      ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: () => gsap.fromTo(o, { v: 0 }, { v: Number(el.textContent) || fin, duration: 1.6, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v); } }) });
    });
  });

  // Arranque: con las fuentes listas (o a los 1.2 s), corre la entrada
  let intro = null;
  const correrIntro = () => {
    if (portada) intro = firmaPortada(portada);
    else if (recetaPortada) intro = entradaReceta(recetaPortada);
    if (!intro) return;
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchmove'];
    const saltar = () => { if (intro && intro.progress() < 1) intro.progress(1); quitar(); };
    const quitar = () => eventos.forEach((ev) => removeEventListener(ev, saltar));
    eventos.forEach((ev) => addEventListener(ev, saltar, { passive: true }));
    intro.eventCallback('onComplete', quitar);
  };
  Promise.race([d.fonts ? d.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 1200))])
    .then(() => {
      safe(correrIntro);
      titulos();
      medirTarjetas($$('[data-receta]'));
      ScrollTrigger.refresh();
      // Si llegó con #ancla, baja sin animación
      if (location.hash && location.hash.length > 1) { const el = d.getElementById(location.hash.slice(1)); if (el && !(el.tagName === 'DIALOG')) irA(el, true); }
    });
  addEventListener('load', () => ScrollTrigger.refresh());
})();
