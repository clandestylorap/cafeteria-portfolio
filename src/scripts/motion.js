/**
 * Webestatica Motion Kit (v2 · optimizado para fluidez)
 * Sistema declarativo de animaciones: se marca el HTML con data-atributos
 * y initMotion() aplica cada efecto. Devuelve una función de limpieza.
 *
 * Uso (Astro o módulo ES):
 *   import gsap from 'gsap';
 *   import { ScrollTrigger } from 'gsap/ScrollTrigger';
 *   import Lenis from 'lenis';
 *   import { initMotion } from './motion.js';
 *   const cleanup = initMotion({ gsap, ScrollTrigger, Lenis }, { level: 'media', cursor: false });
 *
 * Uso (HTML con CDN): cargar GSAP, ScrollTrigger y Lenis como <script> y luego
 *   <script type="module">
 *     import { initMotion } from './motion.js';
 *     initMotion({ gsap: window.gsap, ScrollTrigger: window.ScrollTrigger, Lenis: window.Lenis });
 *   </script>
 *
 * Cambios de rendimiento respecto a v1:
 * - Una sola instancia viva: si initMotion se llama dos veces (ClientRouter,
 *   HMR, dos <script>), limpia la anterior. Dos Lenis a la vez = scroll a tirones.
 * - gsap.matchMedia(): los efectos dependientes de breakpoint o reduced motion
 *   se crean y se destruyen solos al cruzar el breakpoint (antes se evaluaba una vez).
 * - Scroll reveal con ScrollTrigger.batch(): un trigger por grupo, no uno por elemento.
 * - Magnetic con gsap.quickTo(): antes creaba un tween nuevo en cada pointermove.
 * - Split text: el DOM se parte una sola vez y se reutiliza.
 * - Nuevo efecto [data-stack] (stacking cards) integrado en el kit, animando
 *   solo transform y opacity.
 * - Pins con anticipatePin, ignoreMobileResize y scroll-behavior neutralizado
 *   mientras Lenis está activo.
 */

const PRESETS = {
  sutil:     { dur: 1.1,  ease: 'power2.out', y: 28, stagger: 0.12, text: 0.035 },
  media:     { dur: 0.9,  ease: 'power3.out', y: 48, stagger: 0.10, text: 0.03  },
  expresiva: { dur: 0.75, ease: 'power4.out', y: 70, stagger: 0.07, text: 0.022 },
};

const BP_DESKTOP = '(min-width: 768px)';
const MQ = {
  desktop: BP_DESKTOP,
  mobile: '(max-width: 767.98px)',
  reduce: '(prefers-reduced-motion: reduce)',
  fine: '(pointer: fine)',
};

