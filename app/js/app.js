/*
 * RP IPTV (webOS) — tela principal.
 * Mesmo comportamento do Roku (v0.6.2): menu focável, listas ativas, tela cheia com troca de canal,
 * lista lateral com OK, confirmação antes de sair e foco sempre explícito (zona atual).
 */
(function () {
  'use strict';

  var P = window.RPParsers;

  // Códigos de tecla do controle LG webOS e de teclado (ESC para testes no computador).
  // [verificar no aparelho] CH+/CH- (33/34) e as cores (403-406).
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, ESC: 27, BACK: 461,
    CH_UP: 33, CH_DOWN: 34, FWD: 417, REW: 412, PLAY: 415, INFO: 457,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406
  };

  // Itens fixos do menu (depois das seções, que vêm do próprio catálogo).
  var FIXED_MENU = [
    { label: 'Todos os canais', view: 'channels', title: 'Todos os canais' },
    { label: 'Minhas listas', view: 'lists', title: 'Minhas listas' },
    { label: 'Favoritos', view: 'favorites', title: 'Favoritos' },
    { label: 'Histórico', view: 'history', title: 'Histórico' },
    { label: 'Buscar', view: 'search', title: 'Buscar' }
  ];

  // Listas que o app já trouxe pré-configuradas (versões anteriores). São removidas uma vez.
  var OLD_DEFAULT_URLS = [
    'https://iptv-org.github.io/iptv/countries/br.m3u',
    'https://iptv-org.github.io/iptv/categories/movies.m3u',
    'https://iptv-org.github.io/iptv/categories/series.m3u',
    'https://iptv-org.github.io/iptv/categories/kids.m3u',
    'https://iptv-org.github.io/iptv/languages/por.m3u'
  ];

  var LOAD_TIMEOUT_MS = 60000;
  var BANNER_MS = 5000;
  var HISTORY_MAX = 25;

  var S = {
    mode: 'browse',          // 'browse' | 'play'
    zone: 'menu',            // 'menu' | 'list' | 'input' | 'dialog'
    menuIndex: 0,
    menuItems: [],
    listIndex: 0,
    view: 'category',
    cat: 'Canais abertos',
    title: 'Canais abertos',
    statusMsg: '',
    progressMsg: '',
    viewSource: [],          // itens exibidos na lista (para lists: as listas)
    visible: [],             // resultados da busca
    channels: [],            // catálogo: união das listas ativas
    lists: [],
    favorites: [],
    history: [],
    cache: {},               // url -> canais baixados
    queue: [],
    loading: false,
    loadTotal: 0,
    loadDone: 0,
    loadErrors: 0,
    lastError: '',
    currentUrl: '',
    playSource: [],
    playIndex: 0,
    playContext: '',
    overlayOpen: false,
    overlayIndex: 0,
    modal: null
  };

  var hls = null;
  var bannerTimer = null;

  function $(id) { return document.getElementById(id); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { S.statusMsg = 'Não foi possível salvar (armazenamento cheio).'; }
  }

  function hasListUrl(url) {
    for (var i = 0; i < S.lists.length; i++) {
      if (S.lists[i].url === url) return true;
    }
    return false;
  }

  function activeLists() {
    return S.lists.filter(function (l) { return l.active !== false; });
  }

  function currentSource() {
    switch (S.view) {
      case 'favorites': return S.favorites;
      case 'history': return S.history;
      case 'search': return S.visible;
      case 'category': return S.channels.filter(function (c) { return c.cat === S.cat; });
      default: return S.channels;
    }
  }

  // ------------------------------------------------------------- renderização ---

  function renderRows(ul, rows, idx, focused) {
    ul.innerHTML = '';
    var frag = document.createDocumentFragment();
    rows.forEach(function (text, i) {
      var li = document.createElement('li');
      li.textContent = text;
      if (i === idx) li.className = focused ? 'focus' : 'sel';
      frag.appendChild(li);
    });
    ul.appendChild(frag);
    if (focused) {
      var el = ul.children[idx];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }

  // Seções existentes no catálogo (com contagem), na ordem preferida, seguidas dos itens fixos.
  function buildMenu() {
    var counts = {};
    S.channels.forEach(function (c) { counts[c.cat] = (counts[c.cat] || 0) + 1; });
    var order = P.SECTION_ORDER;
    var names = Object.keys(counts).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0) ia = 999;
      if (ib < 0) ib = 999;
      return ia - ib || a.localeCompare(b);
    });
    var sections = names.map(function (name) {
      return { label: name, count: counts[name], view: 'category', cat: name, title: name };
    });
    // Se a seção aberta deixou de existir (ex.: lista removida), volta para a primeira disponível.
    if (S.view === 'category' && names.indexOf(S.cat) < 0 && names.length) {
      S.cat = names[0];
      S.title = names[0];
    }
    S.menuItems = sections.concat(FIXED_MENU);
    if (S.menuIndex >= S.menuItems.length) S.menuIndex = Math.max(0, S.menuItems.length - 1);
  }

  function renderMenu() {
    var ul = $('menu');
    ul.innerHTML = '';
    var focusEl = null;
    S.menuItems.forEach(function (m, i) {
      var li = document.createElement('li');
      li.textContent = m.count ? m.label + '  (' + m.count + ')' : m.label;
      var isActive = (m.view === S.view) && (m.view !== 'category' || m.cat === S.cat);
      if (isActive) li.classList.add('active');
      if (S.zone === 'menu' && i === S.menuIndex) { li.classList.add('focus'); focusEl = li; }
      ul.appendChild(li);
    });
    if (focusEl && focusEl.scrollIntoView) focusEl.scrollIntoView({ block: 'nearest' });
  }

  function listRowTitle(l) {
    var tag = (l.active === false) ? '[DESLIGADA] ' : '[LIGADA] ';
    var count = hasOwn(S.cache, l.url) ? ' (' + S.cache[l.url].length + ' canais)' : '';
    return tag + l.name + count;
  }

  function countMsg(n) {
    return n === 0 ? 'Nenhum canal nesta seção ainda. Aguarde o carregamento ou ative uma lista.' : n + ' itens.';
  }

  function hintText() {
    if (S.zone === 'menu') return '↑ ↓ Navegar     → ou OK Entrar     AZUL Buscar     BACK Sair';
    if (S.view === 'lists') return '↑ ↓ Navegar     OK Liga/desliga     VERDE Adicionar     VERMELHO Remover     ← Menu';
    return '↑ ↓ Navegar     OK Reproduzir     AMARELO Favoritar     ← Menu';
  }

  function render() {
    renderMenu();
    if (S.mode !== 'browse') return;

    $('section').textContent = S.title;
    var rows = [];
    var src;
    if (S.view === 'lists') {
      src = S.lists;
      rows.push('+ Adicionar pelo celular (QR code)');
      rows.push('Digitar a URL no controle');
      src.forEach(function (l) { rows.push(listRowTitle(l)); });
    } else {
      src = currentSource();
      src.forEach(function (ch) { rows.push((ch.cat ? ch.cat + '  |  ' : '') + ch.name); });
    }
    S.viewSource = src;

    if (S.listIndex >= rows.length) S.listIndex = Math.max(0, rows.length - 1);
    renderRows($('list'), rows, S.listIndex, S.zone === 'list');

    if (S.loading) {
      $('status').textContent = S.progressMsg;
    } else if (!S.lists.length && S.view !== 'lists') {
      $('status').textContent = 'Nenhuma lista cadastrada. Vá em "Minhas listas" e pressione VERDE para adicionar sua lista M3U.';
    } else if (S.statusMsg) {
      $('status').textContent = S.statusMsg;
    } else {
      $('status').textContent = S.view === 'lists'
        ? S.lists.length + ' listas.'
        : countMsg(src.length);
    }
    $('hint').textContent = hintText();
  }

  function renderOverlay() {
    var rows = S.playSource.map(function (ch) { return (ch.cat ? ch.cat + '  |  ' : '') + ch.name; });
    renderRows($('overlayList'), rows, S.overlayIndex, true);
  }

  // -------------------------------------------------------------- navegação ---

  function activateMenu(i) {
    var m = S.menuItems[i];
    if (!m) return;
    S.statusMsg = '';
    if (m.view === 'search') { openSearch(); return; }
    S.view = m.view;
    if (m.cat) S.cat = m.cat;
    S.title = m.title;
    S.listIndex = 0;
    // Em "Minhas listas" o foco vai direto para a lista, para o VERDE e o OK já funcionarem.
    if (m.view === 'lists') S.zone = 'list';
    render();
  }

  function selectFocused() {
    if (S.view === 'lists') {
      if (S.listIndex === 0) openPairing();
      else if (S.listIndex === 1) openAddList();
      else toggleListActive(S.listIndex - 2);
      return;
    }
    play(S.viewSource, S.listIndex);
  }

  function toggleFavorite() {
    var ch = S.viewSource[S.listIndex];
    if (!ch) return;
    var found = -1;
    for (var i = 0; i < S.favorites.length; i++) {
      if (S.favorites[i].url === ch.url) { found = i; break; }
    }
    if (found >= 0) {
      S.favorites.splice(found, 1);
      S.statusMsg = 'Removido dos favoritos.';
    } else {
      S.favorites.push(ch);
      S.statusMsg = 'Adicionado aos favoritos.';
    }
    save('rp.favorites', S.favorites);
    render();
  }

  // ----------------------------------------------------------------- listas ---

  function toggleListActive(i) {
    var l = S.lists[i];
    if (!l) return;
    l.active = (l.active === false);
    save('rp.lists', S.lists);
    S.statusMsg = '';
    refreshCatalog();
    render();
  }

  function removeList() {
    if (S.listIndex < 2) return;
    S.lists.splice(S.listIndex - 2, 1);
    save('rp.lists', S.lists);
    buildCatalog();
    S.statusMsg = 'Lista removida.';
    render();
  }

  // ----------------------------------------------------------------- catálogo ---

  function needsLoad(url) {
    return !hasOwn(S.cache, url) || S.cache[url].length === 0;
  }

  function refreshCatalog() {
    if (S.loading) {
      // Já há download em andamento: só acrescenta as listas novas à fila.
      activeLists().forEach(function (l) {
        if (needsLoad(l.url) && S.queue.indexOf(l.url) < 0 && l.url !== S.currentUrl) {
          S.queue.push(l.url);
          S.loadTotal++;
        }
      });
      return;
    }
    S.queue = [];
    activeLists().forEach(function (l) { if (needsLoad(l.url)) S.queue.push(l.url); });
    S.loadTotal = S.queue.length;
    S.loadDone = 0;
    S.loadErrors = 0;
    nextLoad();
  }

  function nextLoad() {
    if (!S.queue.length) {
      S.loading = false;
      S.progressMsg = '';
      buildCatalog();
      S.statusMsg = catalogSummary();
      render();
      return;
    }
    S.loading = true;
    S.currentUrl = S.queue.shift();
    S.progressMsg = 'Carregando lista ' + (S.loadDone + 1) + ' de ' + S.loadTotal + '...';
    render();

    var url = S.currentUrl;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, LOAD_TIMEOUT_MS);

    fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        clearTimeout(timer);
        var canais = P.parsePlaylistText(text);
        S.cache[url] = canais;
        if (!canais.length) { S.loadErrors++; S.lastError = 'nenhum canal encontrado'; }
        S.loadDone++;
        nextLoad();
      })
      .catch(function (err) {
        clearTimeout(timer);
        S.cache[url] = [];
        S.loadDone++;
        S.loadErrors++;
        S.lastError = (err && err.name === 'AbortError') ? 'tempo esgotado' : (err && err.message) || 'erro de rede';
        nextLoad();
      });
  }

  function buildCatalog() {
    var seen = {};
    var merged = [];
    activeLists().forEach(function (l) {
      if (!hasOwn(S.cache, l.url)) return;
      S.cache[l.url].forEach(function (ch) {
        if (!seen[ch.url]) {
          seen[ch.url] = true;
          ch.cat = P.sectionFor(ch.name, ch.category);
          merged.push(ch);
        }
      });
    });
    S.channels = merged;
    buildMenu();
  }

  function catalogSummary() {
    var msg = S.channels.length + ' canais de ' + activeLists().length + ' listas ativas.';
    if (S.loadErrors > 0) {
      msg += ' ' + S.loadErrors + ' lista(s) falharam (' + S.lastError + '). Verifique a rede ou remova em Minhas listas.';
    }
    return msg;
  }

  // ---------------------------------------------------------------- reprodução ---

  function addHistory(ch) {
    for (var i = S.history.length - 1; i >= 0; i--) {
      if (S.history[i].url === ch.url) S.history.splice(i, 1);
    }
    S.history.unshift(ch);
    if (S.history.length > HISTORY_MAX) S.history.length = HISTORY_MAX;
    save('rp.history', S.history);
  }

  function play(source, idx) {
    if (!source || idx < 0 || idx >= source.length) return;
    var ch = source[idx];
    if (!ch || !ch.url) return;
    S.playSource = source;
    S.playIndex = idx;
    S.playContext = S.view + '|' + S.cat;
    addHistory(ch);

    S.mode = 'play';
    S.overlayOpen = false;
    $('overlay').classList.add('hidden');
    $('browse').classList.add('hidden');
    $('player').classList.remove('hidden');

    startStream(ch.url);
    showBanner(ch);
  }

  function step(delta) {
    var n = S.playSource.length;
    if (!n) return;
    play(S.playSource, (S.playIndex + delta + n) % n);
  }

  function startStream(url) {
    stopStream();
    var v = $('video');
    var lower = url.toLowerCase();
    if (lower.indexOf('.m3u8') >= 0 && window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.on(window.Hls.Events.ERROR, function (_ev, d) { if (d && d.fatal) showError(); });
      hls.loadSource(url);
      hls.attachMedia(v);
    } else {
      v.src = url;
    }
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* erros tratados pelo evento 'error' do vídeo */ });
  }

  function stopStream() {
    if (hls) { hls.destroy(); hls = null; }
    var v = $('video');
    v.pause();
    v.removeAttribute('src');
    v.load();
  }

  function stopPlayback() {
    stopStream();
    S.mode = 'browse';
    $('player').classList.add('hidden');
    $('browse').classList.remove('hidden');
    hideBanner();
    if (S.playContext === S.view + '|' + S.cat) S.listIndex = S.playIndex;
    S.zone = 'list';
    render();
  }

  function openOverlay() {
    S.overlayOpen = true;
    S.overlayIndex = S.playIndex;
    hideBanner();
    $('overlay').classList.remove('hidden');
    renderOverlay();
  }

  function closeOverlay() {
    S.overlayOpen = false;
    $('overlay').classList.add('hidden');
  }

  function showBannerBox() { $('banner').classList.remove('hidden'); }

  function hideBanner() {
    clearTimeout(bannerTimer);
    bannerTimer = null;
    $('banner').classList.add('hidden');
  }

  function showBanner(ch) {
    if (S.mode !== 'play' || S.overlayOpen) return;
    $('bannerName').textContent = ch.name;
    $('bannerInfo').textContent = (ch.cat || '') + '     ↑ ↓ ou CH trocam o canal     OK: lista     BACK: sair';
    var logo = $('bannerLogo');
    if (ch.logo && P.isHttpUrl(ch.logo)) {
      logo.src = ch.logo;
      logo.classList.remove('hidden');
    } else {
      logo.classList.add('hidden');
      logo.removeAttribute('src');
    }
    showBannerBox();
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(hideBanner, BANNER_MS);
  }

  function showError() {
    if (S.mode !== 'play') return;
    $('bannerName').textContent = 'Não foi possível reproduzir este canal';
    $('bannerInfo').textContent = 'CH ou ↑ ↓ para outro canal     BACK: sair';
    $('bannerLogo').classList.add('hidden');
    showBannerBox();
    clearTimeout(bannerTimer);
    bannerTimer = null;
  }

  // -------------------------------------------------------------------- modais ---

  function openModal(m) {
    m.prevZone = S.zone;
    S.modal = m;
    $('modalTitle').textContent = m.title;
    $('modalText').textContent = m.text || '';
    var inp = $('modalInput');
    if (m.input) {
      inp.classList.remove('hidden');
      inp.value = '';
      inp.placeholder = m.placeholder || '';
    } else {
      inp.classList.add('hidden');
    }
    renderModalButtons();
    $('modal').classList.remove('hidden');
    if (m.input) {
      S.zone = 'input';
      inp.focus();
    } else {
      S.zone = 'dialog';
    }
  }

  function renderModalButtons() {
    var box = $('modalButtons');
    box.innerHTML = '';
    S.modal.buttons.forEach(function (b, i) {
      var btn = document.createElement('button');
      btn.textContent = b.label;
      if (i === S.modal.index) btn.className = 'focus';
      box.appendChild(btn);
    });
  }

  function closeModal() {
    var prev = S.modal ? S.modal.prevZone : 'menu';
    S.modal = null;
    $('modal').classList.add('hidden');
    $('modalInput').blur();
    S.zone = prev || 'menu';
    render();
  }

  function openSearch() {
    openModal({
      kind: 'search', title: 'Buscar canal', input: true, placeholder: 'Nome do canal',
      buttons: [{ label: 'Buscar', action: 'search' }, { label: 'Cancelar', action: 'close' }], index: 0
    });
  }

  function openAddList() {
    openModal({
      kind: 'addList', title: 'URL da playlist M3U (http ou https)', input: true, placeholder: 'https://...',
      buttons: [{ label: 'Adicionar', action: 'addList' }, { label: 'Cancelar', action: 'close' }], index: 0
    });
  }

  function openExit() {
    openModal({
      kind: 'exit', title: 'Sair do RP IPTV?', text: 'Deseja realmente fechar o aplicativo?',
      buttons: [{ label: 'Sair', action: 'exit' }, { label: 'Cancelar', action: 'close' }], index: 1
    });
  }

  function submitAddList() {
    var url = $('modalInput').value.trim();
    if (!url) { closeModal(); S.statusMsg = 'Adição cancelada.'; render(); return; }
    if (!P.isHttpUrl(url)) { $('modalText').textContent = 'URL inválida. Use http:// ou https://.'; return; }
    if (hasListUrl(url)) { $('modalText').textContent = 'Essa lista já está cadastrada.'; return; }
    S.lists.push({ name: 'Lista personalizada ' + (S.lists.length + 1), url: url, active: true });
    save('rp.lists', S.lists);
    closeModal();
    S.view = 'lists';
    S.title = 'Minhas listas';
    S.statusMsg = 'Lista adicionada. Carregando canais...';
    refreshCatalog();
    render();
  }

  function submitSearch() {
    var q = $('modalInput').value.trim().toLowerCase();
    if (!q) { closeModal(); S.statusMsg = 'Busca cancelada.'; render(); return; }
    if (!S.channels.length) { $('modalText').textContent = 'Aguarde o carregamento dos canais.'; return; }
    S.visible = S.channels.filter(function (c) { return c.name.toLowerCase().indexOf(q) >= 0; });
    S.view = 'search';
    S.title = 'Resultados da busca';
    S.listIndex = 0;
    closeModal();
    S.zone = 'list';
    S.statusMsg = S.visible.length + ' resultado(s) para: ' + q;
    render();
  }

  function runModalAction(action) {
    if (action === 'close') closeModal();
    else if (action === 'exit') {
      closeModal();
      S.statusMsg = 'Para fechar, use o botão Home do controle.';
      window.close();
      render();
    }
    else if (action === 'addList') submitAddList();
    else if (action === 'search') submitSearch();
  }

  function handleModal(k) {
    if (!S.modal) return false;
    var n = S.modal.buttons.length;
    if (k === KEY.LEFT || k === KEY.UP) {
      S.modal.index = Math.max(0, S.modal.index - 1);
      renderModalButtons();
    } else if (k === KEY.RIGHT || k === KEY.DOWN) {
      S.modal.index = Math.min(n - 1, S.modal.index + 1);
      renderModalButtons();
    } else if (k === KEY.ENTER) {
      runModalAction(S.modal.buttons[S.modal.index].action);
    } else if (k === KEY.BACK || k === KEY.ESC) {
      closeModal();
    } else {
      return false;
    }
    return true;
  }

  function onInputKey(e) {
    var k = e.keyCode;
    if (k === KEY.ENTER) {
      e.preventDefault();
      runModalAction(S.modal.buttons[0].action);
    } else if (k === KEY.BACK || k === KEY.ESC) {
      e.preventDefault();
      closeModal();
    } else if (k === KEY.DOWN) {
      e.preventDefault();
      S.zone = 'dialog';
      S.modal.index = 0;
      $('modalInput').blur();
      renderModalButtons();
    }
  }

  // ------------------------------------------------------- pareamento pelo celular ---

  var PAIR_TIMEOUT_MS = 10 * 60 * 1000;
  var PAIR_POLL_MS = 4000;

  function rpcCall(nome, corpo) {
    var cfg = window.RPConfig;
    return fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + nome, {
      method: 'POST',
      headers: {
        'apikey': cfg.SUPABASE_KEY,
        'Authorization': 'Bearer ' + cfg.SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(corpo)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function openPairing() {
    var cfg = window.RPConfig;
    if (!cfg || !cfg.SUPABASE_URL || !cfg.PAIR_PAGE_URL || cfg.PAIR_PAGE_URL.indexOf('SEU_USUARIO') >= 0) {
      S.statusMsg = 'Pareamento pelo celular não configurado. Use "Digitar a URL no controle".';
      render();
      return;
    }
    if (S.pairing) return;
    var code = P.makePairCode(Math.random);
    S.pairing = { code: code, started: Date.now(), timer: null, busy: false };
    showPairing(code, 'Gerando código...');
    rpcCall('criar_pareamento', { p_codigo: code }).then(function () {
      if (!S.pairing || S.pairing.code !== code) return;
      drawQr(cfg.PAIR_PAGE_URL + '?c=' + code);
      $('pairStatus').textContent = 'Aguardando o envio pelo celular...';
      S.pairing.timer = setInterval(function () { pollPairing(code); }, PAIR_POLL_MS);
    }).catch(function () {
      if (!S.pairing || S.pairing.code !== code) return;
      endPairing('Sem conexão com o serviço de pareamento. Use "Digitar a URL no controle".');
    });
  }

  function showPairing(code, texto) {
    $('pairing').classList.remove('hidden');
    $('pairCode').textContent = code;
    $('pairUrl').textContent = window.RPConfig.PAIR_PAGE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('pairStatus').textContent = texto || '';
    $('qr').innerHTML = '';
  }

  function drawQr(url) {
    if (typeof qrcode !== 'function') {
      $('pairStatus').textContent = 'Não foi possível gerar o QR code. Use o código acima.';
      return;
    }
    var qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function pollPairing(code) {
    if (!S.pairing || S.pairing.code !== code || S.pairing.busy) return;
    if (Date.now() - S.pairing.started > PAIR_TIMEOUT_MS) {
      endPairing('O código expirou. Tente de novo.');
      return;
    }
    S.pairing.busy = true;
    rpcCall('retirar_url', { p_codigo: code }).then(function (res) {
      if (!S.pairing || S.pairing.code !== code) return;
      S.pairing.busy = false;
      if (!res) return;
      if (res.status === 'ok') receivedUrl(res.url);
      else if (res.status === 'expirado') endPairing('O código expirou. Tente de novo.');
    }).catch(function () {
      if (S.pairing && S.pairing.code === code) S.pairing.busy = false;
    });
  }

  function receivedUrl(url) {
    if (!P.isHttpUrl(url)) { endPairing('O celular enviou um endereço inválido.'); return; }
    if (hasListUrl(url)) { endPairing('Essa lista já estava cadastrada.'); return; }
    S.lists.push({ name: 'Lista do celular ' + (S.lists.length + 1), url: url, active: true });
    save('rp.lists', S.lists);
    endPairing('Lista recebida do celular e adicionada.');
    refreshCatalog();
  }

  function endPairing(msg) {
    if (S.pairing && S.pairing.timer) clearInterval(S.pairing.timer);
    S.pairing = null;
    $('pairing').classList.add('hidden');
    $('qr').innerHTML = '';
    S.view = 'lists';
    S.title = 'Minhas listas';
    S.zone = 'list';
    S.statusMsg = msg;
    render();
  }

  function cancelPairing() {
    endPairing('Pareamento cancelado.');
  }

  // ---------------------------------------------------------------- teclado ---

  function handleBrowse(k) {
    var rowCount = S.viewSource.length + (S.view === 'lists' ? 2 : 0);
    if (S.zone === 'menu') {
      var nm = S.menuItems.length || 1;
      if (k === KEY.UP) { S.menuIndex = (S.menuIndex + nm - 1) % nm; render(); return true; }
      if (k === KEY.DOWN) { S.menuIndex = (S.menuIndex + 1) % nm; render(); return true; }
      if (k === KEY.RIGHT) { S.statusMsg = ''; S.zone = 'list'; render(); return true; }
      if (k === KEY.ENTER) { activateMenu(S.menuIndex); return true; }
      if (k === KEY.BLUE) { openSearch(); return true; }
      if (k === KEY.BACK || k === KEY.ESC) { openExit(); return true; }
      return false;
    }
    // zona: lista
    if (k === KEY.UP) { S.listIndex = Math.max(0, S.listIndex - 1); render(); return true; }
    if (k === KEY.DOWN) { S.listIndex = Math.min(Math.max(0, rowCount - 1), S.listIndex + 1); render(); return true; }
    if (k === KEY.LEFT || k === KEY.BACK || k === KEY.ESC) { S.zone = 'menu'; render(); return true; }
    if (k === KEY.ENTER) { selectFocused(); return true; }
    if (k === KEY.PLAY) { if (S.view !== 'lists') play(S.viewSource, S.listIndex); return true; }
    if (k === KEY.YELLOW) { if (S.view !== 'lists') toggleFavorite(); return true; }
    if (k === KEY.RED) { if (S.view === 'lists') removeList(); return true; }
    if (k === KEY.GREEN) { if (S.view === 'lists') openPairing(); return true; }
    if (k === KEY.BLUE) { openSearch(); return true; }
    return false;
  }

  function handlePlay(k) {
    if (k === KEY.BACK || k === KEY.ESC) {
      if (S.overlayOpen) closeOverlay();
      else stopPlayback();
      return true;
    }
    if (S.overlayOpen) {
      var n = S.playSource.length;
      if (k === KEY.UP) { S.overlayIndex = Math.max(0, S.overlayIndex - 1); renderOverlay(); return true; }
      if (k === KEY.DOWN) { S.overlayIndex = Math.min(n - 1, S.overlayIndex + 1); renderOverlay(); return true; }
      if (k === KEY.ENTER) { play(S.playSource, S.overlayIndex); return true; }
      return false;
    }
    if (k === KEY.ENTER) { openOverlay(); return true; }
    if (k === KEY.UP || k === KEY.CH_UP || k === KEY.FWD) { step(1); return true; }
    if (k === KEY.DOWN || k === KEY.CH_DOWN || k === KEY.REW) { step(-1); return true; }
    if (k === KEY.INFO) { if (S.playSource[S.playIndex]) showBanner(S.playSource[S.playIndex]); return true; }
    return false;
  }

  function init() {
    S.lists = load('rp.lists', []);
    if (!Array.isArray(S.lists)) S.lists = [];
    S.favorites = load('rp.favorites', []);
    S.history = load('rp.history', []);
    if (!Array.isArray(S.favorites)) S.favorites = [];
    if (!Array.isArray(S.history)) S.history = [];

    // Versão 3: o app começa limpo. Remove só as listas pré-configuradas antigas; as do usuário ficam.
    if (load('rp.seedVersion', 0) < 3) {
      S.lists = S.lists.filter(function (l) { return OLD_DEFAULT_URLS.indexOf(l.url) < 0; });
      save('rp.lists', S.lists);
      save('rp.seedVersion', 3);
    }

    $('video').addEventListener('error', showError);
    $('modalInput').addEventListener('keydown', onInputKey);
    $('banner').querySelector('img').addEventListener('error', function () { this.classList.add('hidden'); });

    document.addEventListener('keydown', function (e) {
      if (S.zone === 'input') return;             // o campo de texto trata as próprias teclas
      var handled;
      if (S.pairing) {
        if (e.keyCode === KEY.BACK || e.keyCode === KEY.ESC) cancelPairing();
        e.preventDefault();
        return;
      }
      if (S.modal) handled = handleModal(e.keyCode);
      else if (S.mode === 'play') handled = handlePlay(e.keyCode);
      else handled = handleBrowse(e.keyCode);
      if (handled) e.preventDefault();
    });

    buildMenu();
    render();
    refreshCatalog();
  }

  init();

  // Registra que esta versão abriu bem. O carregador usa isso para detectar uma versão baixada que trava.
  try { localStorage.setItem('rp.bootOk', window.RP_BOOT_TAG || 'local'); } catch (e) { /* ignora */ }
})();
