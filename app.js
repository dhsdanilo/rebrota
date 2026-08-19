/* App do sítio — frente de análise (PC).
 *
 * Postura de mesa: densa, duas mãos, formulário longo. A frente de campo
 * (a consulta) é outro app sobre o mesmo catálogo e vem depois.
 *
 * Redesenho: o palco só é reconstruído em mudança estrutural (abrir, criar,
 * remover, arrastar). Digitação escreve direto no modelo e retoca apenas o
 * que mudou, para o cursor nunca saltar do campo.
 */

(function () {
  'use strict';

  var M = Modelo;

  var tela = { tipo: null, id: null };

  /* Três estados por tarefa, não dois: fechada, aberta trancada, aberta solta.
     Ler o que está cadastrado é o uso comum; editar é raro. O que muda todo
     dia — concluir, reabrir, arrastar — nunca fica atrás do cadeado. */
  var passoAberto = null;          // id da tarefa com a ficha aberta
  var passoEditando = null;        // id da tarefa com os campos soltos

  var projetoEditando = null;      // id do projeto com os campos soltos
  var acaoProjeto = null;          // { pid, tipo } esperando confirmação
  var cancelandoTarefa = null;     // id da tarefa com o cancelar destravado
  var avisoCascata = '';           // o que a última ação moveu de vaga
  var planejamentoAberto = null;   // pid com o planejamento concluído reaberto
  var filtroProjetos = '';         // grupo aberto na página de projetos
  var filtroAvulsas = '';          // grupo aberto na página das avulsas
  var filtroSementes = 'nova';     // a caixa de entrada abre no que não tem destino
  var mudaAviso = '';              // o que faltou para a muda ficar pronta, no último toque
  var mudaAvisoDe = null;          // …e de qual muda, para não vazar para a ficha de outra
  var diaristaMetade = null;       // linha da folha com o campo "sobrou quanto?" aberto
  var esperando = null;            // tarefa com o campo "espera algo chegar" aberto

  /* Cada tecla grava — então "desfazer" é devolver a foto tirada na hora do
     editar. Entrou na tarefa errada, mexeu, viu: desfazer, e ela volta inteira. */
  var foto = null;                 // { id, copia } do que está em edição
  function fotografar(obj) { foto = obj ? { id: obj.id, copia: JSON.parse(JSON.stringify(obj)) } : null; }
  function revelar(obj) {
    if (!obj || !foto || foto.id !== obj.id) return;
    Object.keys(obj).forEach(function (k) { delete obj[k]; });
    Object.keys(foto.copia).forEach(function (k) { obj[k] = foto.copia[k]; });
    foto = null;
    M.salvar();
  }
  var sementeDescartando = null;   // semente com o campo de motivo aberto
  var voltarPara = null;           // de onde se veio, para poder folhear

  var perigo = { aberto: null };   // projeto com o apagar destravado
  var proposta = null;

  var $lista    = document.getElementById('listaProjetos');
  var $avulsas  = document.getElementById('listaAvulsas');
  var $palco    = document.getElementById('palco');

  // ── utilidades de marcação ────────────────────────────────────────

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function opcoes(lista, atual) {
    return lista.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (String(o.v) === String(atual) ? ' selected' : '') +
        '>' + esc(o.t) + '</option>';
    }).join('');
  }

  /* Trancado não muda a apresentação: é o mesmo campo, no mesmo lugar, só que
     duro. Duas telas diferentes para a mesma coisa fariam procurar onde ficou
     cada dado toda vez. Texto e área ficam `readonly` para continuarem
     selecionáveis; o resto fica `disabled`, que é o único jeito de segurar
     select, caixa de marca e campo de data. */
  /* Explicação não ocupa linha: vira `title`, e aparece ao parar o mouse em
     cima. O rótulo fica curto — quem já sabe o que é o campo não precisa ler a
     regra dele toda vez, e quem esqueceu passa o mouse. */
  function rotuloDe(id, chave, texto, ajuda) {
    if (!texto) return '';
    return '<label for="c_' + id + '_' + chave + '"' +
      (ajuda ? ' title="' + esc(ajuda) + '" class="tem-ajuda"' : '') + '>' + esc(texto) + '</label>';
  }

  function campoTexto(alvo, id, chave, rotulo, valor, extra) {
    extra = extra || {};
    var vazio = valor === null || valor === undefined || valor === '';
    return '<div class="campo' + (extra.largo ? ' campo-largo' : '') + '">' +
      rotuloDe(id, chave, rotulo, extra.ajuda) +
      '<input type="' + (extra.numero ? 'number' : 'text') + '" id="c_' + id + '_' + chave + '"' +
      // trancado e vazio mostra um traço: campo em branco sem moldura parece defeito
      (extra.travado ? ' readonly placeholder="—"'
                     : (extra.dica ? ' placeholder="' + esc(extra.dica) + '"' : '')) +
      (extra.min !== undefined ? ' min="' + extra.min + '"' : '') +
      ' data-alvo="' + alvo + '" data-id="' + id + '" data-campo="' + chave + '"' +
      ' value="' + esc(vazio ? '' : valor) + '">' +
      '</div>';
  }

  function campoSelect(alvo, id, chave, rotulo, lista, atual, travado, ajuda) {
    return '<div class="campo">' +
      rotuloDe(id, chave, rotulo, ajuda) +
      '<select id="c_' + id + '_' + chave + '" data-alvo="' + alvo + '" data-id="' + id +
      '" data-campo="' + chave + '"' + (travado ? ' disabled' : '') + '>' +
      opcoes(lista, atual) + '</select></div>';
  }

  /* Tags (§44): chips + uma caixa com autocompletar. Enter ou vírgula fecha a
     tag; a grafia existente vence a nova. Só cadastro — a análise vem depois. */
  function campoTags(alvo, id, tags, travado) {
    var chips = (tags || []).map(function (t) {
      return '<span class="tag">' + esc(t) +
        (travado ? '' : '<button type="button" class="tag-x" data-acao="tirar-tag" data-alvo="' + alvo + '" data-id="' + id + '" data-valor="' + esc(t) + '" aria-label="tirar">×</button>') +
        '</span>';
    }).join('');
    if (travado) return '<div class="tags">' + (chips || '<span class="aviso">—</span>') + '</div>';
    return '<div class="tags">' + chips +
      '<input type="text" class="tag-caixa" list="tagsLista_' + id + '" placeholder="assunto — Enter ou vírgula" autocomplete="off"' +
      ' data-tags="' + alvo + '" data-id="' + id + '">' +
      '<datalist id="tagsLista_' + id + '">' + M.todasAsTags().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>' +
      '</div>';
  }

  function campoMarca(alvo, id, chave, rotulo, ligado, travado, ajuda) {
    return '<div class="campo campo-marca' + (ligado ? ' campo-marca-on' : '') + '">' +
      '<input type="checkbox" id="c_' + id + '_' + chave + '"' +
      ' data-alvo="' + alvo + '" data-id="' + id + '" data-campo="' + chave + '"' +
      (ligado ? ' checked' : '') + (travado ? ' disabled' : '') + '>' +
      rotuloDe(id, chave, rotulo, ajuda) + '</div>';
  }

  // ── coluna da esquerda ────────────────────────────────────────────

  function desenharLista() {
    try { montarLista(); } catch (e) {
      // a coluna é a navegação: sem ela o usuário fica sem saída nenhuma
      console.error('falhou ao montar a coluna', e);
      $lista.innerHTML = '<li class="aviso" style="padding:0 10px">' +
        'Não consegui montar a lista.<br><button type="button" class="bt-fraco" ' +
        'data-acao="voltar-inicio" style="margin-top:8px">recomeçar</button></li>';
    }
  }

  /* A coluna mostra CINCO: as três vagas, sempre, mesmo vazias — vaga vazia é
     informação —, e depois os dois mais recentes, por conveniência. O resto vive
     na página de projetos. Coluna que cresce com o cadastro vira lista infinita,
     e lista infinita é volume de obrigação à vista. */
  var VAGAS_COLUNA = [
    { papel: 'titular', t: 'titular' },
    { papel: 'reserva', t: 'reserva' },
    { papel: 'planejamento', t: 'em planejamento' }
  ];

  function montarLista() {
    var linhas = VAGAS_COLUNA.map(function (v) {
      var p = M.projetoPorPapel(v.papel);
      return p ? itemProjeto(p) : itemVagaAberta(v);
    });

    var jaEstao = {};
    M.cat().projetos.forEach(function (p) { if (p.papel) jaEstao[p.id] = true; });

    M.cat().projetos
      .filter(function (p) {
        return !jaEstao[p.id] && p.estado !== 'concluido' && p.estado !== 'encerrado';
      })
      .sort(function (a, b) { return a.ultimoToque < b.ultimoToque ? 1 : -1; })
      .slice(0, 5 - VAGAS_COLUNA.length)
      .forEach(function (p) { linhas.push(itemProjeto(p)); });

    linhas.push('<li><button type="button" class="item-projeto item-vermais" data-abrir="projetos"' +
      (tela.tipo === 'projetos' ? ' aria-current="true"' : '') + '>ver todos</button></li>');

    $lista.innerHTML = linhas.join('');

    var av = M.avulsas();
    $avulsas.innerHTML = itemSimples('avulsas', 'Tarefas sem projeto',
      av.length + ' cadastrada' + (av.length === 1 ? '' : 's'));

    var abertas = M.pendenciasAbertas();
    var pior = abertas.length ? M.nivelPendencia(abertas[0]) : null;
    document.getElementById('listaPendencias').innerHTML = itemSimples(
      'pendencias', 'Aguardando',
      abertas.length ? abertas.length + ' em aberto' : 'nada esperando',
      pior) +
      // a folha do diarista só existe quando há algo separado
      (M.separadas().length
        ? itemSimples('diarista', 'Diarista', M.separadas().length + ' separada' + (M.separadas().length === 1 ? '' : 's') +
            ' · ' + M.formatarData(M.separadas()[0].separada.dia) + ' · ~' + M.duracao(M.minutosSeparados()))
        : '');

    // a coluna diz o que pede análise: as novas. O resto já tem destino.
    var novas = M.cat().sementes.filter(function (s) { return s.estado === 'nova'; }).length;
    document.getElementById('listaRoadmap').innerHTML = itemSimples('sementes', 'Sementes',
      novas ? novas + ' nova' + (novas === 1 ? '' : 's') + ' para analisar' : 'nada novo');
  }

  function itemProjeto(p) {
    var atual = tela.tipo === 'projeto' && tela.id === p.id;
    var r = M.etiquetaDe(p);
    var nota = M.motivoTrancado(p) ||
      (p.estado === 'preparo' ? M.oQueFaltaParaSubir(p) : '');

    return '<li><button type="button" class="item-projeto vaga-' + r.chave + '"' +
      ' data-abrir="projeto" data-id="' + p.id + '"' + (atual ? ' aria-current="true"' : '') + '>' +
      '<span class="item-etiqueta"><i class="pino"></i>' + esc(r.texto) + '</span>' +
      '<span class="item-nome">' + esc(p.nome || 'sem nome') + '</span>' +
      (mostraEnvelope(p) ? barraEnvelope(p) : '') +
      (nota ? '<span class="item-nota">' + esc(nota) + '</span>' : '') +
      '</button></li>';
  }

  /* "Vai sair?" (§43): só quando há coisa de rua em jogo. Não é cobrança —
     é aproveitar a viagem. */
  function linkDaRua() {
    var n = M.tarefasDaRua().length;
    if (!n) return '';
    return '<p class="rua-link"><button type="button" class="bt-linha" data-acao="ir-rua">vai sair? · ' +
      n + (n === 1 ? ' coisa' : ' coisas') + ' na rua</button></p>';
  }

  /* Vaga vazia é convite, não buraco: leva direto para a escolha. */
  function itemVagaAberta(v) {
    var prontas = M.planejadas().filter(M.aptaParaExecucao).length;
    var chamada = v.papel === 'planejamento'
      ? 'escolher uma muda pronta'
      : prontas ? 'escolher entre ' + prontas + (prontas === 1 ? ' pronta' : ' prontas') : 'nada pronto ainda';

    return '<li><button type="button" class="item-projeto item-vaga vaga-' + v.papel + '"' +
      ' data-abrir="projetos" data-filtro="' + (v.papel === 'planejamento' ? 'fila' : 'planejada') + '">' +
      '<span class="item-etiqueta"><i class="pino"></i>' + esc(v.t) + '</span>' +
      '<span class="item-livre">vaga aberta · ' + esc(chamada) + '</span>' +
      '</button></li>';
  }

  function itemSimples(chave, nome, nota, nivel) {
    return '<li><button type="button" class="item-projeto" data-abrir="' + chave + '"' +
      (tela.tipo === chave ? ' aria-current="true"' : '') + '>' +
      '<span class="item-nome">' +
        (nivel ? '<span class="ponto ponto-' + nivel + '"></span>' : '') + esc(nome) +
      '</span>' +
      '<span class="item-nota">' + esc(nota) + '</span></button></li>';
  }

  /* O envelope só aparece em projeto PLANEJADO (§36): é quando se sabe quanto
     custa e ainda não se começou. Na fila é chute; em planejamento está sendo
     levantado; rodando, já disparou. Só o "orçado em" sobrevive na obra. */
  function mostraEnvelope(p) {
    return p.estado === 'preparo' && !p.papel &&
      p.custoEstimado !== null && p.custoEstimado !== undefined;
  }

  /* Barra do envelope: "X de X", nunca porcentagem. O valor tem lastro —
     quando enche, uma porta abre. A porcentagem não teria. */
  function barraEnvelope(p) {
    var meta = Number(p.custoEstimado) || 0;
    var tem = Number(p.guardado) || 0;
    var fatia = meta > 0 ? Math.min(100, (tem / meta) * 100) : 100;
    return '<span class="envelope">' +
      '<span class="envelope-valor">' + esc(M.moeda(tem)) + ' de ' + esc(M.moeda(meta)) + '</span>' +
      '<span class="envelope-barra"><span class="envelope-cheia" style="width:' +
        fatia.toFixed(1) + '%"></span></span></span>';
  }

  // ── palco ─────────────────────────────────────────────────────────

  var TELAS = {
    projetos:   marcacaoProjetos,
    projeto:    function () {
      var p = M.projeto(tela.id);
      return p ? marcacaoProjeto(p) : null;
    },
    avulsas:    marcacaoAvulsas,
    pendencias: marcacaoPendencias,
    sementes:   marcacaoSementes,
    diarista:   marcacaoDiarista,
    rua:        marcacaoRua,
    proposta:   marcacaoProposta
  };

  /* Nunca deixar o usuário preso numa tela sem saída: se algo estourar ao
     montar o palco, ele mostra o erro e um caminho de volta em vez de meia
     tela quebrada. Ação dentro do app tem que ser barata de desfazer. */
  function desenharPalco() {
    guardarLugar();
    var html;
    try {
      var construtor = TELAS[tela.tipo];
      html = construtor ? construtor() : null;
    } catch (e) {
      console.error('falhou ao montar', tela, e);
      html = '<h2>Deu ruim aqui</h2>' +
        '<p class="palco-sub">Nada foi perdido — o que está gravado continua gravado.</p>' +
        '<pre class="aviso" style="white-space:pre-wrap">' + esc(e.message) + '</pre>' +
        '<div class="rodape-acoes">' +
          '<button type="button" class="bt-forte" data-acao="voltar-inicio">voltar</button>' +
          '<button type="button" class="bt-fraco" id="btSocorroExportar">exportar tudo</button>' +
        '</div>';
    }
    if (html === null) {
      tela = { tipo: null, id: null };
      html = marcacaoAbertura();
    }
    // a cascata é automática, mas nunca calada: ela diz o que moveu, uma vez
    $palco.innerHTML = (avisoCascata
      ? '<p class="aviso-cascata">' + esc(avisoCascata) + '</p>' : '') + html;

    var socorro = document.getElementById('btSocorroExportar');
    if (socorro) socorro.addEventListener('click', exportar);
  }

  /* O cadastro do projeto se escreve uma vez e se lê muitas: fica trancado por
     padrão. Escapam do cadeado a SITUAÇÃO — a única coisa ali que muda toda
     semana, e que por isso pergunta antes — e o GUARDADO, que muda a cada
     aporte. Custo estimado não: orçamento se refaz na mesa, não de passagem. */
  // ── abertura ──────────────────────────────────────────────────────
  /* A tela de entrada mandava criar o primeiro projeto mesmo com quatro
     cadastrados. No lugar, uma frase que muda com a hora e as três vagas —
     que é o estado que governa tudo o que o app vai oferecer. Não é o painel
     ainda: aqui não entra tarefa nenhuma. */

  /* Voz seca da §16: sem exclamação, sem elogio, sem incentivo. A frase não
     empurra nem cobra — ela só reconhece que hora é e que dia é. */
  /* Voz seca da §16 — sem exclamação, sem elogio, sem incentivo — mas seca não
     é sem graça. A frase reconhece a hora com um canto de boca; ela nunca
     empurra, nunca cobra e nunca comenta o seu desempenho. */
  var SAUDACOES = {
    madrugada: [
      'Ainda de pé.',
      'A esta hora, só a casa e você.',
      'O sítio dorme. Nem tudo em você concorda.',
      'Cedo demais ou tarde demais, depende de como você conta.',
      'Ninguém nunca começou uma obra à meia-noite e se orgulhou disso.',
      'A serra ainda está preta.',
      'Nada lá fora precisa de você agora.',
      'Boa hora para pensar. Péssima para cavar.',
      'O galo ainda está se preparando.',
      'Se está aqui a esta hora, é ideia, não trabalho.'
    ],
    manha: [
      'Bom dia.',
      'O dia está inteiro na sua frente.',
      'A neblina levanta lá pelas nove. Você, não sei.',
      'Primeira hora, a que rende.',
      'Hora boa para o que precisa de tempo firme.',
      'O barro de ontem já decidiu se secou.',
      'Antes do calor, tudo parece mais fácil.',
      'As cabras já tomaram o café delas.',
      'O galo desistiu de te acordar faz tempo.',
      'Manhã: a única parte do dia que ninguém ainda estragou.',
      'Cedo. Dá para fingir que o dia vai render tudo isso.'
    ],
    tarde: [
      'Boa tarde.',
      'Meio do dia já foi embora.',
      'A tarde dá conta de uma coisa. De três, não.',
      'O sol virou. O trabalho, não.',
      'Depois do almoço tudo pesa dez quilos a mais.',
      'Ainda cabe alguma coisa hoje.',
      'Metade do dia foi. A outra metade também vai.',
      'Boa hora para o que não exige empolgação.',
      'Antes de escurecer, ainda dá.',
      'Tarde é quando as ideias da manhã prestam contas.'
    ],
    noite: [
      'Boa noite.',
      'Hora de mesa, não de bota.',
      'O dia acabou lá fora. Aqui dentro, você decide.',
      'Escureceu. A enxada descansa; o plano, não.',
      'A noite é boa para decidir e péssima para se convencer.',
      'Lá fora já não dá para enxergar o próprio pé.',
      'O que ficou para amanhã já ficou.',
      'Toda ferramenta está exatamente onde você deixou.',
      'De noite todo projeto parece mais fácil do que é.',
      'Fim do dia. As cabras não estão nem aí.'
    ]
  };

  // temperos que entram no sorteio só quando são verdade
  var FIM_DE_SEMANA = [
    'Fim de semana. O sítio não foi avisado.',
    'Dia sem hora marcada.',
    'Hoje o relógio é seu — e ele some rápido.',
    'Sábado e domingo rendem o dobro e passam na metade do tempo.'
  ];

  var SEGUNDA = [
    'Segunda. A grama cresceu o fim de semana inteiro.',
    'Semana nova. O mato não soube disso.',
    'Segunda-feira, que para o sítio é terça, quarta e domingo também.'
  ];

  // sorteada uma vez por abertura: redesenhar a tela não pode trocar a frase
  var saudacao = (function () {
    var agora = new Date();
    var h = agora.getHours(), d = agora.getDay();
    var pool = SAUDACOES[h < 5 ? 'madrugada' : h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite'];
    if (d === 0 || d === 6) pool = pool.concat(FIM_DE_SEMANA);
    if (d === 1) pool = pool.concat(SEGUNDA);
    return pool[Math.floor(Math.random() * pool.length)];
  })();

  var VAGAS = [
    { v: 'titular', t: 'titular' },
    { v: 'reserva', t: 'reserva' },
    { v: 'planejamento', t: 'planejamento' }
  ];

  /* Se a tarefa atravessou a caminhada do sítio até o PC sem ser recusada, ela
     é uma declaração de vontade — e tudo que não for ela vira concorrência.
     Por isso ela ocupa a entrada inteira, e o catálogo entra em modo consulta:
     só o projeto DELA aceita escrita, porque orçar acaba em registrar preço e
     conferir acaba em abrir pendência. */
  function caixaTarefaAtiva(t) {
    var proj = t.projetoId ? M.projeto(t.projetoId) : null;
    var recado = M.recadoDe(t.id);

    return '<div class="ativa-caixa">' +
      '<span class="ativa-etiqueta">em andamento</span>' +
      '<p class="ativa-texto">' + esc(t.texto || 'tarefa sem texto') + '</p>' +
      (recado ? '<p class="ativa-recado">' + esc(recado) + '</p>' : '') +
      '<p class="ativa-meta">' +
        (proj ? esc(proj.nome || 'projeto sem nome') + ' · ' : '') +
        'faltam ~' + esc(M.duracao(M.restanteDe(t.id))) +
      '</p>' +
      /* Na MESA a segunda porta precisa existir: você veio ao PC no meio da
         tarefa justamente para consultar alguma coisa, e sem ela o modo consulta
         vira uma sala sem porta. Na BOTA não — lá o que se consulta é a trilha,
         dentro da própria tarefa. */
      '<div class="ativa-saidas">' +
        '<button type="button" class="bt-forte" data-acao="ir-executar">abrir a tarefa</button>' +
        (naMesa()
          ? '<button type="button" class="bt-fraco" data-acao="ir-organizar">consultar os projetos</button>'
          : '') +
      '</div>' +
      (naMesa()
        ? '<p class="ativa-nota">Enquanto ela estiver aberta, só o projeto dela aceita mudança. ' +
          'O resto do app fica para leitura.</p>'
        : '') + '</div>';
  }

  /* Enquanto há tarefa ativa, só o "projeto dela" aceita escrita — e para uma
     avulsa, o projeto dela são as avulsas. `null` aqui é a lista das avulsas,
     não "nenhum lugar"; o que é geral (criar projeto, promover, importar)
     pergunta a `emConsultaGeral`. */
  function emConsulta(projetoId) {
    var t = M.tarefaAtivaDe('pe_eu');
    if (!t) return false;
    return (t.projetoId || null) !== (projetoId || null);
  }

  function emConsultaGeral() { return !!M.tarefaAtivaDe('pe_eu'); }

  /* A entrada pergunta ANTES de mostrar os projetos, e o motivo é o que você
     nomeou: planejar é gostoso, executar não é, e o app feito para quem trava
     pode virar o lugar onde se trava. A pergunta protege o instante exato em
     que a deriva começa. */
  function marcacaoAbertura() {
    var frase = '<p class="abertura-frase">' + esc(saudacao) + '</p>';
    var ativa = M.tarefaAtivaDe('pe_eu');

    if (ativa) return '<div class="abertura">' + frase + caixaTarefaAtiva(ativa) + avisoDeCopia() + '</div>';

    if (M.estaVazio()) {
      // na bota não há porta para o catálogo, nem vazio: cadastrar é da mesa
      if (!naMesa()) {
        return '<div class="abertura">' + frase +
          '<p class="abertura-nota">Nada cadastrado ainda. Os projetos se cadastram na mesa.</p></div>';
      }
      return '<div class="abertura">' + frase +
        '<p class="abertura-nota">Nada cadastrado ainda. Comece por um projeto.</p>' +
        '<div class="portas"><button type="button" class="porta" data-acao="ir-organizar">' +
        '<span class="porta-nome">organizar</span>' +
        '<span class="porta-sub">cadastrar o primeiro projeto</span></button></div></div>';
    }

    /* NO CELULAR NÃO HÁ DUAS PORTAS. Ali o app é a consulta — "uma pergunta e
       uma resposta", como diz a §1. Não há porta nenhuma para o catálogo: folhear
       projetos de pé no pasto não resolve nenhuma situação real, e o que a bota
       precisa mesmo consultar — o que já foi decidido neste projeto — mora
       dentro da própria tarefa, na trilha. */
    if (!naMesa()) {
      return '<div class="abertura">' + frase +
        '<button type="button" class="c-acao porta-unica" data-acao="ir-executar">encontrar tarefa</button>' +
        linkDaRua() +
        vagasDaAbertura() + avisoDeNuvem() +
        '</div>';
    }

    return '<div class="abertura">' + frase +
      '<div class="portas">' +
        /* Na mesa as duas portas são iguais: o app não tem opinião sobre qual
           delas você deveria escolher agora. Destacar executar fazia organizar
           parecer o caminho errado, e organizar é trabalho legítimo. */
        '<button type="button" class="porta" data-acao="ir-executar">' +
          '<span class="porta-nome">executar</span>' +
          '<span class="porta-sub">o app escolhe o que cabe agora</span>' +
        '</button>' +
        '<button type="button" class="porta" data-acao="ir-organizar">' +
          '<span class="porta-nome">organizar</span>' +
          '<span class="porta-sub">mexer nos projetos e no plano</span>' +
        '</button>' +
      '</div>' + linkDaRua() + vagasDaAbertura() + avisoDeNuvem() + avisoDeCopia() + '</div>';
  }

  /* Aparelho sem sincronização diz isso na entrada, uma linha, sem alarme —
     é onde se descobre que a semente plantada no pasto não chegou na mesa. */
  function avisoDeNuvem() {
    if (typeof Sync === 'undefined') return '';
    if (!Sync.ligado()) {
      return '<p class="aviso-copia">Este aparelho não sincroniza com os outros. ' +
        '<button type="button" class="bt-linha bt-mini" data-acao="nuvem">ligar</button></p>';
    }
    // ligado: a última sincronização, miúda, sempre à vista — clique sincroniza
    var s = Sync.situacao();
    var texto = s.ocupado ? 'sincronizando…' : s.erro ? '⚠ nuvem: ' + s.erro
      : s.ultimo ? 'nuvem · sincronizado às ' + M.horaDe(new Date(s.ultimo)) : 'nuvem ligada';
    return '<p class="aviso-copia' + (s.erro ? ' aviso-erro' : '') + '">' + esc(texto) +
      ' <button type="button" class="bt-linha bt-mini" data-acao="sincronizar-agora">sincronizar agora</button></p>';
  }

  function vagasDaAbertura() {
    return '<dl class="abertura-vagas">' + VAGAS.map(function (vaga) {
      var p = M.cat().projetos.filter(function (q) { return q.papel === vaga.v; })[0];
      return '<div class="abertura-vaga vaga-' + vaga.v + '">' +
        '<dt><i class="pino"></i>' + vaga.t + '</dt>' +
        '<dd' + (p ? '' : ' class="abertura-livre"') + '>' +
          esc(p ? (p.nome || 'sem nome') : 'vaga aberta') + '</dd></div>';
    }).join('') + '</dl>';
  }

  /* "Próximo passo" era uma promessa que o app não pode cumprir: quem escolhe a
     próxima é o motor, na hora, pela situação do dia — pode ser a da sequência
     ou qualquer outra que caiba melhor. O que o app sabe de verdade é onde você
     parou. */
  function ondeParou(pid) {
    var ultima = null, quando = '';
    M.passosDe(pid).forEach(function (t) {
      if (M.estadoDe(t.id) !== 'feita') return;
      var dia = M.ultimaVezDe(t.id) || '';
      if (!ultima || dia >= quando) { ultima = t; quando = dia; }
    });
    if (!ultima) return 'Ainda não começou.';
    return 'Onde parou: ' + (ultima.texto || 'tarefa sem texto') +
      (quando ? ' · ' + M.formatarData(quando) : '');
  }

  function marcacaoProjeto(p) {
    var outros = M.cat().projetos.filter(function (q) { return q.id !== p.id; });
    var consulta = emConsulta(p.id);
    var solto = projetoEditando === p.id && !consulta;
    var trancado = M.motivoTrancado(p);

    /* O título É o campo. Antes o nome e o resultado apareciam duas vezes — uma
       grandes no alto, outra como campo de formulário logo abaixo. Um elemento
       por dado, sempre no mesmo lugar e do mesmo tamanho: solto ele aceita
       digitação, trancado só se lê. */
    return [
      /* Folhear projetos é ir e vir: sem a volta, ler o terceiro da lista custa
         voltar pela porta da frente e reencontrar onde você estava. */
      voltarPara
        ? '<button type="button" class="voltar-lista" data-acao="voltar-lista">← todos os projetos</button>'
        : '',
      '<div class="palco-cabeca">',
        '<div class="palco-cabeca-texto">',
          '<h2><input type="text" class="titulo-obra" placeholder="Projeto sem nome"' +
            ' aria-label="Nome da obra"' + (solto ? '' : ' readonly') +
            ' data-alvo="projeto" data-id="' + p.id + '" data-campo="nome"' +
            ' value="' + esc(p.nome) + '"></h2>',
          (solto || p.resultado
            ? '<input type="text" class="titulo-resultado"' +
              ' placeholder="Resultado — o que muda quando ficar pronto"' +
              ' aria-label="Resultado"' + (solto ? '' : ' readonly') +
              ' data-alvo="projeto" data-id="' + p.id + '" data-campo="resultado"' +
              ' value="' + esc(p.resultado) + '">'
            : ''),
          '<p class="palco-sub">' + esc(trancado || ondeParou(p.id)) +
            /* Num projeto rodando o envelope já disparou e some — mas quanto a
               obra custou continua sendo curiosidade legítima. Fica aqui, numa
               linha só, sem barra e sem campo. */
            ((p.papel === 'titular' || p.papel === 'reserva' ||
              p.estado === 'concluido' || p.estado === 'encerrado') &&
             p.custoEstimado !== null && p.custoEstimado !== undefined && Number(p.custoEstimado) > 0
              ? '<span class="palco-custo">orçado em ' + esc(M.moeda(p.custoEstimado)) + '</span>'
              : '') +
          '</p>',
          barraAcoes(p),
        '</div>',
        consulta ? '<span class="selo-consulta">consulta</span>'
          : solto
          ? '<button type="button" class="bt-forte" data-acao="salvar-projeto">salvar</button>' +
            (foto && foto.id === p.id
              ? '<button type="button" class="bt-fraco" data-acao="desfazer-projeto" data-id="' + p.id + '" title="Volta o projeto a como estava quando você clicou em editar.">desfazer</button>' : '')
          : '<button type="button" class="bt-fraco" data-acao="editar-projeto" data-id="' + p.id + '">editar</button>',
      '</div>',

      // a confirmação da ação fica colada na barra que a abriu — não no meio da ficha
      caixaAcao(p),

      // tags (§44): assuntos do projeto; as tarefas dele herdam na análise
      grupo('Tags', '', campoTags('projeto', p.id, p.tags, consulta),
        'Assuntos deste projeto — as tarefas dele herdam. Só cadastro por ora; a análise por assunto vem depois.'),

      /* A MUDA (§37): enquanto o projeto espera vaga, o trabalho é lapidar a
         ideia — e a ficha é essa lapidação. Depois de virar obra, a muda fica
         guardada num grupo fechado no pé: registro, não formulário. */
      (p.estado === 'fila' || p.estado === 'descartado') ? fichaMuda(p, consulta) : '',

      /* MOTIVAÇÃO = a muda (§37). Toda a motivação da obra foi lapidada na muda —
         vantagens, desvantagens, despesas por cima, sentimento, o que inviabiliza —
         então aqui ela aparece fechada, para ler quando a vontade acabar e você
         precisar lembrar por que começou. Obra antiga sem muda mostra os ganhos
         que tinha. Na muda viva isto não existe: a ficha da muda é a motivação. */
      (p.estado === 'fila' || p.estado === 'descartado') ? '' :
      mudaTemConteudo(p)
        ? grupoRecolhido('Motivação', p.id, resumoMuda(p))
        : (p.ganhos || []).length
        ? grupoRecolhido('Motivação', p.id, '<div class="caixa-motivacao"><p class="area-motivacao">' +
            (p.ganhos || []).map(esc).join('<br>') + '</p></div>')
        : '',

      /* O envelope é gatilho de entrada: dispara uma vez e some. Num projeto já
         rodando ele não decide mais nada, e ficar mostrando dinheiro no meio da
         obra é convidar a virar controle financeiro, que ele não é. E antes de
         planejar não existe (§36): orçar é trabalho da vaga de planejamento —
         em planejamento os campos aparecem para receber o número; a barra, só
         quando o projeto está planejado. */
      !(p.papel === 'planejamento' || (p.estado === 'preparo' && !p.papel))
        ? ''
        : grupo('Envelope', '',
            // a barra é a leitura; os campos são só o jeito de mexer nela
            (mostraEnvelope(p) ? '<div class="envelope-largo">' + barraEnvelope(p) + '</div>' : '') +
            // a muda estimou por cima; o orçamento de verdade é trabalho daqui
            (p.papel === 'planejamento' && (p.custoEstimado === null || p.custoEstimado === undefined) &&
             Number(p.muda.despesas.inicial) > 0
              ? '<p class="aviso" style="margin:0 0 10px">A muda estimava ' + esc(M.moeda(p.muda.despesas.inicial)) + ' por cima.</p>' : '') +
            '<div class="grade">' +
            campoTexto('projeto', p.id, 'custoEstimado', 'Custo estimado', p.custoEstimado,
              { numero: true, min: 0, travado: !solto,
                ajuda: 'O que o planejamento levantou. Sem ele a planejada não sobe: ' +
                       'o app diz "sem orçamento levantado".' }) +
            // escapa do cadeado normal (aporte é rotina), mas não do modo consulta
            campoTexto('projeto', p.id, 'guardado', 'Guardado', p.guardado, { numero: true, min: 0,
              travado: consulta,
              ajuda: 'Quanto já está separado para esta obra. Onde você aporta é a sua declaração de ' +
                     'qual projeto vem primeiro — decisão fria, tomada meses antes de começar.' }) +
            '</div>',
            'Quanto custa e quanto já foi juntado. É gatilho para começar, não controle financeiro: ' +
            'quando enche, a porta abre uma vez e o app para de olhar para dinheiro. A barra mostra ' +
            'valores, nunca porcentagem: o valor tem lastro, e quando enche uma porta abre.'),

      /* Projeto que já está executando passou por todas as portas: listar o que
         um dia o segurou é história, não restrição. */
      // muda não tem Depende: dependência entre projetos é "como e quando" — planejamento
      (p.papel === 'titular' || p.papel === 'reserva' || p.estado === 'fila' || p.estado === 'descartado' ||
       p.estado === 'concluido' || p.estado === 'encerrado')
        ? ''
        : grupo('Depende', '', fichasPrerequisitos(p, outros, !solto),
            'Projetos que precisam estar concluídos antes deste. Enquanto faltar um, este fica ' +
            'com a porta trancada e o motivo aparece em texto seco na coluna da esquerda.'),

      (p.estado === 'fila' || p.estado === 'descartado') ? '' :
      secaoEtapa(p, 'planejamento', 'Planejamento',
        'Decidir como vai ser feito, medir, conferir o que já existe, orçar e comprar. ' +
        'Enquanto sobrar uma tarefa aberta aqui, a execução fica segura — planejar é o prazer ' +
        'e executar é o gargalo, então vale gastar o tempo aqui antes de mexer na terra.'),
      // o estado fica na tela; a explicação da regra vai para o hover
      (p.estado === 'fila' || p.estado === 'descartado') ? '' :
      secaoEtapa(p, 'execucao', 'Execução',
        'O trabalho em si. Nenhuma destas é oferecida enquanto houver uma tarefa de ' +
        'planejamento aberta neste projeto.',
        pendentePlanejamento(p.id) ? 'espera o planejamento' : ''),

      /* Projeto que morreu vira `cancelado` e fica no registro. Apagar existe
         só para o que foi cadastrado errado — por isso é pequeno e fica no
         canto, e não no meio do caminho como uma saída natural. */
      // as saídas ficam aqui embaixo, pequenas: existem, mas não convidam
      consulta ? '' : peDoProjeto(p)
    ].join('');
  }

  // ── a ficha da muda (§37) ─────────────────────────────────────────

  /* CADEIAS: cada linha é uma razão (ou desvantagem) puxada até esgotar. Os
     elos são caixas em sequência; a última é sempre vazia, com a pergunta que
     puxa — deixou vazia, a cadeia acabou. A linha vazia do fim começa outra.
     A tela não redesenha a cada tecla: o `input` só acrescenta caixa quando um
     elo vazio ganha texto; o redesenho fica para quando um elo é apagado. */
  function cadeias(p, campo, cadeiaLista, pergunta, novaLinha, editavel) {
    var vivas = editavel ? cadeiaLista : M.cadeiasVivas(cadeiaLista);
    var linhas = vivas.map(function (c, i) {
      var elos = c.map(function (texto, j) { return elo(p, campo, i, j, texto, editavel, pergunta, j === 0); });
      if (editavel) elos.push(elo(p, campo, i, c.length, '', true, pergunta, false));
      return '<li class="cadeia">' + elos.join('<span class="seta" aria-hidden="true">→</span>') + '</li>';
    });
    if (editavel) {
      linhas.push('<li class="cadeia cadeia-nova">' +
        elo(p, campo, vivas.length, 0, '', true, novaLinha, true) + '</li>');
    }
    return '<ol class="cadeias" data-cadeias="' + campo + '">' +
      (linhas.length ? linhas.join('') : '<li class="aviso">—</li>') + '</ol>';
  }
  function elo(p, campo, i, j, texto, editavel, pergunta, primeiro) {
    if (!editavel) return '<span class="elo elo-lido">' + esc(texto) + '</span>';
    // a caixa cresce com o texto: elo longo não pode ficar cortado
    return '<input type="text" class="elo' + (texto ? '' : ' elo-vazio') + '"' +
      ' size="' + Math.min(48, Math.max(14, (texto || pergunta).length + 2)) + '"' +
      ' data-muda="' + campo + '" data-id="' + p.id + '" data-linha="' + i + '" data-elo="' + j + '"' +
      ' placeholder="' + esc(primeiro && j === 0 && !texto ? pergunta : (j === 0 ? '' : pergunta)) + '"' +
      ' value="' + esc(texto) + '">';
  }

  /* O centro: quando duas cadeias terminam na mesma coisa. É leitura, não
     campo — o app só aponta a convergência quando ela existe. */
  function centroDe(lista) {
    var fins = {};
    M.cadeiasVivas(lista).forEach(function (c) {
      var fim = c[c.length - 1].trim().toLowerCase();
      if (fim) fins[fim] = (fins[fim] || 0) + 1;
    });
    var melhor = Object.keys(fins).sort(function (a, b) { return fins[b] - fins[a]; })[0];
    return melhor && fins[melhor] >= 2 ? { texto: melhor, n: fins[melhor] } : null;
  }

  function contagem(lista, minimo, singular, plural) {
    var n = M.cadeiasVivas(lista).length;
    return '<span class="cadeias-conta">' + n + ' ' + (n === 1 ? singular : plural) +
      (n < minimo ? ' · pronta pede ' + minimo : '') + '</span>';
  }

  function fichaMuda(p, consulta) {
    var m = p.muda, d = m.despesas;
    var editavel = m.estado === 'plantando' && !consulta;
    var falta = M.faltaParaPronta(p);
    var centro = centroDe(m.vantagens);
    var outros = M.cat().projetos.filter(function (q) { return q.id !== p.id && q.estado !== 'descartado' && q.estado !== 'concluido' && q.estado !== 'encerrado'; });

    // o estado da muda e o botão que o vira
    var cabeca;
    if (m.estado === 'descartada') {
      cabeca = '<span class="muda-estado muda-descartada">descartada em ' + esc(M.formatarData(M.diaDe(m.descartadaEm))) + '</span>' +
        '<p class="semente-motivo">' + esc(m.motivo) + '</p>' +
        (consulta ? '' : '<button type="button" class="bt-fraco bt-mini" data-acao="muda-reabrir" data-id="' + p.id + '">reabrir a muda</button>');
    } else if (m.estado === 'pronta') {
      cabeca = '<span class="muda-estado muda-pronta">pronta desde ' + esc(M.formatarData(M.diaDe(m.prontaEm))) + '</span>' +
        (consulta ? '' : '<button type="button" class="bt-linha bt-mini" data-acao="muda-plantar" data-id="' + p.id + '">voltar a lapidar</button>');
    } else {
      cabeca = '<span class="muda-estado muda-plantando">plantando</span>' +
        (consulta ? '' :
          '<button type="button" class="bt-forte bt-mini' + (falta.length ? ' bt-travado' : '') + '"' +
            (falta.length ? ' title="' + esc('Falta: ' + falta.join(', ') + '.') + '"' : '') +
            ' data-acao="muda-pronta" data-id="' + p.id + '">' + (falta.length ? CADEADO : '') + 'pronta</button>') +
        (falta.length ? '<span class="muda-falta">' + esc((mudaAvisoDe === p.id && mudaAviso) || ('Falta: ' + falta.join(', ') + '.')) + '</span>' : '');
    }

    function caixa(campo, rotulo, valor, dica) {
      return '<div class="campo campo-largo"><label for="m_' + p.id + '_' + campo + '">' + esc(rotulo) + '</label>' +
        '<textarea id="m_' + p.id + '_' + campo + '" rows="3" data-muda="' + campo + '" data-id="' + p.id + '"' +
        (editavel ? ' placeholder="' + esc(dica) + '"' : ' readonly placeholder="—"') + '>' + esc(valor) + '</textarea></div>';
    }
    function numero(campo, rotulo, valor, dica) {
      var vazio = valor === null || valor === undefined;
      return '<div class="campo"><label for="m_' + p.id + '_' + campo + '">' + esc(rotulo) + '</label>' +
        '<input type="number" min="0" id="m_' + p.id + '_' + campo + '" data-muda="' + campo + '" data-id="' + p.id + '"' +
        (editavel ? ' placeholder="' + esc(dica || 'R$') + '"' : ' readonly placeholder="—"') +
        ' value="' + (vazio ? '' : esc(valor)) + '"></div>';
    }

    return [
      '<div class="secao secao-campos muda">',
        '<div class="secao-titulo">Muda</div>',
        '<div class="secao-corpo">',
          '<div class="muda-cabeca">' + cabeca + '</div>',
          '<p class="dica muda-dica">Lapidar a ideia até dar para decidir: toca ou muda o rumo. É sobre motivação — como e quando são planejamento.</p>',
        '</div>',
      '</div>',

      grupo('O que é', '',
        '<p class="muda-oquee">' + (p.nome ? esc(p.nome) : '<span class="aviso">escreva o nome lá em cima — a semente refinada numa coisa concreta</span>') + '</p>',
        'A semente refinada numa coisa concreta: "criar cabras" vira "construir um capril". É o nome da obra.'),

      grupo('Vantagens', '',
        contagem(m.vantagens, 2, 'vantagem', 'vantagens') +
        cadeias(p, 'vantagens', m.vantagens, 'e isso, para quê?', 'por que você quer isso? — uma razão', editavel) +
        (centro ? '<p class="muda-centro">centro: <b>' + esc(centro.texto) + '</b> — ' + centro.n + ' razões chegam aqui</p>' : ''),
        'Uma razão por linha, e cada razão puxada até o fim: "e isso, para quê?" Deixou a caixa vazia, a cadeia acabou. Quando duas cadeias terminam no mesmo lugar, o app aponta o centro.'),

      grupo('Desvantagens', '',
        contagem(m.desvantagens, 2, 'desvantagem', 'desvantagens') +
        cadeias(p, 'desvantagens', m.desvantagens, 'e isso causa o quê?', 'uma desvantagem', editavel),
        'Uma por linha, cada uma puxada até o fim: "e isso causa o quê?" Cuidado diário → menos tempo de manhã. O custo por cima, em palavras, cabe aqui também.'),

      grupo('Despesas', '',
        '<div class="grade">' +
          numero('inicial', 'Valor inicial estimado', d.inicial, 'por cima; 0 se não custa') +
          numero('fixaMensal', 'Valor fixo mensal', d.fixaMensal, 'por cima; 0 se não tem') +
          '<div class="campo"><label for="m_' + p.id + '_geraProduto">Gera produto ou serviço?</label>' +
            '<select id="m_' + p.id + '_geraProduto" data-muda="geraProduto" data-id="' + p.id + '"' + (editavel ? '' : ' disabled') + '>' +
              '<option value=""' + (d.geraProduto === null || d.geraProduto === undefined ? ' selected' : '') + '>—</option>' +
              '<option value="sim"' + (d.geraProduto === true ? ' selected' : '') + '>sim</option>' +
              '<option value="nao"' + (d.geraProduto === false ? ' selected' : '') + '>não</option>' +
            '</select></div>' +
          (d.geraProduto
            ? '<div class="campo"><label for="m_' + p.id + '_produto">O quê?</label>' +
              '<input type="text" id="m_' + p.id + '_produto" data-muda="produto" data-id="' + p.id + '"' +
              (editavel ? ' placeholder="leite, limpeza do terreno, ovos"' : ' readonly placeholder="—"') +
              ' value="' + esc(d.produto) + '"></div>'
            : '') +
          numero('retornoMensal', 'Retorno mensal estimado', d.retornoMensal, 'em dinheiro, mesmo que consumido aqui') +
        '</div>' +
        '<p class="muda-leitura" id="leitura_' + p.id + '">' + esc(M.leituraFria(p)) + '</p>',
        'Estimativa de decisão, por cima — nunca vira envelope. O envelope nasce no planejamento, quando se orça de verdade. Zero vale; "não sei" vira um chute honesto.'),

      grupo('Como você se sentiria', '',
        caixa('sentimento', 'Com isso pronto — e por quê?', m.sentimento, 'a única pergunta emocional, de propósito depois dos números'),
        'O valor sentimental. Fica depois dos números para não contaminar a conta — mas conta tanto quanto.'),

      grupo('O que isso inviabiliza', '',
        caixa('inviabiliza', 'Que projetos, mudas ou intenções perdem espaço ou tempo com isso?', m.inviabiliza, '"nada" também é resposta — mas escrita') +
        (outros.length
          ? '<p class="dica">Para olhar a lista, não a memória: ' + outros.map(function (q) {
              return esc(q.nome || 'sem nome') + ' <i>(' + esc(M.etiquetaDe(q).texto) + ')</i>'; }).join(' · ') + '</p>'
          : ''),
        'O sítio tem limite de espaço e você de tempo. O que esta obra tira de outra?')
    ].join('');
  }

  // muda vazia (obra criada direto, antes da §37) não tem o que mostrar
  function mudaTemConteudo(p) {
    var m = p.muda, d = m.despesas || {};
    return M.cadeiasVivas(m.vantagens).length || M.cadeiasVivas(m.desvantagens).length ||
      (m.sentimento || '').trim() || (m.inviabiliza || '').trim() ||
      [d.inicial, d.fixaMensal, d.retornoMensal].some(function (v) { return v !== null && v !== undefined; });
  }

  /* A muda depois de virar obra: um resumo fechado, para ler quando a vontade
     acabou e você precisa lembrar por que começou. */
  function resumoMuda(p) {
    var m = p.muda;
    function lista(l) {
      return '<ul class="cadeias-lidas">' + M.cadeiasVivas(l).map(function (c) {
        return '<li>' + c.map(esc).join(' <span class="seta">→</span> ') + '</li>'; }).join('') + '</ul>';
    }
    return '<div class="muda-resumo">' +
      '<h4>vantagens</h4>' + lista(m.vantagens) +
      '<h4>desvantagens</h4>' + lista(m.desvantagens) +
      (M.leituraFria(p) ? '<h4>despesas, por cima</h4><p>' + esc(M.leituraFria(p)) + '</p>' : '') +
      (m.sentimento ? '<h4>como me sentiria</h4><p>' + esc(m.sentimento) + '</p>' : '') +
      (m.inviabiliza ? '<h4>o que inviabiliza</h4><p>' + esc(m.inviabiliza) + '</p>' : '') +
      '</div>';
  }

  var recolhidos = {};   // grupos fechados abertos à mão, por chave
  function grupoRecolhido(titulo, chave, corpo) {
    var aberto = !!recolhidos[chave];
    return '<div class="secao secao-campos' + (aberto ? '' : ' secao-recolhida') + '">' +
      '<div class="secao-titulo"><button type="button" class="cabeca-link" data-acao="abrir-recolhido" data-id="' + chave + '">' +
        esc(titulo) + (aberto ? ' ▾' : ' ▸') + '</button></div>' +
      (aberto ? '<div class="secao-corpo">' + corpo + '</div>' : '') +
      '</div>';
  }

  /* Suspender e cancelar com uma tarefa em andamento dentro deixava a bota
     mostrando tarefa de projeto suspenso. A tarefa ativa é vontade declarada:
     primeiro ela fecha, depois o projeto sai da vaga. */
  function peDoProjeto(p) {
    var corpo;
    if (perigo.aberto === p.id) {
      corpo = '<span class="dica">Apaga o projeto e todas as tarefas dele, sem desfazer. Para guardar o registro, use <em>cancelar</em>.</span>' +
        '<button type="button" class="bt-linha bt-mini" data-acao="remover-projeto" data-id="' + p.id + '">sim, apagar tudo</button>' +
        '<button type="button" class="bt-fraco bt-mini" data-acao="cancelar-perigo">deixa quieto</button>';
    } else if (M.temTarefaAtiva(p.id)) {
      corpo = '<span class="dica">Há uma tarefa em andamento aqui. Termine ou pare ela antes de suspender, cancelar ou apagar.</span>';
    } else {
      corpo = saidasDe(p).map(function (k) {
        return '<button type="button" class="bt-linha bt-mini" data-acao="projeto-' + k +
          '" data-id="' + p.id + '">' + ACOES[k].rotulo + (p.estado === 'fila' ? ' esta muda' : ' este projeto') + '</button>';
      }).join('') +
      '<button type="button" class="bt-linha bt-mini" data-acao="abrir-perigo" data-id="' + p.id + '">apagar</button>';
    }
    return '<div class="pe-projeto">' + corpo + '</div>';
  }

  // ── todos os projetos ─────────────────────────────────────────────
  /* Esta página não é uma lista com filtros: é a TELA DA DECISÃO de qual vem
     depois. Por isso vem agrupada na ordem do funil — a ordem é a informação,
     você vê o cano inteiro e onde ele está entupido — e cada linha carrega só
     o que serve para escolher: o destino, o que falta, o envelope, a idade.
     NENHUMA TAREFA aparece aqui: no instante em que aparecesse, isto viraria a
     tela de "todas as tarefas" que o teto de três frentes proíbe. */

  var GRUPOS = [
    { chave: 'vagas',      t: 'em andamento',
      cabe: function (p) { return p.papel === 'titular' || p.papel === 'reserva' || p.papel === 'planejamento'; } },
    { chave: 'planejada',  t: 'planejadas',
      cabe: function (p) { return p.estado === 'preparo' && !p.papel; } },
    { chave: 'fila',       t: 'mudas',
      cabe: function (p) { return p.estado === 'fila'; } },
    { chave: 'suspenso',   t: 'suspensos',
      cabe: function (p) { return p.estado === 'parado'; } },
    { chave: 'encerrado',  t: 'concluídos e cancelados',
      cabe: function (p) { return p.estado === 'concluido' || p.estado === 'encerrado'; } },
    // muda descartada é registro: fica visível, com o motivo, sem contar no teto
    { chave: 'descartada', t: 'mudas descartadas',
      cabe: function (p) { return p.estado === 'descartado'; } }
  ];

  function marcacaoProjetos() {
    var todos = M.cat().projetos;

    var blocos = GRUPOS.filter(function (g) {
      return !filtroProjetos || filtroProjetos === g.chave;
    }).map(function (g) {
      var lista = todos.filter(g.cabe);
      if (g.chave === 'planejada') lista = M.planejadas();
      if (g.chave === 'vagas') {
        var peso = { titular: 0, reserva: 1, planejamento: 2 };
        lista = lista.slice().sort(function (a, b) { return peso[a.papel] - peso[b.papel]; });
      }
      if (!lista.length) return '';
      return '<div class="secao"><div class="secao-titulo">' + esc(g.t) + '</div>' +
        '<ul class="fichario">' + lista.map(linhaProjeto).join('') + '</ul></div>';
    }).join('');

    return [
      '<h2>Projetos</h2>',
      '<p class="palco-sub">' + esc(estadoDoFunil()) + '</p>',
      '<div class="filtros">',
        botaoFiltro('', 'todos'),
        GRUPOS.map(function (g) { return botaoFiltro(g.chave, g.t); }).join(''),
      '</div>',
      blocos || '<p class="aviso" style="margin-top:24px">Nada aqui.</p>',
      emConsultaGeral() ? '' :
      '<div class="rodape-acoes">' +
        '<button type="button" class="bt-forte" data-acao="novo-projeto">novo projeto</button>' +
      '</div>'
    ].join('');
  }

  /* Responde "dá para promover alguma coisa agora?" sem ler a lista. */
  function estadoDoFunil() {
    var vazias = VAGAS_COLUNA.filter(function (v) { return !M.projetoPorPapel(v.papel); });
    var prontas = M.planejadas().filter(M.aptaParaExecucao);

    if (!vazias.length) {
      return 'As três vagas estão ocupadas. ' + (prontas.length
        ? prontas.length + (prontas.length === 1 ? ' planejada espera' : ' planejadas esperam') + ' a próxima abrir.'
        : 'Nada esperando na fila.');
    }

    // 'em planejamento' já carrega o 'em'; titular e reserva não
    var nomes = vazias.map(function (v) { return v.papel === 'planejamento' ? 'planejamento' : v.t; }).join(' e ');
    var querPlanejamento = vazias.some(function (v) { return v.papel === 'planejamento'; });
    var querExecucao = vazias.some(function (v) { return v.papel !== 'planejamento'; });

    var frases = ['Vaga aberta em ' + nomes + '.'];
    if (querExecucao) {
      frases.push(prontas.length
        ? (prontas.length === 1 ? '1 planejada está pronta para entrar.' : prontas.length + ' planejadas estão prontas para entrar.')
        : 'Nenhuma planejada está pronta ainda.');
    }
    if (querPlanejamento) {
      var mudas = M.mudasVivas();
      var prontasM = mudas.filter(M.mudaPronta).length;
      frases.push(mudas.length
        ? (prontasM ? 'Há ' + prontasM + (prontasM === 1 ? ' muda pronta' : ' mudas prontas') + ' para escolher.'
                    : 'Há ' + mudas.length + (mudas.length === 1 ? ' muda' : ' mudas') + ', nenhuma pronta ainda.')
        : 'Nenhuma muda plantada.');
    }
    return frases.join(' ');
  }

  function botaoFiltro(chave, texto) {
    return '<button type="button" class="filtro' + (filtroProjetos === chave ? ' filtro-on' : '') +
      '" data-acao="filtrar" data-valor="' + chave + '">' + esc(texto) + '</button>';
  }

  function botaoFiltroAvulsas(chave, texto) {
    return '<button type="button" class="filtro' + (filtroAvulsas === chave ? ' filtro-on' : '') +
      '" data-acao="filtrar-avulsas" data-valor="' + chave + '">' + esc(texto) + '</button>';
  }

  function linhaProjeto(p) {
    var r = M.etiquetaDe(p);
    var falta = M.motivoTrancado(p) || (p.estado === 'preparo' ? M.oQueFaltaParaSubir(p) : '');
    var idade = M.diasDesde(p.ultimoToque);

    return '<li class="ficha-projeto vaga-' + r.chave + '">' +
      '<button type="button" class="ficha-abrir" data-abrir="projeto" data-id="' + p.id + '">' +
        '<span class="item-etiqueta"><i class="pino"></i>' + esc(r.texto) + '</span>' +
        // na mesa, o nome da obra é o destaque (§4: o PC mostra o nome; a bota,
        // o resultado). O resultado vem embaixo, como o destino que a obra serve.
        '<span class="ficha-nome">' + esc(p.nome || p.resultado || 'sem nome') + '</span>' +
        (p.resultado && p.nome ? '<span class="ficha-obra">' + esc(p.resultado) + '</span>' : '') +
        (falta ? '<span class="item-nota">' + esc(falta) + '</span>' : '') +
        (mostraEnvelope(p) ? barraEnvelope(p) : '') +
        (idade >= 60 && p.estado !== 'ativo'
          ? '<span class="ficha-idade">parado há ' + idade + ' dias</span>' : '') +
      '</button>' +
      (emConsultaGeral() ? '' :
       M.aptaParaExecucao(p) && !M.projetoPorPapel('reserva')
        ? '<button type="button" class="bt-forte bt-mini" data-acao="projeto-promover" data-id="' +
          p.id + '">pôr em execução</button>'
        : '') +
      (emConsultaGeral() ? '' :
       p.estado === 'fila' && M.mudaPronta(p) && !M.projetoPorPapel('planejamento')
        ? '<button type="button" class="bt-fraco bt-mini" data-acao="projeto-promover" data-id="' +
          p.id + '">planejar</button>'
        : '') +
      '</li>';
  }

  // ── ações do projeto ──────────────────────────────────────────────
  /* O select de sete situações morreu. Ele permitia qualquer salto, inclusive
     os absurdos — titular voltando a planejamento —, e tratava como campo de
     cadastro o que é decisão. O caminho é um só: muda → planejamento →
     execução → concluído, com suspender e cancelar como saídas laterais.
     A ÚNICA promoção que é escolha é a entrada no planejamento, porque é a
     única em que existe mais de um candidato. */

  var CADEADO = '<svg class="cadeado" viewBox="0 0 12 14" aria-hidden="true">' +
    '<path d="M3.2 6V4.1a2.8 2.8 0 0 1 5.6 0V6" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
    '<rect x="1.5" y="6" width="9" height="7" rx="1.3" fill="currentColor"/></svg>';

  var ACOES = {
    promover:  { rotulo: 'promover',  forte: true },
    descartar: { rotulo: 'descartar' },
    concluir:  { rotulo: 'concluir',  forte: true },
    retomar:   { rotulo: 'retomar',   forte: true },
    suspender: { rotulo: 'suspender' },
    cancelar:  { rotulo: 'cancelar' }
  };

  /* O topo tem só o que AVANÇA. Suspender e cancelar desceram para o pé, em
     letra pequena, junto do apagar: com o concluir trancado e as duas saídas
     em botão normal ao lado, a tela estava sugerindo desistir — e um app para
     quem trava não pode oferecer a desistência com mais clareza que a
     conclusão. */
  function acaoQueAvanca(p) {
    if (p.estado === 'descartado') return null;   // reabrir mora no pé, junto do motivo
    if (p.estado === 'parado') return 'retomar';
    if (p.estado === 'concluido' || p.estado === 'encerrado') return 'retomar';
    if (p.papel === 'titular' || p.papel === 'reserva') return 'concluir';
    if (p.papel === 'planejamento') return null;
    return 'promover';
  }

  // muda sobe para planejamento; planejada sobe para reserva
  function destinoDaPromocao(p) {
    return p.estado === 'preparo' ? 'reserva' : 'planejamento';
  }

  function saidasDe(p) {
    if (p.estado === 'concluido' || p.estado === 'encerrado' || p.estado === 'descartado') return [];
    if (p.estado === 'fila') return ['descartar'];   // muda não suspende nem cancela: descarta, com motivo
    if (p.estado === 'parado') return ['cancelar'];
    return ['suspender', 'cancelar'];
  }

  /* Concluir fica visível e trancado, com o que falta ao lado: escondido, o
     botão não puxa ninguém; trancado, ele vira o motivo para fechar a última
     tarefa. E o que destranca é decisão sua — terminar ou cancelar. */
  function barraAcoes(p) {
    if (emConsulta(p.id)) return '';
    var abertas = M.tarefasAbertasDe(p.id).length;
    var k = acaoQueAvanca(p);
    var botoes = '';

    if (k) {
      // o teto de três frentes é parede, não conselho: sem vaga, não promove
      var ocupada = k === 'promover' && (destinoDaPromocao(p) === 'reserva'
        ? !!M.projetoPorPapel('reserva') && !!M.projetoPorPapel('titular')
        : !!M.projetoPorPapel('planejamento'));

      var mudaCrua = k === 'promover' && p.estado === 'fila' && !M.mudaPronta(p);
      var trava = (k === 'concluir' && abertas > 0) || ocupada || mudaCrua ||
                  (k === 'promover' && destinoDaPromocao(p) === 'reserva' && !M.aptaParaExecucao(p));
      var rotulo = k === 'promover'
        ? (destinoDaPromocao(p) === 'reserva' ? 'pôr em execução' : 'promover a planejamento')
        : ACOES[k].rotulo;
      botoes = '<button type="button" class="' + (ACOES[k].forte ? 'bt-forte' : 'bt-fraco') + ' bt-acao' +
        (trava ? ' bt-travado' : '') + '"' + (trava ? ' disabled' : '') +
        ' data-acao="projeto-' + k + '" data-id="' + p.id + '">' +
        (trava ? CADEADO : '') + rotulo + '</button>';
    }

    /* Planejada volta para o planejamento quando você quiser: o mundo muda, o
       preço muda, e um plano pronto pode precisar ser refeito. Só depende de a
       vaga estar livre — é um por vez. */
    if (p.estado === 'preparo' && !p.papel) {
      var vagaOcupada = M.projetoPorPapel('planejamento');
      botoes += '<button type="button" class="bt-fraco bt-acao' + (vagaOcupada ? ' bt-travado' : '') + '"' +
        (vagaOcupada ? ' disabled' : '') +
        ' data-acao="projeto-revisar" data-id="' + p.id + '">' +
        (vagaOcupada ? CADEADO : '') + 'voltar a planejamento</button>';
    }

    var nota = '';
    if (mudaCrua) {
      nota = 'A muda ainda não está pronta. Só muda pronta entra em planejamento.';
    } else if (ocupada) {
      var dono = M.projetoPorPapel(destinoDaPromocao(p) === 'reserva' ? 'reserva' : 'planejamento');
      nota = 'A vaga está com ' + (dono.nome || 'outro projeto') +
        '. Conclua, suspenda ou cancele um dos que estão andando primeiro.';
    } else if ((p.papel === 'titular' || p.papel === 'reserva') && abertas) {
      nota = abertas === 1 ? 'Falta 1 tarefa aberta.' : 'Faltam ' + abertas + ' tarefas abertas.';
    } else if (p.papel === 'planejamento' || (p.estado === 'preparo' && !p.papel)) {
      nota = M.oQueFaltaParaSubir(p);
      // o cadeado tem que dizer o caminho: sem custo, o botão parece morto
      if (p.estado === 'preparo' && !p.papel && /orçamento/.test(nota || '')) {
        nota += ' Preencha o custo estimado no Envelope — 0 se não custa nada — e o botão abre.';
      }
      var idade = M.diasDesde(p.ultimoToque);
      if (p.estado === 'preparo' && !p.papel && idade >= 60) {
        nota += ' Planejado há ' + idade + ' dias.';
      }
    } else if (p.fecho && p.fecho.texto) {
      nota = p.fecho.texto;
    }

    return '<div class="barra-acoes">' + botoes +
      (nota ? '<span class="barra-nota">' + esc(nota) + '</span>' : '') + '</div>';
  }

  var TEXTOS_ACAO = {
    promover:  { frase: 'Entra em planejamento e ganha o esqueleto: decidir, medir, conferir, orçar, comprar.',
                 ok: 'promover' },
    descartar: { frase: 'Descartar a muda. Tudo o que você escreveu fica guardado, com o motivo — a Márcia também lê.',
                 campo: 'Por quê?', ok: 'descartar' },
    revisar:   { frase: 'Volta para a vaga de planejamento e entra uma tarefa: revisar preços, medidas ' +
                        'e disponibilidade. Enquanto houver tarefa de planejamento aberta aqui, ele fica ' +
                        'nessa vaga — é o momento de reclassificar o que estiver na etapa errada. Quando ' +
                        'a última fechar, ele volta sozinho para as planejadas.',
                 ok: 'voltar a planejamento' },
    concluir:  { frase: 'Concluir. Nenhuma tarefa aberta ficou para trás.',
                 campo: 'Quer anotar alguma coisa? O que ficou pronto, o que você faria diferente.',
                 opcional: true, ok: 'concluir' },
    suspender: { frase: 'Suspender. O projeto sai da vaga e guarda tudo como está, para voltar depois.',
                 campo: 'Por quê?', ok: 'suspender' },
    cancelar:  { frase: 'Cancelar. O projeto e as tarefas continuam no registro, mas saem do caminho.',
                 campo: 'Por quê?', ok: 'cancelar' },
    retomar:   { frase: 'Retomar. Volta para onde estava antes de parar — planejada ou muda — ' +
                        'sem vaga: a vaga você dá de novo, pela mesma porta de todos.',
                 ok: 'retomar' }
  };

  function caixaAcao(p) {
    if (!acaoProjeto || acaoProjeto.pid !== p.id) return '';
    var cfg = TEXTOS_ACAO[acaoProjeto.tipo];
    if (!cfg) return '';

    var frases = [cfg.frase];

    if (acaoProjeto.tipo === 'promover') {
      if (destinoDaPromocao(p) === 'reserva') {
        frases = [M.projetoPorPapel('titular')
          ? 'Entra como reserva e passa a receber trabalho quando a titular travar.'
          : 'A vaga de titular está aberta: este projeto assume o comando do dia.'];
        var idade = M.diasDesde(p.ultimoToque);
        if (idade >= 60) {
          frases.push('Planejado há ' + idade + ' dias — os preços do orçamento são desta época.');
        }
      } else {
        var anterior = M.projetoPorPapel('planejamento');
        if (anterior && anterior.id !== p.id) {
          frases.push((anterior.nome || 'O projeto que estava em planejamento') + ' volta para a fila.');
        }
        if (M.passosDe(p.id).length) frases[0] = 'Entra em planejamento.';
      }
    }
    // dizer antes quem sobe: a cascata não pode ser surpresa
    if (['concluir', 'suspender', 'cancelar'].indexOf(acaoProjeto.tipo) !== -1 &&
        (p.papel === 'titular' || p.papel === 'reserva')) {
      var sobe = quemSobe(p);
      if (sobe) frases.push(sobe);
    }

    return '<div class="confirma">' +
      '<p class="confirma-texto">' + esc(frases.join(' ')) + '</p>' +
      (cfg.campo
        ? '<textarea class="confirma-campo" id="campoAcao" rows="2" placeholder="' +
          esc(cfg.campo) + '"></textarea>'
        : '') +
      '<div class="confirma-acoes">' +
        '<button type="button" class="bt-forte" data-acao="confirmar-acao">' + esc(cfg.ok) + '</button>' +
        '<button type="button" class="bt-fraco" data-acao="cancelar-acao">deixa quieto</button>' +
      '</div></div>';
  }

  /* Simula a cascata sem executá-la, só para dizer o que vai acontecer. Só a
     subida de reserva para titular é automática — a vaga que sobra fica aberta
     esperando a sua escolha, e isso é dito na cara. */
  function quemSobe(p) {
    var reserva = M.projetoPorPapel('reserva');
    var prontas = M.planejadas().filter(M.aptaParaExecucao).length;

    var frase = p.papel === 'titular' && reserva
      ? (reserva.nome || 'A reserva') + ' assume a vaga de titular. A de reserva fica aberta.'
      : 'A vaga de ' + (p.papel || 'execução') + ' fica aberta.';

    return frase + ' ' + (prontas
      ? (prontas === 1 ? 'Há 1 planejada pronta para entrar.' : 'Há ' + prontas + ' planejadas prontas para entrar.')
      : 'Nenhuma planejada está pronta ainda.');
  }

  function pendentePlanejamento(pid) {
    return M.passosDe(pid).some(function (t) {
      return t.etapa === 'planejamento' && M.estadoDe(t.id) === 'aberta';
    });
  }

  /* Duas seções, não uma lista só: a divisão entre decidir e fazer precisa
     estar visível, senão a regra que segura a execução parece arbitrária. */
  function secaoEtapa(p, etapa, titulo, explicacao, estado) {
    var tarefas = M.passosDe(p.id).filter(function (t) { return t.etapa === etapa; });
    var travada = etapa === 'execucao' && pendentePlanejamento(p.id);

    /* Planejamento cumprido não precisa se mostrar toda vez que você entra:
       ele já fez o que tinha de fazer. Recolhe para uma linha, e continua a um
       clique de distância — nada é escondido, só sai da frente. */
    var cumprido = etapa === 'planejamento' && tarefas.length &&
                   !M.tarefasAbertasDe(p.id, 'planejamento').length;
    var recolhido = cumprido && planejamentoAberto !== p.id;
    /* Obra rodando não ganha tarefa de planejamento: planejamento já foi. O que
       parecer planejamento agora acontece na execução. A seção fica só como
       registro. Muda também não adiciona (detalhar é da vaga de planejamento). */
    var executando = p.papel === 'titular' || p.papel === 'reserva';
    var podeAdicionar = !emConsulta(p.id) && p.estado !== 'fila' && !(etapa === 'planejamento' && executando);

    return '<div class="secao secao-etapa' + (travada ? ' secao-travada' : '') +
      (recolhido ? ' secao-recolhida' : '') + '">' +
      '<div class="secao-cabeca">' +
        '<div class="secao-titulo tem-ajuda" title="' + esc(explicacao) + '">' + esc(titulo) + '</div>' +
        (estado ? '<span class="secao-nota">' + esc(estado) + '</span>' : '') +
        (cumprido
          ? '<button type="button" class="bt-linha bt-mini" data-id="' + p.id + '" data-acao="' +
            (recolhido ? 'mostrar-planejamento' : 'esconder-planejamento') + '">' +
            (recolhido ? tarefas.length + ' tarefas, todas resolvidas · mostrar' : 'esconder') +
            '</button>'
          : '') +
        // adicionar também aqui em cima: numa lista longa, descer até o pé para
        // incluir uma tarefa é caminhada demais (fica nos dois lugares)
        (podeAdicionar && !recolhido
          ? '<button type="button" class="bt-fraco bt-mini secao-adicionar" data-acao="nova-tarefa" data-id="' + p.id +
            '" data-etapa="' + etapa + '">adicionar tarefa</button>'
          : '') +
      '</div>' +
      (recolhido ? '' :
        /* Detalhar é trabalho da vaga de planejamento — é o vazamento por onde
           o teto de três frentes escapava: dava para passar a tarde cadastrando
           tarefas de uma obra que não está em vaga nenhuma. */
        listaPassos(tarefas, etapa,
          emConsulta(p.id) ? ''
            : p.estado === 'fila'
            ? '<p class="aviso" style="margin-top:14px">Detalhar é trabalho da vaga de planejamento.</p>'
            : !podeAdicionar
            ? ''
            : '<div class="rodape-acoes">' +
              '<button type="button" class="bt-fraco" data-acao="nova-tarefa" data-id="' + p.id +
              '" data-etapa="' + etapa + '">adicionar tarefa</button>' +
            '</div>')) +
      '</div>';
  }

  function fichasPrerequisitos(p, outros, travado) {
    var fichas = (p.prerequisitos || []).map(function (qid) {
      var q = M.projeto(qid);
      return '<span class="ficha">' + esc(q ? q.nome || 'sem nome' : '(removido)') +
        (travado ? '' :
          '<button type="button" data-acao="tirar-prereq" data-id="' + p.id +
          '" data-valor="' + qid + '" aria-label="tirar">×</button>') + '</span>';
    }).join('');

    var livres = outros.filter(function (q) {
      return (p.prerequisitos || []).indexOf(q.id) === -1;
    });

    if (travado) {
      return '<div class="fichas">' + (fichas || '<span class="aviso">Nada segurando.</span>') + '</div>';
    }

    var seletor = livres.length
      ? '<div class="junta"><select id="selPrereq"><option value="">escolher projeto…</option>' +
          livres.map(function (q) {
            return '<option value="' + esc(q.id) + '">' + esc(q.nome || 'sem nome') + '</option>';
          }).join('') + '</select>' +
          '<button type="button" class="bt-fraco" data-acao="por-prereq" data-id="' + p.id + '">vincular</button></div>'
      : '<p class="aviso">Nenhum outro projeto cadastrado.</p>';

    return '<div class="fichas">' + (fichas || '<span class="aviso">Nada segurando.</span>') +
      '</div>' + seletor;
  }

  /* Filtros como na página de projetos: a lista das avulsas junta rotina,
     destrave e obra pequena, e sem filtro o que se procura fica no meio do
     resto. Rotina é a que tem cadência; feitas e canceladas vêm do diário. */
  var FILTROS_AVULSAS = [
    { chave: 'abertas',    t: 'abertas',    cabe: function (t) { return !fechada(t) && !M.periodica(t); } },
    { chave: 'rotina',     t: 'rotina',     cabe: function (t) { return M.periodica(t); } },
    { chave: 'juntando',   t: 'juntando dinheiro', cabe: function (t) { return !fechada(t) && M.juntandoDinheiro(t); } },
    { chave: 'feitas',     t: 'feitas',     cabe: function (t) { return M.estadoDe(t.id) === 'feita'; } },
    { chave: 'canceladas', t: 'canceladas', cabe: function (t) { return M.estadoDe(t.id) === 'encerrada'; } }
  ];

  function marcacaoAvulsas() {
    var todas = M.avulsas();
    var grupo = FILTROS_AVULSAS.filter(function (g) { return g.chave === filtroAvulsas; })[0];
    var lista = grupo ? todas.filter(grupo.cabe) : todas;

    return [
      '<h2>Tarefas sem projeto</h2>',
      '<p class="palco-sub">O lastro do app: o que responde quando os projetos estão travados.</p>',
      '<div class="filtros">',
        botaoFiltroAvulsas('', 'todas'),
        FILTROS_AVULSAS.map(function (g) { return botaoFiltroAvulsas(g.chave, g.t); }).join(''),
      '</div>',
      listaPassos(lista, null,
        emConsulta(null) ? '' :
        '<div class="rodape-acoes">' +
          '<button type="button" class="bt-forte" data-acao="novo-passo" data-id="">adicionar tarefa</button>' +
          deSemente() +
        '</div>')
    ].join('');
  }

  /* A outra porta da tarefa nova: partir de uma semente já aprovada para isso.
     Só aparece quando há alguma — sem semente elegível, criar do zero é o único
     caminho e a linha não existe. */
  function deSemente() {
    var elegiveis = M.sementesParaTarefa();
    if (!elegiveis.length) return '';
    return '<label class="de-semente">a partir de uma semente ' +
      '<select id="selSementeTarefa">' +
        '<option value="">escolher…</option>' +
        elegiveis.map(function (s) {
          return '<option value="' + s.id + '">' + esc(s.nome) + '</option>';
        }).join('') +
      '</select></label>';
  }

  // ── passos ────────────────────────────────────────────────────────

  var AJUDA_ETAPA =
    'Planejamento é decidir como vai ser feito. Execução é fazer. Enquanto sobrar uma tarefa ' +
    'de planejamento aberta neste projeto, nenhuma de execução é oferecida — é o que impede ' +
    'cavar trinta buracos antes de saber se o poste cabe no orçamento.';

  var AJUDA_DURACAO =
    'Quanto tempo a coisa leva, em minutos. Estimativa grossa serve: errar aqui é normal, e ao ' +
    'parar no meio você diz quanto andou em vez de cronometrar nada.';

  function fechada(t) {
    var e = M.estadoDe(t.id);
    return e === 'feita' || e === 'encerrada';
  }

  /* O que interessa ler é o que vem pela frente: o que já foi desce para o pé
     da seção, sem a tira de marcas, e as abertas numeram de 1. */
  /* A lista existe mesmo vazia: é ela que recebe a tarefa arrastada da outra
     etapa. Sem isso, mover para um planejamento vazio seria impossível. */
  /* `rodape` (o "adicionar tarefa") entra ANTES das feitas: o que já foi desce
     para o pé e o botão não pode descer junto — senão some atrás do histórico. */
  function listaPassos(passos, etapa, rodape) {
    if (!passos.length) {
      return '<ul class="passos passos-vazia" data-etapa="' + esc(etapa || '') + '">' +
        '<li class="passos-nada">Nenhuma tarefa aqui' +
        (etapa ? ' — arraste uma da outra seção, ou adicione' : '') + '.</li></ul>' + (rodape || '');
    }

    var abertas = passos.filter(function (t) { return !fechada(t); });
    var prontas = passos.filter(fechada);

    // o número que a tarefa mostra na tela é o endereço dela: as dependências
    // apontam para ele em vez de repetir a frase inteira da outra tarefa
    var numeros = {};
    abertas.forEach(function (t, i) { numeros[t.id] = i + 1; });

    var html = abertas.map(function (t, i) { return marcacaoPasso(t, i + 1, numeros, etapa); }).join('');
    if (rodape) html += '<li class="passos-rodape">' + rodape + '</li>';
    if (prontas.length) {
      var temFeita = prontas.some(function (t) { return M.estadoDe(t.id) === 'feita'; });
      var temCancelada = prontas.some(function (t) { return M.estadoDe(t.id) === 'encerrada'; });
      html += '<li class="passos-divisor">' +
        (temFeita && temCancelada ? 'feitas e canceladas' : temCancelada ? 'canceladas' : 'feitas') +
        '</li>' +
        prontas.map(function (t) { return marcacaoPasso(t, 0, numeros, etapa); }).join('');
    }
    return '<ul class="passos" data-etapa="' + esc(etapa || '') + '">' + html + '</ul>';
  }

  /* A duração em edição é um seletor: 15 · 30 · 60 · 90 · +. Quase toda tarefa
     cai numa dessas; o "+" abre o número para as outras (e fica marcado quando
     o valor não é nenhum dos quatro). Tocar é mais rápido que digitar. */
  var TEMPOS = [15, 30, 60, 90];
  function seletorDeTempo(t) {
    var atual = Number(t.duracaoTotal) || 0;
    var fora = TEMPOS.indexOf(atual) === -1 || tempoLivre === t.id;
    return '<span class="passo-tempos" title="' + esc(AJUDA_DURACAO) + '">' +
      TEMPOS.map(function (m) {
        return '<button type="button" class="tempo' + (!fora && atual === m ? ' tempo-on' : '') + '"' +
          ' data-acao="tempo" data-id="' + t.id + '" data-valor="' + m + '">' + (m < 60 ? m : m === 60 ? '1h' : '1h30') + '</button>';
      }).join('') +
      '<button type="button" class="tempo' + (fora ? ' tempo-on' : '') + '" data-acao="tempo-livre" data-id="' + t.id + '">+</button>' +
      (fora
        ? '<input type="number" class="passo-tempo passo-tempo-edita" min="5"' +
          ' data-alvo="tarefa" data-id="' + t.id + '" data-campo="duracaoTotal" value="' + esc(t.duracaoTotal) + '">'
        : '') +
      '</span>';
  }
  var tempoLivre = null;   // tarefa com o "+" aberto

  function executandoObra(pid) {
    var p = M.projeto(pid);
    return !!p && (p.papel === 'titular' || p.papel === 'reserva');
  }

  function marcacaoPasso(t, n, numeros, etapaDaSecao) {
    var aberto = passoAberto === t.id;
    var solto = passoEditando === t.id;
    var situacao = M.estadoDe(t.id);   // vem do diário, não do catálogo
    var feita = situacao === 'feita';
    var pronta = fechada(t);
    var avisos = M.avisosDe(t);

    // com a ficha aberta não arrasta: os campos dentro precisam de seleção.
    // Em consulta também não: arrastar reordena e muda etapa, e isso é escrita.
    var arrasta = !aberto && !emConsulta(t.projetoId);
    return '<li class="passo passo-' + situacao + (pronta ? ' passo-pronta' : '') +
      (aberto ? ' passo-aberto' : '') +
      '" draggable="' + (arrasta ? 'true' : 'false') + '" data-tarefa="' + t.id + '">' +
      '<div class="passo-linha">' +
        '<span class="passo-alca" aria-hidden="true">⋮⋮</span>' +
        // só o endereço da tarefa: o número não é botão, e fingir que era só
        // funcionava para quem já sabia
        '<span class="passo-ordem' + (pronta ? ' passo-ordem-fim' : '') + '">' +
          (feita ? '✓' : situacao === 'encerrada' ? '×' : (n || '·')) + '</span>' +
        /* O título é o campo — como no projeto. Duro, ele abre e fecha a ficha;
           solto, aceita digitação no mesmo lugar. A duração idem: formatada
           enquanto se lê, em minutos enquanto se edita. */
        '<input type="text" class="passo-texto" placeholder="tarefa sem texto"' +
          (solto ? '' : ' readonly data-acao="abrir-ficha"') +
          ' data-alvo="tarefa" data-id="' + t.id + '" data-campo="texto"' +
          ' value="' + esc(t.texto) + '">' +
        /* Etapa e duração na barra do título: é o que se lê de relance antes de
           decidir se vale abrir a ficha. Soltas, viram os próprios controles —
           por isso nenhuma das duas tem seção lá dentro. */
        /* A etiqueta só aparece quando diz algo novo: dentro da seção EXECUÇÃO,
           sete etiquetas "execução" empilhadas não informam nada e só pesam.
           Nas avulsas, que não têm seção, ela sempre aparece. */
        /* A etapa só se escolhe onde ela ainda é escolha: projeto em planejamento
           ou planejada. Obra rodando não ganha planejamento (a seção já nasce
           certa), e avulsa não tem etapa. Fechar essa brecha é o que impede
           tarefa de planejamento nascer em obra com planejamento fechado. */
        (solto && t.projetoId && !executandoObra(t.projetoId)
          ? '<select class="passo-etapa passo-etapa-edita"' +
            ' data-alvo="tarefa" data-id="' + t.id + '" data-campo="etapa">' +
            opcoes(M.ETAPAS, t.etapa) + '</select>'
          : t.etapa === etapaDaSecao || !t.projetoId ? ''
          : '<span class="passo-etapa" title="' + esc(AJUDA_ETAPA) + '">' +
            esc(t.etapa === 'planejamento' ? 'planejamento' : 'execução') + '</span>') +
        /* O LOCAL vem antes do tempo, na própria linha (§46): é ele que decide o
           resto da ficha, e escondido no fim ele era esquecido. Fora, o tempo
           não entra — coisa de rua é rápida e o tempo serve ao sorteio do dia. */
        (solto
          ? '<select class="passo-local-edita" title="Onde esta tarefa precisa ser feita — decide o resto da ficha."' +
            ' data-alvo="tarefa" data-id="' + t.id + '" data-campo="ondePrecisaEstar">' +
            opcoes(M.LOCAIS, t.ondePrecisaEstar) + '</select>'
          : '') +
        (t.ondePrecisaEstar === 'fora' ? ''
          : solto
          ? seletorDeTempo(t)
          : '<span class="passo-tempo" title="' + esc(AJUDA_DURACAO) + '">' +
            '<i aria-hidden="true">⏱</i>' + esc(M.duracao(t.duracaoTotal)) + '</span>') +
        // delegar ao diarista (§39): decisão de véspera, na própria linha.
        // Em edição a linha só tem salvar: o resto espera a tarefa existir.
        (emConsulta(t.projetoId) || solto ? ''
          : t.separada
          ? '<span class="passo-delegada" title="separada para o diarista">delegada · ' + esc(M.formatarData(t.separada.dia)) + '</span>' +
            '<button type="button" class="bt-linha bt-mini" data-acao="desfazer-separacao" data-id="' + t.id + '">tirar da folha</button>'
          : M.podeSeparar(t)
          ? '<button type="button" class="bt-linha bt-mini" data-acao="separar-diarista" data-id="' + t.id + '">delegar</button>'
          : '') +
        // as duas ações da linha, com nome: concluir de um lado do editar
        (emConsulta(t.projetoId) || solto ? ''
          : pronta
          ? '<button type="button" class="bt-linha bt-mini" data-acao="reabrir-tarefa" data-id="' + t.id + '">reabrir</button>'
          : '<button type="button" class="bt-linha bt-mini bt-concluir" data-acao="concluir-tarefa" data-id="' + t.id + '">' +
              (t.separada ? 'feita pelo diarista' : 'concluir') + '</button>') +
        (emConsulta(t.projetoId) ? ''
          : solto
          ? '<button type="button" class="bt-forte bt-mini" data-acao="salvar-passo">salvar</button>'
          : '<button type="button" class="bt-linha bt-mini" data-acao="editar-passo" data-id="' + t.id + '">editar</button>') +
      '</div>' +

      (M.juntandoDinheiro(t) && !aberto && !fechada(t)
        ? '<div class="passo-avisos"><span class="aviso-linha aviso-diarista">juntando dinheiro · faltam ' + esc(M.moeda(M.faltaDinheiro(t))) + '</span></div>' : '') +
      (M.esperasDe(t.id).length && !aberto
        ? '<div class="passo-avisos">' + M.esperasDe(t.id).map(function (x) {
            return '<span class="aviso-linha aviso-espera espera-' + M.nivelPendencia(x) + '">espera ' + esc(x.descricao) +
              ' · ' + esc(M.textoPendencia(x).toLowerCase().replace(/\.$/, '')) + '</span>'; }).join('') + '</div>'
        : '') +
      (avisos.length && !aberto
        ? '<div class="passo-avisos">' + avisos.map(function (a) {
            return '<span class="aviso-linha">' + esc(a) + '</span>'; }).join('') + '</div>'
        : '') +
      // §40: o que esta tarefa espera chegar — e o campo para dizer que espera mais
      (aberto && !solto && !emConsulta(t.projetoId) && !fechada(t)
        ? '<div class="passo-espera">' +
            M.esperasDe(t.id).map(function (x) {
              return '<div class="espera-item espera-' + M.nivelPendencia(x) + '">' +
                '<span class="ponto ponto-' + M.nivelPendencia(x) + '"></span>' +
                '<span class="espera-texto">espera <b>' + esc(x.descricao) + '</b> · ' + esc(M.textoPendencia(x)) + '</span>' +
                '<button type="button" class="bt-fraco bt-mini" data-acao="pendencia-chegou" data-id="' + x.id + '">chegou</button>' +
                '<button type="button" class="bt-linha bt-mini" data-acao="pendencia-cancelada" data-id="' + x.id + '">cancelada</button>' +
                '</div>';
            }).join('') +
            (esperando === t.id
              ? '<div class="espera-nova">' +
                  '<input type="text" id="esperaDesc_' + t.id + '" placeholder="o quê? — tela fina 1 m, agroloja">' +
                  '<input type="date" id="esperaDia_' + t.id + '" value="' + esc(M.hoje()) + '">' +
                  '<button type="button" class="bt-forte bt-mini" data-acao="esperar-confirmar" data-id="' + t.id + '">esperar</button>' +
                  '<button type="button" class="bt-linha bt-mini" data-acao="esperar-cancelar">deixa</button>' +
                '</div>'
              : '<button type="button" class="bt-linha bt-mini" data-acao="esperar-abrir" data-id="' + t.id + '">espera algo chegar</button>') +
          '</div>'
        : '') +
      (aberto
        ? '<div class="passo-corpo">' + formularioPasso(t, null, !solto) + '</div>'
        /* Feita ou cancelada, as condições já não importam — mas o que foi
           levado importa: no meio da tarefa de hoje, saber com que ferramenta e
           quanto material a anterior foi feita é consulta de verdade. */
        : pronta ? (marcasDoLevado(t) ? '<div class="passo-marcas">' + marcasDoLevado(t) + '</div>' : '')
        : '<div class="passo-marcas">' + marcasDe(t, numeros) + '</div>' +
          (t.recado ? '<p class="passo-recado">' + esc(t.recado) + '</p>' : '')) +
      '</li>';
  }

  function marcasDe(t, numeros) {
    var m = [];
    var local = M.LOCAIS.filter(function (l) { return l.v === t.ondePrecisaEstar; })[0];

    // o ícone diz o local: bandeira no sítio, carrinho na rua, tela no computador
    // ícone monocromático, na cor do texto — emoji vinha colorido e gritava
    m.push([t.ondePrecisaEstar === 'fora' ? '<svg class="marca-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12.5 4.6 8a1.5 1.5 0 0 1 1.4-1h8a1.5 1.5 0 0 1 1.4 1l1.6 4.5"/><rect x="2.5" y="12.5" width="15" height="3.5" rx="1"/><circle cx="6" cy="16.5" r="1.3"/><circle cx="14" cy="16.5" r="1.3"/></svg>' : t.ondePrecisaEstar === 'computador' ? '<svg class="marca-svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="15" height="9.5" rx="1.2"/><path d="M7 17h6M10 13.5V17"/></svg>' : '⚑',
      (local ? local.t : '') + (t.onde ? ' · ' + t.onde : '')]);
    // só o que é notável: "pode parar" é o caso comum e não merece etiqueta
    if (!t.podeParar) m.push(['⏱', 'não pode parar']);

    var cond = [];
    var noSitioL = t.ondePrecisaEstar === 'sitio';
    if (t.ondePrecisaEstar !== 'computador' && t.exigeClima !== 'indiferente') cond.push(t.exigeClima === 'firme' ? 'tempo firme' : 'tolera chuva fina');
    if (t.podeNoCalor === false) cond.push('não no calor');
    if (t.exigeSoloFirme) cond.push('solo firme');
    if (t.guardadaParaChuva) cond.push('guardada para a chuva');
    if (noSitioL) cond.push(t.esforco === 'pesado' ? 'pesado' : 'leve');
    if (cond.length) m.push(['☁', cond.join(' · ')]);
    if ((t.tags || []).length) m.push(['#', t.tags.join(' · ')]);

    var gente = [];
    if (t.precisaAjuda) gente.push('precisa ajuda');
    if (t.boaComCriancas) gente.push('boa com crianças');
    if (t.perigosaComCriancas) gente.push('perigosa com crianças');
    if (gente.length) m.push(['☻', gente.join(' · ')]);

    if ((t.ferramentas || []).length) m.push(['⚒', t.ferramentas.join(', ')]);
    if ((t.materiais || []).length) m.push(['▤', t.materiais.join(', ')]);

    var q = resumoQuando(t);
    if (q) m.push(['◷', q]);
    if (t.prazo) {
      m.push(['⏳', t.prazo.tipo === 'data'
        ? 'até ' + M.formatarData(t.prazo.em)
        : 'a cada ' + t.prazo.cadenciaDias + ' dias']);
    }

    /* Só as dependências que ainda seguram: cumprida deixou de ser restrição e
       vira ruído. E aponta para o NÚMERO da outra tarefa — repetir a frase
       inteira dela era o que mais entupia a linha. */
    var presas = (t.dependeDe || []).filter(function (d) { return M.estadoDe(d) !== 'feita'; });
    if (presas.length) {
      m.push(['⇢', 'depois de ' + presas.map(function (d) {
        var alvo = M.tarefa(d);
        if (numeros && numeros[d]) return numeros[d];
        return alvo ? (alvo.texto || 'sem texto') : '?';
      }).join(' e ')]);
    }

    return m.filter(function (x) { return x[1]; }).map(function (x) {
      return '<span class="marca"><i>' + x[0] + '</i>' + esc(x[1]) + '</span>';
    }).join('');
  }

  // só o que foi levado: ferramentas e materiais da tarefa já fechada
  function marcasDoLevado(t) {
    var m = [];
    if ((t.ferramentas || []).length) m.push(['⚒', t.ferramentas.join(', ')]);
    if ((t.materiais || []).length) m.push(['▤', t.materiais.join(', ')]);
    return m.map(function (x) {
      return '<span class="marca"><i>' + x[0] + '</i>' + esc(x[1]) + '</span>';
    }).join('');
  }

  function resumoQuando(t) {
    var q = t.quando || {};
    var partes = [];
    if (q.horario && q.horario !== 'qualquer') {
      var h = M.HORARIOS.filter(function (x) { return x.v === q.horario; })[0];
      partes.push(q.horario === 'personalizado' ? q.de + '–' + q.ate : (h ? h.t : ''));
    }
    if (q.dias && q.dias !== 'qualquer') {
      if (q.dias === 'personalizado') {
        partes.push((q.diasEscolhidos || []).map(function (d) { return M.NOMES_DIA[d]; }).join(' '));
      } else {
        var d2 = M.DIAS_SEMANA.filter(function (x) { return x.v === q.dias; })[0];
        partes.push(d2 ? d2.t : '');
      }
    }
    if (q.meses && q.meses.length && q.meses.length < 12) {
      partes.push('só ' + q.meses.map(function (mm) { return M.NOMES_MES[mm - 1]; }).join(' '));
    }
    return partes.filter(Boolean).join(' · ');
  }

  /* Tudo visível, sem "mais/menos": ele olharia sempre mesmo, por medo de
     estar esquecendo campo. A ordem segue a pergunta natural — o que é, quanto
     tempo, onde, em que condições, com quem, o que levar, quando, depois de
     que, recado. */
  /* Uma linha por assunto, com o nome curto à esquerda e a explicação inteira
     no hover. O texto e a duração saíram daqui: eles já estão na linha de cima
     e agora são editáveis lá mesmo — campo que existe só para repetir o que
     está três centímetros acima é campo para apagar. */
  /* O LOCAL DIZ O RESTO (§42). No computador, clima, chão, calor, esforço e
     companhia não existem — e o motor nem lê. Fora, clima e chão também não.
     O formulário só mostra o que o motor vai ler para aquele local; o resto
     fica neutro por baixo, e você não vê campo que não precisa preencher. */
  function formularioPasso(t, irmaos, travado) {
    var avisos = M.avisosDe(t);
    var noSitio = t.ondePrecisaEstar === 'sitio';
    var noPc = t.ondePrecisaEstar === 'computador';
    var naRua = t.ondePrecisaEstar === 'fora';

    return [
      // o local mora na linha da tarefa (§46); aqui fica só o ponto exato
      noPc ? '' :
      grupo('Onde', 'grade',
        (campoTexto('tarefa', t.id, 'onde', 'Lugar', t.onde,
          { dica: 'trecho rente à estrada', travado: travado,
            ajuda: 'O ponto exato. Vem junto da tarefa na hora de sair, para você não ' +
                   'atravessar o sítio e descobrir lá que era do outro lado.' })),
        'A primeira pergunta da consulta, e a que poda todas as outras: quando você responde ' +
        '"fora" ou "computador", o app nem pergunta clima, chão, companhia e energia.'),

      // dinheiro só na avulsa (§41): obra tem o envelope do projeto
      (t.projetoId ? '' :
      grupo('Dinheiro', '',
        '<div class="grade">' +
        campoTexto('tarefa', t.id, 'custo', 'Custo, por cima', t.custo,
          { numero: true, min: 0, travado: travado,
            ajuda: 'Deixe vazio se não custa. Com custo e sem o dinheiro separado, ela fica fora do ' +
                   'páreo como "juntando dinheiro".' }) +
        campoTexto('tarefa', t.id, 'guardado', 'Separado', t.guardado,
          { numero: true, min: 0, travado: travado,
            ajuda: 'Quanto já está separado para isto. Igual ou maior que o custo, ela entra no páreo.' }) +
        '</div>' +
        (M.juntandoDinheiro(t) ? '<p class="aviso" style="margin:8px 0 0">juntando dinheiro — faltam ' + esc(M.moeda(M.faltaDinheiro(t))) + '</p>' : ''),
        'A avulsa que custa dinheiro espera o dinheiro, não o app. Mesmo desenho do envelope, em tamanho de tarefa.')) +

      /* Fora não tem condições (§42): sair é planejado, não sorteado — a folha
         da rua é a lista, e ele decide. O que sobra para a rua: o que é, o
         lugar, o que comprar, quando precisa, dependência, tags, nota. */
      (naRua ? '' :
      grupo('Condições', '',
        (noPc ? '' :
        linhaCond('Clima',
          'Como o tempo precisa estar. "Só com tempo firme" desaparece em qualquer chuva. ' +
          '"Tolera chuva fina" fica guardada para a segunda chamada, quando não sobrou nada limpo, ' +
          'e aí o app avisa que você vai se molhar. Aqui chove metade do ano, então isto pesa.',
          campoSelect('tarefa', t.id, 'exigeClima', '', M.CLIMAS, t.exigeClima, travado)) +

        /* Estas duas eram caixas de marca empilhadas embaixo do valor do clima,
           e liam-se como uma lista em que o primeiro item tinha perdido a
           caixinha. Viraram pergunta com resposta, como todas as outras. */
        linhaCond('Pode no calor?',
          '"Não" some nos dias em que você responde "sol forte · calor" na consulta. É o tempo de hoje, ' +
          'não a hora: nublado e fresco às 13 h continua valendo.',
          campoBooleano('tarefa', t.id, 'podeNoCalor', t.podeNoCalor !== false, travado)) +

        linhaCond('Precisa de chão firme?',
          'Para o que exige pisar sem atolar ou rodar carrinho de mão. Some nos dias em que você ' +
          'responde "barro" na consulta — e chuva forte já responde barro sozinha.',
          campoBooleano('tarefa', t.id, 'exigeSoloFirme', t.exigeSoloFirme, travado))) +

        (!noSitio ? '' :
        linhaCond('Guardar para a chuva?',
          'Trabalho que dá para fazer em qualquer dia, mas que vale a pena reservar para um dia ' +
          'de chuva. Fica fora do páreo enquanto o tempo está firme — a não ser que não haja mais ' +
          'nada, e aí o app oferece assim mesmo em vez de te deixar parado.',
          campoBooleano('tarefa', t.id, 'guardadaParaChuva', t.guardadaParaChuva, travado))) +

        (!noSitio ? '' :
        linhaCond('Esforço',
          'Quanto o corpo vai sentir. Nos dias em que você responder "pouca energia", só as leves ' +
          'chegam até você — as pesadas nem são cogitadas.',
          campoSelect('tarefa', t.id, 'esforco', '', M.ESFORCOS, t.esforco, travado))) +

        (t.projetoId ? '' :
        linhaCond('Importância',
          'Só para desempatar entre avulsas iguais no resto. Não é ordem: data, rotina vencida e ' +
          'destrave continuam mandando. Padrão: normal.',
          campoSelect('tarefa', t.id, 'peso', '', M.PESOS, t.peso, travado))) +

        (noPc ? '' :
        linhaCond('Companhia',
          'Quem precisa estar junto e quem não pode. As três marcas são independentes: uma tarefa ' +
          'pode precisar de ajuda e ainda assim ser boa com as crianças por perto.',
          linhaMarcas(
          campoMarca('tarefa', t.id, 'precisaAjuda', 'precisa de ajuda', t.precisaAjuda, travado,
            'Trabalho de duas pessoas. Só é oferecida nos dias em que você marca "ajuda", e nesses ' +
            'dias ela sobe na fila: gente disponível é situação escassa e não se desperdiça.') +
          campoMarca('tarefa', t.id, 'boaComCriancas', 'boa com crianças', t.boaComCriancas, travado,
            'Trabalho que fica melhor com elas junto. Nos dias em que você marca "crianças", esta ' +
            'ganha peso e vem na frente — aproveita o tempo com eles em vez de disputar com eles.') +
          campoMarca('tarefa', t.id, 'perigosaComCriancas', 'perigosa com crianças', t.perigosaComCriancas, travado,
            'Motosserra, altura, ferramenta cortante, elétrica. Nos dias em que você marca ' +
            '"crianças", esta simplesmente não existe para o app.')))) +

        linhaCond('Pode interromper?',
          'Sim: a tarefa aparece mesmo numa janela curta, e o app diz quanto cabe hoje e quanto ' +
          'sobra depois. Não: ela só aparece quando o tempo disponível cobre a coisa inteira — ' +
          'concreto não aceita ser deixado pela metade.',
          campoBooleano('tarefa', t.id, 'podeParar', t.podeParar, travado)),

        'Tudo que precisa ser verdade no dia para esta tarefa aparecer. Se uma só destas linhas ' +
        'não bater com a situação que você informou, ela não é oferecida — e você nem fica sabendo ' +
        'que ela existia, que é justamente o alívio.')),

      noPc ? '' :
      grupo('Levar', 'grade',
        campoLista('tarefa', t.id, 'ferramentas', 'Ferramentas', t.ferramentas, 'cavadeira\nmarreta\nEPI', travado,
          'Uma por linha. O que precisa estar na mão para começar, incluindo o EPI — que é ' +
          'a coisa que mais se esquece e a que mais custa esquecer.') +
        campoLista('tarefa', t.id, 'materiais', 'Materiais', t.materiais, '38 postes de eucalipto\n90 m de tela', travado,
          'Um por linha, com a quantidade quando ela importa. "90 m de tela" evita a segunda viagem; ' +
          '"tela" não evita nada.'),
        'A folha que você confere antes de sair. Não é inventário do sítio nem controle de estoque: ' +
        'é só o que precisa ir junto nesta tarefa.'),

      blocoQuando(t, travado),

      grupo('Depende', '', fichasDependencia(t, travado),
        'Tarefas que precisam terminar antes desta. A ordem da lista é preferência sua e muda ' +
        'arrastando; isto aqui é lei, e o app segura a tarefa até as outras ficarem prontas. ' +
        'Usar demais engessa o projeto — vincule só o que é impossível fora de ordem.'),

      grupo('Tags', '',
        campoTags('tarefa', t.id, t.tags, travado),
        'Assuntos desta tarefa — galpão, madeira, galinhas. Por ora é só cadastro: a análise por ' +
        'assunto vem depois. Uma grafia por assunto: o app junta "sítio" e "Sitio".'),

      grupo('Nota', 'grade',
        campoArea('tarefa', t.id, 'recado', '', t.recado, travado,
          'anotação que aparece junto da tarefa'),
        'Viaja com a tarefa e aparece na tela na hora de trabalhar. É onde vai o que você ' +
        'descobriu da última vez e não quer descobrir de novo: a medida, o jeito certo, ' +
        'onde ficou guardada a peça.'),

      // o contêiner existe sempre, vazio: é ele que recebe o aviso enquanto
      // você mexe nos campos, sem precisar redesenhar o formulário inteiro
      '<div class="secao"><div class="avisos">' + avisos.map(function (a) {
        return '<p class="aviso-linha">' + esc(a) + '</p>'; }).join('') + '</div></div>',

      /* Cancelar e apagar são decisões sobre a tarefa que JÁ EXISTE: aparecem
         com a ficha aberta e trancada, no pé, em letra pequena. Em edição, o
         rodapé só tem salvar (e desfazer): o resto espera a tarefa ser salva. */
      travado
        ? (emConsulta(t.projetoId) || fechada(t) ? '' :
          cancelandoTarefa === t.id
            ? '<div class="confirma">' +
                '<p class="confirma-texto">Cancelar a tarefa. Ela sai do caminho, deixa de segurar ' +
                'as que vinham depois e para de travar a conclusão do projeto — mas continua no ' +
                'registro, com o motivo.</p>' +
                '<input type="text" class="confirma-campo" id="campoCancelaTarefa" placeholder="por quê?">' +
                '<div class="confirma-acoes">' +
                  '<button type="button" class="bt-forte" data-acao="confirmar-cancelar-tarefa" data-id="' + t.id + '">cancelar a tarefa</button>' +
                  '<button type="button" class="bt-fraco" data-acao="voltar-cancelar-tarefa">deixa quieto</button>' +
                '</div></div>'
            : '<div class="passo-rodape passo-rodape-quieto"><span class="passo-rodape-fim">' +
                '<button type="button" class="bt-linha bt-mini" data-acao="cancelar-tarefa" data-id="' + t.id + '">cancelar tarefa</button>' +
                '<button type="button" class="bt-linha bt-mini" data-acao="remover-passo" data-id="' + t.id + '">apagar</button>' +
              '</span></div>')
        :
      cancelandoTarefa === t.id
        ? '<div class="confirma">' +
            '<p class="confirma-texto">Cancelar a tarefa. Ela sai do caminho, deixa de segurar ' +
            'as que vinham depois e para de travar a conclusão do projeto — mas continua no ' +
            'registro, com o motivo.</p>' +
            '<input type="text" class="confirma-campo" id="campoCancelaTarefa" placeholder="por quê?">' +
            '<div class="confirma-acoes">' +
              '<button type="button" class="bt-forte" data-acao="confirmar-cancelar-tarefa" data-id="' + t.id + '">cancelar a tarefa</button>' +
              '<button type="button" class="bt-fraco" data-acao="voltar-cancelar-tarefa">deixa quieto</button>' +
            '</div></div>'
        : '<div class="passo-rodape">' +
            '<button type="button" class="bt-forte" data-acao="salvar-passo">salvar</button>' +
            (foto && foto.id === t.id
              ? '<button type="button" class="bt-fraco" data-acao="desfazer-passo" data-id="' + t.id + '" title="Volta a tarefa a como estava quando você clicou em editar.">desfazer</button>' : '') +
            // cancelar e apagar ficam para depois de salva: em edição, só salvar (e desfazer)
            '<span class="passo-rodape-fim"></span>' +
          '</div>'
    ].join('');
  }

  /* Título à esquerda, campos à direita. Empilhado, cada seção virava uma laje
     com um traço em cima e muito ar dentro, e o olho não achava onde começar a
     ler. Em duas colunas os valores ganham uma borda esquerda única, que é o
     que faz uma ficha ser varrida de relance em vez de lida linha a linha. */
  function grupo(titulo, classe, corpo, ajuda) {
    return '<div class="secao secao-campos">' +
      '<div class="secao-titulo' + (ajuda ? ' tem-ajuda' : '') + '"' +
      (ajuda ? ' title="' + esc(ajuda) + '"' : '') + '>' + esc(titulo) + '</div>' +
      '<div class="secao-corpo">' +
        (classe ? '<div class="' + classe + '">' + corpo + '</div>' : corpo) +
      '</div></div>';
  }

  /* Caixa de marca não é campo com rótulo em cima: é uma linha só. Misturada na
     mesma grade dos campos de texto, ela herdava colunas largas e sobrava
     órfã na linha de baixo. */
  function linhaMarcas(corpo) { return '<div class="marcas-linha">' + corpo + '</div>'; }

  /* Uma condição por linha: nome curto à esquerda, controles à direita. A
     explicação inteira mora no hover do nome — é o tutorial do app, e ele não
     ocupa tela. */
  function linhaCond(rotulo, ajuda, corpo) {
    return '<div class="cond">' +
      '<span class="cond-rotulo tem-ajuda" title="' + esc(ajuda) + '">' + esc(rotulo) + '</span>' +
      '<div class="cond-corpo">' + corpo + '</div></div>';
  }

  /* Sim/não com palavra, não caixa de marca: trancado, "[ ] sim" não diz se a
     resposta é não ou se ninguém respondeu. */
  function campoBooleano(alvo, id, chave, ligado, travado) {
    return '<div class="campo campo-bool">' +
      '<select data-bool="1" data-alvo="' + alvo + '" data-id="' + id + '" data-campo="' + chave + '"' +
      (travado ? ' disabled' : '') + '>' +
      opcoes([{ v: 'sim', t: 'sim' }, { v: 'nao', t: 'não' }], ligado ? 'sim' : 'nao') +
      '</select></div>';
  }

  function campoArea(alvo, id, chave, rotulo, valor, travado, dica) {
    return '<div class="campo campo-largo">' +
      rotuloDe(id, chave, rotulo) +
      '<textarea id="c_' + id + '_' + chave + '" rows="2"' +
      (travado ? ' readonly placeholder="—"' : ' placeholder="' + esc(dica || '') + '"') +
      ' data-alvo="' + alvo + '" data-id="' + id + '" data-campo="' + chave + '">' +
      esc(valor || '') + '</textarea></div>';
  }

  function campoLista(alvo, id, chave, rotulo, valores, dica, travado, ajuda) {
    return '<div class="campo campo-largo">' +
      rotuloDe(id, chave, rotulo, ajuda) +
      // a lista aparece inteira: nada de barra de rolagem própria escondendo o último item
      '<textarea id="c_' + id + '_' + chave + '" rows="' + Math.max(3, (valores || []).length + (travado ? 0 : 1)) + '"' +
      (travado ? ' readonly placeholder="—"' : ' placeholder="' + esc(dica) + '"') +
      ' data-alvo="' + alvo + '" data-id="' + id + '" data-campo="' + chave + '">' +
      esc((valores || []).join('\n')) + '</textarea></div>';
  }

  /* Cinco campos, duas perguntas: quando PRECISA acontecer (urgência, define a
     faixa) e quando É POSSÍVEL acontecer (elegibilidade). Juntar tudo num
     controle só transformaria a tarefa em compromisso de agenda. */
  /* Trancado, "personalizado" e doze meses marcados não dizem nada — o que se
     quer ler é "08:00–12:00 · dia útil · todos os meses". É a única parte da
     ficha em que o modo de leitura não usa os mesmos controles do modo de
     edição, e o motivo é que grade de caixinha não é frase. */
  function resumoDoQuando(t) {
    var q = t.quando || {};
    var j = M.janelaDe(t);

    var precisa = 'quando der';
    if (t.prazo && t.prazo.tipo === 'data') {
      precisa = t.prazo.em ? 'até ' + M.formatarData(t.prazo.em) : 'até uma data ainda não escolhida';
    } else if (t.prazo && t.prazo.tipo === 'periodico') {
      var ultima = M.ultimaVezDe(t.id) || t.prazo.ultimaVez;
      precisa = 'a cada ' + t.prazo.cadenciaDias + ' dias' +
        (ultima ? ' · última vez ' + M.formatarData(ultima) : ' · nunca feita') +
        (t.prazo.antecipavelDias ? ' · adianta até ' + t.prazo.antecipavelDias + ' dias' : '');
    }

    var horario = q.horario === 'personalizado' ? q.de + '–' + q.ate
      : q.horario === 'qualquer' || !q.horario ? 'qualquer hora'
      : (M.HORARIOS.filter(function (x) { return x.v === q.horario; })[0] || {}).t;

    var dias = q.dias === 'personalizado'
      ? (j.dias.length === 7 ? 'todo dia' : j.dias.map(function (d) { return M.NOMES_DIA[d]; }).join(' '))
      : q.dias === 'qualquer' || !q.dias ? 'todo dia'
      : (M.DIAS_SEMANA.filter(function (x) { return x.v === q.dias; })[0] || {}).t;

    var meses = j.meses.length === 12 ? 'o ano todo'
      : j.meses.map(function (m) { return M.NOMES_MES[m - 1]; }).join(' ');

    return '<div class="grade">' +
      linhaResumo('Precisa acontecer', precisa) +
      linhaResumo('É possível', horario + ' · ' + dias + ' · ' + meses) +
      '</div>';
  }

  function linhaResumo(rotulo, valor) {
    return '<div class="campo campo-largo"><label>' + esc(rotulo) + '</label>' +
      '<p class="valor-lido">' + esc(valor) + '</p></div>';
  }

  function blocoQuando(t, travado) {
    var q = t.quando || {};
    var prazoTipo = t.prazo ? t.prazo.tipo : '';

    if (travado) {
      return grupo('Quando', '', resumoDoQuando(t),
        'Duas perguntas diferentes no mesmo lugar. Em cima, quando isto precisa acontecer: ' +
        'é o que decide a urgência, e o que faz uma tarefa passar na frente das outras. ' +
        'Embaixo, quando isto pode acontecer: é o que decide se ela entra no páreo hoje. ' +
        'Juntar as duas num controle só transformaria a tarefa em compromisso de agenda.');
    }

    var precisa = '<div class="grade">' +
      campoSelect('tarefa', t.id, 'prazoTipo', 'Precisa acontecer', [
        { v: '', t: 'quando der' },
        { v: 'data', t: 'até uma data' },
        { v: 'periodico', t: 'a cada N dias' }
      ], prazoTipo, travado,
        '"Quando der" não tem prazo e disputa só pelo peso. "Até uma data" fica quieta até o dia ' +
        'chegar, e nesse dia passa na frente de tudo. "A cada N dias" é a rotina: quando passa da ' +
        'hora, o peso vai crescendo com os dias — FAMACHA que passou há vinte dias vem antes ' +
        'do que passou há três. Feita, ela não fecha: reinicia a contagem daquele dia.');

    if (prazoTipo === 'data') {
      precisa += campoData('tarefa', t.id, 'prazoEm', 'Data', t.prazo.em, travado);
    } else if (prazoTipo === 'periodico') {
      precisa += campoTexto('tarefa', t.id, 'prazoCadencia', 'A cada quantos dias',
        t.prazo.cadenciaDias, { numero: true, min: 1, travado: travado });
      precisa += campoData('tarefa', t.id, 'prazoUltima', 'Última vez',
        M.ultimaVezDe(t.id) || t.prazo.ultimaVez || '', travado);
      precisa += campoTexto('tarefa', t.id, 'prazoAdianta', 'Adiantar até (dias antes)',
        t.prazo.antecipavelDias || 0, { numero: true, min: 0, travado: travado,
          ajuda: 'Quantos dias antes de vencer esta rotina já pode ser feita, pela porta "quero fazer ' +
                 'mais". Zero: só quando vencer. Quinze: a partir de quinze dias antes — e nunca no ' +
                 'dia seguinte ao que você acabou de fazer.' });
    }
    precisa += '</div>';

    var possivel = '<div class="grade">' +
      campoSelect('tarefa', t.id, 'qHorario', 'Horário', M.HORARIOS, q.horario, travado,
        'A que horas isto é possível. O aparelho já sabe que horas são, então isto nunca vira ' +
        'pergunta na consulta — diferente do clima, que você informa de propósito.') +
      campoSelect('tarefa', t.id, 'qDias', 'Dia da semana', M.DIAS_SEMANA, q.dias, travado,
        'Em que dias isto é possível. Serve principalmente para o que depende dos outros: ' +
        'loja não abre domingo, e pedreiro não atende sábado à noite.') +
      '</div>';

    if (q.horario === 'personalizado') {
      possivel += '<div class="grade" style="margin-top:12px">' +
        campoTexto('tarefa', t.id, 'qDe', 'Das', q.de, { travado: travado }) +
        campoTexto('tarefa', t.id, 'qAte', 'Até', q.ate, { travado: travado }) + '</div>';
    }
    if (q.dias === 'personalizado') {
      possivel += '<div class="caixinhas">' + M.NOMES_DIA.map(function (nome, i) {
        return marcaMini('qDia', t.id, i, nome, (q.diasEscolhidos || []).indexOf(i) !== -1, travado);
      }).join('') + '</div>';
    }

    possivel += '<label class="rotulo-solto tem-ajuda" title="Em que meses isto é possível. ' +
      'Serve para janela de estação: derrubar madeira no outono, quando há menos seiva, ou ' +
      'revisar os desviadores de água antes da estação chuvosa. Todos marcados = o ano todo.">' +
      'Meses</label><div class="caixinhas">' +
      M.NOMES_MES.map(function (nome, i) {
        return marcaMini('qMes', t.id, i + 1, nome, (q.meses || []).indexOf(i + 1) !== -1, travado);
      }).join('') + '</div>';

    return grupo('Quando', '',
      precisa + '<div class="separador-fino"></div>' + possivel,
      'Em cima, quando PRECISA acontecer — define a urgência e a faixa de prioridade. ' +
      'Embaixo, quando é POSSÍVEL acontecer — define se a tarefa entra no páreo agora.');
  }

  function campoData(alvo, id, chave, rotulo, valor, travado) {
    return '<div class="campo"><label for="c_' + id + '_' + chave + '">' + esc(rotulo) + '</label>' +
      '<input type="date" id="c_' + id + '_' + chave + '" data-alvo="' + alvo + '" data-id="' + id +
      '" data-campo="' + chave + '"' + (travado ? ' disabled' : '') +
      ' value="' + esc(valor || '') + '"></div>';
  }

  function marcaMini(chave, id, valor, rotulo, ligado, travado) {
    return '<label class="caixinha' + (ligado ? ' caixinha-on' : '') +
      (travado ? ' caixinha-travada' : '') + '">' +
      '<input type="checkbox" data-alvo="tarefa" data-id="' + id + '" data-campo="' + chave + '"' +
      ' data-valor="' + valor + '"' + (ligado ? ' checked' : '') + (travado ? ' disabled' : '') +
      '>' + esc(rotulo) + '</label>';
  }

  /* Ordem é preferência; isto aqui é lei. Vale entre as duas etapas — uma
     tarefa de execução pode depender de uma de planejamento específica. */
  function fichasDependencia(t, travado) {
    var fichas = (t.dependeDe || []).map(function (did) {
      var d = M.tarefa(did);
      return '<span class="ficha">depois de: ' + esc(d ? d.texto || 'sem texto' : '(removida)') +
        (travado ? '' :
          '<button type="button" data-acao="tirar-dep" data-id="' + t.id +
          '" data-valor="' + did + '" aria-label="tirar">×</button>') + '</span>';
    }).join('');

    var candidatas = (t.projetoId ? M.passosDe(t.projetoId) : M.avulsas()).filter(function (o) {
      return o.id !== t.id && (t.dependeDe || []).indexOf(o.id) === -1;
    });

    if (travado) {
      return '<div class="fichas">' + (fichas || '<span class="aviso">Sem dependência.</span>') + '</div>';
    }

    var seletor = candidatas.length
      ? '<div class="junta"><select data-entrada="dep" data-id="' + t.id + '">' +
          '<option value="">escolher tarefa…</option>' +
          candidatas.map(function (o) {
            return '<option value="' + esc(o.id) + '">' +
              (o.etapa === 'planejamento' ? '[plan] ' : '') + esc(o.texto || 'sem texto') + '</option>';
          }).join('') + '</select>' +
          '<button type="button" class="bt-fraco" data-acao="por-dep" data-id="' + t.id + '">vincular</button></div>'
      : '<p class="aviso">Nenhuma outra tarefa para vincular.</p>';

    return '<div class="fichas">' + (fichas || '<span class="aviso">Sem dependência.</span>') +
      '</div>' + seletor;
  }

  // ── pendências ────────────────────────────────────────────────────
  /* Única tela do sistema com cor de alarme, e de propósito: bater o olho e ver
     tudo verde é uma saída de leitura zero. A cobrança aqui é sobre a entrega
     de terceiro, nunca sobre o trabalho do usuário — por isso a regra 2 não se
     aplica. E é cercada: não vaza para a consulta nem para projeto ou tarefa. */

  function marcacaoPendencias() {
    var abertas = M.pendenciasAbertas();
    var resolvidas = M.cat().pendencias.filter(function (x) { return x.resolvida; });

    return [
      '<h2>Aguardando</h2>',
      '<p class="palco-sub">O que depende de outro e tem data. Você vem aqui; isto nunca vai atrás de você. Espera aberta de dentro de uma tarefa segura a tarefa até chegar.</p>',

      '<div class="junta" style="max-width:900px">',
        '<input type="text" id="campoPendencia" placeholder="tela fina 1 m — agroloja">',
        '<button type="button" class="bt-forte" data-acao="nova-pendencia">esperar</button>',
      '</div>',

      abertas.length
        ? '<ul class="pendencias">' + abertas.map(linhaPendencia).join('') + '</ul>'
        : '<p class="aviso" style="margin-top:24px">Nada esperando.</p>',

      resolvidas.length
        ? '<div class="secao"><div class="secao-titulo">Resolvidas</div>' +
          resolvidas.map(function (x) {
            return '<p class="aviso">' + esc(x.descricao) + ' — ' + esc(x.resolvida) + '</p>';
          }).join('') + '</div>'
        : ''
    ].join('');
  }

  function linhaPendencia(x) {
    var nivel = M.nivelPendencia(x);
    return '<li class="pendencia pendencia-' + nivel + '">' +
      '<span class="ponto ponto-' + nivel + '"></span>' +
      '<div class="pendencia-corpo">' +
        '<input type="text" class="pendencia-nome" data-alvo="pendencia" data-id="' + x.id +
          '" data-campo="descricao" value="' + esc(x.descricao) + '">' +
        '<span class="pendencia-nota">' + esc(M.textoPendencia(x)) +
          (x.tarefaId && M.tarefa(x.tarefaId)
            ? ' · segura <em>' + esc(M.tarefa(x.tarefaId).texto) + '</em>' +
              (M.tarefa(x.tarefaId).projetoId && M.projeto(M.tarefa(x.tarefaId).projetoId)
                ? ' (' + esc(M.projeto(M.tarefa(x.tarefaId).projetoId).nome) + ')' : '')
            : '') +
        '</span>' +
      '</div>' +
      '<input type="date" class="pendencia-data" data-alvo="pendencia" data-id="' + x.id +
        '" data-campo="previsto" value="' + esc(x.previsto) + '">' +
      '<button type="button" class="bt-fraco" data-acao="pendencia-chegou" data-id="' + x.id + '">chegou</button>' +
      '<button type="button" class="bt-linha" data-acao="pendencia-cancelada" data-id="' + x.id + '">cancelada</button>' +
      '</li>';
  }

  // ── sementes ──────────────────────────────────────────────────────

  // ── a folha do diarista (§39) ─────────────────────────────────────
  /* Uma lista na ordem que o Dan quer, com o que a pessoa precisa saber para
     fazer sem perguntar: onde, ferramentas, materiais, quanto tempo. Copia
     como texto puro para mandar; imprime limpa. Fechar o dia é aqui também:
     feita · pela metade · não fez, em nome dele. */
  function marcacaoDiarista() {
    var lista = M.separadas();
    if (!lista.length) {
      return '<h2>Diarista</h2><p class="palco-sub">Nada separado. Abra uma tarefa de execução (projeto em vaga ou avulsa) e use <em>separar para o diarista</em>.</p>';
    }
    var dia = lista[0].separada.dia;
    return [
      // o que só sai no papel: o título que ELE lê, não o nosso
      '<div class="folha-papel"><h1>Tarefas de ' + esc(M.formatarData(dia)) + '</h1>' +
        '<p>Na ordem. Faça até onde der; o que sobrar fica para a próxima.</p></div>',
      '<h2>Folha do diarista</h2>',
      '<p class="palco-sub">Só o que ele precisa para fazer sem perguntar. Separada, a tarefa sai do seu páreo até você fechar o dia.</p>',
      '<div class="folha-cabeca">',
        '<label class="folha-dia">para o dia <input type="date" id="diaDiarista" value="' + esc(dia) + '"></label>',
        '<span class="folha-total">~' + esc(M.duracao(M.minutosSeparados())) + ' · ' + lista.length + (lista.length === 1 ? ' tarefa' : ' tarefas') + '</span>',
        '<button type="button" class="bt-fraco bt-mini" data-acao="diarista-copiar">copiar a folha</button>',
        '<button type="button" class="bt-fraco bt-mini" onclick="window.print()">imprimir</button>',
      '</div>',
      '<ol class="folha">',
      lista.map(function (t, i) {
        var p = t.projetoId ? M.projeto(t.projetoId) : null;
        var abrindo = diaristaMetade === t.id;
        return '<li class="folha-item">' +
          '<div class="folha-linha">' +
            '<span class="folha-n">' + (i + 1) + '</span>' +
            // palavras, não ícones: a folha é lida por ele, no papel. O tempo só
            // na tela (ritmos diferentes — no papel não entra).
            '<div class="folha-texto"><strong>' + esc(t.texto || 'tarefa sem texto') + '</strong>' +
              '<em class="folha-tempo">' + (p ? esc(p.nome) + ' · ' : '') + esc(M.duracao(M.restanteDe(t.id) || t.duracaoTotal)) + '</em>' +
              (t.onde ? '<span><b>Onde:</b> ' + esc(t.onde) + '</span>' : '') +
              ((t.ferramentas || []).length ? '<span><b>Ferramentas:</b> ' + esc(t.ferramentas.join(', ')) + '</span>' : '') +
              ((t.materiais || []).length ? '<span><b>Materiais:</b> ' + esc(t.materiais.join(', ')) + '</span>' : '') +
              (M.recadoDe && M.recadoDe(t.id) ? '<span class="folha-recado"><b>Detalhes:</b> ' + esc(M.recadoDe(t.id)) + '</span>' : '') +
            '</div>' +
            '<span class="folha-acoes">' +
              '<button type="button" class="bt-linha bt-mini" data-acao="diarista-mover" data-valor="-1" data-id="' + t.id + '" aria-label="subir">↑</button>' +
              '<button type="button" class="bt-linha bt-mini" data-acao="diarista-mover" data-valor="1" data-id="' + t.id + '" aria-label="descer">↓</button>' +
              '<button type="button" class="bt-fraco bt-mini" data-acao="diarista-fechar" data-valor="feita" data-id="' + t.id + '">feita</button>' +
              '<button type="button" class="bt-fraco bt-mini" data-acao="diarista-metade" data-id="' + t.id + '">pela metade</button>' +
              '<button type="button" class="bt-linha bt-mini" data-acao="diarista-fechar" data-valor="nao_fez" data-id="' + t.id + '">não fez</button>' +
            '</span>' +
          '</div>' +
          (abrindo
            ? '<div class="folha-metade">' +
                '<label>sobrou quanto? <input type="number" min="5" id="sobrou_' + t.id + '" placeholder="min"></label>' +
                '<input type="text" id="nota_' + t.id + '" placeholder="o que ele disse (opcional)">' +
                '<button type="button" class="bt-forte bt-mini" data-acao="diarista-fechar" data-valor="metade" data-id="' + t.id + '">registrar</button>' +
              '</div>'
            : '') +
          '</li>';
      }).join(''),
      '</ol>',
      '<div class="rodape-acoes"><button type="button" class="bt-linha" data-acao="diarista-desfazer-tudo">ele não veio — devolver tudo ao meu páreo</button></div>'
    ].join('');
  }

  /* A folha da rua (§43): o que tem para fazer fora, na ordem que você quiser
     — a rota. Nome, lugar, materiais como lista de compras, detalhes. Feita
     registra em seu nome; o resto volta para a lista. */
  function marcacaoRua() {
    var lista = M.tarefasDaRua();
    return [
      '<button type="button" class="voltar-lista" data-acao="voltar-inicio">← voltar</button>',
      '<h2>Na rua</h2>',
      '<p class="palco-sub">O que dá para resolver nesta saída. Arrume a ordem como a rota; o que não der, fica.</p>',
      lista.length
        ? '<ol class="folha folha-rua">' + lista.map(function (t, i) {
            var p = t.projetoId ? M.projeto(t.projetoId) : null;
            return '<li class="folha-item">' +
              '<div class="folha-linha">' +
                '<span class="folha-n">' + (i + 1) + '</span>' +
                '<div class="folha-texto"><strong>' + esc(t.texto || 'tarefa sem texto') + '</strong>' +
                  (p ? '<em>' + esc(p.nome) + '</em>' : '') +
                  (t.onde ? '<span><b>Onde:</b> ' + esc(t.onde) + '</span>' : '') +
                  ((t.materiais || []).length ? '<span><b>Comprar:</b> ' + esc(t.materiais.join(', ')) + '</span>' : '') +
                  ((t.ferramentas || []).length ? '<span><b>Levar:</b> ' + esc(t.ferramentas.join(', ')) + '</span>' : '') +
                  (M.recadoDe(t.id) ? '<span class="folha-recado"><b>Detalhes:</b> ' + esc(M.recadoDe(t.id)) + '</span>' : '') +
                '</div>' +
                '<span class="folha-acoes">' +
                  '<button type="button" class="bt-linha bt-mini" data-acao="rua-mover" data-valor="-1" data-id="' + t.id + '" aria-label="subir">↑</button>' +
                  '<button type="button" class="bt-linha bt-mini" data-acao="rua-mover" data-valor="1" data-id="' + t.id + '" aria-label="descer">↓</button>' +
                  '<button type="button" class="bt-fraco bt-mini" data-acao="rua-feita" data-id="' + t.id + '">feita</button>' +
                '</span>' +
              '</div></li>';
          }).join('') + '</ol>'
        : '<p class="aviso" style="margin-top:24px">Nada para a rua agora.</p>'
    ].join('');
  }

  function textoDaFolha() {
    var lista = M.separadas();
    var linhas = ['Rebrota — folha do diarista · ' + M.formatarData(lista[0].separada.dia), ''];
    lista.forEach(function (t, i) {
      var p = t.projetoId ? M.projeto(t.projetoId) : null;
      linhas.push((i + 1) + '. ' + (t.texto || 'tarefa sem texto') + (p ? ' (' + p.nome + ')' : ''));
      if (t.onde) linhas.push('   Onde: ' + t.onde);
      if ((t.ferramentas || []).length) linhas.push('   Ferramentas: ' + t.ferramentas.join(', '));
      if ((t.materiais || []).length) linhas.push('   Materiais: ' + t.materiais.join(', '));
      if (M.recadoDe && M.recadoDe(t.id)) linhas.push('   Detalhes: ' + M.recadoDe(t.id));
      linhas.push('');
    });
    return linhas.join('\n');
  }

  /* A página de sementes é a CAIXA DE ENTRADA da análise: abre em "nova" —
     só o que ainda não tem destino — e cada semente pede um toque. Descartar
     pede motivo; aprovar separa o que pode virar projeto do que pode virar
     tarefa, para a promoção acontecer noutro momento, quando abrir vaga.
     Nada é apagado: a semente carrega o estado, e o estado é o registro. */
  var FILTROS_SEMENTES = [
    { chave: 'nova',       t: 'novas',              vazio: 'Nada novo. A caixa está limpa.' },
    { chave: 'projeto',    t: 'pode virar muda',    vazio: 'Nenhuma aprovada para muda.' },
    { chave: 'tarefa',     t: 'pode virar tarefa',  vazio: 'Nenhuma aprovada para tarefa.' },
    { chave: 'descartada', t: 'descartadas',        vazio: 'Nenhuma descartada.' },
    { chave: 'virou',      t: 'viraram',            vazio: 'Nenhuma virou projeto ou tarefa ainda.' }
  ];
  var ROTULO_ESTADO_SEMENTE = {
    nova: 'nova', descartada: 'descartada', projeto: 'pode virar muda',
    tarefa: 'pode virar tarefa', virou_projeto: 'virou muda', virou_tarefa: 'virou tarefa'
  };

  function grupoDaSemente(s) { return s.estado.indexOf('virou_') === 0 ? 'virou' : s.estado; }

  function marcacaoSementes() {
    var todas = M.cat().sementes;
    var grupo = FILTROS_SEMENTES.filter(function (g) { return g.chave === filtroSementes; })[0];
    var lista = grupo ? todas.filter(function (s) { return grupoDaSemente(s) === grupo.chave; }) : todas;
    // as mais recentes primeiro: a análise começa pelo que acabou de chegar
    lista = lista.slice().sort(function (a, b) { return a.criadaEm < b.criadaEm ? 1 : -1; });

    function botaoFiltroSementes(chave, texto) {
      var n = chave ? todas.filter(function (s) { return grupoDaSemente(s) === chave; }).length : todas.length;
      return '<button type="button" class="filtro' + (filtroSementes === chave ? ' filtro-on' : '') +
        '" data-acao="filtrar-sementes" data-valor="' + chave + '">' + esc(texto) +
        (n ? ' <i>' + n + '</i>' : '') + '</button>';
    }

    return [
      '<h2>Sementes</h2>',
      '<p class="palco-sub">A caixa de entrada das ideias. Nenhuma gera tarefa antes de virar muda ou tarefa avulsa.</p>',
      '<div class="junta" style="max-width:900px">',
        '<input type="text" id="campoSemente" placeholder="escreva uma ideia">',
        '<button type="button" class="bt-forte" data-acao="nova-semente">guardar</button>',
      '</div>',
      '<div class="filtros filtros-sementes">',
        FILTROS_SEMENTES.map(function (g) { return botaoFiltroSementes(g.chave, g.t); }).join(''),
        botaoFiltroSementes('', 'todas'),
      '</div>',
      lista.length ? lista.map(cartaoSemente).join('')
        : '<p class="aviso" style="margin-top:24px">' + esc(grupo ? grupo.vazio : 'Nada na caixa.') + '</p>'
    ].join('');
  }

  function cartaoSemente(s) {
    var virou = !!s.virouId;
    var descartando = sementeDescartando === s.id;
    var oQueVirou = virou && (s.estado === 'virou_projeto' ? M.projeto(s.virouId) : M.tarefa(s.virouId));

    // quem plantou e quando: a semente dela e a sua não se confundem
    var cabeca = '<p class="semente-autor">' +
      'plantada por ' + esc(M.nomeDe(s.autor)) +
      ' · ' + esc(M.formatarData(M.diaDe(s.criadaEm))) +
      ' <span class="semente-estado semente-estado-' + grupoDaSemente(s) + '">' +
        esc(ROTULO_ESTADO_SEMENTE[s.estado]) + '</span></p>';

    // um texto só, e só leitura: a ideia como foi despejada — ditou torto, a
    // muda refina no "o que é"; e a semente da Márcia é dela. Não se edita.
    var campos = '<p class="semente-texto">' + esc(s.frase || s.nome) + '</p>';

    var rodape;
    if (virou) {
      // terminal: só diz no que deu, e leva até lá
      rodape = '<div class="rodape-acoes">' +
        (oQueVirou
          ? '<button type="button" class="bt-fraco" data-acao="ir-ao-fruto" data-id="' + s.id + '">' +
              esc(s.estado === 'virou_projeto' ? 'abrir a muda' : 'ver a tarefa') + '</button>'
          : '<span class="aviso">o que nasceu dela não existe mais</span>') +
        '</div>';
    } else if (descartando) {
      rodape = '<div class="semente-descarte">' +
        '<label for="motivo_' + s.id + '">Por que descartar? A Márcia vai ler isto.</label>' +
        '<input type="text" id="motivo_' + s.id + '" value="' + esc(s.motivo) + '"' +
          ' placeholder="já existe como tarefa · não é do sítio · conversamos e caiu">' +
        '<div class="rodape-acoes">' +
          '<button type="button" class="bt-forte" data-acao="descartar-semente" data-id="' + s.id + '">descartar</button>' +
          '<button type="button" class="bt-linha" data-acao="cancelar-descarte">cancelar</button>' +
        '</div></div>';
    } else {
      /* Os destinos são um seletor: o atual marcado, os outros a um toque.
         Reclassificar é livre — uma descartada volta a nova, uma aprovada cai. */
      function destino(estado, texto) {
        return '<button type="button" class="filtro' + (s.estado === estado ? ' filtro-on' : '') +
          '" data-acao="classificar-semente" data-id="' + s.id + '" data-valor="' + estado + '">' +
          esc(texto) + '</button>';
      }
      rodape =
        (s.estado === 'descartada'
          ? '<p class="semente-motivo">descartada: ' + esc(s.motivo) + '</p>' : '') +
        '<div class="rodape-acoes semente-destinos">' +
          (s.estado === 'projeto'
            ? (M.motivoTetoMudas()
                ? '<span class="aviso">' + esc(M.motivoTetoMudas()) + '</span>'
                : '<button type="button" class="bt-forte" data-acao="promover-semente" data-id="' + s.id + '">virar muda</button>') : '') +
          (s.estado === 'tarefa'
            ? '<button type="button" class="bt-forte" data-acao="semente-vira-tarefa" data-id="' + s.id + '">virar tarefa avulsa</button>' : '') +
          '<span class="semente-seletor">' +
            destino('nova', 'nova') +
            destino('projeto', 'pode virar muda') +
            destino('tarefa', 'pode virar tarefa') +
            '<button type="button" class="filtro' + (s.estado === 'descartada' ? ' filtro-on' : '') +
              '" data-acao="pedir-descarte" data-id="' + s.id + '">descartar</button>' +
          '</span>' +
        '</div>';
    }

    return '<div class="secao semente-cartao">' + cabeca + campos + rodape + '</div>';
  }

  // ── proposta vinda do dados.js ────────────────────────────────────

  var NOMES_COLECAO = {
    projetos: 'Projetos', tarefas: 'Tarefas',
    pendencias: 'Aguardando', sementes: 'Sementes'
  };

  function marcacaoProposta() {
    if (!proposta) return '<p class="palco-vazio">Nada para confirmar.</p>';

    var blocos = proposta.resumo.map(function (r) {
      var linhas = [];
      if (r.entram.length) linhas.push(grupoMudanca('entram', r.entram));
      if (r.mudam.length)  linhas.push(grupoMudanca('mudam', r.mudam));
      if (r.saem.length)   linhas.push(grupoMudanca('saem', r.saem));
      return '<div class="secao"><div class="secao-titulo">' +
        esc(NOMES_COLECAO[r.colecao] || r.colecao) + '</div>' + linhas.join('') + '</div>';
    }).join('');

    return [
      '<h2>Confirmar importação</h2>',
      '<p class="palco-sub">' + esc(proposta.arquivo || 'arquivo') +
        ' · nada é gravado antes de você aceitar.</p>',
      blocos || '<p class="aviso">Este arquivo é igual ao que já está aqui. Nada mudaria.</p>',
      '<div class="rodape-acoes">',
        '<button type="button" class="bt-forte" data-acao="aceitar-proposta">aceitar</button>',
        '<button type="button" class="bt-fraco" data-acao="descartar-proposta">descartar</button>',
      '</div>'
    ].join('');
  }

  function grupoMudanca(qual, itens) {
    return '<p style="margin:0 0 10px">' +
      '<span class="marca">' + itens.length + ' ' + qual + '</span> ' +
      itens.slice(0, 8).map(function (x) {
        return '<span style="color:var(--neblina-fraca);font-size:13px">' + esc(x) + '</span>';
      }).join('<span style="color:var(--musgo)"> · </span>') +
      (itens.length > 8 ? '<span class="aviso"> e mais ' + (itens.length - 8) + '</span>' : '') + '</p>';
  }

  /* Com tarefa ativa, o que cria coisa nova some da coluna: o app inteiro entra
     em consulta, menos o projeto da tarefa. */
  /* Recarregar não custa o lugar (F5 é reflexo, não decisão): a tela da mesa —
     página, ficha aberta, filtros — fica na sessão da aba e volta ao abrir. Só
     na mesa: a bota abre sempre na pergunta, de propósito. */
  var CHAVE_LUGAR = 'app-sitio-lugar';
  function guardarLugar() {
    if (!naMesa()) return;
    try {
      sessionStorage.setItem(CHAVE_LUGAR, JSON.stringify({
        tela: tela, passoAberto: passoAberto, filtroProjetos: filtroProjetos,
        filtroAvulsas: filtroAvulsas, filtroSementes: filtroSementes
      }));
    } catch (e) {}
  }
  function voltarAoLugar() {
    if (!naMesa()) return;
    var l = null;
    try { l = JSON.parse(sessionStorage.getItem(CHAVE_LUGAR)); } catch (e) {}
    if (!l || !l.tela) return;
    if (l.tela.tipo === 'projeto' && !M.projeto(l.tela.id)) return;
    tela = l.tela;
    passoAberto = l.passoAberto && M.tarefa(l.passoAberto) ? l.passoAberto : null;
    filtroProjetos = l.filtroProjetos || '';
    filtroAvulsas = l.filtroAvulsas || '';
    filtroSementes = l.filtroSementes || 'nova';
  }

  function desenhar() {
    guardarLugar();
    // o que a regra já decidiu, aplicado antes de desenhar — em todo redesenho,
    // não só na abertura: arraste, apagar e edição também fecham planejamento
    if (M.cascatearVagas().length) colherAvisos();
    // registro de uso: qual tela está na frente (a frente de campo é a bota)
    var campoAberto = !document.getElementById('execucao').hidden;
    M.usoTela(campoAberto ? 'campo' : (tela.tipo || 'entrada'));
    var criar = emConsultaGeral();
    var btNovo = document.getElementById('btNovoProjeto');
    btNovo.hidden = criar;
    // teto de mudas é parede: o botão fica, trancado, com o motivo no hover
    btNovo.disabled = !!M.motivoTetoMudas();
    btNovo.title = M.motivoTetoMudas() || 'Nova muda: toda obra nasce muda, e são no máximo ' + M.TETO_MUDAS + '.';
    document.getElementById('btNovaAvulsa').hidden = criar;
    document.body.classList.toggle('modo-consulta', criar);
    // na entrada a coluna sai de cena: ali a pergunta é uma só, e a lista de
    // projetos ao lado é exatamente a distração que a pergunta existe para evitar
    document.body.classList.toggle('sem-coluna', tela.tipo === null);
    // "mesa" e "bota" são as duas posturas que a spec descreve, e o topo diz
    // qual delas está valendo — nunca o que você vai fazer nela
    document.body.classList.toggle('na-bota', !naMesa());
    document.querySelector('.topo-modo').textContent = naMesa() ? 'mesa' : 'bota';
    desenharLista();
    desenharPalco();
  }

  /* A bancada de prova muda de tamanho, e o aparelho gira: quando a largura
     cruza a fronteira, o app precisa se redesenhar inteiro. */
  /* Ouve a própria consulta de mídia, não o resize: é ela que decide o modo,
     e assim a troca acontece exatamente no cruzamento. Ao virar bota com o
     catálogo aberto, o catálogo fecha — na bota não há caminho para ele. */
  window.matchMedia('(min-width: 721px)').addEventListener('change', function () {
    if (!naMesa() && tela.tipo !== null) { tela = { tipo: null, id: null }; fecharFicha(); }
    desenhar();
  });

  // ── escrita vinda dos campos ──────────────────────────────────────

  function alvoDe(el) {
    var alvo = el.getAttribute('data-alvo');
    var alvoId = el.getAttribute('data-id');
    if (alvo === 'projeto')   return M.projeto(alvoId);
    if (alvo === 'tarefa')    return M.tarefa(alvoId);
    if (alvo === 'pendencia') return M.pendencia(alvoId);
    if (alvo === 'semente')   return M.cat().sementes.filter(function (s) { return s.id === alvoId; })[0];
    if (alvo === 'coleta') {
      var dona = M.tarefa(alvoId);
      if (!dona) return null;
      var cid = el.getAttribute('data-cid');
      return dona.coleta.filter(function (c) { return c.id === cid; })[0];
    }
    return null;
  }

  /* Escrita da muda. Os campos simples gravam a cada tecla; as CADEIAS também,
     mas sem redesenhar enquanto se digita: um elo vazio que ganha texto só
     ganha a próxima caixa ao lado; um elo apagado (no blur) emenda a cadeia e
     aí sim a tela redesenha. */
  function escreverMuda(el, fim) {
    var p = M.projeto(el.getAttribute('data-id'));
    if (!p) return;
    var campo = el.getAttribute('data-muda');
    var m = p.muda;

    if (campo === 'vantagens' || campo === 'desvantagens') {
      var i = Number(el.getAttribute('data-linha')), j = Number(el.getAttribute('data-elo'));
      var lista = m[campo];
      var v = el.value;
      var eraVazio = el.classList.contains('elo-vazio');
      while (lista.length <= i) lista.push([]);
      var c = lista[i];
      if (v.trim()) {
        c[j] = v;
        el.size = Math.min(48, Math.max(14, v.length + 2));
        if (eraVazio) {
          // acabou de nascer: ganha a próxima caixa (ou a próxima linha)
          el.classList.remove('elo-vazio');
          var linhaEl = el.closest('.cadeia');
          var pergunta = campo === 'vantagens' ? 'e isso, para quê?' : 'e isso causa o quê?';
          if (linhaEl.classList.contains('cadeia-nova')) {
            linhaEl.classList.remove('cadeia-nova');
            var nova = document.createElement('li');
            nova.className = 'cadeia cadeia-nova';
            nova.innerHTML = elo(p, campo, i + 1, 0, '', true, campo === 'vantagens' ? 'por que você quer isso? — uma razão' : 'uma desvantagem', true);
            linhaEl.parentNode.appendChild(nova);
          }
          var seta = document.createElement('span'); seta.className = 'seta'; seta.textContent = '→';
          var prox = document.createElement('span'); prox.innerHTML = elo(p, campo, i, j + 1, '', true, pergunta, false);
          linhaEl.appendChild(seta); linhaEl.appendChild(prox.firstChild);
        }
        p.ultimoToque = M.agora(); M.salvar();
        retocarMuda(p);
        return;
      }
      // apagou: só no blur, para não sumir a caixa enquanto se corrige
      if (!fim || eraVazio) return;
      if (j === 0) lista.splice(i, 1); else c.splice(j, 1);
      m[campo] = lista.filter(function (x) { return x.length; });
      p.ultimoToque = M.agora(); M.salvar();
      return desenharPalco();
    }

    if (campo === 'inicial' || campo === 'fixaMensal' || campo === 'retornoMensal') {
      m.despesas[campo] = el.value === '' ? null : Math.max(0, Number(el.value));
    } else if (campo === 'geraProduto') {
      m.despesas.geraProduto = el.value === '' ? null : el.value === 'sim';
      p.ultimoToque = M.agora(); M.salvar();
      return desenharPalco();   // o campo "o quê?" aparece ou some
    } else if (campo === 'produto') {
      m.despesas.produto = el.value;
    } else {
      m[campo] = el.value;
    }
    p.ultimoToque = M.agora(); M.salvar();
    retocarMuda(p);
  }

  // o que muda de leitura sem redesenhar: contagens, o que falta, a leitura fria
  function retocarMuda(p) {
    var leitura = document.getElementById('leitura_' + p.id);
    if (leitura) leitura.textContent = M.leituraFria(p);
    var falta = M.faltaParaPronta(p);
    var aviso = $palco.querySelector('.muda-falta');
    var bt = $palco.querySelector('[data-acao="muda-pronta"]');
    if (bt) {
      bt.classList.toggle('bt-travado', !!falta.length);
      bt.innerHTML = (falta.length ? CADEADO : '') + 'pronta';
      bt.title = falta.length ? 'Falta: ' + falta.join(', ') + '.' : '';
    }
    if (aviso) aviso.textContent = falta.length ? 'Falta: ' + falta.join(', ') + '.' : '';
    ['vantagens', 'desvantagens'].forEach(function (campo) {
      var ol = $palco.querySelector('[data-cadeias="' + campo + '"]');
      var conta = ol && ol.previousElementSibling;
      if (conta && conta.classList.contains('cadeias-conta')) {
        var n = M.cadeiasVivas(p.muda[campo]).length;
        var sing = campo === 'vantagens' ? 'vantagem' : 'desvantagem';
        conta.textContent = n + ' ' + (n === 1 ? sing : campo) + (n < 2 ? ' · pronta pede 2' : '');
      }
    });
  }

  function escrever(el) {
    var obj = alvoDe(el);
    if (!obj) return;
    var chave = el.getAttribute('data-campo');
    var valor = el.type === 'checkbox' ? el.checked
              : el.hasAttribute('data-bool') ? el.value === 'sim'
              : el.type === 'number' ? (el.value === '' ? null : Number(el.value))
              : el.value;

    if (chave === 'etapa') {
      var junto = M.moverEtapa(obj.id, valor).length - 1;
      avisoCascata = junto > 0
        ? 'Levei junto ' + junto + (junto === 1 ? ' tarefa da mesma corrente.' : ' tarefas da mesma corrente.')
        : '';
      colherAvisos();
      return desenhar();
    }

    if (chave.indexOf('prazo') === 0) return escreverPrazo(obj, chave, valor);
    if (chave.charAt(0) === 'q' && chave.length > 1 && chave.charAt(1) === chave.charAt(1).toUpperCase()) {
      return escreverQuando(obj, chave, valor, el);
    }

    // semente: a ideia é o texto todo; o nome é a primeira frase dele
    if (el.getAttribute('data-alvo') === 'semente' && chave === 'frase') {
      obj.frase = valor;
      obj.nome = M.apelido(valor, 60);
      obj.ultimoToque = M.agora();
      M.salvar();
      return;
    }
    if (chave === 'ganhos' || chave === 'ferramentas' || chave === 'materiais') {
      obj[chave] = String(valor).split('\n').map(function (x) { return x.trim(); })
        .filter(function (x) { return x; });
    } else if (chave === 'guardado' && valor === null) {
      obj.guardado = 0;
    } else if (chave === 'peso') {
      obj.peso = Number(valor) || 2;
    } else {
      obj[chave] = valor;
    }

    // o local decide o resto (§42): trocou, o que não se aplica volta ao neutro e a ficha redesenha
    if (chave === 'ondePrecisaEstar') {
      if (valor !== 'sitio') { obj.guardadaParaChuva = false; obj.esforco = 'leve'; }
      if (valor === 'computador' || valor === 'fora') {
        obj.exigeClima = 'indiferente'; obj.podeNoCalor = true; obj.exigeSoloFirme = false;
        obj.precisaAjuda = false; obj.boaComCriancas = false; obj.perigosaComCriancas = false;
        obj.podeParar = true; obj.peso = 2;
      }
      if (valor === 'computador') obj.onde = '';
      obj.ultimoToque = M.agora(); M.salvar();
      return desenharPalco();
    }

    // boa com crianças e perigosa com crianças não coexistem: marcar uma desmarca a outra
    if ((chave === 'boaComCriancas' || chave === 'perigosaComCriancas') && valor === true) {
      var outra = chave === 'boaComCriancas' ? 'perigosaComCriancas' : 'boaComCriancas';
      obj[outra] = false;
      var caixa = $palco.querySelector('[data-alvo="tarefa"][data-id="' + obj.id + '"][data-campo="' + outra + '"]');
      if (caixa) { caixa.checked = false; var rot = caixa.closest('.campo-marca'); if (rot) rot.classList.remove('campo-marca-on'); }
    }

    // duração recém-cadastrada define o restante: a tarefa ainda não começou
    if (chave === 'duracaoTotal' && obj.estado === 'aberta') obj.restanteEstimado = valor;

    obj.ultimoToque = M.agora();
    M.salvar();
    retocar(el, obj, chave);
  }

  function escreverPrazo(t, chave, valor) {
    if (chave === 'prazoTipo') {
      if (!valor) t.prazo = null;
      else if (valor === 'data') t.prazo = { tipo: 'data', em: '', antecipavel: false };
      else t.prazo = { tipo: 'periodico', cadenciaDias: 30, ultimaVez: M.hoje(), antecipavelDias: 0 };
      t.ultimoToque = M.agora();
      M.salvar();
      return desenharPalco();
    }
    if (!t.prazo) return;
    if (chave === 'prazoEm') t.prazo.em = valor;
    if (chave === 'prazoCadencia') t.prazo.cadenciaDias = Math.max(1, Number(valor) || 1);
    if (chave === 'prazoUltima') t.prazo.ultimaVez = valor;
    if (chave === 'prazoAdianta') t.prazo.antecipavelDias = Math.max(0, Number(valor) || 0);
    t.ultimoToque = M.agora();
    M.salvar();
    retocarAvisos(t);
  }

  function escreverQuando(t, chave, valor, el) {
    if (!t.quando) t.quando = { horario: 'qualquer', de: '06:00', ate: '18:00',
                                dias: 'qualquer', diasEscolhidos: [1,2,3,4,5],
                                meses: M.TODOS_MESES.slice() };
    var q = t.quando;
    var estrutural = false;

    if (chave === 'qHorario') { q.horario = valor; estrutural = true; }
    if (chave === 'qDias')    { q.dias = valor; estrutural = true; }
    if (chave === 'qDe')      q.de = valor;
    if (chave === 'qAte')     q.ate = valor;

    if (chave === 'qDia' || chave === 'qMes') {
      var lista = chave === 'qDia' ? (q.diasEscolhidos = q.diasEscolhidos || [])
                                   : (q.meses = q.meses || []);
      var n = Number(el.getAttribute('data-valor'));
      var i = lista.indexOf(n);
      if (valor && i === -1) lista.push(n);
      if (!valor && i !== -1) lista.splice(i, 1);
      lista.sort(function (a, b) { return a - b; });
      el.closest('.caixinha').classList.toggle('caixinha-on', !!valor);
    }

    t.ultimoToque = M.agora();
    M.salvar();
    if (estrutural) return desenharPalco();
    retocarAvisos(t);
  }

  /* Aviso de contradição é o único retorno imediato desta seção — vale
     redesenhar só ele, para o cursor não sair do campo. */
  function retocarAvisos(t) {
    var li = $palco.querySelector('.passo[data-tarefa="' + t.id + '"] .avisos');
    if (!li) return;
    li.innerHTML = M.avisosDe(t).map(function (a) {
      return '<p class="aviso-linha">' + esc(a) + '</p>';
    }).join('');
  }

  /* Retoque cirúrgico: só o que o campo mudou, para o cursor não saltar. */
  function retocar(el, obj, chave) {
    var alvo = el.getAttribute('data-alvo');

    // o título é o próprio campo: não há segundo lugar para sincronizar
    if (alvo === 'projeto') return desenharLista();
    if (alvo === 'pendencia') {
      if (chave === 'previsto') desenharPalco();
      else desenharLista();
      return;
    }
    // texto e duração agora SÃO os campos da linha: não há segundo lugar
    // para sincronizar, e reescrevê-los mataria o cursor
    if (alvo === 'tarefa' && chave === 'duracaoTotal') retocarAvisos(obj);
  }

  // ── ações ─────────────────────────────────────────────────────────

  function valorDoCampo(id) {
    var campo = document.getElementById(id);
    return campo ? campo.value.trim() : '';
  }

  function fecharFicha() { passoAberto = null; passoEditando = null; cancelandoTarefa = null; }

  // largura, não user-agent: o que muda o comportamento é o tamanho da tela
  function naMesa() { return window.matchMedia('(min-width: 721px)').matches; }

  /* Fechar a última tarefa de planejamento libera a vaga sozinho: o projeto
     vira planejada e o próximo pré-projeto pode entrar. */
  function apurarVagas() {
    M.cascatearVagas();
    colherAvisos();
    return desenhar();
  }

  /* O modelo enfileira cada movimento de vaga; a mesa drena a fila e diz.
     Assim nada que a regra decidiu passa em silêncio — nem na abertura, nem o
     que aconteceu na bota. */
  function colherAvisos() {
    var movidos = M.avisosDeCascata();
    if (!movidos.length) return;
    // soma ao que já ia ser dito ("levei junto…"), não substitui
    avisoCascata = (avisoCascata ? avisoCascata + ' ' : '') + movidos.map(function (m) {
      return m.vaga === 'planejadas'
        ? (m.projeto.nome || 'O projeto') + ' terminou o planejamento e entrou nas planejadas.'
        : (m.projeto.nome || 'Um projeto') + ' assume a vaga de ' + m.vaga + '.';
    }).join(' ');
  }

  function criarProjeto() {
    var p = M.inserirProjeto();
    if (!p) { alert(M.motivoTetoMudas()); return; }
    tela = { tipo: 'projeto', id: p.id };
    projetoEditando = p.id;
    desenhar();
    var campo = $palco.querySelector('.titulo-obra');
    if (campo) campo.focus();
  }

  var DESFECHO_DE = { concluir: 'concluido', suspender: 'suspenso', cancelar: 'cancelado' };

  function executarAcao() {
    if (!acaoProjeto) return;
    var p = M.projeto(acaoProjeto.pid);
    var cfg = TEXTOS_ACAO[acaoProjeto.tipo];
    if (!p || !cfg) { acaoProjeto = null; return desenharPalco(); }

    var campo = document.getElementById('campoAcao');
    var texto = campo ? campo.value.trim() : '';
    if (cfg.campo && !cfg.opcional && !texto) return;   // motivo é obrigatório

    if (acaoProjeto.tipo === 'promover' && destinoDaPromocao(p) === 'reserva') {
      M.promoverParaReserva(p.id);
      colherAvisos();
      tela = { tipo: 'projeto', id: p.id };
    } else if (acaoProjeto.tipo === 'revisar') {
      var r = M.revisarPlano(p.id);
      avisoCascata = r && r.bloqueado
        ? 'A vaga de planejamento está com ' + (r.bloqueado.nome || 'outro projeto') + '. Só cabe um por vez.'
        : 'Voltou para o planejamento com a tarefa de revisar o plano.';
    } else if (acaoProjeto.tipo === 'promover') {
      var saiu = M.promoverParaPlanejamento(p.id);
      avisoCascata = saiu ? (saiu.nome || 'O projeto anterior') + ' voltou para a fila.' : '';
      tela = { tipo: 'projeto', id: p.id };
    } else if (acaoProjeto.tipo === 'retomar') {
      M.retomarProjeto(p.id);
      avisoCascata = '';
    } else if (acaoProjeto.tipo === 'descartar') {
      M.descartarMuda(p.id, texto);
      avisoCascata = '';
    } else {
      M.fecharProjeto(p.id, DESFECHO_DE[acaoProjeto.tipo], texto);
      colherAvisos();
    }

    acaoProjeto = null;
    return desenhar();
  }

  function agir(acao, el) {
    var tid = el.getAttribute('data-id');

    if (acao === 'voltar-inicio') {
      tela = { tipo: null, id: null };
      fecharFicha();
      return desenhar();
    }
    if (acao === 'semear') return alternarSemear();
    if (acao === 'nuvem')  return alternarNuvem();

    if (acao === 'editar-projeto')  { projetoEditando = tid; fotografar(M.projeto(tid)); return desenharPalco(); }
    if (acao === 'salvar-projeto')  { projetoEditando = null; foto = null; return desenhar(); }
    if (acao === 'desfazer-projeto') { revelar(M.projeto(tid)); projetoEditando = null; return desenhar(); }

    if (acao.indexOf('projeto-') === 0) {
      acaoProjeto = { pid: tid, tipo: acao.slice(8) };
      avisoCascata = '';
      // decidir pede o contexto inteiro: a motivação, o envelope, o que falta
      if (tela.tipo !== 'projeto' || tela.id !== tid) {
        tela = { tipo: 'projeto', id: tid };
        return desenhar();
      }
      return desenharPalco();
    }
    if (acao === 'cancelar-acao') { acaoProjeto = null; return desenharPalco(); }
    if (acao === 'confirmar-acao') return executarAcao();

    if (acao === 'mostrar-planejamento') { planejamentoAberto = tid; return desenharPalco(); }
    if (acao === 'esconder-planejamento') { planejamentoAberto = null; return desenharPalco(); }

    // cancelar tarefa: o registro fica, a execução não
    if (acao === 'cancelar-tarefa') { cancelandoTarefa = tid; return desenharPalco(); }
    if (acao === 'voltar-cancelar-tarefa') { cancelandoTarefa = null; return desenharPalco(); }
    if (acao === 'confirmar-cancelar-tarefa') {
      var porque = valorDoCampo('campoCancelaTarefa');
      if (!porque) return;
      M.encerrar('pe_eu', tid, porque);
      cancelandoTarefa = null;
      fecharFicha();
      return apurarVagas();
    }

    if (acao === 'aceitar-proposta') {
      if (proposta) M.confirmarImportacao(proposta.estado);
      proposta = null;
      tela = { tipo: null, id: null };
      return desenhar();
    }
    if (acao === 'descartar-proposta') {
      // marca esta versão como recusada para ela não voltar a toda abertura
      if (proposta && proposta.impressao) localStorage.setItem(CHAVE_DESCARTE, proposta.impressao);
      proposta = null;
      tela = { tipo: null, id: null };
      return desenhar();
    }

    if (acao === 'nova-tarefa' || acao === 'novo-passo') {
      var pid = tid || null;
      var etapa = el.getAttribute('data-etapa') || 'execucao';
      var irmaos = (pid ? M.passosDe(pid) : M.avulsas()).filter(function (x) { return x.etapa === etapa; });
      var nova = M.inserirPasso(pid, irmaos[irmaos.length - 1]);
      nova.etapa = etapa;
      M.salvar();
      passoAberto = passoEditando = nova.id;   // tarefa nova nasce solta
      desenhar();
      // ela nasce no pé da lista; quem clicou em cima precisa ser levado até ela
      var li = $palco.querySelector('[data-tarefa="' + nova.id + '"]');
      if (li) { li.scrollIntoView({ block: 'center', behavior: 'smooth' }); var campo = li.querySelector('.passo-texto'); if (campo) campo.focus(); }
      return;
    }

    // o título abre e fecha a ficha; o botão da linha solta os campos
    if (acao === 'abrir-ficha') {
      if (passoAberto === tid) fecharFicha();
      else { passoAberto = tid; passoEditando = null; }
      return desenharPalco();
    }
    if (acao === 'editar-passo') { passoAberto = passoEditando = tid; fotografar(M.tarefa(tid)); return desenharPalco(); }
    if (acao === 'salvar-passo') { passoEditando = null; foto = null; return desenhar(); }
    if (acao === 'desfazer-passo') { revelar(M.tarefa(tid)); passoEditando = null; return desenhar(); }

    if (acao === 'ir-executar') {
      $campo.hidden = false;
      /* Na mesa o aparelho sabe onde você está e a consulta começa uma pergunta
         adiante. No celular ele não sabe de nada — ele vai junto para o pasto —,
         então a primeira pergunta continua sendo "onde você está". */
      Campo.abrir($campoTela, naMesa() ? { local: 'computador' } : null, sairDoCampo);
      return;
    }
    if (acao === 'ir-organizar') {
      tela = { tipo: 'projetos', id: null };
      filtroProjetos = '';
      return desenhar();
    }

    if (acao === 'voltar-lista') {
      filtroProjetos = voltarPara ? voltarPara.filtro : '';
      voltarPara = null;
      tela = { tipo: 'projetos', id: null };
      fecharFicha();
      return desenhar();
    }
    if (acao === 'guardar-copia') { exportar(); return desenhar(); }
    if (acao === 'filtrar') { filtroProjetos = el.getAttribute('data-valor'); return desenharPalco(); }
    if (acao === 'filtrar-avulsas') { filtroAvulsas = el.getAttribute('data-valor'); return desenharPalco(); }
    if (acao === 'novo-projeto') return criarProjeto();

    // concluir e reabrir também pelo PC: nem tudo é feito com o celular na mão
    if (acao === 'concluir-tarefa') {
      // delegada: concluir fora da folha também é "ele fez" — senão o registro mentia
      var tarefaDel = M.tarefa(tid);
      if (tarefaDel && tarefaDel.separada) M.fecharDiarista(tid, 'feita');
      else M.terminar('pe_eu', tid, '');
      M.limparKit(tid);
      return apurarVagas();
    }
    if (acao === 'reabrir-tarefa')  { M.reabrir('pe_eu', tid); return apurarVagas(); }

    if (acao === 'remover-passo') {
      if (!confirm('Remover esta tarefa?')) return;
      M.removerTarefa(tid);
      fecharFicha();
      return desenhar();
    }

    // apagar projeto é raro e irreversível: fica atrás de uma confirmação escrita
    if (acao === 'abrir-perigo')    { perigo.aberto = tid; return desenharPalco(); }
    if (acao === 'cancelar-perigo') { perigo.aberto = null; return desenharPalco(); }
    if (acao === 'remover-projeto') {
      M.removerProjeto(tid);
      perigo.aberto = null;
      tela = { tipo: null, id: null };
      return desenhar();
    }

    if (acao === 'nova-pendencia') {
      var desc = valorDoCampo('campoPendencia');
      if (!desc) return;
      M.inserirPendencia(desc);
      return desenhar();
    }
    if (acao === 'sincronizar-agora') { Sync.sincronizar(); return; }
    if (acao === 'esperar-abrir')  { esperando = tid; return desenharPalco(); }
    if (acao === 'esperar-cancelar') { esperando = null; return desenharPalco(); }
    if (acao === 'esperar-confirmar') {
      var oque = valorDoCampo('esperaDesc_' + tid);
      if (!oque) { var c = document.getElementById('esperaDesc_' + tid); if (c) c.focus(); return; }
      M.esperarPara(tid, oque, valorDoCampo('esperaDia_' + tid));
      esperando = null;
      return desenhar();
    }
    if (acao === 'pendencia-chegou')    { M.resolverPendencia(tid, 'chegou'); return desenhar(); }
    if (acao === 'pendencia-cancelada') {
      var gerada = M.resolverPendencia(tid, 'cancelada');
      if (gerada) alert('Criei a tarefa: ' + gerada.texto);
      return desenhar();
    }

    if (acao === 'nova-semente') {
      var texto = valorDoCampo('campoSemente');
      if (!texto) return;
      M.inserirSemente(texto);
      return desenhar();
    }
    // ── diarista ──
    if (acao === 'separar-diarista') { M.separarTarefa(tid); return desenhar(); }
    if (acao === 'desfazer-separacao') { M.desfazerSeparacao(tid); return desenhar(); }
    if (acao === 'diarista-fechar') {
      var como = el.getAttribute('data-valor');
      var sobrou = como === 'metade' ? valorDoCampo('sobrou_' + tid) : null;
      if (como === 'metade' && !sobrou) { var c = document.getElementById('sobrou_' + tid); if (c) c.focus(); return; }
      M.fecharDiarista(tid, como, sobrou, valorDoCampo('nota_' + tid));
      colherAvisos();
      return desenhar();
    }
    if (acao === 'diarista-metade') { diaristaMetade = tid; return desenharPalco(); }
    if (acao === 'diarista-mover') {
      var ids = M.separadas().map(function (t) { return t.id; });
      var i = ids.indexOf(tid), j = i + Number(el.getAttribute('data-valor'));
      if (i < 0 || j < 0 || j >= ids.length) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      M.reordenarSeparadas(ids);
      return desenharPalco();
    }
    if (acao === 'tempo') {
      var tt = M.tarefa(tid); if (!tt) return;
      tt.duracaoTotal = Number(el.getAttribute('data-valor'));
      if (M.estadoDe(tid) === 'aberta') tt.restanteEstimado = tt.duracaoTotal;
      tt.ultimoToque = M.agora(); M.salvar(); tempoLivre = null;
      return desenharPalco();
    }
    if (acao === 'tempo-livre') {
      tempoLivre = tid; desenharPalco();
      var caixa = $palco.querySelector('.passo-tempo-edita[data-id="' + tid + '"]'); if (caixa) { caixa.focus(); caixa.select(); }
      return;
    }
    if (acao === 'tirar-tag') {
      var alvoTag = el.getAttribute('data-alvo') === 'projeto' ? M.projeto(tid) : M.tarefa(tid);
      M.tirarTag(alvoTag, el.getAttribute('data-valor'));
      return desenharPalco();
    }
    if (acao === 'ir-rua') { tela = { tipo: 'rua', id: null }; return desenhar(); }
    if (acao === 'rua-mover') {
      var idsR = M.tarefasDaRua().map(function (t) { return t.id; });
      var iR = idsR.indexOf(tid), jR = iR + Number(el.getAttribute('data-valor'));
      if (iR < 0 || jR < 0 || jR >= idsR.length) return;
      idsR.splice(jR, 0, idsR.splice(iR, 1)[0]);
      M.reordenarRua(idsR);
      return desenharPalco();
    }
    if (acao === 'rua-feita') { M.terminar('pe_eu', tid, ''); M.limparKit(tid); colherAvisos(); return desenhar(); }
    if (acao === 'diarista-copiar') {
      var texto = textoDaFolha();
      function feito() { var b = el; b.textContent = 'copiado'; setTimeout(function () { b.textContent = 'copiar a folha'; }, 1500); }
      if (navigator.clipboard) navigator.clipboard.writeText(texto).then(feito, function () { prompt('Copie:', texto); });
      else prompt('Copie:', texto);
      return;
    }
    if (acao === 'diarista-desfazer-tudo') { M.separadas().forEach(function (t) { M.desfazerSeparacao(t.id); }); tela = { tipo: null, id: null }; return desenhar(); }

    if (acao === 'filtrar-sementes') {
      filtroSementes = el.getAttribute('data-valor'); sementeDescartando = null;
      return desenharPalco();
    }
    if (acao === 'classificar-semente') {
      M.classificarSemente(tid, el.getAttribute('data-valor'));
      return desenhar();
    }
    if (acao === 'pedir-descarte') { sementeDescartando = tid; return desenharPalco(); }
    if (acao === 'cancelar-descarte') { sementeDescartando = null; return desenharPalco(); }
    if (acao === 'descartar-semente') {
      var motivo = valorDoCampo('motivo_' + tid);
      if (!motivo) { document.getElementById('motivo_' + tid).focus(); return; }
      M.classificarSemente(tid, 'descartada', motivo);
      sementeDescartando = null;
      return desenhar();
    }
    if (acao === 'promover-semente') {
      var novo = M.promoverSemente(tid);
      if (novo) tela = { tipo: 'projeto', id: novo.id };
      else if (M.motivoTetoMudas()) alert(M.motivoTetoMudas());
      return desenhar();
    }
    // ── muda: pronta, plantando, reabrir ──
    if (acao === 'muda-pronta') {
      var falta = M.marcarMudaPronta(tid);
      if (falta && falta.length) { mudaAviso = 'Falta: ' + falta.join(', ') + '.'; mudaAvisoDe = tid; }
      else { mudaAviso = ''; mudaAvisoDe = null; }
      return desenhar();
    }
    if (acao === 'muda-plantar') { M.voltarAPlantar(tid); mudaAviso = ''; return desenhar(); }
    if (acao === 'abrir-recolhido') { recolhidos[tid] = !recolhidos[tid]; return desenharPalco(); }
    if (acao === 'muda-reabrir') {
      if (!M.reabrirMuda(tid)) alert(M.motivoTetoMudas() || 'Não deu para reabrir.');
      return desenhar();
    }
    // da semente para a lista das avulsas, com a ficha nova já solta
    if (acao === 'semente-vira-tarefa') {
      var nascida = M.semearTarefa(tid);
      if (nascida) {
        tela = { tipo: 'avulsas', id: null };
        filtroAvulsas = '';
        passoAberto = passoEditando = nascida.id;
      }
      return desenhar();
    }
    if (acao === 'ir-ao-fruto') {
      var origem = M.semente(tid);
      if (!origem) return;
      if (origem.estado === 'virou_projeto') tela = { tipo: 'projeto', id: origem.virouId };
      else { tela = { tipo: 'avulsas', id: null }; filtroAvulsas = ''; passoAberto = origem.virouId; }
      return desenhar();
    }

    if (acao === 'por-prereq') {
      var sel = document.getElementById('selPrereq');
      var p = M.projeto(tid);
      if (sel && sel.value && p && p.prerequisitos.indexOf(sel.value) === -1) {
        p.prerequisitos.push(sel.value);
        M.salvar();
      }
      return desenhar();
    }
    if (acao === 'tirar-prereq') {
      var pr = M.projeto(tid);
      var fora = el.getAttribute('data-valor');
      if (pr) pr.prerequisitos = pr.prerequisitos.filter(function (x) { return x !== fora; });
      M.salvar();
      return desenhar();
    }

    if (acao === 'por-dep') {
      var selDep = $palco.querySelector('[data-entrada="dep"][data-id="' + tid + '"]');
      var td = M.tarefa(tid);
      if (selDep && selDep.value && td && td.dependeDe.indexOf(selDep.value) === -1) {
        td.dependeDe.push(selDep.value);
        M.salvar();
        /* Planejamento que depende de execução trava as duas para sempre. O
           arraste já puxa a corrente; vincular pelo seletor faz o mesmo. */
        var alvoDep = M.tarefa(selDep.value);
        if (td.etapa === 'planejamento' && alvoDep && alvoDep.etapa === 'execucao') {
          var puxadas = M.moverEtapa(selDep.value, 'planejamento').length;
          avisoCascata = 'Levei ' + (puxadas === 1 ? '1 tarefa' : puxadas + ' tarefas') +
            ' para o planejamento: execução só é oferecida depois que ele fecha.';
        }
      }
      return desenharPalco();
    }
    if (acao === 'tirar-dep') {
      var t2 = M.tarefa(tid);
      var dep = el.getAttribute('data-valor');
      if (t2) t2.dependeDe = t2.dependeDe.filter(function (x) { return x !== dep; });
      M.salvar();
      return desenharPalco();
    }
  }

  // ── arrastar para reordenar ───────────────────────────────────────

  var arrastando = null;

  function ligarArraste() {
    $palco.addEventListener('dragstart', function (e) {
      var li = e.target.closest('.passo');
      if (!li) return;
      arrastando = li;
      li.classList.add('arrastando');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', li.dataset.tarefa); } catch (x) {}
    });

    $palco.addEventListener('dragover', function (e) {
      if (!arrastando) return;

      var li = e.target.closest('.passo');
      if (li && li !== arrastando) {
        e.preventDefault();
        var meio = li.getBoundingClientRect().top + li.offsetHeight / 2;
        return li.parentNode.insertBefore(arrastando, e.clientY < meio ? li : li.nextSibling);
      }
      // lista vazia da outra etapa: sem isto não dá para mover para um
      // planejamento que ainda não tem tarefa nenhuma
      var ul = e.target.closest('.passos');
      if (ul && !ul.querySelector('.passo')) {
        e.preventDefault();
        ul.appendChild(arrastando);
      }
    });

    /* Soltar numa seção de outra etapa reclassifica a tarefa. É o caminho de
       conserto para o que foi cadastrado antes de existir a divisão — muito
       mais barato que recadastrar tudo. */
    $palco.addEventListener('dragend', function () {
      if (!arrastando) return;
      arrastando.classList.remove('arrastando');
      var ul = arrastando.closest('.passos');
      var alvo = arrastando;
      arrastando = null;
      if (!ul) return;

      var etapaDestino = ul.getAttribute('data-etapa');
      var t = M.tarefa(alvo.dataset.tarefa);
      if (t && etapaDestino && t.etapa !== etapaDestino) {
        var levadas = M.moverEtapa(t.id, etapaDestino).length - 1;
        avisoCascata = levadas > 0
          ? 'Levei junto ' + levadas + (levadas === 1 ? ' tarefa da mesma corrente.' : ' tarefas da mesma corrente.')
          : '';
        colherAvisos();
      }

      M.reordenar(Array.prototype.map.call(ul.querySelectorAll('.passo'), function (li) {
        return li.dataset.tarefa;
      }));
      desenhar();
    });
  }

  // ── arquivo ───────────────────────────────────────────────────────

  /* O localStorage não é backup: limpar dados do navegador apaga tudo. A cópia
     de verdade é o arquivo exportado, e o app conta há quanto tempo você não
     tira uma — em texto seco, sem alarme. É um fato, não uma cobrança. */
  var CHAVE_COPIA = 'app-sitio-ultima-copia';

  // a cópia automática na nuvem conta como cópia: o aviso só cobra quem não tem nuvem
  Sync.quandoCopiar(function () { localStorage.setItem(CHAVE_COPIA, M.hoje()); copiarLocal(); desenhar(); });

  /* CÓPIA LOCAL DIÁRIA (§47): uma pasta escolhida uma vez (pode ser do
     OneDrive — aí fica no PC e fora dele), e a mesa grava sozinha
     rebrota-AAAA-MM-DD.json uma vez por dia, guardando as últimas 30. A
     permissão da pasta mora no IndexedDB (localStorage não guarda handle).
     Só existe onde a API de pastas existe: Edge/Chrome no PC — a mesa. */
  var CHAVE_COPIA_LOCAL = 'app-sitio-copia-local';
  var pastaCopias = null;
  function bdPasta(modo, valor) {
    return new Promise(function (ok, falha) {
      var req = indexedDB.open('rebrota', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('chaves'); };
      req.onerror = function () { falha(req.error); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction('chaves', modo === 'ler' ? 'readonly' : 'readwrite');
        var loja = tx.objectStore('chaves');
        var r = modo === 'ler' ? loja.get('pastaCopias') : loja.put(valor, 'pastaCopias');
        r.onsuccess = function () { ok(r.result); db.close(); };
        r.onerror = function () { falha(r.error); db.close(); };
      };
    });
  }
  function temApiDePasta() { return typeof window.showDirectoryPicker === 'function' && naMesa(); }
  function carregarPastaCopias() {
    if (!temApiDePasta()) return Promise.resolve(null);
    return bdPasta('ler').then(function (h) { pastaCopias = h || null; return pastaCopias; }).catch(function () { return null; });
  }
  function estadoDaCopiaLocal() {
    var caixa = document.getElementById('copiaLocal');
    if (!naMesa()) { caixa.hidden = true; return; }
    caixa.hidden = false;
    var ultima = localStorage.getItem(CHAVE_COPIA_LOCAL);
    /* Sem a API de pastas (Firefox): a cópia local é um download por dia, para
       a pasta de Downloads — silencioso se o navegador estiver configurado para
       salvar sem perguntar; senão, a janela de salvar aparece uma vez por dia. */
    if (!temApiDePasta()) {
      document.getElementById('copiaLocalEstado').textContent = 'Cópia local diária: este navegador não deixa escolher pasta, então ' +
        'o arquivo vai para Downloads uma vez por dia' + (ultima ? ' · última ' + M.formatarData(ultima) : ' · ainda nenhuma hoje') + '.';
      document.getElementById('btPastaCopias').textContent = 'baixar a cópia de hoje';
      return;
    }
    document.getElementById('copiaLocalEstado').textContent = pastaCopias
      ? 'cópia local em "' + pastaCopias.name + '"' + (ultima ? ' · última ' + M.formatarData(ultima) : ' · ainda nenhuma')
      : 'Cópia local diária: escolha uma pasta (pode ser do OneDrive) e o resto é automático.';
    document.getElementById('btPastaCopias').textContent = pastaCopias ? 'trocar a pasta' : 'escolher a pasta das cópias';
  }
  function copiarLocal(forcar) {
    var hoje = M.hoje();
    if (!forcar && localStorage.getItem(CHAVE_COPIA_LOCAL) === hoje) return Promise.resolve(false);
    if (!temApiDePasta()) {
      if (!naMesa()) return Promise.resolve(false);
      exportar();   // marca a cópia de hoje e baixa
      localStorage.setItem(CHAVE_COPIA_LOCAL, hoje);
      estadoDaCopiaLocal();
      return Promise.resolve(true);
    }
    if (!pastaCopias) return Promise.resolve(false);
    return pastaCopias.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') return p;
      // só pede de novo com gesto do usuário; sem gesto, fica para o próximo clique
      return forcar ? pastaCopias.requestPermission({ mode: 'readwrite' }) : p;
    }).then(function (p) {
      if (p !== 'granted') throw new Error('sem permissão');
      return pastaCopias.getFileHandle('rebrota-' + hoje + '.json', { create: true });
    }).then(function (fh) {
      return fh.createWritable().then(function (w) { return w.write(M.exportar()).then(function () { return w.close(); }); });
    }).then(function () {
      localStorage.setItem(CHAVE_COPIA_LOCAL, hoje);
      // guarda as últimas 30
      var nomes = [];
      return (async function () {
        for await (var [nome] of pastaCopias.entries()) { if (/^rebrota-\d{4}-\d{2}-\d{2}\.json$/.test(nome)) nomes.push(nome); }
        nomes.sort().reverse().slice(30).forEach(function (n) { pastaCopias.removeEntry(n).catch(function () {}); });
      })();
    }).then(function () { estadoDaCopiaLocal(); return true; })
      .catch(function (e) {
        document.getElementById('copiaLocalEstado').textContent = 'cópia local parada: ' + (e.message || e) + ' — clique em trocar a pasta para renovar a permissão.';
        return false;
      });
  }
  document.getElementById('btPastaCopias').addEventListener('click', function () {
    if (!temApiDePasta()) { copiarLocal(true); return; }
    var estadoEl = document.getElementById('copiaLocalEstado');
    estadoEl.textContent = 'abrindo a escolha da pasta…';
    var pedido;
    try { pedido = window.showDirectoryPicker({ mode: 'readwrite', id: 'rebrota-copias' }); }
    catch (e) { estadoEl.textContent = 'não abriu: ' + (e.message || e); return; }
    pedido.then(function (h) {
      pastaCopias = h;
      return bdPasta('gravar', h).then(function () { return copiarLocal(true); });
    }).then(function () { estadoDaCopiaLocal(); })
      .catch(function (e) {
        // cancelou (AbortError) não é erro; o resto é
        if (e && e.name === 'AbortError') { estadoDaCopiaLocal(); return; }
        estadoEl.textContent = 'não deu: ' + (e && e.message ? e.message : e);
      });
  });
  carregarPastaCopias().then(function () { estadoDaCopiaLocal(); copiarLocal(); });

  function avisoDeCopia() {
    var quando = localStorage.getItem(CHAVE_COPIA);
    var dias = quando ? M.diasDesde(quando) : null;
    if (dias !== null && dias < 14) return '';

    return '<p class="aviso-copia">' +
      (quando ? 'Última cópia dos dados há ' + dias + ' dias.' : 'Você ainda não guardou uma cópia dos dados.') +
      ' <button type="button" class="bt-linha bt-mini" data-acao="guardar-copia">guardar agora</button></p>';
  }

  function exportar() {
    localStorage.setItem(CHAVE_COPIA, M.hoje());
    var blob = new Blob([M.exportar()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'sitio-' + M.hoje() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importar(arquivo) {
    var leitor = new FileReader();
    leitor.onload = function () {
      try {
        proposta = M.lerImportacao(leitor.result);
        proposta.arquivo = arquivo.name;
        tela = { tipo: 'proposta', id: null };
        fecharFicha();
        desenhar();
      } catch (e) {
        alert('Não consegui ler esse arquivo: ' + e.message);
      }
    };
    leitor.readAsText(arquivo);
  }

  // ── proposta que veio no dados.js ─────────────────────────────────
  /* O Claude escreve o arquivo; o app decide o que fazer com ele. Se ainda não
     há nada gravado, entra direto — não existe trabalho para proteger. Se já
     há, vira uma proposta na coluna e espera aceite, como manda a regra 11.
     Descartada uma vez, aquela versão não volta a incomodar. */

  var CHAVE_DESCARTE = 'app-sitio-proposta-descartada';

  function impressao(texto) {
    var h = 5381;
    for (var i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
    return String(h);
  }

  function conferirProposta() {
    if (typeof window.DADOS_CLAUDE === 'undefined') return;

    var texto = JSON.stringify(window.DADOS_CLAUDE);
    var lida;
    try { lida = M.lerImportacao(texto); } catch (e) {
      return console.warn('dados.js ilegível', e);
    }

    if (M.estaVazio()) return M.confirmarImportacao(lida.estado);
    if (!lida.resumo.length) return;
    if (localStorage.getItem(CHAVE_DESCARTE) === impressao(texto)) return;

    lida.arquivo = 'proposta do Claude';
    lida.impressao = impressao(texto);
    proposta = lida;
  }

  function desenharProposta() {
    var caixa = document.getElementById('listaProposta');
    if (!proposta) return (caixa.innerHTML = '');

    var quantas = proposta.resumo.reduce(function (n, r) {
      return n + r.entram.length + r.mudam.length + r.saem.length;
    }, 0);

    caixa.innerHTML = '<li><button type="button" class="item-projeto" data-abrir="proposta"' +
      (tela.tipo === 'proposta' ? ' aria-current="true"' : '') + '>' +
      '<span class="item-etiqueta">proposta</span>' +
      '<span class="item-nome">Mudanças do Claude</span>' +
      '<span class="item-nota">' + quantas + (quantas === 1 ? ' item' : ' itens') +
      ' · nada gravado ainda</span></button></li>';
  }

  // ── ligações ──────────────────────────────────────────────────────

  document.addEventListener('click', function (e) {
    var abrir = e.target.closest('[data-abrir]');
    if (abrir) {
      var destino = { tipo: abrir.getAttribute('data-abrir'), id: abrir.getAttribute('data-id') || null };
      // guarda a lista quando se entra num projeto vindo dela; qualquer outro
      // pulo limpa a volta, para o botão nunca apontar para lugar nenhum
      voltarPara = (destino.tipo === 'projeto' && tela.tipo === 'projetos')
        ? { filtro: filtroProjetos } : null;
      tela = destino;
      if (tela.tipo === 'projetos') filtroProjetos = abrir.getAttribute('data-filtro') || '';
      fecharFicha();
      projetoEditando = null;
      acaoProjeto = null;
      avisoCascata = '';
      planejamentoAberto = null;
      desenharProposta();
      return desenhar();
    }
    var acao = e.target.closest('[data-acao]');
    if (acao) {
      agir(acao.getAttribute('data-acao'), acao);
      desenharProposta();
    }
  });

  document.getElementById('btNovoProjeto').addEventListener('click', criarProjeto);

  document.getElementById('btNovaAvulsa').addEventListener('click', function () {
    var t = M.inserirPasso(null, null);
    tela = { tipo: 'avulsas', id: null };
    passoAberto = passoEditando = t.id;
    desenhar();
  });

  // ── frente de campo ───────────────────────────────────────────────

  var $campo = document.getElementById('execucao');
  var $campoTela = document.getElementById('campoTela');
  Campo.ligar($campoTela);

  /* Sair do campo é voltar para a tela inicial — e colher o que a bota moveu de
     vaga, para a mesa dizer. */
  function sairDoCampo() {
    $campo.hidden = true;
    tela = { tipo: null, id: null };
    fecharFicha();
    colherAvisos();
    desenhar();
  }

  document.getElementById('btSairCampo').addEventListener('click', sairDoCampo);

  // Esc sempre sai — nenhuma tela do app é uma armadilha. Exceto com texto
  // digitado pela metade: aí Esc só larga o campo, e não joga o texto fora.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$semear.hidden) {
      if ($semearTexto.value.trim()) return $semearTexto.blur();   // não joga a ideia fora
      $semear.hidden = true; return;
    }
    if (!$campo.hidden) {
      var digitando = $campoTela.querySelector('textarea');
      if (digitando && digitando.value.trim()) return digitando.blur();
      return sairDoCampo();
    }
    if (acaoProjeto)     { acaoProjeto = null; return desenharPalco(); }
    if (cancelandoTarefa) { cancelandoTarefa = null; return desenharPalco(); }
    if (passoAberto)     { fecharFicha(); return desenharPalco(); }
    if (projetoEditando) { projetoEditando = null; desenharPalco(); }
  });

  document.getElementById('btExportar').addEventListener('click', exportar);
  document.getElementById('btImportar').addEventListener('click', function () {
    document.getElementById('arquivoImportar').click();
  });
  document.getElementById('arquivoImportar').addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) importar(e.target.files[0]);
    e.target.value = '';
  });

  $palco.addEventListener('input',  function (e) {
    // caixas de lista crescem com o texto, para nunca esconder uma linha
    if (e.target.tagName === 'TEXTAREA') e.target.rows = Math.max(3, e.target.value.split('\n').length + 1);
    if (e.target.hasAttribute('data-muda')) return escreverMuda(e.target, false);
    if (e.target.hasAttribute('data-campo')) escrever(e.target);
  });
  // a caixa de tags fecha no Enter, na vírgula ou ao sair
  function fecharTag(caixa) {
    var partes = caixa.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!partes.length) { caixa.value = ''; return; }
    var alvo = caixa.getAttribute('data-tags') === 'projeto' ? M.projeto(caixa.getAttribute('data-id')) : M.tarefa(caixa.getAttribute('data-id'));
    partes.forEach(function (x) { M.porTag(alvo, x); });
    caixa.value = '';
    desenharPalco();
    var nova = $palco.querySelector('.tag-caixa[data-id="' + caixa.getAttribute('data-id') + '"]');
    if (nova) nova.focus();
  }
  $palco.addEventListener('keydown', function (e) {
    if (!e.target.classList.contains('tag-caixa')) return;
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); fecharTag(e.target); }
  });
  $palco.addEventListener('change', function (e) {
    if (e.target.classList.contains('tag-caixa')) return fecharTag(e.target);
    if (e.target.id === 'diaDiarista' && e.target.value) { M.definirDiaDiarista(e.target.value); return desenhar(); }
    if (e.target.hasAttribute('data-muda')) return escreverMuda(e.target, true);
    if (e.target.hasAttribute('data-campo')) return escrever(e.target);
    // escolher a semente já cria a tarefa: a escolha é a ação
    if (e.target.id === 'selSementeTarefa' && e.target.value) {
      var nascida = M.semearTarefa(e.target.value);
      if (nascida) passoAberto = passoEditando = nascida.id;
      desenhar();
    }
  });

  // ── bilhete sobre o app ───────────────────────────────────────────
  /* Fica por cima de tudo, inclusive da tela de execução: o incômodo aparece
     durante o uso, e anotar depois é anotar pior. */

  var $bilhete = document.getElementById('bilhete');
  var $bilheteTexto = document.getElementById('bilheteTexto');
  var $bilheteAviso = document.getElementById('bilheteAviso');
  var $bilheteLista = document.getElementById('bilheteLista');

  /* O ✎ (§45): caderno, não documento. Escrever acrescenta; riscar tira da
     lista e fica no registro. Tudo é evento no diário — sincroniza sozinho. */
  function desenharAnotacoes() {
    var lista = M.anotacoes();
    $bilheteLista.innerHTML = lista.length ? lista.map(function (a) {
      return '<li><p>' + esc(a.texto) + '</p><em>' +
        esc(M.formatarData(M.diaDe(a.quando))) + ' ' + esc(M.horaDe(new Date(a.quando))) +
        (a.app ? ' · ' + esc(a.app) : '') +
        ' <button type="button" class="bt-linha bt-mini" data-riscar="' + a.id + '">riscar</button></em></li>';
    }).join('') : '<li class="aviso">Nada anotado.</li>';
  }

  function abrirBilhete() {
    $bilhete.hidden = false;
    $bilheteAviso.textContent = '';
    desenharAnotacoes();
    $bilheteTexto.focus();
  }

  function anotarAgora() {
    var texto = $bilheteTexto.value.trim();
    if (!texto) return ($bilheteAviso.textContent = 'escreva alguma coisa');
    M.anotar('pe_eu', texto, naMesa() ? 'mesa' : 'bota');
    $bilheteTexto.value = '';
    $bilheteAviso.textContent = 'anotado';
    desenharAnotacoes();
    $bilheteTexto.focus();
  }

  document.getElementById('btBilhete').addEventListener('click', function () {
    if ($bilhete.hidden) abrirBilhete(); else $bilhete.hidden = true;
  });
  document.getElementById('btFecharBilhete').addEventListener('click', function () { $bilhete.hidden = true; });
  document.getElementById('btAnotar').addEventListener('click', anotarAgora);
  $bilheteTexto.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); anotarAgora(); }
  });
  $bilheteLista.addEventListener('click', function (e) {
    var b = e.target.closest('[data-riscar]');
    if (!b) return;
    M.riscarAnotacao('pe_eu', b.getAttribute('data-riscar'));
    desenharAnotacoes();
  });

  // o texto antigo do bilhete vira a primeira anotação: nada se perde
  if (M.lerBilhete().trim()) { M.anotar('pe_eu', M.lerBilhete(), 'mesa'); M.escreverBilhete(''); }

  // ── semente: o (+) da §14 ─────────────────────────────────────────
  /* Captura em um toque, nos dois modos e por cima da frente de campo: a ideia
     aparece andando pelo sítio, e o que não se despeja na hora se perde. O
     texto pode ser longo e ditado; o nome a semente tira sozinha da primeira
     frase, e o resto se preenche na mesa, com calma. */

  var $semear = document.getElementById('semear');
  var $semearTexto = document.getElementById('semearTexto');
  var $semearAviso = document.getElementById('semearAviso');

  function alternarSemear() {
    if (!$semear.hidden) { $semear.hidden = true; return; }
    $bilhete.hidden = true;
    $semear.hidden = false;
    $semearAviso.textContent = '';
    $semearTexto.focus();
  }

  document.getElementById('btFecharSemear').addEventListener('click', function () {
    $semear.hidden = true;
  });

  document.getElementById('btGuardarSemente').addEventListener('click', function () {
    var texto = $semearTexto.value.trim();
    if (!texto) return ($semearAviso.textContent = 'nada escrito ainda');
    // nasce como evento no diário (viaja pela sincronização); a mesa absorve
    var s = M.semear('pe_eu', texto);
    if (naMesa()) M.absorverSementes();
    $semearTexto.value = '';
    $semearAviso.textContent = 'guardada: ' + s.nome;
    // a coluna conta as sementes; a página de sementes, se aberta, ganha a nova
    if ($campo.hidden) desenhar(); else desenharLista();
  });

  // ── casco do app ──────────────────────────────────────────────────
  /* O service worker guarda só o APP para abrir sem internet. Dado do sítio
     não passa por ele. E o pedido de armazenamento persistente é o que impede
     o navegador de descartar o localStorage sozinho quando ficar apertado —
     sem isso, "backup local" é promessa que o navegador não assinou. */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('service worker não registrou', e);
      });
    });
  }

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (jaTem) {
      if (!jaTem) navigator.storage.persist();
    }).catch(function () {});
  }

  // ── sincronização ─────────────────────────────────────────────────
  /* A mesa escreve o catálogo; a bota só lê. O papel muda com a largura, como
     tudo o mais. Quando algo chega de fora, a mesa absorve as sementes que
     nasceram como evento e a tela se redesenha. */

  var $nuvem = document.getElementById('nuvem');
  var $nuvemToken = document.getElementById('nuvemToken');
  var $nuvemEstado = document.getElementById('nuvemEstado');

  function textoDaNuvem(s) {
    if (!s.ligado) return 'Este aparelho não sincroniza. Cole o token e ligue.';
    if (s.ocupado) return 'sincronizando…';
    if (s.erro) return 'não consegui: ' + s.erro;
    if (s.ultimo) return 'sincronizado às ' + M.horaDe(new Date(s.ultimo));
    return 'ligado';
  }

  function desenharNuvem() {
    var s = Sync.situacao();
    $nuvemEstado.textContent = textoDaNuvem(s);
    if (typeof estadoDaCopiaLocal === 'function') estadoDaCopiaLocal();
    // o carimbo na barra: a última sincronização, sem abrir painel nenhum
    var carimbo = document.getElementById('nuvemCarimbo');
    carimbo.hidden = !s.ligado;
    carimbo.classList.toggle('nuvem-carimbo-erro', !!s.erro);
    carimbo.textContent = s.ocupado ? 'sincronizando…'
      : s.erro ? '⚠ nuvem: ' + s.erro
      : s.ultimo ? 'nuvem · ' + M.horaDe(new Date(s.ultimo))
      : 'nuvem ligada';
    carimbo.title = textoDaNuvem(s) + ' — clique para sincronizar agora';
    document.getElementById('btLigarNuvem').hidden = s.ligado;
    document.getElementById('btDesligarNuvem').hidden = !s.ligado;
    document.getElementById('btSincronizarAgora').hidden = !s.ligado;
    var foto = M.fotoDoCatalogo();
    var btFoto = document.getElementById('btVoltarFoto');
    btFoto.hidden = !foto;
    if (foto) btFoto.textContent = 'voltar ao de antes das ' + M.horaDe(new Date(foto.em));
    $nuvemToken.hidden = s.ligado;
    document.getElementById('nuvemComo').hidden = s.ligado;
    document.body.classList.toggle('sem-nuvem', !s.ligado);
  }

  function alternarNuvem() {
    if (!$nuvem.hidden) { $nuvem.hidden = true; return; }
    $bilhete.hidden = true; $semear.hidden = true;
    desenharNuvem();
    $nuvem.hidden = false;
    if (!Sync.ligado()) $nuvemToken.focus();
  }

  document.getElementById('btFecharNuvem').addEventListener('click', function () { $nuvem.hidden = true; });
  document.getElementById('btLigarNuvem').addEventListener('click', function () {
    var t = $nuvemToken.value.trim();
    if (!t) return ($nuvemEstado.textContent = 'cole o token primeiro');
    $nuvemToken.value = '';
    Sync.ligar(t);
  });
  document.getElementById('btDesligarNuvem').addEventListener('click', function () {
    Sync.desligar(); desenharNuvem(); desenhar();
  });
  document.getElementById('btSincronizarAgora').addEventListener('click', function () { Sync.sincronizar(); });
  document.getElementById('nuvemCarimbo').addEventListener('click', function () { Sync.sincronizar(); });
  document.getElementById('btVoltarFoto').addEventListener('click', function () {
    var mudou = M.voltarAFoto();
    $nuvemEstado.textContent = mudou ? 'juntei o de antes ao de agora — e vai subir' : 'nada para voltar: já estava tudo aqui';
    desenhar();
  });

  Sync.configurar({ escreveCatalogo: naMesa(), pessoa: 'pe_eu' });
  window.matchMedia('(min-width: 721px)').addEventListener('change', function () {
    Sync.configurar({ escreveCatalogo: naMesa(), pessoa: 'pe_eu' });
  });
  M.quandoSalvar(function () { Sync.marcarSujo(); });

  // ── uso: uma linha por sessão, para o modo analisar (§38) ──
  M.usoIniciar('pe_eu', naMesa() ? 'mesa' : 'bota');
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') M.usoFechar();
    else M.usoRetomar();
  });
  window.addEventListener('pagehide', function () { M.usoFechar(); });
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (n) {
    window.addEventListener(n, M.usoAtividade, { passive: true, capture: true });
  });
  setInterval(M.usoVerificarOcio, 60 * 1000);

  // outra aba (ou a Sementeira no mesmo aparelho) gravou: relê e redesenha,
  // em vez de gravar memória velha por cima na próxima tecla
  window.addEventListener('storage', function (e) {
    if (e.key !== 'app-sitio-v3') return;
    if (M.relerSeOutraAbaGravou()) desenhar();
  });
  Sync.ouvir(function (s, mudouLocal) {
    desenharNuvem();
    if (mudouLocal && !$bilhete.hidden) desenharAnotacoes();
    // a linha da nuvem na entrada acompanha o estado (hora, erro), sem mexer no resto
    if (!mudouLocal && tela.tipo === null && $campo.hidden && !s.ocupado) return desenhar();
    if (!mudouLocal) return;
    if (naMesa()) M.absorverSementes();
    M.cascatearVagas(); colherAvisos();
    // a frente de campo lê o estado a cada toque; a mesa precisa redesenhar
    if ($campo.hidden) desenhar(); else desenharLista();
  });

  ligarArraste();
  M.carregar();
  M.cascatearVagas();   // o que a regra já decidiu, aplicado antes de desenhar
  colherAvisos();       // ... e dito, não engolido
  conferirProposta();
  desenharProposta();
  if (naMesa()) M.absorverSementes();
  voltarAoLugar();
  // a nuvem carrega o token ANTES do primeiro desenho: senão a entrada dizia
  // "não sincroniza" com o painel dizendo "sincronizado às…"
  Sync.iniciar();
  desenhar();
  desenharNuvem();
})();