export function initMotion({ gsap, ScrollTrigger, Lenis }, opts = {}) {
  // Una sola instancia viva del kit por documento.
  if (typeof window.__webestaticaMotionCleanup === 'function') {
    window.__webestaticaMotionCleanup();
  }

  gsap.registerPlugin(ScrollTrigger);
  // Sin limitCallbacks: con él, los elementos que ya están en pantalla al cargar
  // no reciben onEnter y se quedan ocultos (p. ej. el hero con data-reveal).
  ScrollTrigger.config({ ignoreMobileResize: true });

  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const level = opts.level || document.body.dataset.motion || 'media';
  const P = { ...(PRESETS[level] || PRESETS.media), ...(opts.preset || {}) };
  const cleanups = [];

  /* ---------- Split text (se construye una vez) ---------- */
  const splitCache = new WeakMap();
  const splitWords = (el, chars) => {
    const key = chars ? 'chars' : 'words';
    const cached = splitCache.get(el);
    if (cached && cached.key === key) return cached.nodes;

    const text = el.textContent.trim().replace(/\s+/g, ' ');
    el.setAttribute('aria-label', text);
    el.textContent = '';
    const nodes = [];
    const frag = document.createDocumentFragment();
    text.split(' ').forEach((w, i, a) => {
      const ws = document.createElement('span');
      ws.className = 'm-word';
      ws.setAttribute('aria-hidden', 'true');
      if (chars) {
        [...w].forEach(ch => {
          const c = document.createElement('span');
          c.className = 'm-char'; c.textContent = ch; ws.appendChild(c); nodes.push(c);
        });
      } else {
        const inner = document.createElement('span');
        inner.className = 'm-inner'; inner.textContent = w; ws.appendChild(inner); nodes.push(inner);
      }
      frag.appendChild(ws);
      if (i < a.length - 1) frag.appendChild(document.createTextNode(' '));
    });
    el.appendChild(frag);
    splitCache.set(el, { key, nodes });
    return nodes;
  };

  /* ---------- Split reveal: construir slices una vez ---------- */
  const splitRevealEls = $$('[data-split-reveal]');
  splitRevealEls.forEach(el => {
    if (el.dataset.built) return;
    el.dataset.built = '1';
    const mode = el.dataset.splitReveal || 'cols';
    el.style.setProperty('--m-img', `url("${el.dataset.src}")`);
    el.classList.add('m-split', `m-split--${mode}`);
    el.setAttribute('role', 'img');
    if (el.dataset.alt) el.setAttribute('aria-label', el.dataset.alt);
    const frag = document.createDocumentFragment();
    const add = (i, clip, dir = 1) => {
      const s = document.createElement('div');
      s.className = 'm-slice';
      s.style.setProperty('--i', i);
      s.style.setProperty('--dir', dir);
      s.style.clipPath = clip;
      frag.appendChild(s);
    };
    const pct = v => `${(v * 100).toFixed(3)}%`;
    if (mode === 'grid') {
      const cols = +el.dataset.cols || 8, rows = +el.dataset.rows || 4;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        add(r + c, `inset(${pct(r / rows)} ${pct((cols - 1 - c) / cols)} ${pct((rows - 1 - r) / rows)} ${pct(c / cols)})`);
      }
    } else {
      const n = +el.dataset.count || (mode === 'cols' ? 8 : 6);
      for (let i = 0; i < n; i++) {
        const a = pct(i / n), b = pct((n - 1 - i) / n);
        add(i, mode === 'cols' ? `inset(0 ${b} 0 ${a})` : `inset(${a} 0 ${b} 0)`, i % 2 ? 1 : -1);
      }
    }
    el.appendChild(frag);
  });

  /* ---------- Efectos, reconstruidos por gsap.matchMedia ---------- */
  const mm = gsap.matchMedia();

  mm.add(MQ, ctx => {
    const { desktop, mobile, reduce, fine } = ctx.conditions;

    /* Split reveal: con reduced motion se muestra directamente */
    splitRevealEls.forEach(el => {
      if (el.classList.contains('is-visible')) return;
      if (reduce) { el.classList.add('is-visible'); return; }
      ScrollTrigger.create({
        trigger: el, start: 'top 80%', once: true,
        onEnter: () => el.classList.add('is-visible'),
      });
    });

    if (!reduce) {
      /* Scroll reveal agrupado: un trigger por lote, no por elemento */
      const reveals = $$('[data-reveal]');
      if (reveals.length) {
        const show = (els, delay = 0) => gsap.to(els, {
          y: 0, autoAlpha: 1, duration: P.dur, ease: P.ease, delay,
          stagger: 0.06, overwrite: true, clearProps: 'transform,visibility',
        });
        // Lo que ya está visible al cargar (hero, primera pantalla) entra
        // directamente, sin depender de un callback de ScrollTrigger.
        const limit = innerHeight * 0.85;
        const inView = reveals.filter(el => el.getBoundingClientRect().top < limit);
        const later = reveals.filter(el => !inView.includes(el));
        gsap.set(reveals, { y: P.y, autoAlpha: 0 });
        if (inView.length) show(inView, 0.1);
        if (later.length) ScrollTrigger.batch(later, {
          start: 'top 85%',
          once: true,
          onEnter: batch => show(batch),
        });
      }

      /* Stagger: los hijos directos entran escalonados */
      $$('[data-stagger]').forEach(c => gsap.fromTo(c.children,
        { y: P.y, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: P.dur, ease: P.ease, clearProps: 'transform,visibility',
          stagger: parseFloat(c.dataset.stagger) || P.stagger,
          scrollTrigger: { trigger: c, start: 'top 85%', once: true } },
      ));

      /* Text reveal: data-split="chars|words|lines", data-split-trigger="load" para el hero */
      $$('[data-split]').forEach(el => {
        const mode = el.dataset.split || 'words';
        const onLoad = el.dataset.splitTrigger === 'load';
        const st = onLoad ? undefined : { trigger: el, start: 'top 85%', once: true };
        const delay = onLoad ? 0.15 : 0;
        if (mode === 'chars') {
          gsap.from(splitWords(el, true), {
            yPercent: 115, rotate: level === 'expresiva' ? 6 : 0,
            duration: P.dur * 1.1, ease: P.ease, stagger: P.text, delay, scrollTrigger: st,
          });
        } else if (mode === 'lines') {
          const inners = splitWords(el, false);
          // Agrupar por línea: lectura de layout en bloque (sin intercalar escrituras)
          const tops = inners.map(n => n.parentElement.offsetTop);
          const groups = [];
          let top = null;
          inners.forEach((n, i) => {
            if (tops[i] !== top) { groups.push([]); top = tops[i]; }
            groups[groups.length - 1].push(n);
          });
          const tl = gsap.timeline({ delay, scrollTrigger: st });
          groups.forEach((g, i) => tl.from(g, { yPercent: 115, duration: P.dur * 1.2, ease: P.ease }, i * P.stagger * 1.5));
        } else {
          gsap.from(splitWords(el, false), {
            yPercent: 115, duration: P.dur, ease: P.ease, stagger: P.stagger * 0.8, delay, scrollTrigger: st,
          });
        }
      });

      /* Parallax: data-parallax="15" (porcentaje de desplazamiento) */
      $$('[data-parallax]').forEach(el => {
        const s = (parseFloat(el.dataset.parallax) || 15) * (mobile ? 0.5 : 1);
        gsap.fromTo(el, { yPercent: -s, force3D: true }, {
          yPercent: s, ease: 'none', force3D: true,
          scrollTrigger: {
            trigger: el.closest('[data-parallax-scope]') || el.parentElement,
            start: 'top bottom', end: 'bottom top',
            // Lenis ya suaviza el scroll: scrub numérico aquí duplicaría la inercia
            scrub: true,
          },
        });
      });

      /* Contadores: data-counter="1250" */
      $$('[data-counter]').forEach(el => {
        const raw = el.dataset.counter, end = parseFloat(raw);
        const dec = (raw.split('.')[1] || '').length;
        const nf = new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        const o = { v: 0 };
        let last = '';
        el.textContent = nf.format(0);
        gsap.to(o, {
          v: end, duration: 1.8, ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
          onUpdate: () => {
            const next = nf.format(o.v);
            if (next !== last) { el.textContent = next; last = next; } // solo toca el DOM si cambia
          },
        });
      });

      /* Stacking cards (solo desktop):
         [data-stack] > [data-stack-card] > [data-stack-inner] (+ [data-stack-shade] opcional)
         El sticky lo pone el CSS; aquí solo la profundidad de la card que queda tapada.
         Opcionales en [data-stack]: data-stack-scale="0.94" data-stack-dim="0.3" */
      if (desktop) {
        $$('[data-stack]').forEach(stack => {
          const cards = $$('[data-stack-card]', stack);
          const scale = parseFloat(stack.dataset.stackScale) || 0.94;
          const dim = parseFloat(stack.dataset.stackDim) || 0.3;
          cards.forEach((card, i) => {
            if (i === 0) return;
            const prev = cards[i - 1];
            const inner = prev.querySelector('[data-stack-inner]') || prev;
            const shade = prev.querySelector('[data-stack-shade]');
            const stickyTop = () => parseFloat(getComputedStyle(card).top) || 0;
            const tl = gsap.timeline({
              defaults: { ease: 'none' },
              scrollTrigger: {
                trigger: card,
                start: 'top bottom',
                end: () => `top ${stickyTop()}px`,
                scrub: true,
                invalidateOnRefresh: true,
              },
            });
            tl.fromTo(inner, { scale: 1, force3D: true }, { scale, force3D: true }, 0);
            if (shade) tl.fromTo(shade, { opacity: 0 }, { opacity: dim }, 0);
          });
        });
      }
    }

    /* Sticky scroll: [data-pin-steps] con [data-step], [data-step-media] y [data-step-progress] */
    $$('[data-pin-steps]').forEach(sec => {
      const steps = $$('[data-step]', sec), media = $$('[data-step-media]', sec);
      const bar = sec.querySelector('[data-step-progress]');
      const setBar = bar ? gsap.quickSetter(bar, 'scaleX') : null;
      const n = steps.length; let cur = -1;
      const set = i => {
        if (i === cur) return; cur = i;
        steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
        media.forEach((m, k) => m.classList.toggle('is-active', k === i));
      };
      set(0);
      ScrollTrigger.create({
        trigger: sec, start: 'top top', end: `+=${n * 80}%`,
        pin: true, anticipatePin: 1,
        onUpdate: self => {
          if (setBar) setBar(self.progress);
          set(Math.min(n - 1, Math.floor(self.progress * n)));
        },
      });
    });

    /* Horizontal scroll: [data-hscroll] con [data-hscroll-track]. En móvil pasa a swipe nativo */
    $$('[data-hscroll]').forEach(sec => {
      const track = sec.querySelector('[data-hscroll-track]');
      if (!track) return;
      if (reduce || mobile) { sec.classList.add('m-hscroll--native'); return; }
      sec.classList.remove('m-hscroll--native');
      const dist = () => Math.max(0, track.scrollWidth - innerWidth);
      gsap.to(track, {
        x: () => -dist(), ease: 'none', force3D: true,
        scrollTrigger: {
          trigger: sec, start: 'top top', end: () => '+=' + dist(),
          pin: true, anticipatePin: 1, scrub: true, invalidateOnRefresh: true,
        },
      });
    });

    /* Magnetic: data-magnetic="0.35" (solo puntero fino) */
    const local = [];
    if (fine && !reduce) {
      $$('[data-magnetic]').forEach(btn => {
        const k = parseFloat(btn.dataset.magnetic) || 0.35;
        const inner = btn.firstElementChild;
        const q = { duration: 0.5, ease: 'power3.out' };
        const bx = gsap.quickTo(btn, 'x', q), by = gsap.quickTo(btn, 'y', q);
        const ix = inner ? gsap.quickTo(inner, 'x', q) : null;
        const iy = inner ? gsap.quickTo(inner, 'y', q) : null;
        let rect = null;
        const enter = () => { rect = btn.getBoundingClientRect(); };
        const move = e => {
          if (!rect) rect = btn.getBoundingClientRect();
          const x = e.clientX - (rect.left + rect.width / 2);
          const y = e.clientY - (rect.top + rect.height / 2);
          bx(x * k); by(y * k);
          if (ix) { ix(x * k * 0.4); iy(y * k * 0.4); }
        };
        const leave = () => {
          rect = null;
          gsap.to([btn, inner].filter(Boolean), { x: 0, y: 0, duration: 1.1, ease: 'elastic.out(1, 0.3)', overwrite: 'auto' });
        };
        btn.addEventListener('pointerenter', enter);
        btn.addEventListener('pointermove', move);
        btn.addEventListener('pointerleave', leave);
        local.push(() => {
          btn.removeEventListener('pointerenter', enter);
          btn.removeEventListener('pointermove', move);
          btn.removeEventListener('pointerleave', leave);
        });
      });
    }

    /* Custom cursor (opt-in, solo puntero fino) */
    if (opts.cursor && fine && !reduce) {
      const ring = document.createElement('div'); ring.className = 'm-cursor';
      const dot = document.createElement('div'); dot.className = 'm-cursor-dot';
      [ring, dot].forEach(n => { n.setAttribute('aria-hidden', 'true'); document.body.appendChild(n); });
      gsap.set([ring, dot], { xPercent: -50, yPercent: -50 });
      const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3.out' });
      const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3.out' });
      const dx = gsap.quickTo(dot, 'x', { duration: 0.08 });
      const dy = gsap.quickTo(dot, 'y', { duration: 0.08 });
      const move = e => { rx(e.clientX); ry(e.clientY); dx(e.clientX); dy(e.clientY); };
      const over = e => ring.classList.toggle('is-hover', !!e.target.closest('a, button, [data-cursor]'));
      addEventListener('pointermove', move, { passive: true });
      document.addEventListener('pointerover', over, { passive: true });
      local.push(() => {
        removeEventListener('pointermove', move);
        document.removeEventListener('pointerover', over);
        ring.remove(); dot.remove();
      });
    }

    // Se ejecuta al cruzar un breakpoint o al destruir el kit
    return () => local.forEach(f => f());
  });

  // Animaciones ya preparadas (estados iniciales aplicados): a partir de aquí
  // manda el JS y motion.css deja de pre-ocultar. Mismo tick, sin repintado entre medias.
  document.documentElement.classList.add('m-ready');

  /* ---------- Smooth scroll (Lenis) ---------- */
  const reduceNow = matchMedia(MQ.reduce).matches;
  if ((opts.smooth ?? true) && !reduceNow && Lenis) {
    const html = document.documentElement;
    // scroll-behavior: smooth (p. ej. la clase scroll-smooth de Tailwind) pelea con Lenis
    const prevBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';

    const lenis = new Lenis({
      lerp: opts.lerp ?? 0.1,
      anchors: true,
      autoRaf: false,          // el ritmo lo marca el ticker de GSAP, no un rAF propio
      smoothWheel: true,
      syncTouch: false,        // en táctil, scroll nativo (más fluido que simularlo)
      ...(opts.lenis || {}),
    });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = t => lenis.raf(t * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    window.lenis = lenis; // para pausar desde modales: window.lenis.stop() / .start()

    cleanups.push(() => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      if (window.lenis === lenis) delete window.lenis;
      html.style.scrollBehavior = prevBehavior;
    });
  }

  /* ---------- Recalcular posiciones cuando cargan fuentes e imágenes ---------- */
  let refreshId = 0;
  const refresh = () => {
    cancelAnimationFrame(refreshId);
    refreshId = requestAnimationFrame(() => ScrollTrigger.refresh());
  };
  document.fonts?.ready.then(refresh);
  if (document.readyState === 'complete') refresh();
  else addEventListener('load', refresh, { once: true });
  cleanups.push(() => {
    cancelAnimationFrame(refreshId);
    removeEventListener('load', refresh);
  });

  const destroy = () => {
    cleanups.forEach(f => f());
    mm.revert();
    document.documentElement.classList.remove('m-ready');
    if (window.__webestaticaMotionCleanup === destroy) delete window.__webestaticaMotionCleanup;
  };
  window.__webestaticaMotionCleanup = destroy;
  return destroy;
}