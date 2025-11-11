
  const ensureProgressUI = () => {
    if (!$loading) return null;
    $loading.hidden = false;
    return $loading;
  };

  const getProgressRow = (kind) => {
    if (!$loading) return null;
    return $loading.querySelector(`.progress-row[data-kind="${kind}"]`);
  };

  const setProgressLabel = (kind, text) => {
    const row = getProgressRow(kind);
    if (!row) return;
    const status = row.querySelector('.progress-status');
    if (!status) return;
    
    // Animate label change with Motion.js
    if (typeof Motion !== 'undefined' && Motion.animate) {
      // Fade out current text upward
      if (status.textContent && status.textContent !== text) {
        Motion.animate(
          status,
          { opacity: [1, 0], y: [0, -10] },
          { duration: 0.1, easing: [0.4, 0, 1, 1] }
        ).finished.then(() => {
          // Update text
          status.textContent = text || '';
          // Fade in new text from bottom
          Motion.animate(
            status,
            { opacity: [0, 1], y: [10, 0] },
            { duration: 0.2, easing: [0, 0, 0.2, 1] }
          );
        });
      } else {
        // First time or same text, just set it
        status.textContent = text || '';
      }
    } else {
      // Fallback without animation
      status.textContent = text || '';
    }
    
    if ($loading) $loading.setAttribute('aria-label', text || '');
  };

  const setProgressPercent = (kind, pct) => {
    const row = getProgressRow(kind);
    if (!row) return;
    const bar = row.querySelector('.progress-bar');
    const fill = row.querySelector('.progress-bar-fill');
    const clamped = Math.max(0, Math.min(100, pct));
    if (fill) fill.style.width = clamped + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(clamped)));
  };

  const startSmoothProgress = (kind) => {
    const slot = state.progress[kind];
    if (!slot) return;
    clearInterval(slot.timer);
    
    slot.timer = setInterval(() => {
      const now = Date.now();
      const elapsedStep = now - (slot.stepStartTs || now);
      const sinceMsg = now - (slot.lastMessageTs || slot.stepStartTs || now);
      let gap = slot.targetPct - slot.currentPct;

      // Never go backwards
      if (gap < 0) gap = 0;

      if (gap > 0.1) {
        // Move toward target with decreasing speed as we get closer and as time passes
        const proximity = Math.max(0.02, Math.min(0.15, Math.abs(gap) / 100));
        const timeFactor = Math.max(0.6, Math.min(2, elapsedStep / 1000));
        const inc = (gap * proximity) / timeFactor;
        slot.currentPct += inc;
        setProgressPercent(kind, slot.currentPct);
      } else {
        // At target: idle creep toward a soft ceiling (<= 99%) with decreasing speed
        const base = slot.targetPct || 0;
        const bonus = Math.min(25, Math.log1p(sinceMsg / 800) * 10); // rises quickly then plateaus
        slot.softCeil = Math.min(99, Math.max(slot.softCeil || 0, base + bonus));
        const idleGap = (slot.softCeil - slot.currentPct);
        if (idleGap > 0.001) {
          const decay = 1 + (sinceMsg / 1000); // slows over time
          const floor = 0.003; // ensure tiny forward movement
          const factor = Math.max(floor, 0.05 / decay);
          const inc = Math.min(idleGap, idleGap * factor);
          slot.currentPct += inc;
          setProgressPercent(kind, slot.currentPct);
        }
      }
    }, 50);
  };

  const completeProgress = (kind) => {
    if (!$loading) return;
    const slot = state.progress[kind];
    if (!slot) return;
    clearInterval(slot.timer);
    slot.timer = null;
    // Always set to 100% on completion
    setProgressPercent(kind, 100);
    if (slot.currentPct !== undefined) slot.currentPct = 100;
    const row = getProgressRow(kind);
    if (row) {
      setTimeout(() => { row.hidden = true; }, 200);
    }
    // Hide container if both rows are hidden
    setTimeout(() => {
      const allRows = $loading.querySelectorAll('.progress-row');
      const hasVisible = Array.from(allRows).some(r => !r.hidden);
      if (!hasVisible) $loading.hidden = true;
    }, 250);
  };
