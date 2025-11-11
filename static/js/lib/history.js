 (function() {
  const STORAGE_KEY = 'search_history';
  const MAX_STORE = 100; // keep up to 100 in storage
  const MAX_VISIBLE = 10; // default visible rows
  const DISPLAY_DELAY_MS = 4000;

  let items = [];
  let timer = null;
  let pending = '';
  const listeners = new Set();
  // Animation guards for history list
  let animTimer = null;
  let lastListKey = '';
  let lastShown = false;
  let moTimer = null; // debounce timer for MutationObserver

  const norm = (q) => (q || '').trim();

  const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { items = []; return; }
      const arr = JSON.parse(raw);
      items = Array.isArray(arr) ? arr.filter(x => typeof x === 'string').slice(0, MAX_STORE) : [];
    } catch (e) { items = []; }
  };
  const slashMenuOpen = () => {
    try { return !!(window.slashMenu && typeof window.slashMenu.isOpen === 'function' && window.slashMenu.isOpen()); }
    catch (e) { return false; }
  };
  const isSlashCommand = (q) => {
    try {
      const s = norm(q);
      if (!s) return false;
      // Treat any input starting with '/' as a slash command
      return s.startsWith('/');
    } catch (e) { return false; }
  };
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_STORE))); } catch (e) { /* ignore save errors */ } };
  const notify = () => { listeners.forEach(fn => { try { fn(items.slice()); } catch (e) { /* ignore listener error */ } }); };

  const add = (q) => {
    const v = norm(q);
    if (!v) return;
    if (items[0] === v) return;
    items = [v, ...items.filter(x => x !== v)];
    if (items.length > MAX_STORE) items.length = MAX_STORE;
    save();
    render();
    notify();
  };

  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const recordDisplayed = (q) => {
    const v = norm(q);
    cancel();
    pending = v;
    if (!v) return;
    // Do not record while slash menu is active or when the input is a command
    if (slashMenuOpen() || isSlashCommand(v)) return;
    timer = setTimeout(() => { add(pending); timer = null; }, DISPLAY_DELAY_MS);
  };
  const recordImmediate = (q) => {
    const v = norm(q);
    cancel();
    if (!v) return;
    if (slashMenuOpen() || isSlashCommand(v)) return;
    add(v);
  };
  const get = () => items.slice();
  const clear = () => { items = []; save(); render(); notify(); };
  const onChange = (fn) => { if (typeof fn === 'function') listeners.add(fn); return () => listeners.delete(fn); };

  // UI
  let $container = null;
  const ensureContainer = () => {
    if ($container && document.body.contains($container)) return $container;
    const el = document.getElementById('search-history');
    if (!el) return null;
    $container = el;
    return $container;
  };

  const render = () => {
    const input = document.getElementById('search-input');
    const val = norm(input ? input.value : '');
    const results = document.getElementById('search-results');
    const el = ensureContainer();
    if (!el) return;
    const isEmpty = !val;
    const hasResults = !!(results && results.querySelector && results.querySelector('.result'));
    const stats = document.getElementById('search-stats');
    const hasStats = !!(stats && stats.textContent && stats.textContent.trim());
    
    // Show history only if:
    // - there are history items
    // - input is truly empty
    // - no visible results
    // - stats is empty (no "Loading..." or result count)
    const shouldShow = !!(items.length && isEmpty && !hasResults && !hasStats);

    // Compute signature of current items to detect changes
    const key = items.join('\u0001');
    if (!shouldShow) {
      // Hide and reset state when not showing
      el.hidden = true;
      el.innerHTML = '';
      lastShown = false;
      lastListKey = '';
      if (animTimer) { clearTimeout(animTimer); animTimer = null; }
      return;
    }
    
    const frag = document.createDocumentFragment();
    // Render newest first (items already maintain this order)
    items.forEach((q) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      // Match sidebar tree item styling
      btn.className = 'history-btn flex items-center gap-2 px-2 py-1.5 rounded text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 w-full text-left';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      // Tailwind-like sizing and color to match sidebar icons
      svg.setAttribute('class', 'w-3 h-3 text-gray-500 dark:text-gray-400');
      // Using lucide search icon
      svg.innerHTML = '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>';

      const label = document.createElement('span');
      label.textContent = q;

      btn.appendChild(svg);
      btn.appendChild(label);
      btn.addEventListener('click', () => {
        const input = document.getElementById('search-input');
        if (input) {
          input.value = q;
          try { if (typeof onSearch === 'function') onSearch({ target: { value: q } }); } catch (e) { /* ignore */ }
          // Ensure history hides immediately when results are about to render
          try { render(); } catch (e) { /* ignore */ }
        }
      });
      li.appendChild(btn);
      frag.appendChild(li);
    });
    el.appendChild(frag);
    el.hidden = false;
    // Animate only on first show or when items changed
    const itemsChanged = key !== lastListKey;
    if (!lastShown || itemsChanged) {
      if (animTimer) { clearTimeout(animTimer); animTimer = null; }
      animTimer = setTimeout(() => {
        try {
          if (typeof Motion !== 'undefined' && Motion.animate && Motion.stagger) {
            Motion.animate(
              '#search-history li',
              { opacity: [0, 1], x: [-20, 0] },
              { 
                duration: 0.2,
                delay: Motion.stagger(0.05, { start: 0 }),
                easing: [0.22, 0.61, 0.36, 1]
              }
            );
          } else {
            // Fallback: ensure items are visible immediately
            document.querySelectorAll('#search-history li').forEach(li => { li.style.opacity = '1'; li.style.transform = 'none'; });
          }
        } catch (e) { try { console.warn('History animation failed', e); } catch (_) {} }
      }, 300);
    }
    lastShown = true;
    lastListKey = key;
  };

  const wire = () => {
    try {
      const input = document.getElementById('search-input');
      if (input) {
        let last = norm(input.value);
        // Initial render on load
        setTimeout(render, 0);
        input.addEventListener('input', () => {
          const v = norm(input.value);
          if (v !== last) {
            last = v;
            recordDisplayed(v);
          }
          render();
        });
      }
      const results = document.getElementById('search-results');
      if (results) {
        results.addEventListener('click', (e) => {
          const li = e.target && e.target.closest ? e.target.closest('li.result') : null;
          if (!li) return;
          const input = document.getElementById('search-input');
          const q = input ? input.value : '';
          recordImmediate(q);
        }, true);
        // Hide/show history when results list changes (e.g., search completed)
        try {
          const mo = new MutationObserver(() => {
            try {
              if (moTimer) clearTimeout(moTimer);
              moTimer = setTimeout(() => { try { render(); } catch (err) { try { console.warn('History render failed after mutation', err); } catch (_) {} } }, 50);
            } catch (err) { try { console.warn('History mutation debounce failed', err); } catch (_) {} }
          });
          mo.observe(results, { childList: true });
        } catch (e) { try { console.warn('History mutation observer failed', e); } catch (_) {} }
      }
      // Also react to stats changes so history hides when stats are present
      try {
        const stats = document.getElementById('search-stats');
        if (stats) {
          const moStats = new MutationObserver(() => {
            try {
              if (moTimer) clearTimeout(moTimer);
              moTimer = setTimeout(() => { try { render(); } catch (err) { try { console.warn('History render failed after stats mutation', err); } catch (_) {} } }, 50);
            } catch (err) { try { console.warn('History stats mutation debounce failed', err); } catch (_) {} }
          });
          moStats.observe(stats, { childList: true, subtree: true, characterData: true });
        }
      } catch (e) { try { console.warn('History stats mutation observer failed', e); } catch (_) {} }
    } catch (e) { try { console.warn('History wire failed', e); } catch (_) {} }
  };

  load();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else { wire(); }

  window.searchHistory = { get, clear, recordDisplayed, recordImmediate, onChange };
})();
