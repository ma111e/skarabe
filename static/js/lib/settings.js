(function(){
  if (window.__settingsInit) return;
  window.__settingsInit = true;

  document.addEventListener('DOMContentLoaded', () => {
    const NO_ANIM_KEY = 'si:noAnimations';
    try {
      if (localStorage.getItem(NO_ANIM_KEY) === '1') {
        document.documentElement.classList.add('no-animations');
      }
    } catch (e) {}

    const $settingsBtn = document.getElementById('settings-button');
    const $settingsMenu = document.getElementById('settings-menu');

    const toggleMenu = (open) => {
      if (!$settingsBtn || !$settingsMenu) return;
      const willOpen = typeof open === 'boolean' ? open : $settingsMenu.hasAttribute('hidden');
      if (willOpen) {
        $settingsMenu.removeAttribute('hidden');
        $settingsBtn.setAttribute('aria-expanded', 'true');
      } else {
        $settingsMenu.setAttribute('hidden', '');
        $settingsBtn.setAttribute('aria-expanded', 'false');
      }
    };

    if ($settingsBtn && $settingsMenu) {
      $settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu();
      });
      document.addEventListener('click', (e) => {
        if (!$settingsMenu || $settingsMenu.hasAttribute('hidden')) return;
        if (e.target === $settingsBtn || ($settingsBtn.contains && $settingsBtn.contains(e.target))) return;
        if ($settingsMenu.contains && $settingsMenu.contains(e.target)) return;
        toggleMenu(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') toggleMenu(false);
      });
    }

    const $clearBtn = document.getElementById('clear-storage');
    if ($clearBtn) {
      const clearAllStorage = async () => {
        try { localStorage.clear(); } catch (e) { }
        try { sessionStorage.clear(); } catch (e) { }
        try {
          if (typeof caches !== 'undefined' && caches.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
          }
        } catch (e) { }
        try {
          if (window.indexedDB && typeof indexedDB.databases === 'function') {
            const dbs = await indexedDB.databases();
            await Promise.all((dbs || []).map(db => {
              if (!db || !db.name) return Promise.resolve();
              return new Promise((resolve) => { const req = indexedDB.deleteDatabase(db.name); req.onsuccess = () => resolve(); req.onerror = () => resolve(); req.onblocked = () => resolve(); });
            }));
          }
        } catch (e) { }
      };
      $clearBtn.addEventListener('click', async () => {
        await clearAllStorage();
        location.reload();
      });
    }

    const $animBtn = document.getElementById('toggle-animations');
    if ($animBtn) {
      const disabledAnimIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>`;
      const animIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-off-icon lucide-star-off"><path d="M8.34 8.34 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21l-.59-3.43"/><path d="M18.42 12.76 22 9.27l-6.91-1L12 2l-1.44 2.91"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
      const applyAnimState = (disabled) => {
        document.documentElement.classList.toggle('no-animations', !!disabled);
        try { localStorage.setItem(NO_ANIM_KEY, disabled ? '1' : '0'); } catch (e) {}
        $animBtn.setAttribute('aria-label', disabled ? 'Enable animations' : 'Disable animations');
        $animBtn.setAttribute('title', disabled ? 'Enable animations' : 'Disable animations');
        $animBtn.innerHTML = `${disabled ? disabledAnimIcon : animIcon}<span>${disabled ? 'Enable' : 'Disable'} animations</span>`;
      };
      const animationsDisabled = (() => {
        try { return localStorage.getItem(NO_ANIM_KEY) === '1'; } catch { return false; }
      })();
      applyAnimState(animationsDisabled);
      $animBtn.addEventListener('click', () => {
        const allowAnims = !document.documentElement.classList.contains('no-animations');
        applyAnimState(allowAnims);
        if (!allowAnims) {
          location.reload()
        }
      });
    }
  });
})();
