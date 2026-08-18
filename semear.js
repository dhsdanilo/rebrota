/* Sementeira — a tela da esposa.
 *
 * Um campo, um botão. Cada semente é um evento `semeou` no diário dela
 * (`pe_esposa`), que a sincronização leva até a mesa, onde vira semente do
 * catálogo. Ela não vê nem escreve mais nada: as duas recusas, as vagas e o
 * catálogo são de quem negocia consigo mesmo — não transferem (§10 do delta).
 */

(function () {
  'use strict';

  var M = Modelo;
  var EU = 'pe_esposa';

  var $texto = document.getElementById('texto');
  var $aviso = document.getElementById('aviso');
  var $lista = document.getElementById('lista');
  var $nuvemToken = document.getElementById('nuvemToken');
  var $nuvemEstado = document.getElementById('nuvemEstado');

  var FRASES = [
    'O que passou pela cabeça?',
    'Uma ideia para o sítio.',
    'Pode ser vaga. Ele lapida depois.',
    'Semente não precisa de plano.'
  ];
  document.getElementById('frase').textContent = FRASES[Math.floor(Math.random() * FRASES.length)];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function desenharLista() {
    var minhas = M.sementesDe(EU).slice().reverse().slice(0, 8);
    $lista.innerHTML = minhas.length
      ? minhas.map(function (s) {
          return '<li><strong>' + esc(s.nome) + '</strong>' +
            (s.frase !== s.nome ? '<span>' + esc(s.frase) + '</span>' : '') +
            '<em>' + esc(M.formatarData(M.diaDe(s.criadaEm))) + '</em></li>';
        }).join('')
      : '<li class="aviso">Nada plantado ainda.</li>';
  }

  document.getElementById('btPlantar').addEventListener('click', function () {
    var t = $texto.value.trim();
    if (!t) return ($aviso.textContent = 'escreva alguma coisa primeiro');
    var s = M.semear(EU, t);
    $texto.value = '';
    $aviso.textContent = 'plantada: ' + s.nome;
    desenharLista();
  });

  // ── nuvem ─────────────────────────────────────────────────────────

  function textoDaNuvem(s) {
    if (!s.ligado) return 'Sem token, as sementes ficam só neste aparelho.';
    if (s.ocupado) return 'sincronizando…';
    if (s.erro) return 'não consegui: ' + s.erro;
    if (s.ultimo) return 'sincronizado às ' + M.horaDe(new Date(s.ultimo));
    return 'ligado';
  }

  function desenharNuvem() {
    var s = Sync.situacao();
    $nuvemEstado.textContent = textoDaNuvem(s);
    document.getElementById('btLigarNuvem').hidden = s.ligado;
    document.getElementById('btDesligarNuvem').hidden = !s.ligado;
    document.getElementById('btSincronizarAgora').hidden = !s.ligado;
    document.getElementById('nuvemComo').hidden = s.ligado;
    $nuvemToken.hidden = s.ligado;
  }

  document.getElementById('btLigarNuvem').addEventListener('click', function () {
    var t = $nuvemToken.value.trim();
    if (!t) return ($nuvemEstado.textContent = 'cole o token primeiro');
    $nuvemToken.value = '';
    Sync.ligar(t);
  });
  document.getElementById('btDesligarNuvem').addEventListener('click', function () { Sync.desligar(); desenharNuvem(); });
  document.getElementById('btSincronizarAgora').addEventListener('click', function () { Sync.sincronizar(); });

  Sync.configurar({ escreveCatalogo: false, pessoa: EU });
  M.quandoSalvar(function () { Sync.marcarSujo(); });
  Sync.ouvir(function () { desenharNuvem(); desenharLista(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  M.carregar();
  desenharLista();
  Sync.iniciar();
  desenharNuvem();
})();
