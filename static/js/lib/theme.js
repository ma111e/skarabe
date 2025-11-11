window.addEventListener('DOMContentLoaded', () => {
    try {
        let ls = localStorage.getItem('theme');
        let prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        let theme = ls || (prefersDark ? 'dark' : 'light');
        if (theme === 'dark') document.documentElement.classList.add('dark');
        else {
            document.documentElement.classList.remove('dark');
            document.documentElement.classList.add('light');
        }
    } catch (e) { }

    let btn = document.getElementById('theme-toggle');
    let icon = document.getElementById('theme-icon');
    let SUN_SVG = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon-star-icon lucide-moon-star"><path d="M18 5h4"/><path d="M20 3v4"/><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;
    let MOON_SVG = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun-icon lucide-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
    function current() { return document.documentElement.classList.contains('dark') ? 'dark' : 'light'; }
    function apply(theme) {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        try { localStorage.setItem('theme', theme); } catch (e) { }
        icon.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
    }
    apply(current());
    btn && btn.addEventListener('click', function () { apply(current() === 'dark' ? 'light' : 'dark'); });
});
