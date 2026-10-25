// Applies the saved light/dark choice before first paint, falling back to the system setting.
// An external file on purpose: the API's Content-Security-Policy forbids inline scripts.
try {
    const saved = localStorage.getItem('theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch {
    // Storage blocked (private mode): the stylesheet's light default applies.
}
