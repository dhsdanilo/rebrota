/* App do sítio — frente de campo (a consulta).
 *
 * Postura de bota: uma mão, polegar, segundos, zero digitação exceto o
 * "não quero" e a linha do travamento. É a identidade do app.
 *
 * O contraste é entre a PERGUNTA — densa, cheia de botões — e a RESPOSTA,
 * que é quase vazia: uma frase grande e três botões. O alívio visual da
 * resposta é o ponto (§15).
 */

var Campo = (function () {
  'use strict';

  var M = Modelo, Mo = Motor;
  var EU = 'pe_eu';

  var cena = { fase: 'pergunta', sit: null, resp: null, rascunho: {}, aviso: '' };
  var $ = null;
  var sair = null;   // quem abriu diz como se volta para a tela inicial

  /* `pronto.local` vem de quem abriu: no PC, o aparelho já sabe onde você está,
     e perguntar seria teatro. Não fere a §5, que proíbe pré-marcar a resposta
     da VÉSPERA — isto é um fato de agora, e continua trocável. */
  function abrir(alvo, pronto, aoSair) {
    $ = alvo;
    sair = aoSair || null;
    cena.sit = Mo.situacaoVazia();
    cena.sit.quem = EU;
    if (pronto && pronto.local) cena.sit.local = pronto.local;
    var clima = M.climaDeHoje();
    if (clima) { cena.sit.tempo = clima.tempo; cena.sit.barro = clima.barro; }
    cena.fase = 'pergunta';
    cena.resp = null;
    cena.rascunho = {};
    cena.aviso = '';
    responder();
    desenhar();
  }

  /* Voltar para a tela inicial — não para a pergunta. Depois de um "não dá"
     ou de um "tive que parar", cair de novo em "onde você está? quanto tempo?"
     é reabrir a consulta que você acabou de encerrar. */
  function voltarAoInicio() {
    if (sair) return sair();
    cena.fase = 'pergunta';
    desenhar();
  }

  /* Se há tarefa ativa, abrir o app mostra ela — não a consulta (§8). */
  function responder() {
    if (M.tarefaAtivaDe(EU)) { cena.fase = 'ativa'; return; }
    if (M.diaEncerradoPara(EU)) { cena.fase = 'encerrado'; return; }
  }

  // ── utilidades ────────────────────────────────────────────────────

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function linha(rotulo, botoes) {
    return '<div class="c-linha"><span class="c-rotulo">' + esc(rotulo) + '</span>' +
      '<div class="c-botoes">' + botoes + '</div></div>';
  }

  function botao(campo, valor, texto, ligado) {
    return '<button type="button" class="c-bt' + (ligado ? ' c-bt-on' : '') +
      '" data-campo="' + campo + '" data-valor="' + esc(valor) + '">' + esc(texto) + '</button>';
  }

  // ── a pergunta (§5) ───────────────────────────────────────────────

  function marcacaoPergunta() {
    var s = cena.sit;
    var partes = [];

    partes.push(linha('Onde você está?',
      M.LOCAIS.map(function (l) {
        return botao('local', l.v, l.t, s.local === l.v);
      }).join('')));

    if (!s.local) return envolver(partes.join(''), false);

    partes.push(linha('Quanto tempo?',
      Mo.temposDe().map(function (t) {
        return botao('minutos', t.v, t.t, s.minutos === t.v);
      }).join('')));

    /* Poda: fora e computador encerram a sequência. Clima, chão, companhia e
       energia não mudam nada quando o trabalho é um telefonema. */
    if (s.local === 'sitio') {
      var jaTem = !!M.climaDeHoje();
      partes.push(linha(jaTem ? 'O tempo mudou?' : 'Como está o tempo?',
        [['sol', 'sol'], ['nublado', 'nublado'], ['chuva_fina', 'chuva fina'], ['chuva_forte', 'chuva forte']]
          .map(function (p) { return botao('tempo', p[0], p[1], s.tempo === p[0]); }).join('')));

      // chuva forte hoje implica barro e a pergunta some
      if (s.tempo && s.tempo !== 'chuva_forte') {
        partes.push(linha('Dá para pisar e rodar?',
          botao('barro', 'nao', 'firme', s.barro === false) +
          botao('barro', 'sim', 'barro', s.barro === true)));
      }

      partes.push(linha('Comigo',
        botao('sozinho', '1', 'sozinho', !s.criancas && !s.ajuda) +
        botao('criancas', '1', 'crianças', s.criancas) +
        botao('ajuda', '1', 'ajuda', s.ajuda)));
    }

    partes.push(linha('Energia',
      botao('energia', 'normal', 'normal', s.energia === 'normal') +
      botao('energia', 'pouca', 'pouca', s.energia === 'pouca')));

    var pronto = s.local && s.minutos && (s.local !== 'sitio' || (s.tempo && s.barro !== null));
    return envolver(partes.join(''), pronto);
  }

  function envolver(html, pronto) {
    return '<div class="c-pergunta">' + html +
      '<button type="button" class="c-acao" data-acao="consultar"' +
      (pronto ? '' : ' disabled') + '>o que eu faço</button></div>';
  }

  // ── a resposta ────────────────────────────────────────────────────

  function marcacaoResposta() {
    var r = cena.resp;
    if (!r) return '';

    if (r.vazio === 'dia_encerrado') return marcacaoEncerrado();

    if (r.vazio) {
      var molhar = Mo.temSegundaChamada(cena.sit);
      return '<div class="c-vazio">' +
        (cena.aviso ? '<p class="c-nota c-aviso">' + esc(cena.aviso) + '</p>' : '') +
        '<p class="c-frase-media">Nada que caiba nessa situação.</p>' +
        (molhar
          ? '<button type="button" class="c-acao" data-acao="molhar">Nada limpo nessa situação. Isto dá, mas você vai se molhar.</button>'
          : '') +
        (r.temSegundaPorta
          ? '<button type="button" class="c-porta" data-acao="segunda-porta">quero fazer mais</button>'
          : '') +
        '<button type="button" class="c-voltar" data-acao="reabrir">mudar a situação</button>' +
        '</div>';
    }

    var t = r.tarefa;
    var proj = t.projetoId ? M.projeto(t.projetoId) : null;
    var recado = M.recadoDe(t.id);

    /* §8 — o restante zerou sem você dizer "terminei". Pergunta uma vez.
       Estimativa errada é normal e não gera nada. */
    if (M.restanteDe(t.id) <= 0 && t.podeParar) {
      return caixa('Acabou, ou faltou mais do que parecia?',
        '<p class="c-frase-media">' + esc(t.texto) + '</p>' +
        '<button type="button" class="c-bt c-bt-largo" data-acao="zerou-acabou">acabou</button>' +
        '<button type="button" class="c-bt c-bt-largo" data-acao="zerou-faltou">faltou mais</button>');
    }

    return [
      '<div class="c-resposta">',
        // a cascata que a tarefa anterior disparou: dita uma vez, aqui mesmo
        cena.aviso ? '<p class="c-nota c-aviso">' + esc(cena.aviso) + '</p>' : '',
        '<p class="c-frase">' + esc(t.texto) + '</p>',
        // o estado volta para a tela: você lê onde parou antes de decidir
        recado ? '<p class="c-recado">' + esc(recado) + '</p>' : '',
        '<p class="c-meta">',
          proj ? esc(proj.resultado || proj.nome) + '<br>' : '',
          esc(encaixe(t)),
          t.onde ? '<br>' + esc(t.onde) : '',
          // "vencido" é palavra proibida (§16): é informação, não veredito
          r.faixa === 2 ? '<br>rotina · já passou da hora' : '',
          r.guardada ? '<br>guardado para dia de chuva' : '',
          r.molhada ? '<br>isto dá, mas você vai se molhar' : '',
        '</p>',
        ((t.ferramentas || []).length || (t.materiais || []).length)
          ? '<details class="c-kit"><summary>o que levar</summary><ul>' +
            (t.ferramentas || []).concat(t.materiais || []).map(function (x) {
              return '<li>' + esc(x) + '</li>'; }).join('') +
            '</ul></details>'
          : '',
        // antes de aceitar também vale: às vezes você confere onde a obra
        // parou justamente para decidir se topa
        t.projetoId ? '<button type="button" class="c-trilha-link" data-acao="ver-trilha">o projeto até aqui</button>' : '',
        '<button type="button" class="c-acao" data-acao="vamos">vamos</button>',
        '<div class="c-recusas">',
          '<button type="button" class="c-recusa" data-acao="nao-da">não dá</button>',
          '<button type="button" class="c-recusa" data-acao="nao-quero">não quero</button>',
        '</div>',
      '</div>'
    ].join('');
  }

  function encaixe(t) {
    var restante = M.restanteDe(t.id);
    var disp = cena.sit.minutos;
    if (!t.podeParar || restante <= disp) return 'dá para terminar hoje';
    return 'cabem ~' + M.duracao(disp) + ' · faltam ~' + M.duracao(restante - disp) + ' depois';
  }

  // ── tarefa ativa (§8) ─────────────────────────────────────────────

  /* A RESPOSTA é quase vazia de propósito — ela existe para você decidir. A
     tarefa ACEITA é outra coisa: é a folha de trabalho, e aqui o plano inteiro
     tem que estar à mão. Esconder o que levar depois do "vamos" jogaria fora
     justamente o trabalho de planejamento que a tarefa custou. */
  function marcacaoAtiva() {
    var t = M.tarefaAtivaDe(EU);
    if (!t) { cena.fase = 'pergunta'; return marcacaoPergunta(); }

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
        '<p class="c-meta">em andamento · faltam ~' + esc(M.duracao(M.restanteDe(t.id))) +
          (proj ? '<br>' + esc(proj.nome || 'projeto sem nome') : '') + '</p>',

        '<div class="c-ficha">',
          fichaLinha('onde', [local ? local.t : '', t.onde].filter(Boolean).join(' · ')),
          fichaLista('ferramentas', t.ferramentas, t.id),
          fichaLista('materiais', t.materiais, t.id),
          fichaLinha('condições', condicoesDe(t)),
          fichaLinha('libera', libera.map(function (o) { return o.texto; }).join(' · ')),
        '</div>',

        (t.projetoId ? '<button type="button" class="c-trilha-link" data-acao="ver-trilha">' +
          'o projeto até aqui</button>' : ''),

        '<button type="button" class="c-acao" data-acao="terminei">terminei</button>',
        '<div class="c-recusas">',
          '<button type="button" class="c-recusa" data-acao="parar">parei por agora</button>',
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
    if (!t) { cena.fase = cena.voltarPara || 'pergunta'; return desenhar(); }

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
                '<em>' + esc(M.formatarData(p.quando.slice(0, 10))) + '</em></button>' +
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

  /* A ficha de uma tarefa passada: o que foi levado, onde foi, em que condições
     e tudo que você anotou nela — inclusive as anotações de sessões anteriores,
     quando ela foi feita em pedaços. */
  function fichaDaPegada(p) {
    var t = p.tarefa;
    var local = M.LOCAIS.filter(function (l) { return l.v === t.ondePrecisaEstar; })[0];
    var notas = M.anotacoesDe(t.id);

    /* Ferramentas e materiais aparecem SEMPRE na pegada, vazios inclusive: é
       a pergunta que se faz olhando a tarefa antiga no meio da de hoje, e uma
       linha ausente parecia informação que o app não tinha. */
    return '<div class="pegada-ficha">' +
      fichaLinha('onde', [local ? local.t : '', t.onde].filter(Boolean).join(' · ')) +
      fichaLinha('levou', M.duracao(t.duracaoTotal)) +
      ((t.ferramentas || []).length ? fichaLista('ferramentas', t.ferramentas) : fichaLinha('ferramentas', '—')) +
      ((t.materiais || []).length ? fichaLista('materiais', t.materiais) : fichaLinha('materiais', '—')) +
      fichaLinha('condições', condicoesDe(t)) +
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

  function condicoesDe(t) {
    var c = [];
    if (t.exigeClima === 'firme') c.push('só com tempo firme');
    if (t.exigeClima === 'tolera_chuva_fina') c.push('tolera chuva fina');
    if (t.exigeSoloFirme) c.push('precisa de chão firme');
    if (t.precisaAjuda) c.push('precisa de ajuda');
    if (t.perigosaComCriancas) c.push('perigosa com crianças');
    if (!t.podeParar) c.push('não pode parar no meio');
    return c.join(' · ');
  }

  // ── parar: duas naturezas ─────────────────────────────────────────

  function marcacaoParar() {
    var passo = cena.rascunho.passo || 'avanco';

    if (passo === 'avanco') {
      return caixa('Quanto andou?',
        botao('avanco', 'pouco', 'pouco') +
        botao('avanco', 'metade', 'metade') +
        botao('avanco', 'quase_tudo', 'quase tudo'));
    }

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

  // ── não quero (§9) ────────────────────────────────────────────────

  function marcacaoNaoQuero() {
    return caixa('O que houve?',
      '<textarea class="c-campo" id="cQuero" rows="4" placeholder="escreva com suas palavras"></textarea>' +
      '<button type="button" class="c-acao" data-acao="confirmar-nao-quero">pronto</button>') +
      '<p class="c-nota">Cala o app por três horas. Nada é oferecido nesse tempo.</p>';
  }

  /* "Não quero" cala o app por três horas, não pelo resto do dia: o custo
     continua caro o bastante para impedir percorrer, sem fazer uma recusa às
     onze da noite cobrar a manhã seguinte. */
  function marcacaoEncerrado() {
    var volta = M.voltaAOferecerEm(EU);
    return '<div class="c-vazio">' +
      '<p class="c-frase-media">Por agora é isso.</p>' +
      (volta ? '<p class="c-meta">volta a oferecer às ' + esc(M.horaDe(volta)) + '</p>' : '') +
      '</div>';
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

  // ── desenho ───────────────────────────────────────────────────────

  function desenhar() {
    var html =
      cena.fase === 'pergunta'  ? marcacaoPergunta()
    : cena.fase === 'resposta'  ? marcacaoResposta()
    : cena.fase === 'ativa'     ? marcacaoAtiva()
    : cena.fase === 'parar'     ? marcacaoParar()
    : cena.fase === 'naoda'     ? marcacaoNaoDa()
    : cena.fase === 'naoquero'  ? marcacaoNaoQuero()
    : cena.fase === 'terminar'  ? marcacaoTerminar()
    : cena.fase === 'projeto'   ? marcacaoProjeto()
    : cena.fase === 'encerrado' ? marcacaoEncerrado()
    : '';
    $.innerHTML = '<div class="c-tela">' + html + '</div>';
  }

  // ── eventos ───────────────────────────────────────────────────────

  function marcar(campo, valor) {
    var s = cena.sit;
    if (campo === 'local')   { s.local = valor; s.minutos = null; }
    if (campo === 'minutos') s.minutos = Number(valor);
    if (campo === 'tempo')   {
      s.tempo = valor;
      if (valor === 'chuva_forte') s.barro = true;    // chuva forte implica barro
      else if (s.barro === true) s.barro = null;
    }
    if (campo === 'barro')   s.barro = (valor === 'sim');
    if (campo === 'sozinho') { s.criancas = false; s.ajuda = false; }
    if (campo === 'criancas') s.criancas = !s.criancas;
    if (campo === 'ajuda')    s.ajuda = !s.ajuda;
    if (campo === 'energia')  s.energia = valor;
    if (campo === 'avanco')   { cena.rascunho.avanco = valor; cena.rascunho.passo = 'natureza'; }
    desenhar();
  }

  /* O clima é registro do dia: a primeira resposta grava, e "o tempo mudou?"
     regrava quando a resposta é outra — antes a segunda resposta era lida e
     jogada fora. */
  function consultar() {
    var s = cena.sit;
    if (s.local === 'sitio' && s.tempo) {
      var c = M.climaDeHoje();
      if (!c || c.tempo !== s.tempo || !!c.barro !== !!s.barro) M.registrarClima(EU, s.tempo, s.barro);
    }
    cena.aviso = '';
    cena.resp = Mo.escolher(s);
    // a segunda chamada vale para UMA resposta: a próxima volta a ser limpa
    s.segundaChamada = false;
    registrarOferta();
    cena.fase = cena.resp.ativa ? 'ativa' : 'resposta';
    desenhar();
  }

  /* Guardada mesmo quando repete: a oferta gruda para a reconsulta não virar
     um jeito de escolher, e a contagem de repetições é material da revisão. */
  function registrarOferta() {
    if (cena.resp && cena.resp.tarefa) M.ofertar(EU, cena.resp.tarefa.id);
  }

  function agir(acao, el) {
    var t = cena.resp && cena.resp.tarefa;
    var ativa = M.tarefaAtivaDe(EU);

    if (acao === 'consultar') return consultar();
    if (acao === 'reabrir')   { cena.fase = 'pergunta'; return desenhar(); }
    if (acao === 'cancelar')  { cena.rascunho = {}; cena.fase = ativa ? 'ativa' : 'resposta'; return desenhar(); }

    if (acao === 'molhar') {
      cena.sit.segundaChamada = true;
      return consultar();
    }
    if (acao === 'segunda-porta') {
      var extra = Mo.escolherSegundaPorta(cena.sit);
      cena.resp = extra ? { tarefa: extra, faixa: 3 } : { vazio: 'nada' };
      return desenhar();
    }

    if (acao === 'vamos' && t) {
      M.iniciar(EU, t.id);
      cena.fase = 'ativa';
      return desenhar();
    }

    /* Sempre o projeto da tarefa que está na mão — antes de aceitar, para
       decidir se topa, ou durante, para lembrar o que já foi decidido. Nunca
       vira navegação: não há como chegar em outro projeto por aqui. */
    if (acao === 'ver-trilha') {
      cena.alvo = (ativa || t) ? (ativa || t).id : null;
      cena.voltarPara = cena.fase;
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
      cena.fase = cena.voltarPara || (ativa ? 'ativa' : 'resposta');
      return desenhar();
    }

    if (acao === 'conferir' && ativa) {
      M.alternarConferido(ativa.id, el.getAttribute('data-valor'));
      return desenhar();
    }

    if (acao === 'terminei' && ativa) { cena.fase = 'terminar'; return desenhar(); }
    if (acao === 'confirmar-terminei' && ativa) {
      var nota = ($.querySelector('#cAnotacao') || {}).value || '';
      M.terminar(EU, ativa.id, nota.trim());
      M.limparKit(ativa.id);
      return depoisDeFechar();
    }

    if (acao === 'zerou-acabou' && t) { M.terminar(EU, t.id, ''); return depoisDeFechar(); }
    if (acao === 'zerou-faltou' && t) {
      M.devolverTempo(EU, t.id, Math.round(t.duracaoTotal * 0.25));
      return depoisDeFechar();
    }

    if (acao === 'parar')  { cena.rascunho = { passo: 'avanco' }; cena.fase = 'parar'; return desenhar(); }
    if (acao === 'parou-saiu' && ativa) {
      // a vida aconteceu: grava o avanço e cala a boca. Nada é oferecido —
      // você não está mais aqui. Volta para a tela inicial, não para a pergunta.
      M.parar(EU, ativa.id, cena.rascunho.avanco, 'saiu', '');
      M.limparKit(ativa.id);
      cena.rascunho = {};
      cena.resp = null;
      return voltarAoInicio();
    }
    if (acao === 'parou-travou') { cena.rascunho.passo = 'linha'; return desenhar(); }
    if (acao === 'confirmar-travou' && ativa) {
      var linhaTexto = ($.querySelector('#cLinha') || {}).value || '';
      if (!linhaTexto.trim()) return;
      M.parar(EU, ativa.id, cena.rascunho.avanco, 'travou', linhaTexto.trim());
      M.limparKit(ativa.id);
      cena.rascunho = {};
      return depoisDeFechar();       // registrado; agora sim outra frente
    }

    if (acao === 'encerrar' && ativa) {
      var motivo = prompt('Encerrar. Por quê?');
      if (motivo === null) return;
      M.encerrar(EU, ativa.id, motivo);
      M.limparKit(ativa.id);
      return depoisDeFechar();
    }

    if (acao === 'nao-da')    { cena.fase = 'naoda'; return desenhar(); }
    /* O destrave nasce agora e, se couber na situação, é a próxima coisa
       oferecida (§9). Fora isso — já fiz, tempo virou, demora mais, outro, ou
       destrave que não cabe aqui —, a consulta acabou: volta à tela inicial,
       não à pergunta. */
    if (acao === 'motivo' && t) {
      var nota = ($.querySelector('#cNota') || {}).value || '';
      var ev = M.naoDeu(EU, t.id, el.getAttribute('data-valor'), nota.trim());
      var destrave = ev.tarefaNova && Mo.elegiveis(cena.sit, new Date()).some(function (x) { return x.id === ev.tarefaNova.id; });
      if (destrave) return depoisDeFechar();
      cena.rascunho = {};
      cena.resp = null;
      return voltarAoInicio();
    }

    if (acao === 'nao-quero') { cena.fase = 'naoquero'; return desenhar(); }
    if (acao === 'confirmar-nao-quero' && t) {
      var texto = ($.querySelector('#cQuero') || {}).value || '';
      if (!texto.trim()) return;
      M.naoQuero(EU, t.id, texto.trim());
      cena.fase = 'encerrado';
      return desenhar();
    }
  }

  /* Depois de fechar uma tarefa o app já traz a próxima — é isso que ocupa a
     janela de trinta segundos em que a saída seria automática. */
  function depoisDeFechar() {
    cena.rascunho = {};
    // o que a tarefa fechada moveu de vaga é dito uma vez, na próxima tela
    cena.aviso = M.avisosDeCascata().map(function (m) {
      return m.vaga === 'planejadas'
        ? (m.projeto.nome || 'O projeto') + ' fechou o planejamento e espera você pôr em execução.'
        : (m.projeto.nome || 'Um projeto') + ' assume a vaga de ' + m.vaga + '.';
    }).join(' ');
    cena.resp = Mo.escolher(cena.sit);
    registrarOferta();
    cena.fase = cena.resp.ativa ? 'ativa' : 'resposta';
    desenhar();
  }

  function ligar(raiz) {
    raiz.addEventListener('click', function (e) {
      var bt = e.target.closest('[data-acao]');
      if (bt) return agir(bt.getAttribute('data-acao'), bt);
      var op = e.target.closest('[data-campo]');
      if (op) return marcar(op.getAttribute('data-campo'), op.getAttribute('data-valor'));
    });
  }

  return { abrir: abrir, ligar: ligar };
})();
