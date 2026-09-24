/* Score-UOR — router and startup */
(() => {
  'use strict';
  const N = window.Nimre;
  const { S, ACTIONS } = N;

  function route() {
    S.seq++;
    S.lastUrl = location.href;
    document.body.classList.remove('has-savebar');
    const teacher = window.NimreTeacher;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

    if (parts[0] === 'subject' && parts[1]) return teacher.subjectView(decodeURIComponent(parts[1]).toUpperCase(), parts[2]);
    if (parts[0] === 'compare') return teacher.compareView();
    return teacher.dashboardView();
  }
  N.route = route;

  // Three languages, so the bar button opens a small picker instead of toggling.
  ACTIONS.lang = () => {
    N.openSheet({
      title: N.t('chooseLanguage'),
      body: '<div class="menu">' + N.LANGS.map((k) =>
        '<button type="button" class="menu-item' + (S.lang === k ? ' is-on' : '') + '" data-act="setLang" data-lang="' + k + '">' +
        (S.lang === k ? N.ICON.check : '<span class="ic" aria-hidden="true"></span>') +
        '<span lang="' + (k === 'ku' ? 'ckb' : k) + '">' + N.esc(N.LANG_NAME[k]) + '</span></button>').join('') + '</div>'
    });
  };

  // Back button: keep unsaved grades safe.
  window.addEventListener('popstate', async () => {
    if (!S.dirty.size) return route();
    const target = location.href;
    history.pushState(null, '', S.lastUrl);
    if (await N.guardDirty()) {
      history.pushState(null, '', target);
      route();
    }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.installEvent = e;
    if (!S.dirty.size && !document.querySelector('.sheet-wrap') && !document.querySelector('.install-row')) {
      const view = location.search ? 'student' : (S.token ? 'teacher' : 'welcome');
      if (view !== 'teacher' || !S.cur) route();
    }
  });

  if (!N.IS_NATIVE && 'serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  N.applyLang();
  route();
})();
