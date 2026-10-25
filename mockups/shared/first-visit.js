// First visit: a warm, low-contrast look (the "solar" palette), light or dark by the system setting.
// The colour panel (appearance.js, loaded after this file) saves every later change.
//
// An external file on purpose: the API's Content-Security-Policy forbids inline scripts, so the same code in
// index.html would be blocked in production and only work on the dev server.
try {
    if (!localStorage.getItem('pal')) {
        localStorage.setItem('pal', 'solar');
        localStorage.setItem(
            'thm',
            matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        );
        localStorage.setItem('ctr', 'low');
    }
} catch {
    // Storage blocked (private mode): the panel falls back to its own defaults.
}
