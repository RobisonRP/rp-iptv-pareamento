/*
 * RP IPTV (webOS) — carregador e atualizador.
 * Este arquivo vem no pacote instalado e NÃO é atualizado sozinho: mudanças aqui exigem reinstalação.
 * Escolhe entre a versão do pacote e a versão baixada (rp.bundle), e consulta atualizações.
 */
(function () {
  'use strict';

  var LOCAL_VERSION = '0.10.0';   // deve ser igual ao "version" do appinfo.json
  var BASE = 'https://robisonrp.github.io/rp-iptv-pareamento/app/';
  var K_BUNDLE = 'rp.bundle';    // versão baixada: {version, base, files:{caminho: texto}}
  var K_BOOTING = 'rp.booting';  // etiqueta da última abertura
  var K_OK = 'rp.bootOk';        // etiqueta gravada pelo app quando termina de carregar
  var K_BAD = 'rp.badVersion';   // versão baixada que travou; não baixar de novo
  var SCRIPTS = ['vendor/hls.min.js', 'vendor/qrcode.js', 'js/config.js', 'js/parsers.js', 'js/app.js'];

  function getItem(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setItem(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem espaço: segue sem gravar */ } }
  function delItem(k) { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } }

  // Compara versões "a.b.c". Retorna >0 se a > b, <0 se a < b, 0 se iguais.
  function cmp(a, b) {
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function readBundle() {
    var raw = getItem(K_BUNDLE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  var bundle = readBundle();

  // A última abertura com a versão baixada não terminou: ela travou. Descarta.
  if (bundle && getItem(K_BOOTING) !== getItem(K_OK)) {
    setItem(K_BAD, bundle.version);
    delItem(K_BUNDLE);
    bundle = null;
  }
  // Versão do pacote mais nova que a baixada (ex.: reinstalou): usa a do pacote.
  if (bundle && cmp(bundle.version, LOCAL_VERSION) <= 0) {
    delItem(K_BUNDLE);
    bundle = null;
  }

  var tag = bundle ? 'v' + bundle.version : 'local:' + LOCAL_VERSION;
  window.RP_BOOT_TAG = tag;
  setItem(K_BOOTING, tag);

  function applyBundle(b) {
    var f = b.files;
    for (var i = 0; i < SCRIPTS.length; i++) {
      if (typeof f[SCRIPTS[i]] !== 'string') throw new Error('arquivo ausente: ' + SCRIPTS[i]);
    }
    if (typeof f['index.html'] !== 'string' || typeof f['css/app.css'] !== 'string') throw new Error('página ausente');

    var parsed = new DOMParser().parseFromString(f['index.html'], 'text/html');
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var j = 0; j < links.length; j++) links[j].parentNode.removeChild(links[j]);
    var style = document.createElement('style');
    style.textContent = f['css/app.css'];
    document.head.appendChild(style);

    var corpo = parsed.body.cloneNode(true);
    var scripts = corpo.querySelectorAll('script');
    for (var k = 0; k < scripts.length; k++) scripts[k].parentNode.removeChild(scripts[k]);
    document.body.innerHTML = corpo.innerHTML;

    // Scripts inline, na ordem: a execução é síncrona e na mesma sequência.
    for (var m = 0; m < SCRIPTS.length; m++) {
      var s = document.createElement('script');
      s.textContent = f[SCRIPTS[m]];
      document.body.appendChild(s);
    }
  }

  function loadLocal() {
    for (var i = 0; i < SCRIPTS.length; i++) {
      var s = document.createElement('script');
      s.src = SCRIPTS[i];
      s.async = false;          // mantém a ordem de execução
      document.body.appendChild(s);
    }
  }

  function showNotice(texto) {
    var div = document.createElement('div');
    div.textContent = texto;
    div.setAttribute('style', 'position:absolute;top:20px;right:40px;z-index:99;background:#111A30;color:#42D6CF;' +
      'font-family:Arial,sans-serif;font-size:24px;padding:14px 22px;border-radius:10px;border:1px solid #42D6CF;');
    document.body.appendChild(div);
    setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 9000);
  }

  function downloadAll(remoto) {
    var base = remoto.base || BASE;
    var caminhos = remoto.files.map(function (x) { return x.path; });
    var arquivos = {};
    return Promise.all(caminhos.map(function (p) {
      return fetch(base + p, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('falha ao baixar ' + p);
        return r.text();
      }).then(function (t) { arquivos[p] = t; });
    })).then(function () {
      if (typeof arquivos['index.html'] !== 'string' || typeof arquivos['js/app.js'] !== 'string') {
        throw new Error('pacote incompleto');
      }
      setItem(K_BUNDLE, JSON.stringify({ version: remoto.version, base: base, files: arquivos }));
      showNotice('Atualização ' + remoto.version + ' baixada. Feche e abra o app para usar.');
    });
  }

  function checkForUpdate() {
    if (!window.fetch) return;
    if (getItem('rp.autoUpdate') === 'false') return;   // usuário desligou a atualização automática
    var atual = bundle ? bundle.version : LOCAL_VERSION;
    fetch(BASE + 'version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (remoto) {
        if (!remoto || !remoto.version || !remoto.files) return;
        if (remoto.version === getItem(K_BAD)) return;   // essa versão já travou aqui
        if (cmp(remoto.version, atual) <= 0) return;     // já está atualizado
        return downloadAll(remoto);
      })
      .catch(function () { /* sem internet ou erro: segue com a versão atual */ });
  }

  function start() {
    if (bundle) {
      try {
        applyBundle(bundle);
      } catch (e) {
        // Versão baixada inválida: descarta e recarrega com a do pacote.
        setItem(K_BAD, bundle.version);
        delItem(K_BUNDLE);
        location.reload();
        return;
      }
    } else {
      loadLocal();
    }
    checkForUpdate();
  }

  start();
})();
