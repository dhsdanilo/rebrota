/* App do sítio — frente de campo (a tarefa em andamento).
 *
 * Postura de bota: uma mão, polegar, segundos, zero digitação exceto a linha
 * do travamento. §64: o app não pergunta mais "onde, quanto tempo, que clima"
 * nem sorteia — quem escolhe é ele, pela vitrine. Esta tela só existe DEPOIS
 * do "vamos": a folha de trabalho da tarefa aceita, com as saídas dela
 * (terminei · parei por agora · não dá · encerrar).
 */

var Campo = (function () {
  'use strict';

  var M = Modelo;
  var EU = 'pe_eu';

  var cena = { fase: 'ativa', rascunho: {}, aviso: '' };
  var $ = null;
  var sair = null;   // quem abriu diz como se volta para a tela inicial

  /* Sem tarefa em andamento não há o que mostrar aqui: volta para a entrada,
     onde a vitrine está. */
  function abrir(alvo, pronto, aoSair) {
    $ = alvo;
    sair = aoSair || null;
    cena.rascunho = {};
    cena.aviso = '';
    cena.listar = null;
    cena.fase = 'ativa';
    if (!M.tarefaAtivaDe(EU)) return voltarAoInicio();
    desenhar();
  }

  /* Voltar para a tela inicial, levando o que a regra tem a dizer (a compra
     que ficou esperando, o projeto que mudou de vaga). */
  function voltarAoInicio() {
    var aviso = cena.avisoPendente || '';
    cena.avisoPendente = '';
    cena.rascunho = {};
    if (sair) return sair(aviso);
  }

  // ── utilidades ────────────────────────────────────────────────────

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── tarefa ativa (§8) ─────────────────────────────────────────────

  /* A tarefa ACEITA é a folha de trabalho, e aqui o plano inteiro tem que
     estar à mão. Esconder o que levar depois do "vamos" jogaria fora
     justamente o trabalho de planejamento que a tarefa custou. */
  function marcacaoAtiva() {
    var t = M.tarefaAtivaDe(EU);
    if (!t) return '';

    var recado = M.recadoDe(t.id);
    var proj = t.projetoId ? M.projeto(t.projetoId) : null;
    var local = M.LOCAIS.filter(function (l) { return l.v === t.ondePrecisaEstar; })[0];

    var libera = M.tarefasVivas().filter(function (o) {
      return (o.dependeDe || []).indexOf(t.id) !== -1 && M.estadoDe(o.id) === 'aberta';
    });

    return [
      '<div class="c-trabalho">',
        '<p class="c-frase">' + esc(t.texto) + '</p>',
        recado ? '<p class="c-recado">' + esc(recado) + '</p>' : '',
        '<p class="c-meta">em andamento' +
          (proj ? '<br>' + esc(proj.nome || 'projeto sem nome') : '') + '</p>',

        '<div class="c-ficha">',
          fichaLinha('onde', [local ? local.t : '', t.onde].filter(Boolean).join(' · ')),
          t.compra ? fichaLista('comprar', t.compras, t.id) : '',
          fichaLista('ferramentas', t.ferramentas, t.id),
          fichaLista('materiais', t.materiais, t.id),
          fichaLinha('libera', libera.map(function (o) { return o.texto; }).join(' · ')),
        '</div>',

        (t.projetoId ? '<button type="button" class="c-trilha-link" data-acao="ver-trilha">' +
          'o projeto até aqui</button>' : ''),

        '<button type="button" class="c-acao" data-acao="terminei">terminei</button>',
        '<div class="c-recusas">',
          '<button type="button" class="c-recusa" data-acao="parar">parei por agora</button>',
          '<button type="button" class="c-recusa" data-acao="nao-da">não dá</button>',
          '<button type="button" class="c-recusa" data-acao="encerrar">encerrar</button>',
        '</div>',
      '</div>'
    ].join('');
  }

  /* O PROJETO ATÉ AQUI — trilha, não lista. A sequência é a informação: ver que
     a medição veio antes da conferência e o orçamento depois é o que reconstrói
     o raciocínio meses depois, não o dado solto. O que ainda não foi feito não
     aparece, com uma exceção: o que ESTA tarefa destrava, porque é isso que
     responde para que serve o dado que você está gerando agora. */
  function marcacaoProjeto() {
    var t = cena.alvo && M.tarefa(cena.alvo);
    if (!t) { cena.fase = 'ativa'; return marcacaoAtiva(); }

    var proj = t.projetoId ? M.projeto(t.projetoId) : null;
    var passos = proj ? M.historicoDe(proj.id) : [];
    var libera = M.tarefasVivas().filter(function (o) {
      return (o.dependeDe || []).indexOf(t.id) !== -1 && M.estadoDe(o.id) === 'aberta';
    });

    return [
      '<div class="c-trilha">',
        '<p class="c-trilha-nome">' + esc(proj ? (proj.nome || 'projeto sem nome') : 'tarefa avulsa') + '</p>',
        proj && proj.resultado ? '<p class="c-trilha-fim">' + esc(proj.resultado) + '</p>' : '',

        '<ol class="trilha">',
          passos.map(function (p) {
            var aberta = cena.pegada === p.tarefa.id;
            return '<li class="pegada pegada-' + p.tipo + (aberta ? ' pegada-aberta' : '') + '">' +
              // a pegada abre: o dado inteiro da tarefa passada ao custo de um clique
              '<button type="button" class="pegada-nome" data-acao="abrir-pegada"' +
                ' data-valor="' + p.tarefa.id + '"' + (aberta ? ' aria-expanded="true"' : '') + '>' +
                esc(p.tarefa.texto || 'sem texto') +
                '<em>' + esc(M.formatarData(p.quando.slice(0, 10))) +
                  (p.quem && p.quem !== EU ? ' · ' + esc(M.nomeDe(p.quem)) : '') + '</em></button>' +
              // sem nota também vale: "comprar a tela" concluída já diz tudo
              (p.nota || p.tarefa.recado
                ? '<p class="pegada-nota">' + esc(p.nota || p.tarefa.recado) + '</p>'
                : '') +
              (aberta ? fichaDaPegada(p) : '') +
              '</li>';
          }).join(''),

          // parecia botão e não fazia nada: agora tocar nela volta para a tarefa
          '<li class="pegada pegada-aqui">' +
            '<button type="button" class="pegada-nome" data-acao="fechar-trilha">' +
              esc(t.texto || 'sem texto') + '</button>' +
            '<span class="pegada-selo">você está aqui</span>' +
          '</li>',
        '</ol>',

        libera.length
          ? '<div class="c-adiante"><span class="c-ficha-rotulo">o que isto destrava</span>' +
            '<ul class="c-ficha-itens">' + libera.map(function (o) {
              return '<li>' + esc(o.texto) + '</li>'; }).join('') + '</ul></div>'
          : '',

        !passos.length
          ? '<p class="c-nota">Nada concluído neste projeto ainda. A trilha começa aqui.</p>'
          : '',

        '<button type="button" class="c-voltar" data-acao="fechar-trilha">voltar</button>',
      '</div>'
    ].join('');
  }

  /* A ficha de uma tarefa passada: o que foi levado, onde foi e tudo que você
     anotou nela — inclusive as anotações de sessões anteriores, quando ela foi
     feita em pedaços. */
  function fichaDaPegada(p) {
    var t = p.tarefa;
    var local = M.LOCAIS.filter(function (l) { return l.v === t.ondePrecisaEstar; })[0];
    var notas = M.anotacoesDe(t.id);

    /* Ferramentas e materiais aparecem SEMPRE na pegada, vazios inclusive: é
       a pergunta que se faz olhando a tarefa antiga no meio da de hoje, e uma
       linha ausente parecia informação que o app não tinha. */
    return '<div class="pegada-ficha">' +
      fichaLinha('onde', [local ? local.t : '', t.onde].filter(Boolean).join(' · ')) +
      (t.compra && (t.compras || []).length ? fichaLista('comprou', t.compras) : '') +
      ((t.ferramentas || []).length ? fichaLista('ferramentas', t.ferramentas) : fichaLinha('ferramentas', '—')) +
      ((t.materiais || []).length ? fichaLista('materiais', t.materiais) : fichaLinha('materiais', '—')) +
      (notas.length > 1
        ? '<div class="c-ficha-linha"><span class="c-ficha-rotulo">anotações</span>' +
          '<ul class="c-ficha-itens">' + notas.map(function (n) {
            return '<li>' + esc(M.formatarData(n.quando)) + ' — ' + esc(n.texto) + '</li>';
          }).join('') + '</ul></div>'
        : '') +
      '</div>';
  }

  function fichaLinha(rotulo, valor) {
    if (!valor) return '';
    return '<div class="c-ficha-linha"><span class="c-ficha-rotulo">' + esc(rotulo) + '</span>' +
      '<span class="c-ficha-valor">' + esc(valor) + '</span></div>';
  }

  /* O kit vira conferência: risca o que já está na mão antes de sair. É opcional
     — dá para ignorar e ir trabalhar — e some junto com a tarefa, porque é
     rascunho de trinta minutos, não histórico. */
  function fichaLista(rotulo, itens, tid) {
    if (!itens || !itens.length) return '';
    // sem tarefa dona, é leitura: conferência só existe para a tarefa em curso
    if (!tid) {
      return '<div class="c-ficha-linha"><span class="c-ficha-rotulo">' + esc(rotulo) + '</span>' +
        '<ul class="c-ficha-itens">' + itens.map(function (x) {
          return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    return '<div class="c-ficha-linha"><span class="c-ficha-rotulo">' + esc(rotulo) + '</span>' +
      '<ul class="c-ficha-itens">' + itens.map(function (x) {
        var pego = M.conferido(tid, x);
        return '<li><button type="button" class="c-item' + (pego ? ' c-item-on' : '') +
          '" data-acao="conferir" data-valor="' + esc(x) + '">' +
          '<span class="c-quadro" aria-hidden="true">' + (pego ? '✓' : '') + '</span>' +
          esc(x) + '</button></li>';
      }).join('') + '</ul></div>';
  }

  // ── parar: duas naturezas ─────────────────────────────────────────

  function marcacaoParar() {
    var passo = cena.rascunho.passo || 'natureza';

    if (passo === 'natureza') {
      return caixa('Por que parou?',
        '<button type="button" class="c-bt c-bt-largo" data-acao="parou-saiu">tive que parar</button>' +
        '<button type="button" class="c-bt c-bt-largo" data-acao="parou-travou">travou</button>') +
        '<p class="c-nota">Chuva, criança, telefone — isso é o primeiro. O segundo é quando o trabalho não anda.</p>';
    }

    // travou: uma linha, e ela vira a tarefa de pensar
    return caixa('O que travou?',
      '<textarea class="c-campo" id="cLinha" rows="3" placeholder="onde você parou e qual é a dúvida"></textarea>' +
      '<button type="button" class="c-acao" data-acao="confirmar-travou">guardar e parar</button>');
  }

  // ── não dá (§9) ───────────────────────────────────────────────────

  function marcacaoNaoDa() {
    return caixa('O que houve?',
      M.MOTIVOS_NAO_DA.map(function (m) {
        return '<button type="button" class="c-bt c-bt-largo" data-acao="motivo" data-valor="' +
          m.v + '">' + esc(m.t) + '</button>';
      }).join('') +
      '<textarea class="c-campo" id="cNota" rows="2" placeholder="detalhe, se quiser"></textarea>') +
      '<p class="c-nota">Isto é você corrigindo o app. Não custa o dia.</p>';
  }

  /* Encerrar é ação de primeira classe (regra 9) e merece a mesma caixa das
     outras saídas — não a janelinha cinza do navegador. Motivo obrigatório,
     como sempre foi. */
  function marcacaoEncerrar() {
    return caixa('Encerrar. Por quê?',
      '<textarea class="c-campo" id="cEncerrar" rows="3" placeholder="não vale mais a pena, mudou o plano…"></textarea>' +
      '<button type="button" class="c-acao" data-acao="confirmar-encerrar">encerrar</button>') +
      '<p class="c-nota">A tarefa sai do caminho e fica no registro, com o motivo.</p>';
  }

  // ── terminei: a coleta ────────────────────────────────────────────

  /* A anotação é pedida na conclusão, não no cadastro. Ao cadastrar você não
     sabe o que vai valer registrar; ao terminar, sabe. E é opcional. */
  function marcacaoTerminar() {
    var t = M.tarefaAtivaDe(EU);
    if (!t) return '';
    return caixa('Quer anotar alguma coisa?',
      '<p class="c-nota" style="text-align:left;margin:0 0 14px">' +
        'A medida, o preço, o que descobriu. Pode deixar em branco.</p>' +
      '<textarea class="c-campo" id="cAnotacao" rows="4" placeholder="opcional"></textarea>' +
      '<button type="button" class="c-acao" data-acao="confirmar-terminei">pronto</button>');
  }

  function caixa(titulo, corpo) {
    return '<div class="c-caixa"><p class="c-titulo">' + esc(titulo) + '</p>' + corpo +
      '<button type="button" class="c-voltar" data-acao="cancelar">voltar</button></div>';
  }

  function marcacaoListar() {
    var c = cena.listar;
    if (!c) { cena.fase = 'ativa'; return marcacaoAtiva(); }
    return '<div class="c-caixa">' +
      '<p class="c-titulo">O que comprar?</p>' +
      '<p class="c-nota" style="text-align:left;margin:0 0 14px">A compra <b>' +
        esc(c.texto || 'sem nome') + '</b> espera a lista. Um item por linha — pode ditar. ' +
        'Dá para completar depois, na mesa.</p>' +
      '<textarea class="c-campo" id="cListar" rows="5" placeholder="6 tábuas de peroba 3 m&#10;2 dobradiças reforçadas"></textarea>' +
      '<button type="button" class="c-acao" data-acao="confirmar-listar">guardar a lista</button>' +
      '<button type="button" class="c-bt c-bt-largo" data-acao="pular-listar">depois, na mesa</button>' +
      '</div>';
  }

  // ── desenho ───────────────────────────────────────────────────────

  function desenhar() {
    M.usoTela('campo:' + cena.fase);
    var html =
      cena.fase === 'ativa'     ? marcacaoAtiva()
    : cena.fase === 'parar'     ? marcacaoParar()
    : cena.fase === 'naoda'     ? marcacaoNaoDa()
    : cena.fase === 'terminar'  ? marcacaoTerminar()
    : cena.fase === 'encerrar'  ? marcacaoEncerrar()
    : cena.fase === 'listar'    ? marcacaoListar()
    : cena.fase === 'projeto'   ? marcacaoProjeto()
    : '';
    $.innerHTML = '<div class="c-tela">' + html + '</div>';
  }

  // ── eventos ───────────────────────────────────────────────────────

  function agir(acao, el) {
    var ativa = M.tarefaAtivaDe(EU);

    if (acao === 'confirmar-listar') {
      var linhasL = (($.querySelector('#cListar') || {}).value || '').split('\n');
      if (cena.listar && linhasL.some(function (x) { return x.trim(); })) {
        M.listarCompra(EU, cena.listar.id, linhasL);
        if (window.matchMedia('(min-width: 721px)').matches) M.absorverCompras();
        cena.avisoPendente = 'A lista de "' + (cena.listar.texto || 'compra') + '" ficou guardada.';
      }
      cena.listar = null;
      return voltarAoInicio();
    }
    if (acao === 'pular-listar') { cena.listar = null; return voltarAoInicio(); }
    if (acao === 'cancelar')  { cena.rascunho = {}; cena.fase = 'ativa'; return desenhar(); }

    /* Sempre o projeto da tarefa que está na mão — para lembrar o que já foi
       decidido. Nunca vira navegação: não há como chegar em outro projeto
       por aqui. */
    if (acao === 'ver-trilha') {
      cena.alvo = ativa ? ativa.id : null;
      cena.pegada = null;
      cena.fase = 'projeto';
      return desenhar();
    }
    if (acao === 'abrir-pegada') {
      var qual = el.getAttribute('data-valor');
      cena.pegada = (cena.pegada === qual) ? null : qual;   // uma por vez
      return desenhar();
    }
    if (acao === 'fechar-trilha') {
      cena.fase = 'ativa';
      return desenhar();
    }

    if (acao === 'conferir' && ativa) {
      M.alternarConferido(ativa.id, el.getAttribute('data-valor'));
      return desenhar();
    }

    if (acao === 'terminei' && ativa) { cena.fase = 'terminar'; return desenhar(); }
    if (acao === 'confirmar-terminei' && ativa) {
      var nota = ($.querySelector('#cAnotacao') || {}).value || '';
      var tidFeita = ativa.id;
      M.terminar(EU, tidFeita, nota.trim());
      M.limparKit(tidFeita);
      return depoisDeTerminar(tidFeita);
    }

    if (acao === 'parar')  { cena.rascunho = { passo: 'natureza' }; cena.fase = 'parar'; return desenhar(); }
    if (acao === 'parou-saiu' && ativa) {
      // a vida aconteceu: grava e cala a boca. Volta para a tela inicial.
      M.parar(EU, ativa.id, null, 'saiu', '');
      M.limparKit(ativa.id);
      return voltarAoInicio();
    }
    if (acao === 'parou-travou') { cena.rascunho.passo = 'linha'; return desenhar(); }
    if (acao === 'confirmar-travou' && ativa) {
      var linhaTexto = ($.querySelector('#cLinha') || {}).value || '';
      if (!linhaTexto.trim()) return;
      M.parar(EU, ativa.id, null, 'travou', linhaTexto.trim());
      M.limparKit(ativa.id);
      return voltarAoInicio();       // registrado; a tarefa de pensar já está no leque
    }

    if (acao === 'encerrar' && ativa) { cena.fase = 'encerrar'; return desenhar(); }
    if (acao === 'confirmar-encerrar' && ativa) {
      var motivoEnc = ($.querySelector('#cEncerrar') || {}).value || '';
      if (!motivoEnc.trim()) return;
      M.encerrar(EU, ativa.id, motivoEnc.trim());
      M.limparKit(ativa.id);
      return voltarAoInicio();
    }

    if (acao === 'nao-da')    { cena.fase = 'naoda'; return desenhar(); }
    /* O destrave nasce agora e já aparece no leque; a consulta acaba: volta à
       tela inicial. */
    if (acao === 'motivo' && ativa) {
      var notaMotivo = ($.querySelector('#cNota') || {}).value || '';
      M.naoDeu(EU, ativa.id, el.getAttribute('data-valor'), notaMotivo.trim());
      return voltarAoInicio();
    }
  }

  /* A compra vazia que dependia da tarefa terminada pede a lista aqui mesmo
     (§57): um item por linha, dita se quiser. Dá para deixar para a mesa. */
  function depoisDeTerminar(tid) {
    var vazias = M.comprasVaziasDependentesDe(tid);
    if (vazias.length) { cena.listar = vazias[0]; cena.fase = 'listar'; return desenhar(); }
    return voltarAoInicio();
  }

  function ligar(raiz) {
    raiz.addEventListener('click', function (e) {
      var bt = e.target.closest('[data-acao]');
      if (bt) return agir(bt.getAttribute('data-acao'), bt);
    });
  }

  return { abrir: abrir, ligar: ligar };
})();
