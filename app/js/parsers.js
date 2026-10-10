/*
 * RP IPTV (webOS) — funções puras de parsing e classificação de canais.
 * Sem dependências. Mesma lógica do Parsers.brs do Roku, para manter os resultados iguais.
 */
(function (root) {
  'use strict';

  function isHttpUrl(value) {
    var l = String(value || '').toLowerCase();
    return l.indexOf('http://') === 0 || l.indexOf('https://') === 0;
  }

  function extractAttribute(line, key) {
    var needle = key + '="';
    var start = line.indexOf(needle);
    if (start < 0) return '';
    start += needle.length;
    var end = line.indexOf('"', start);
    return end < 0 ? '' : line.substring(start, end);
  }

  // Nome após a vírgula que vem depois do último atributo entre aspas.
  function extractExtinfName(line) {
    var lastQuote = line.lastIndexOf('"');
    var from = lastQuote >= 0 ? lastQuote + 1 : 0;
    var comma = line.indexOf(',', from);
    if (comma < 0) return 'Canal';
    var name = line.substring(comma + 1).trim();
    return name || 'Canal';
  }

  function parsePlaylistText(text) {
    var channels = [];
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var pending = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        pending = {
          name: extractExtinfName(line),
          category: extractAttribute(line, 'group-title'),
          logo: extractAttribute(line, 'tvg-logo'),
          epgId: extractAttribute(line, 'tvg-id')
        };
      } else if (line.charAt(0) !== '#' && isHttpUrl(line)) {
        var item = pending || { name: '', category: '', logo: '', epgId: '' };
        channels.push({
          name: item.name || line,
          url: line,
          category: item.category,
          logo: item.logo,
          epgId: item.epgId
        });
        pending = null;
      }
    }
    return channels;
  }

  // Ordem em que as seções aparecem no menu. Seções fora desta lista vão para o fim.
  var SECTION_ORDER = [
    'Canais abertos', 'Filmes', 'Séries', 'Desenhos e infantil', 'Futebol e esportes',
    'Notícias', 'Música', 'Documentários e educação', 'Religiosos', 'Culinária', 'Outros'
  ];

  // group-title do M3U (inglês ou português) -> seção do app.
  var GROUP_MAP = [
    { words: ['movie', 'film', 'cinema'], label: 'Filmes' },
    { words: ['series', 'série', 'tv show', 'sitcom', 'novela'], label: 'Séries' },
    { words: ['kids', 'infantil', 'children', 'cartoon', 'animation', 'animação', 'desenho'], label: 'Desenhos e infantil' },
    { words: ['sport', 'esporte', 'futebol', 'football', 'soccer'], label: 'Futebol e esportes' },
    { words: ['news', 'notícia', 'noticia'], label: 'Notícias' },
    { words: ['music', 'música', 'musica'], label: 'Música' },
    { words: ['documentary', 'documentário', 'documentario', 'education', 'educação', 'educacao', 'science', 'culture', 'cultura'], label: 'Documentários e educação' },
    { words: ['religio'], label: 'Religiosos' },
    { words: ['cooking', 'culinária', 'culinaria', 'food'], label: 'Culinária' },
    { words: ['general', 'entertainment', 'abertos', 'aberto', 'generalista', 'public'], label: 'Canais abertos' }
  ];

  // Palavras no nome do canal, usadas quando o grupo é genérico ou ausente.
  var KIDS_NAME = ['kids', 'gloob', 'cartoon', 'cartoonito', 'nick', 'junior', 'boomerang', 'discovery kids', 'ra-tim-bum', 'rá-tim-bum', 'desenho', 'tiny'];
  var SPORT_NAME = ['sport', 'sports', 'esporte', 'futebol', 'espn', 'premiere', 'combate', 'libertadores', 'copa', 'fox sports', 'band sports', 'cazé', 'cazetv'];
  var MOVIE_NAME = ['movie', 'movies', 'filme', 'cinema', 'cine ', 'telecine', 'paramount', 'tcm', 'megapix'];
  var SERIES_NAME = ['series', 'séries', 'serie ', 'sitcom', 'novela'];
  var NEWS_NAME = ['news', 'notícia', 'noticia', 'cnn', 'globonews', 'record news', 'band news', 'jornal'];

  function containsAny(text, words) {
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) >= 0) return true;
    }
    return false;
  }

  // Seção do canal a partir do grupo do M3U; sem grupo útil, a partir do nome.
  function normalizeGroup(group) {
    var g = String(group || '').toLowerCase().trim();
    if (!g) return '';
    for (var i = 0; i < GROUP_MAP.length; i++) {
      if (containsAny(g, GROUP_MAP[i].words)) return GROUP_MAP[i].label;
    }
    return '';
  }

  function sectionFor(name, group) {
    var g = normalizeGroup(group);
    if (g && g !== 'Canais abertos') return g;
    var n = String(name || '').toLowerCase();
    if (containsAny(n, KIDS_NAME)) return 'Desenhos e infantil';
    if (containsAny(n, SPORT_NAME)) return 'Futebol e esportes';
    if (containsAny(n, MOVIE_NAME)) return 'Filmes';
    if (containsAny(n, SERIES_NAME)) return 'Séries';
    if (containsAny(n, NEWS_NAME)) return 'Notícias';
    if (g) return 'Canais abertos';
    if (String(group || '').trim()) return 'Outros';
    return 'Canais abertos';
  }

  // Código de pareamento: 6 caracteres sem letras/números que se confundem (I, O, 0, 1).
  var PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function makePairCode(random) {
    var out = '';
    for (var i = 0; i < 6; i++) {
      out += PAIR_ALPHABET.charAt(Math.floor(random() * PAIR_ALPHABET.length));
    }
    return out;
  }
  function isPairCode(code) {
    return /^[A-Z2-9]{6}$/.test(String(code || ''));
  }

  var api = {
    makePairCode: makePairCode,
    isPairCode: isPairCode,
    isHttpUrl: isHttpUrl,
    parsePlaylistText: parsePlaylistText,
    sectionFor: sectionFor,
    normalizeGroup: normalizeGroup,
    SECTION_ORDER: SECTION_ORDER,
    extractExtinfName: extractExtinfName,
    extractAttribute: extractAttribute
  };

  root.RPParsers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
