// Mockup-only light/dark switch: applies the saved choice, then adds a small toggle in the top right corner.
(function () {
    var root = document.documentElement;
    function save(v) { try { localStorage.setItem('theme', v); } catch (e) { /* storage blocked */ } }
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) { /* storage blocked */ }
    var dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    document.addEventListener('DOMContentLoaded', function () {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-toggle mock-theme';
        b.innerHTML = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
        function label() { b.setAttribute('aria-label', 'Switch to ' + (root.dataset.theme === 'dark' ? 'light' : 'dark') + ' mode'); }
        label();
        b.addEventListener('click', function () {
            var n = root.dataset.theme === 'dark' ? 'light' : 'dark';
            root.dataset.theme = n; save(n); label();
        });
        document.body.appendChild(b);
    });
})();
