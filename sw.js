/* Rebrota — service worker.
 *
 * Só faz uma coisa: guardar o app para ele abrir sem internet. Não guarda dado
 * nenhum do sítio — isso é do localStorage e da sincronização.
 *
 * O nome do cache não precisa mais acompanhar versão de arquivo: como a busca
 * é pela rede primeiro, cache velho nunca é servido quando há internet. Ele só
 * existe para o app abrir no meio do mato, sem sinal.
 */
var VERSAO = 'rebrota';

/* Sem ?v= aqui: a lista é do que precisa existir para o app abrir offline na
   primeira vez. Depois disso o cache se atualiza sozinho a cada carregamento. */
var CASCO = [
  './',
  './index.html',
  './app.css',
  './modelo.js',
  './tempo.js',
  './sync.js',
  './motor.js',
  './dados.js',
  './campo.js',
  './app.js',
  './manifest.json',
  './icone.svg',
  './icone-mascara.svg',
  // a tela de sementes, que é outro app instalável sobre os mesmos arquivos
  './semear.html',
  './semear.js',
  './semear.webmanifest',
  './icone-semente.svg'
];

self.addEventListener('install', function (e) {
  // addAll falha inteiro se um arquivo faltar; um a um, o que existir entra
  e.waitUntil(caches.open(VERSAO).then(function (cache) {
    return Promise.all(CASCO.map(function (url) {
      return cache.add(url).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (nomes) {
    return Promise.all(nomes.map(function (n) {
      return n === VERSAO ? null : caches.delete(n);
    }));
  }).then(function () { return self.clients.claim(); }));
});

/* REDE PRIMEIRO, cache como paraquedas.
 *
 * Com cache primeiro, a versão nova só chegava quando alguém lembrasse de subir
 * um número — e lembrar é trabalho, trabalho drena motivação, e motivação que
 * drena é como o app morre. Assim, abrir com internet já traz o mais novo;
 * abrir sem internet abre o que ficou guardado da última vez.
 *
 * O custo é uma ida à rede por arquivo, com estes arquivos pequenos. Se a rede
 * estiver ruim, o tempo limite abaixo corta e serve o cache.
 */
var LIMITE_MS = 3500;

function pelaRede(req) {
  return new Promise(function (ok, falha) {
    var caiu = setTimeout(function () { falha(new Error('demorou')); }, LIMITE_MS);
    fetch(req).then(function (r) { clearTimeout(caiu); ok(r); },
                    function (e) { clearTimeout(caiu); falha(e); });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;

  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // API do GitHub sempre pela rede

  e.respondWith(
    pelaRede(e.request).then(function (resposta) {
      // só o que veio inteiro entra no cache: 404 guardado é 404 para sempre
      if (resposta.ok) guardar(e.request, resposta.clone());
      return resposta;
    }).catch(function () {
      /* Paraquedas sem exigir o `?v=` exato: se a versão nova chegou pela
         metade, o arquivo da versão anterior ainda abre o app. */
      return caches.match(e.request, { ignoreSearch: true }).then(function (guardado) {
        if (guardado) return guardado;
        return e.request.mode === 'navigate'
          ? caches.match('./index.html')
          : Promise.reject(new Error('sem cache'));
      });
    })
  );
});

/* Um arquivo, uma cópia: ao guardar `app.js?v=34`, as cópias `?v=33` e
   anteriores saem. Sem isso o cache crescia uma versão por atualização, para
   sempre. */
function guardar(req, resposta) {
  var url = new URL(req.url);
  var caminho = url.origin + url.pathname;
  return caches.open(VERSAO).then(function (c) {
    return c.keys().then(function (chaves) {
      return Promise.all(chaves.map(function (k) {
        var ku = new URL(k.url);
        return (ku.origin + ku.pathname === caminho && k.url !== req.url) ? c.delete(k) : null;
      }));
    }).then(function () { return c.put(req, resposta); });
  });
}
