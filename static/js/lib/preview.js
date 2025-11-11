(function() {
  const LOG = {
    debug: (...a) => console.debug('[preview]', ...a),
    info: (...a) => console.info('[preview]', ...a),
    warn: (...a) => console.warn('[preview]', ...a),
    error: (...a) => console.error('[preview]', ...a)
  };

  let previewContainer = null;
  let backdrop = null;
  let iframe = null;
  let closeBtn = null;
  let isOpen = false;

  const initPreviewUI = () => {
    if (previewContainer) return;
    
    try {
      backdrop = document.getElementById('preview-backdrop');
      previewContainer = document.getElementById('preview-container');
      iframe = document.getElementById('preview-iframe');
      closeBtn = document.getElementById('preview-close');
      
      if (!backdrop || !previewContainer || !iframe || !closeBtn) {
        LOG.error('Preview elements not found in DOM');
        return;
      }
      
      // Close on button click
      closeBtn.addEventListener('click', (e) => {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        close();
      });
      
      // Close on backdrop click
      backdrop.addEventListener('click', close);
      
      // Close on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) close();
      });
      
      LOG.debug('Preview UI initialized');
    } catch (e) {
      LOG.error('Failed to initialize preview UI', e);
    }
  };

  const open = (url) => {
    if (!url) {
      LOG.warn('No URL provided for preview');
      return;
    }
    
    try {
      initPreviewUI();
      
      if (!previewContainer || !backdrop || !iframe) {
        LOG.error('Preview UI not available');
        return;
      }
      
      // Load URL into iframe
      iframe.src = url;
      isOpen = true;
      
      // Show elements
      backdrop.style.display = 'block';
      previewContainer.style.display = 'block';
      previewContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';
      
      // Animate in
      const hasMotion = (typeof Motion !== 'undefined' && Motion.animate);
      if (hasMotion) {
        try {
          Motion.animate(backdrop, { opacity: [0, 1] }, { duration: 0.2, easing: [0.22, 0.61, 0.36, 1] });
          Motion.animate(previewContainer, { opacity: [0, 1], transform: ['translate(-50%, -50%) scale(0.95)', 'translate(-50%, -50%) scale(1)'] }, { duration: 0.3, easing: [0.22, 0.61, 0.36, 1] });
        } catch (e) {
          LOG.warn('Motion animation failed', e);
          backdrop.style.opacity = '1';
          previewContainer.style.opacity = '1';
          previewContainer.style.transform = 'translate(-50%, -50%) scale(1)';
        }
      } else {
        backdrop.style.transition = 'opacity 0.2s ease';
        previewContainer.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        requestAnimationFrame(() => {
          backdrop.style.opacity = '1';
          previewContainer.style.opacity = '1';
          previewContainer.style.transform = 'translate(-50%, -50%) scale(1)';
        });
      }
      
      LOG.info('Preview opened', url);
    } catch (e) {
      LOG.error('Failed to open preview', e);
    }
  };

  const close = () => {
    if (!isOpen || !previewContainer || !backdrop) return;
    
    try {
      const hasMotion = (typeof Motion !== 'undefined' && Motion.animate);
      const cleanup = () => {
        backdrop.style.display = 'none';
        previewContainer.style.display = 'none';
        if (iframe) iframe.src = 'about:blank';
        isOpen = false;
        LOG.debug('Preview closed');
      };
      
      if (hasMotion) {
        try {
          Promise.all([
            Motion.animate(backdrop, { opacity: [1, 0] }, { duration: 0.2, easing: [0.22, 0.61, 0.36, 1] }).finished,
            Motion.animate(previewContainer, { opacity: [1, 0], transform: ['translate(-50%, -50%) scale(1)', 'translate(-50%, -50%) scale(0.95)'] }, { duration: 0.2, easing: [0.22, 0.61, 0.36, 1] }).finished
          ]).then(cleanup).catch((e) => { LOG.warn('Close animation failed', e); cleanup(); });
        } catch (e) {
          LOG.warn('Motion close failed', e);
          cleanup();
        }
      } else {
        backdrop.style.opacity = '0';
        previewContainer.style.opacity = '0';
        previewContainer.style.transform = 'translate(-50%, -50%) scale(0.95)';
        setTimeout(cleanup, 200);
      }
    } catch (e) {
      LOG.error('Failed to close preview', e);
    }
  };

  // Expose API
  window.preview = { open, close };
  
  LOG.debug('Preview module loaded');
})();
