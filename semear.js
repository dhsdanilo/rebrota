/* Sementeira — a tela da esposa.
 *
 * Duas páginas. PLANTAR: um campo, um botão. Cada semente é um evento `semeou`
 * no diário dela (`pe_esposa`), que a sincronização leva até a mesa, onde vira
 * semente do catálogo. O SÍTIO: o catálogo inteiro em leitura — em andamento,
 * fila, avulsas, sementes de todos —, para ela saber o que existe antes de
 * plantar e acompanhar o que andou. Ela não escreve nada além da semente: as
 * duas recusas, as vagas e o catálogo são de quem negocia consigo mesmo — não
 * transferem (§10 do delta). E o que fica fora da leitura é a conversa dele
 * com o app: a oferta do momento e as recusas (§35).
 */

(function () {
  'use strict';

  var M = Modelo;
  var EU = 'pe_esposa';

  var $texto = document.getElementById('texto');
  var $aviso = document.getElementById('aviso');
  var $lista = document.getElementById('lista');
  var $parece = document.getElementById('parece');
  var $busca = document.getElementById('busca');
  var $sitio = document.getElementById('sitio');
  var $nuvemToken = document.getElementById('nuvemToken');
  var $nuvemEstado = document.getElementById('nuvemEstado');

  var FRASES = [
    'O que passou pela cabeça?',
    'Uma ideia para o sítio.',
    'Pode ser vaga. O Dan lapida depois.',
    'Semente não precisa de plano.'
  ];
  document.getElementById('frase').textContent = FRASES[Math.floor(Math.random() * FRASES.length)];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── as duas páginas ───────────────────────────────────────────────

  var pagina = 'plantar';
  var $btIr = document.getElementById('btIr');

  function ir(para) {
    pagina = para;
    document.getElementById('paginaPlantar').hidden = para !== 'plantar';
    document.getElementById('paginaSitio').hidden = para !== 'sitio';
    $btIr.textContent = para === 'sitio' ? 'plantar' : 'o sítio';
    $btIr.dataset.ir = para === 'sitio' ? 'plantar' : 'sitio';
    if (para === 'sitio') desenharSitio();
    window.scrollTo(0, 0);
  }
  $btIr.addEventListener('click', function () { ir($btIr.dataset.ir); });

  // ── sementes: as dela e as de todos ───────────────────────────────

  /* O que aconteceu com cada semente. O estado mora no catálogo, que a nuvem
     traz da mesa; a semente que a mesa ainda não viu é simplesmente nova.
     Nada some: descartada vem com o motivo que ele escreveu — é o combinado. */
  var ESTADO = {
    nova: 'nova', descartada: 'descartada', projeto: 'pode virar muda',
    tarefa: 'pode virar tarefa', virou_projeto: 'virou muda', virou_tarefa: 'virou tarefa'
  };

  function estadoDela(s) {
    return M.semente(s.id) || { estado: 'nova', motivo: '' };
  }

  function linhaSemente(s, e, quem) {
    var grupo = e.estado.indexOf('virou_') === 0 ? 'virou' : e.estado;
    return '<li><strong>' + esc(s.nome) + '</strong>' +
      (s.frase !== s.nome ? '<span>' + esc(s.frase) + '</span>' : '') +
      '<em>' + (quem ? esc(quem) + ' · ' : '') + esc(M.formatarData(M.diaDe(s.criadaEm))) +
        ' <b class="semente-estado semente-estado-' + grupo + '">' + esc(ESTADO[e.estado] || e.estado) + '</b></em>' +
      (e.estado === 'descartada' && e.motivo ? '<span class="semear-motivo">' + esc(e.motivo) + '</span>' : '') +
      '</li>';
  }

  function desenharLista() {
    var minhas = M.sementesDe(EU).slice().reverse();
    $lista.innerHTML = minhas.length
      ? minhas.map(function (s) { return linhaSemente(s, estadoDela(s)); }).join('')
      : '<li class="aviso">Nada plantado ainda.</li>';
  }

  // ── "já existe?" ──────────────────────────────────────────────────

  /* Enquanto ela escreve, o que se parece com a ideia — projeto, tarefa ou
     semente que já existe. Responde a pergunta na hora e não impede nada:
     plantar parecido continua sendo direito dela. */
  function desenharParece() {
    var r = M.buscar($texto.value);
    var itens = []
      .concat(r.projetos.slice(0, 3).map(function (p) {
        return '<li><b>' + esc(p.nome || 'projeto sem nome') + '</b> — projeto, ' + esc(M.etiquetaDe(p).texto) + '</li>';
      }))
      .concat(r.tarefas.slice(0, 3).map(function (t) {
        var p = t.projetoId ? M.projeto(t.projetoId) : null;
        return '<li><b>' + esc(t.texto) + '</b> — tarefa' + (p ? ' de ' + esc(p.nome) : ' avulsa') +
          (M.estadoDe(t.id) === 'feita' ? ', feita' : '') + '</li>';
      }))
      .concat(r.sementes.slice(0, 3).map(function (s) {
        return '<li><b>' + esc(s.nome) + '</b> — semente, ' + esc(ESTADO[s.estado]) + '</li>';
      }));
    $parece.hidden = !itens.length;
    $parece.innerHTML = itens.length
      ? '<p>parece com o que já existe:</p><ul>' + itens.join('') + '</ul>' : '';
  }
  $texto.addEventListener('input', desenharParece);

  document.getElementById('btPlantar').addEventListener('click', function () {
    var t = $texto.value.trim();
    if (!t) return ($aviso.textContent = 'escreva alguma coisa primeiro');
    var s = M.semear(EU, t);
    $texto.value = '';
    $parece.hidden = true;
    $aviso.textContent = 'plantada: ' + s.nome;
    desenharLista();
  });

  // ── o sítio ───────────────────────────────────────────────────────

  var abertos = {};   // cartões abertos, por id do projeto

  function feitasEAbertas(p) {
    var historico = M.historicoDe(p.id);
    var passadas = {};
    historico.forEach(function (h) { passadas[h.tarefa.id] = true; });
    var abertas = M.passosDe(p.id).filter(function (t) { return !passadas[t.id]; });
    return { historico: historico, abertas: abertas };
  }

  /* O envelope só cabe em projeto PLANEJADO — é quando se sabe quanto custa e
     ainda não se começou (§36). Antes disso não existe; depois, o app já parou
     de olhar para dinheiro (§3) e sobra só o "orçado em". */
  function envelope(p) {
    if (p.custoEstimado === null || p.custoEstimado === undefined) return '';
    if (p.estado === 'preparo' && !p.papel) {
      return '<p class="sitio-envelope">' + esc(M.moeda(p.guardado)) + ' de ' + esc(M.moeda(p.custoEstimado)) + '</p>';
    }
    // rodando ou concluído: só quanto foi orçado — o envelope já disparou
    if ((p.papel === 'titular' || p.papel === 'reserva' || p.estado === 'concluido') && Number(p.custoEstimado) > 0) {
      return '<p class="sitio-envelope">orçado em ' + esc(M.moeda(p.custoEstimado)) + '</p>';
    }
    return '';
  }

  /* Um cartão por projeto, fechado por padrão: nome, destino, etiqueta e a
     conta do que anda. Aberto, mostra as tarefas por fazer (planejamento e
     execução, como na mesa) e o projeto até aqui — a trilha da bota, as
     pegadas com as anotações. */
  function cartaoProjeto(p) {
    var e = M.etiquetaDe(p);
    var x = feitasEAbertas(p);
    var aberto = !!abertos[p.id];
    var ehMuda = p.estado === 'fila' || p.estado === 'descartado';
    var resumo = ehMuda
      ? (p.estado === 'descartado' ? 'descartada: ' + (p.muda.motivo || '') : M.leituraFria(p) || (p.muda.estado === 'pronta' ? 'pronta, esperando vaga' : 'sendo lapidada'))
      : [
          x.historico.length ? x.historico.length + ' feita' + (x.historico.length === 1 ? '' : 's') : '',
          x.abertas.length ? x.abertas.length + ' por fazer' : ''
        ].filter(Boolean).join(' · ') || 'sem tarefas ainda';

    var corpo = '';
    if (aberto && ehMuda) {
      function lidas(titulo, l) {
        var vivas = M.cadeiasVivas(l);
        return vivas.length ? '<h4>' + titulo + '</h4><ul class="cadeias-lidas">' + vivas.map(function (c) {
          return '<li>' + c.map(esc).join(' <span class="seta">→</span> ') + '</li>'; }).join('') + '</ul>' : '';
      }
      corpo = '<div class="sitio-corpo">' + lidas('vantagens', p.muda.vantagens) + lidas('desvantagens', p.muda.desvantagens) +
        (p.muda.sentimento ? '<h4>como o Dan se sentiria</h4><p class="sitio-texto">' + esc(p.muda.sentimento) + '</p>' : '') + '</div>';
    } else if (aberto) {
      var plan = x.abertas.filter(function (t) { return t.etapa === 'planejamento'; });
      var exec = x.abertas.filter(function (t) { return t.etapa !== 'planejamento'; });
      function listaAbertas(titulo, lista) {
        if (!lista.length) return '';
        return '<h4>' + titulo + '</h4><ul class="sitio-tarefas">' + lista.map(function (t) {
          return '<li>' + esc(t.texto || 'tarefa sem texto') +
            '<em>' + esc(M.duracao(t.duracaoTotal)) + (t.onde ? ' · ' + esc(t.onde) : '') + '</em></li>';
        }).join('') + '</ul>';
      }
      corpo = '<div class="sitio-corpo">' +
        listaAbertas('planejamento', plan) + listaAbertas('execução', exec) +
        (x.historico.length
          ? '<h4>o projeto até aqui</h4><ol class="trilha">' + x.historico.map(function (h) {
              return '<li class="pegada pegada-' + h.tipo + '">' +
                '<span class="pegada-nome">' + esc(h.tarefa.texto || 'sem texto') +
                  '<em>' + esc(M.formatarData(h.quando.slice(0, 10))) + '</em></span>' +
                (h.nota ? '<p class="pegada-nota">' + esc(h.nota) + '</p>' : '') +
                '</li>';
            }).join('') + '</ol>'
          : '') +
        '</div>';
    }

    return '<article class="sitio-projeto' + (aberto ? ' sitio-aberto' : '') + '" data-projeto="' + p.id + '">' +
      '<button type="button" class="sitio-cabeca" data-abrir="' + p.id + '" aria-expanded="' + aberto + '">' +
        '<span class="sitio-etiqueta sitio-etiqueta-' + esc(e.chave) + '">' + esc(e.texto) + '</span>' +
        '<strong>' + esc(p.nome || 'projeto sem nome') + '</strong>' +
        (p.resultado ? '<span class="sitio-fim">' + esc(p.resultado) + '</span>' : '') +
        envelope(p) +
        '<em>' + esc(resumo) + '</em>' +
      '</button>' + corpo + '</article>';
  }

  function bloco(titulo, html, vazio) {
    return '<section class="sitio-bloco"><h2>' + titulo + '</h2>' +
      (html || '<p class="aviso">' + esc(vazio) + '</p>') + '</section>';
  }

  function linhaAvulsa(t) {
    var ultima = M.periodica(t) ? M.ultimaVezDe(t.id) : null;
    return '<li>' + esc(t.texto || 'tarefa sem texto') +
      '<em>' + esc(M.duracao(t.duracaoTotal)) +
        (M.periodica(t) ? ' · a cada ' + esc(t.prazo.cadenciaDias) + ' dias' +
          (ultima ? ' · última vez ' + esc(M.formatarData(ultima)) : '') : '') +
      '</em></li>';
  }

  function quemPlantou(s) { return M.nomeDe(s.autor); }

  function desenharSitio() {
    var termo = $busca.value.trim();
    if (termo) return desenharBusca(termo);

    var projetos = M.cat().projetos;
    var vagas = ['titular', 'reserva', 'planejamento'].map(function (papel) {
      var p = projetos.filter(function (q) { return q.papel === papel; })[0];
      return p ? cartaoProjeto(p) :
        '<article class="sitio-projeto sitio-vaga"><span class="sitio-etiqueta sitio-etiqueta-' + papel + '">' +
          (papel === 'planejamento' ? 'em planejamento' : papel) + '</span><em>vaga aberta</em></article>';
    }).join('');

    var planejadas = projetos.filter(function (p) { return !p.papel && p.estado === 'preparo'; });
    var fila = projetos.filter(function (p) { return p.estado === 'fila'; });
    var parados = projetos.filter(function (p) { return p.estado === 'parado'; });
    var concluidos = projetos.filter(function (p) { return p.estado === 'concluido'; });
    var descartadas = projetos.filter(function (p) { return p.estado === 'descartado'; });

    var avulsas = M.avulsas().filter(function (t) {
      var s = M.estadoDe(t.id); return s !== 'feita' && s !== 'encerrada';
    });

    var sementes = M.cat().sementes.slice().sort(function (a, b) { return a.criadaEm < b.criadaEm ? 1 : -1; });

    $sitio.innerHTML =
      bloco('Em andamento', vagas) +
      (planejadas.length ? bloco('Planejadas', planejadas.map(cartaoProjeto).join('')) : '') +
      bloco('Mudas', fila.map(cartaoProjeto).join(''), 'Nenhuma muda plantada.') +
      bloco('Avulsas abertas', avulsas.length ? '<ul class="sitio-tarefas">' + avulsas.map(linhaAvulsa).join('') + '</ul>' : '', 'Nenhuma tarefa avulsa aberta.') +
      bloco('Sementes', sementes.length ? '<ul class="semear-lista-sementes">' + sementes.map(function (s) {
        return linhaSemente(s, s, quemPlantou(s)); }).join('') + '</ul>' : '', 'Nenhuma semente ainda.') +
      (parados.length ? bloco('Suspensos', parados.map(cartaoProjeto).join('')) : '') +
      (concluidos.length ? bloco('Concluídos', concluidos.map(cartaoProjeto).join('')) : '') +
      (descartadas.length ? bloco('Mudas descartadas', descartadas.map(cartaoProjeto).join('')) : '');
  }

  function desenharBusca(termo) {
    var r = M.buscar(termo);
    var nada = !r.projetos.length && !r.tarefas.length && !r.sementes.length;
    $sitio.innerHTML = nada
      ? '<p class="aviso sitio-nada">Nada com essas palavras. Pode ser semente nova.</p>'
      : (r.projetos.length ? bloco('Projetos', r.projetos.map(cartaoProjeto).join('')) : '') +
        (r.tarefas.length ? bloco('Tarefas', '<ul class="sitio-tarefas">' + r.tarefas.map(function (t) {
          var p = t.projetoId ? M.projeto(t.projetoId) : null;
          var s = M.estadoDe(t.id);
          return '<li>' + esc(t.texto) + '<em>' + (p ? esc(p.nome) : 'avulsa') +
            (s === 'feita' ? ' · feita' : s === 'encerrada' ? ' · cancelada' : '') + '</em></li>';
        }).join('') + '</ul>') : '') +
        (r.sementes.length ? bloco('Sementes', '<ul class="semear-lista-sementes">' + r.sementes.map(function (s) {
          return linhaSemente(s, s, quemPlantou(s)); }).join('') + '</ul>') : '');
  }

  $busca.addEventListener('input', desenharSitio);
  $sitio.addEventListener('click', function (e) {
    var b = e.target.closest('[data-abrir]');
    if (!b) return;
    var id = b.getAttribute('data-abrir');
    abertos[id] = !abertos[id];
    desenharSitio();
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
  Sync.ouvir(function () {
    desenharNuvem(); desenharLista();
    if (pagina === 'sitio') desenharSitio();
  });

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
