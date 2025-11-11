// Sidebar interaction handlers - sidebar HTML is now generated at build time
// This file only handles interactive features: folder toggling, animations, and preview

// Initialize sidebar interactions when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    // Setup folder toggle interactions
    const details = document.querySelectorAll('.sidebar-details');
    details.forEach(detail => {
      const summary = detail.querySelector('summary');
      const chevron = summary ? summary.querySelector('.chevron-icon') : null;
      
      if (summary) {
        summary.addEventListener('click', (ev) => {
          ev.preventDefault();
          // Toggle the details element
          detail.open = !detail.open;
          // Rotate chevron
          if (chevron) {
            chevron.style.transform = detail.open ? 'rotate(90deg)' : 'rotate(0deg)';
          }
        });
      }
    });

    // Setup Alt+click preview for sidebar links
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    sidebarLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        if (e.altKey && typeof window.preview !== 'undefined') {
          e.preventDefault();
          try {
            window.preview.open(link.href);
          } catch (err) {
            console.warn('Sidebar: preview open failed', err);
          }
        }
      });
    });

    // Animate sidebar items on page load
    setTimeout(() => {
      const hasMotion = (typeof Motion !== 'undefined' && Motion.animate);
      const treeRoot = document.getElementById('sidebar-tree');
      
      // Reveal the sidebar
      if (treeRoot) treeRoot.style.opacity = '1';
      
      // Animate list items
      if (hasMotion) {
        try {
          Motion.animate(
            '#sidebar-sections li',
            { opacity: [0, 1] },
            { duration: 0.25, delay: 0.05, easing: [0.22, 0.61, 0.36, 1] }
          );
        } catch (e) {
          console.warn('Sidebar: animation failed', e);
          // Fallback: ensure items are visible
          document.querySelectorAll('#sidebar-sections li').forEach(li => {
            li.style.opacity = '1';
          });
        }
      } else {
        // No animation support: ensure all items are visible
        document.querySelectorAll('#sidebar-sections li').forEach(li => {
          li.style.opacity = '1';
        });
      }
    }, 0);

    // Setup sidebar filter
    const filterInput = document.getElementById('sidebar-filter');
    if (filterInput) {
      const applyFilter = () => {
        const q = filterInput.value.trim().toLowerCase();

        // Reset all items to visible by default
        const allLis = Array.from(document.querySelectorAll('#sidebar-sections li'));
        allLis.forEach(li => { li.style.display = ''; });

        const allDetails = Array.from(document.querySelectorAll('.sidebar-details'));
        allDetails.forEach(d => { d.style.display = ''; });

        const headers = Array.from(document.querySelectorAll('#sidebar-sections h3'));
        headers.forEach(h => {
          h.style.display = '';
          const ul = h.nextElementSibling;
          if (ul && ul.tagName === 'UL') ul.style.display = '';
        });

        if (!q) return; // empty query => show everything

        // Hide non-matching list items
        allLis.forEach(li => {
          const link = li.querySelector('.sidebar-link');
          const text = (link ? link.textContent : li.textContent) || '';
          const match = text.toLowerCase().includes(q);
          li.style.display = match ? '' : 'none';
        });

        // Hide details groups that have no visible li children
        allDetails.forEach(detail => {
          const hasVisibleLi = Array.from(detail.querySelectorAll('li')).some(li => li.style.display !== 'none');
          detail.style.display = hasVisibleLi ? '' : 'none';
        });

        // Hide entire sections (header + UL) if their list has no visible items
        headers.forEach(h => {
          const ul = h.nextElementSibling;
          if (ul && ul.tagName === 'UL') {
            const hasVisible = Array.from(ul.querySelectorAll('li')).some(li => li.style.display !== 'none');
            h.style.display = hasVisible ? '' : 'none';
            ul.style.display = hasVisible ? '' : 'none';
          }
        });
      };

      filterInput.addEventListener('input', applyFilter);
    }
  } catch (e) {
    console.error('Sidebar initialization failed', e);
  }
});