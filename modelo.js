/* App do sítio — modelo, persistência e derivações.
 *
 * O dado é partido em duas metades que nunca se sobrepõem:
 *
 *   CATÁLOGO — o que você decide. Projetos, tarefas, ordem, vínculos,
 *              envelopes, sementes. Escrito só na frente de análise (PC).
 *
 *   DIÁRIO   — o que acontece. Feito, recusado, parei na metade, o que a
 *              tarefa trouxe de volta. Um arquivo por pessoa, só acrescenta.
 *              Escrito na frente de execução (celular).
 *
 * Estado atual = catálogo + diário, derivado igual dos dois lados. Ninguém
 * "aplica" nada no outro, então não existe conflito para resolver.
 *
 * NÃO EXISTE INVENTÁRIO. Ferramenta e material são texto na tarefa, e a
 * conferência do que se tem é uma TAREFA DE PLANEJAMENTO, não um estado
 * mantido para sempre. Inventário que ninguém atualiza é uma mentira sobre
 * a qual o app decide — pior que a ausência dele.
 */

var Modelo = (function () {
  'use strict';

  var CHAVE = 'app-sitio-v3';
  var VERSAO = 3;

  // ── vocabulários ──────────────────────────────────────────────────

  var PERFIS = ['proprietario', 'servidor', 'crianca'];

  var LOCAIS = [
    { v: 'sitio',      t: 'no sítio' },
    { v: 'computador', t: 'computador' },
    { v: 'fora',       t: 'fora' }
  ];

  var CLIMAS = [
    { v: 'firme',             t: 'só com tempo firme' },
    { v: 'tolera_chuva_fina', t: 'tolera chuva fina' },
    { v: 'indiferente',       t: 'chuva não atrapalha' }
  ];

  var ESFORCOS = [
    { v: 'leve',   t: 'leve' },
    { v: 'pesado', t: 'pesado' }
  ];
  // importância da avulsa (§41): só desempate entre iguais, nunca ordenação principal
  var PESOS = [
    { v: 1, t: 'baixa' },
    { v: 2, t: 'normal' },
    { v: 3, t: 'alta' }
  ];

  /* Estado e papel eram dois controles que se contradiziam — dava para marcar
     "titular" e "fila" ao mesmo tempo. Viraram um só; os dois campos por baixo
     continuam, porque o motor de elegibilidade lê cada um por um motivo. */
  var SITUACOES = [
    // MUDA (§37): a semente lapidada, esperando vaga. Antes chamava pré-projeto.
    { v: 'fila',         t: 'muda',               estado: 'fila',      papel: '' },
    { v: 'descartada',   t: 'muda descartada',    estado: 'descartado', papel: '' },
    { v: 'planejamento', t: 'em planejamento',    estado: 'preparo',   papel: 'planejamento' },
    /* PLANEJADA: o plano está pronto e o projeto espera vaga. Sem este estado,
       um projeto planejado e sem dinheiro ficava ocupando a única vaga de
       planejamento para sempre, e não dava para planejar o próximo. Aqui cabem
       vários — e é por isso que a promoção daqui para cima volta a ser escolha:
       a escolha é a recompensa de ter concluído a anterior. */
    { v: 'planejada',    t: 'planejada',          estado: 'preparo',   papel: '' },
    { v: 'titular',      t: 'titular',            estado: 'ativo',     papel: 'titular' },
    { v: 'reserva',      t: 'reserva',            estado: 'ativo',     papel: 'reserva' },
    // rótulo e valor divergem de propósito: 'suspenso' e 'cancelado' dizem
    // melhor o que aconteceu, e trocar o valor por baixo quebraria os arquivos
    // já exportados sem ganho nenhum
    { v: 'parado',       t: 'suspenso',           estado: 'parado',    papel: '' },
    { v: 'concluido',    t: 'concluído',          estado: 'concluido', papel: '' },
    { v: 'encerrado',    t: 'cancelado',          estado: 'encerrado', papel: '' }
  ];

  var VAGA_UNICA = ['titular', 'reserva', 'planejamento'];

  /* QUANDO — cinco campos que respondem DUAS perguntas diferentes:
       precisa acontecer  → prazo e recorrência, definem a faixa de prioridade
       é possível acontecer → horário, dia e meses, definem elegibilidade
     Juntar tudo num controle só transformaria a tarefa em compromisso de
     agenda, e a §1 recusa ser agenda. O aparelho já sabe que horas são, então
     nada disso vira pergunta na consulta — e não fere a §21, que proíbe
     automatizar o clima porque informar o tempo é escolha consciente. Que
     horas são não tem escolha dentro. */
  var HORARIOS = [
    { v: 'qualquer',      t: 'qualquer' },
    { v: 'dia',           t: 'dia',   de: '06:00', ate: '18:00' },
    { v: 'noite',         t: 'noite', de: '18:00', ate: '23:59' },
    { v: 'personalizado', t: 'personalizado' }
  ];

  var DIAS_SEMANA = [
    { v: 'qualquer',      t: 'qualquer',      dias: [0, 1, 2, 3, 4, 5, 6] },
    { v: 'util',          t: 'dia útil',      dias: [1, 2, 3, 4, 5] },
    { v: 'fds',           t: 'fim de semana', dias: [0, 6] },
    { v: 'personalizado', t: 'personalizado' }
  ];

  var NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                   'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  var TODOS_MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  function quandoPadrao() {
    return {
      horario: 'qualquer', de: '06:00', ate: '18:00',
      dias: 'qualquer', diasEscolhidos: [1, 2, 3, 4, 5],
      meses: TODOS_MESES.slice()
    };
  }

  /* A tarefa é de planejamento ou de execução. A divisão é do PROJETO — ele
     contém os dois tipos —, e execução não é oferecida enquanto houver
     planejamento aberto. */
  var ETAPAS = [
    { v: 'planejamento', t: 'planejamento' },
    { v: 'execucao',     t: 'execução' }
  ];

  // dias de folga em que a pendência já pede atenção antes de vencer
  var BEIRA_DO_PRAZO = 2;

  /* Quanto tempo o "não quero" cala o app. A §9 dizia "encerra o dia", e o
     custo é mesmo o mecanismo — sem ele, recusar traria a próxima, e a próxima
     é sempre mais nova e mais interessante que a obra pela metade. Mas o dia
     como unidade era injusto nas pontas: recusar às 23h custava uma hora e às
     8h custava o dia inteiro. Três horas ainda impedem percorrer — não dá para
     ver três tarefas numa tarde — e não fazem um orçamento recusado à noite
     cobrar a manhã seguinte. */
  var JANELA_RECUSA_H = 3;

  // ── estado ────────────────────────────────────────────────────────

  var estado = vazio();

  function vazio() {
    return {
      versao: VERSAO,
      /* Anotação sobre o PRÓPRIO APP, não sobre o sítio. Não é catálogo nem
         diário — é recado para a próxima conversa, escrito no instante em que
         a coisa incomoda, que é quando ela é lembrada com precisão. */
      bilhete: '',
      catalogo: {
        pessoas: [{ id: 'pe_eu', nome: 'Eu', perfil: 'proprietario' }],
        projetos: [],
        tarefas: [],
        // tudo que depende de terceiro e tem data prevista
        pendencias: [],
        // absorveram a caixa de entrada: o que entra pelo ( + ) já nasce semente
        sementes: [],
        // ids de sementes que nasceram como evento e a mesa já trouxe para cá
        absorvidas: [],
        // o que foi APAGADO de propósito: { id, em }. Sem isto, o merge item a
        // item (§47) ressuscitaria tudo que um aparelho apagou e o outro ainda tinha
        apagados: [],
        // sobe a cada gravação que muda o catálogo: é o que impede um aparelho
        // com catálogo velho de escrever por cima do novo (§38)
        versao: 0
      },
      diarios: { pe_eu: { pessoa: 'pe_eu', eventos: [] } }
    };
  }

  function id(prefixo) {
    return prefixo + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function agora() { return new Date().toISOString(); }

  /* O instante fica em ISO (UTC) para ordenar; o DIA é sempre o do relógio da
     parede. Cortar o ISO em dez letras dava a data de Londres: aqui, das nove
     da noite em diante o app achava que já era amanhã — clima gravado no dia
     errado, pegada com data errada, periódico reiniciando um dia depois. */
  function diaLocal(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function diaDe(iso) { return diaLocal(new Date(iso)); }
  function hoje()  { return diaLocal(new Date()); }

  // ── persistência ──────────────────────────────────────────────────

  function carregar() {
    try {
      var cru = localStorage.getItem(CHAVE);
      if (cru) { estado = costurar(JSON.parse(cru)); ultimoCru = cru; }
    } catch (e) {
      console.warn('Não consegui ler o guardado. Começando vazio.', e);
    }
    ultimoCatalogo = JSON.stringify(estado.catalogo);
    carregarKit();
    derivar();
    converterTarefasDeCompra();
    return estado;
  }

  /* MIGRAÇÃO (§56): tarefa de compra ABERTA vira itens em falta — um por linha
     da lista, vinculados à primeira tarefa que dependia dela — e a tarefa sai,
     com lápide. Ids determinísticos: os dois aparelhos convertem igual e o
     merge não duplica. Compra já feita fica como está: é registro. */
  function converterTarefasDeCompra() {
    var compras = cat().tarefas.filter(function (t) {
      return t.compra && estadoDe(t.id) === 'aberta';
    });
    if (!compras.length) return;
    compras.forEach(function (t) {
      var dependente = tarefasVivas().filter(function (o) {
        return (o.dependeDe || []).indexOf(t.id) !== -1 && estadoDe(o.id) === 'aberta';
      })[0] || null;
      var itens = (t.compras || []).length ? t.compras : [t.texto || 'compra'];
      itens.forEach(function (item, i) {
        var xid = 'x_' + t.id + '_' + i;
        if (achar(cat().pendencias, xid)) return;
        var x = novoItem(item, t.compra === 'internet' ? 'internet' : 'rua');
        x.id = xid;
        x.tarefaId = dependente ? dependente.id : null;
        x.projetoId = t.projetoId || null;
        cat().pendencias.push(x);
      });
      lapide(t.id);
      cat().tarefas = cat().tarefas.filter(function (o) { return o.id !== t.id; });
      cat().tarefas.forEach(function (o) {
        o.dependeDe = (o.dependeDe || []).filter(function (d) { return d !== t.id; });
      });
    });
    salvar();
  }

  /* Gravar o catálogo refaz a vista: uma tarefa recém-criada precisa existir
     para o motor com o restante certo antes de qualquer evento — senão ela
     entrava no páreo com restante zero e "cabia" em qualquer janela. */
  var aoSalvar = null;      // quem quer saber que algo foi gravado (a sincronização)
  var silencio = false;     // gravação vinda de fora não avisa de volta
  var ultimoCatalogo = '';  // o catálogo como foi gravado da última vez, para saber se mudou
  var ultimoCru = null;     // a string gravada por ESTA aba, para reconhecer gravação de outra

  function salvar() {
    // catálogo mudou por mão local: sobe a versão (gravação vinda de fora chega com a dela)
    var agoraCat = JSON.stringify(estado.catalogo);
    if (!silencio && ultimoCatalogo && agoraCat !== ultimoCatalogo) {
      estado.catalogo.versao = (Number(estado.catalogo.versao) || 0) + 1;
    }
    ultimoCatalogo = JSON.stringify(estado.catalogo);
    try {
      ultimoCru = JSON.stringify(estado);
      localStorage.setItem(CHAVE, ultimoCru);
    } catch (e) {
      console.warn('Não consegui gravar. Use exportar como paraquedas.', e);
    }
    derivar();
    if (aoSalvar && !silencio) aoSalvar();
  }

  /* Outra aba da mesma origem gravou (evento `storage`): esta relê, em vez de
     ficar com a memória velha e gravar por cima na próxima tecla. Devolve se
     mudou algo — quem chamou redesenha. */
  function relerSeOutraAbaGravou() {
    var cru = null;
    try { cru = localStorage.getItem(CHAVE); } catch (e) { return false; }
    if (!cru || cru === ultimoCru) return false;
    try { estado = costurar(JSON.parse(cru)); } catch (e) { return false; }
    ultimoCru = cru;
    ultimoCatalogo = JSON.stringify(estado.catalogo);
    carregarKit();
    derivar();
    return true;
  }

  function quandoSalvar(fn) { aoSalvar = fn; }

  // ── sincronização: o que o modelo oferece ao Sync ────────────────

  /* O CATÁLOGO DE FORA SE JUNTA AO DAQUI, ITEM A ITEM (§47) — nunca substitui.
     Três tarefas cadastradas com a nuvem desligada sumiram quando ela religou,
     porque o catálogo inteiro era trocado pelo de lá. Agora:
       - item que só existe de um lado fica (salvo lápide: apagado de propósito);
       - item que existe dos dois lados: vence o de `ultimoToque` mais recente;
       - listas de ids (absorvidas, apagados) são união; versão é o maior.
     Vale para quem é mesa e para quem não é. Devolve se mudou algo daqui. */
  var COLECOES_MERGE = ['projetos', 'tarefas', 'pendencias', 'sementes', 'pessoas'];
  function receberCatalogo(remoto) {
    var antes = JSON.stringify(estado.catalogo);
    var deLa = costurar({ catalogo: remoto }).catalogo;
    var meu = estado.catalogo;

    // lápides dos dois lados, a mais recente por id
    var lapides = {};
    (meu.apagados || []).concat(deLa.apagados || []).forEach(function (l) {
      if (!lapides[l.id] || lapides[l.id] < l.em) lapides[l.id] = l.em;
    });
    function apagadoDepois(item) {
      var em = lapides[item.id];
      return !!em && em >= (item.ultimoToque || item.criadoEm || item.criadaEm || item.desde || '');
    }

    COLECOES_MERGE.forEach(function (k) {
      var porId = {};
      (meu[k] || []).forEach(function (x) { porId[x.id] = x; });
      (deLa[k] || []).forEach(function (x) {
        var aqui = porId[x.id];
        if (!aqui) { porId[x.id] = x; return; }
        var tAqui = aqui.ultimoToque || '', tLa = x.ultimoToque || '';
        if (tLa > tAqui) porId[x.id] = x;      // o de lá é mais novo
      });
      // ordem: a daqui primeiro, depois o que só veio de lá — e fora o que foi apagado
      var ordem = (meu[k] || []).map(function (x) { return x.id; });
      (deLa[k] || []).forEach(function (x) { if (ordem.indexOf(x.id) === -1) ordem.push(x.id); });
      meu[k] = ordem.map(function (id) { return porId[id]; }).filter(function (x) { return x && !apagadoDepois(x); });
    });

    var uni = {};
    (meu.absorvidas || []).concat(deLa.absorvidas || []).forEach(function (id) { uni[id] = true; });
    meu.absorvidas = Object.keys(uni);
    meu.apagados = Object.keys(lapides).map(function (id) { return { id: id, em: lapides[id] }; });
    meu.versao = Math.max(Number(meu.versao) || 0, Number(deLa.versao) || 0);

    if (JSON.stringify(meu) === antes) return false;
    silencio = true; salvar(); silencio = false;
    return true;
  }

  // a foto do catálogo antes da última sincronização que mudou algo: a rede de segurança
  var CHAVE_FOTO = 'app-sitio-v3-antes-da-nuvem';
  function fotografarCatalogo() {
    try { localStorage.setItem(CHAVE_FOTO, JSON.stringify({ em: agora(), catalogo: estado.catalogo })); } catch (e) {}
  }
  function fotoDoCatalogo() {
    try { return JSON.parse(localStorage.getItem(CHAVE_FOTO)); } catch (e) { return null; }
  }
  /* Voltar à foto não substitui: JUNTA a foto ao que está — assim o que veio
     depois não se perde, e o que a foto tinha volta. */
  function voltarAFoto() {
    var f = fotoDoCatalogo();
    if (!f || !f.catalogo) return false;
    var mudou = receberCatalogo(f.catalogo);
    // o que voltou precisa subir: marca o catálogo como mais novo
    estado.catalogo.versao = (Number(estado.catalogo.versao) || 0) + 1;
    salvar();
    return mudou;
  }

  // catálogo sem projeto, tarefa nem semente: nunca deve escrever por cima de um cheio
  function catalogoVazio(c) {
    c = c || estado.catalogo;
    return !(c.projetos || []).length && !(c.tarefas || []).length && !(c.sementes || []).length;
  }
  function versaoDoCatalogo(c) { return Number((c || estado.catalogo).versao) || 0; }

  /* União por id: entra o que ainda não tinha, nada sai. Devolve quantos
     entraram aqui e quantos daqui faltam lá — quem chamou decide subir. */
  function unirDiario(quem, eventosDeLa) {
    var d = diarioDe(quem);
    var tenho = {};
    d.eventos.forEach(function (ev) { tenho[ev.id] = true; });
    var la = {};
    var entraram = 0;
    (eventosDeLa || []).forEach(function (ev) {
      if (!ev || !ev.id) return;
      la[ev.id] = true;
      if (!tenho[ev.id]) { d.eventos.push(ev); tenho[ev.id] = true; entraram++; }
    });
    var faltamLa = d.eventos.filter(function (ev) { return !la[ev.id]; }).length;
    if (entraram) {
      d.eventos.sort(function (a, b) { return a.quando < b.quando ? -1 : 1; });
      silencio = true; salvar(); silencio = false;
    }
    return { entraram: entraram, faltamLa: faltamLa };
  }

  /* Semente plantada é EVENTO no diário de quem plantou — bota, esposa, mesa.
     Assim a bota nunca escreve no catálogo, e o diário dela viaja como sempre. */
  /* Quem é quem, pelo nome — na semente e onde mais aparecer. Uma pessoa é
     `pe_<x>` no diário e `autor` curto na semente; os dois caem aqui. */
  var NOMES = { pe_eu: 'Dan', eu: 'Dan', pe_esposa: 'Márcia', esposa: 'Márcia', pe_diarista: 'Diarista' };
  var DIARISTA = 'pe_diarista';
  function nomeDe(pessoaOuAutor) { return NOMES[pessoaOuAutor] || pessoaOuAutor || ''; }

  function semear(quem, texto) {
    var s = novaSemente(texto);
    s.autor = quem === 'pe_eu' ? 'eu' : 'esposa';
    registrar(quem, 'semeou', { semente: s });
    return s;
  }

  /* A mesa traz para o catálogo o que nasceu como evento, uma vez só. Depois
     disso a semente é do catálogo — editar, promover e descartar valem. */
  function absorverSementes() {
    var vistas = {};
    cat().sementes.forEach(function (s) { vistas[s.id] = true; });
    (cat().absorvidas || []).forEach(function (id) { vistas[id] = true; });
    var novas = 0;
    eventosEmOrdem().forEach(function (ev) {
      if (ev.tipo !== 'semeou' || !ev.semente || vistas[ev.semente.id]) return;
      cat().sementes.push(costurarSemente(JSON.parse(JSON.stringify(ev.semente))));
      cat().absorvidas.push(ev.semente.id);
      vistas[ev.semente.id] = true;
      novas++;
    });
    if (novas) salvar();
    return novas;
  }

  // sementes de evento ainda não absorvidas: para a tela da esposa listar as dela
  function sementesDe(quem) {
    return (diarioDe(quem).eventos || [])
      .filter(function (ev) { return ev.tipo === 'semeou' && ev.semente; })
      .map(function (ev) { return ev.semente; });
  }

  /* Preenche o que faltar num JSON vindo de fora ou de uma versão anterior,
     para o resto do código nunca precisar checar existência de campo. */
  function costurar(cru) {
    var base = vazio();
    if (!cru || typeof cru !== 'object') return base;

    var cat = cru.catalogo || {};
    Object.keys(base.catalogo).forEach(function (k) {
      if (Array.isArray(cat[k])) base.catalogo[k] = cat[k];
    });
    base.catalogo.versao = Number(cat.versao) || 0;
    if (!base.catalogo.pessoas.length) base.catalogo.pessoas = vazio().catalogo.pessoas;

    // arquivos anteriores à fusão traziam uma caixa de entrada separada
    if (Array.isArray(cat.entrada)) {
      cat.entrada.forEach(function (item) {
        var s = novaSemente(item.texto || '');
        s.autor = item.autor || 'eu';
        base.catalogo.sementes.push(s);
      });
    }

    if (typeof cru.bilhete === 'string') base.bilhete = cru.bilhete;
    if (cru.diarios && typeof cru.diarios === 'object') base.diarios = cru.diarios;
    base.catalogo.pessoas.forEach(function (p) {
      if (!base.diarios[p.id]) base.diarios[p.id] = { pessoa: p.id, eventos: [] };
    });

    base.catalogo.tarefas.forEach(costurarTarefa);
    base.catalogo.projetos.forEach(costurarProjeto);
    base.catalogo.sementes.forEach(costurarSemente);
    base.catalogo.pendencias.forEach(costurarPendencia);
    return base;
  }

  function completar(obj, padrao) {
    Object.keys(padrao).forEach(function (k) {
      if (obj[k] === undefined) obj[k] = padrao[k];
    });
    return obj;
  }

  function costurarTarefa(t) {
    // a pergunta virou "pode no calor?" (era "não no calor"); arquivos do meio-dia de 19/08
    if (t.evitaCalor !== undefined) { if (t.podeNoCalor === undefined) t.podeNoCalor = !t.evitaCalor; delete t.evitaCalor; }
    // zona + ponto diziam a mesma coisa e viraram um campo só
    if (t.zona || t.ponto) {
      t.onde = t.onde || [t.zona, t.ponto].filter(Boolean).join(' · ');
      delete t.zona; delete t.ponto;
    }
    // ferramenta e material viraram lista
    t.ferramentas = comoLista(t.ferramentas);
    t.materiais = comoLista(t.materiais);
    t.compras = comoLista(t.compras);

    // janelaHora + janela.meses viraram o bloco `quando`
    if (!t.quando) {
      var q = quandoPadrao();
      if (t.janelaHora) {
        q.horario = 'personalizado';
        q.de = t.janelaHora.de || q.de;
        q.ate = t.janelaHora.ate || q.ate;
        if (t.janelaHora.apenasDiasUteis) q.dias = 'util';
        if (t.janelaHora.preset === 'dia_util') { q.horario = 'qualquer'; q.dias = 'util'; }
      }
      if (t.janela && t.janela.meses && t.janela.meses.length) q.meses = t.janela.meses;
      t.quando = q;
    }
    delete t.janelaHora; delete t.janela; delete t.coleta;

    /* "antecipável" era sim/não, e sim significava "a qualquer momento" — a
       rotina feita ontem já voltava pela segunda porta. Virou um limite em
       dias: pode adiantar até N dias antes de vencer. Quem era sim ganha
       metade da cadência; quem era não, zero. */
    if (t.prazo && t.prazo.tipo === 'periodico' && t.prazo.antecipavelDias === undefined) {
      t.prazo.antecipavelDias = t.prazo.antecipavel ? Math.floor((t.prazo.cadenciaDias || 30) / 2) : 0;
    }
    if (t.prazo) delete t.prazo.antecipavel;

    return completar(t, novaTarefa(t.projetoId || null, t.ordem || 0));
  }

  function comoLista(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string' && v.trim()) {
      return v.split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return [];
  }
  function costurarProjeto(p)  {
    completar(p, novoProjeto());
    p.muda = completar(p.muda || {}, novaMuda());
    p.muda.despesas = completar(p.muda.despesas || {}, novaMuda().despesas);
    return p;
  }
  function costurarSemente(s)  { return completar(s, novaSemente('')); }
  function costurarPendencia(x) { return completar(x, novaPendencia('')); }

  // ── fábricas ──────────────────────────────────────────────────────

  function novoProjeto() {
    return {
      id: id('p'),
      nome: '',
      // O nome é a obra e serve para trabalhar; o resultado é o destino e é o
      // que a frente de campo mostra. Porta trancada só puxa se atrás dela
      // houver um fim pretendido, não um serviço.
      resultado: '',
      ganhos: [],
      estado: 'fila',
      papel: '',
      origem: 'avulso',
      natureza: 'perecivel',
      prerequisitos: [],
      ordemFila: 0,
      contratavel: false,
      custoEstimado: null,   // null = ainda não orçado
      guardado: 0,
      muda: novaMuda(),
      tags: [],              // assuntos (§44)
      criadoEm: agora(),
      ultimoToque: agora()
    };
  }

  /* A MUDA (§37) — o trabalho do projeto enquanto espera vaga: lapidar a
     ideia até dar para decidir se toca ou muda o rumo. É teste de MOTIVAÇÃO,
     não de viabilidade: como e quando são planejamento. Vantagens e
     desvantagens são CADEIAS — cada linha é uma razão puxada até esgotar
     ("e isso, para quê?" / "e isso causa o quê?"). As despesas daqui são
     estimativa de decisão e NUNCA viram envelope (§36). Todo dado fica no
     projeto para sempre, inclusive depois de virar obra. */
  function novaMuda() {
    return {
      estado: 'plantando',        // plantando (em edição) · pronta · descartada
      vantagens: [],              // [[elo, elo, ...], ...]
      desvantagens: [],
      despesas: { inicial: null, fixaMensal: null, geraProduto: null, produto: '', retornoMensal: null },
      sentimento: '',
      inviabiliza: '',
      motivo: '',                 // do descarte
      prontaEm: null,
      descartadaEm: null
    };
  }

  function novaTarefa(projetoId, ordem) {
    return {
      id: id('t'),
      texto: '',
      projetoId: projetoId || null,
      ordem: ordem || 0,

      duracaoTotal: 60,
      restanteEstimado: 60,
      podeParar: true,
      blocoMinimo: null,     // null = derivado da duração

      exigeClima: 'indiferente',
      podeNoCalor: true,     // "não" some nos dias em que a consulta diz "calor" (§41)
      guardadaParaChuva: false,
      exigeSoloFirme: false,
      // só avulsa (§41): custo por cima e o que já está separado — enquanto
      // faltar, ela não entra no páreo ("juntando dinheiro")
      custo: null,
      guardado: 0,
      peso: 2,               // 1 baixa · 2 normal · 3 alta — desempate

      /* O PASSO-COMPRA (§57): tipo 'compra' aparece na lista do projeto como
         um passo — ordenável, com dependência —, mas não é tarefa: o motor
         nunca o oferece e ninguém o conclui. Ele se resolve pelos ITENS (§56):
         vazio tranca quem depende; com tudo comprado/chegado, vira feito
         sozinho. (compra/compras abaixo são o resto morto da §52.) */
      tipo: '',              // '' (tarefa) | 'compra'
      compra: '',
      compras: [],

      ondePrecisaEstar: 'sitio',
      onde: '',              // texto livre; era zona + ponto, que diziam o mesmo

      precisaAjuda: false,
      boaComCriancas: false,
      perigosaComCriancas: false,

      esforco: 'leve',

      // listas de texto puro, não referências: não existe almoxarifado
      ferramentas: [],
      materiais: [],

      etapa: 'execucao',

      // precisa acontecer
      prazo: null,   // null | {tipo:'data', em} | {tipo:'periodico', cadenciaDias, ultimaVez}
      // é possível acontecer
      quando: quandoPadrao(),

      agendada: null,
      disparadaPor: null,
      // separada para o diarista (§39): { para, dia, ordem } — sai do páreo dele
      separada: null,
      rua: 0,                // ordem na folha da rua (§43) — a rota dele
      tags: [],              // assuntos (§44): só cadastro por ora; análise vem depois
      dependeDe: [],

      // sem atribuição = do proprietário. Ninguém novo enxerga por acidente.
      atribuidaA: null,

      impedimento: null,
      estado: 'aberta',
      recado: '',
      criadaEm: agora(),
      ultimoToque: agora()
    };
  }

  /* O ITEM (§56): compra não é tarefa — é o que falta para uma tarefa
     acontecer. A pendência ganhou o estado anterior à espera:
       fase 'falta'     — sei que preciso, ainda não comprei (sem data);
       fase 'esperando' — comprei/encomendei, tem data prevista.
     `via` diz por onde se compra: rua (a folha da rua lista) ou internet.
     Espera que não é compra (terceiro, processo) segue fase 'esperando'. */
  function novaPendencia(descricao) {
    return {
      id: id('x'),
      descricao: descricao || '',
      projetoId: null,
      tarefaId: null,          // a tarefa que ela destrava quando chegar
      fase: 'esperando',       // 'falta' | 'esperando'
      via: '',                 // '' | 'rua' | 'internet' (só interessa em falta)
      desde: hoje(),
      previsto: hoje(),
      resolvida: null          // null | 'chegou' | 'cancelada'
    };
  }

  function novoItem(descricao, via) {
    var x = novaPendencia(descricao);
    x.fase = 'falta';
    x.via = via || 'rua';
    return x;
  }

  /* O ditado do teclado não devolve pontuação, então o nome não pode confiar
     no ponto final: corta na última palavra inteira que couber. */
  function apelido(bruto, limite) {
    var frase = bruto.split(/[.\n]/)[0].trim();
    if (frase.length <= limite) return frase;
    var corte = frase.slice(0, limite);
    var espaco = corte.lastIndexOf(' ');
    return (espaco > limite * 0.5 ? corte.slice(0, espaco) : corte) + '…';
  }

  /* Busca por palavra em tudo que existe — projetos, tarefas, sementes. Serve
     ao "já existe?" da Sementeira: a pergunta é respondida no momento em que a
     ideia nasce, não numa tela à parte. Sem acento e sem caixa; palavras curtas
     não contam (a, de, para) porque casam com tudo. Termo pode ser uma frase
     inteira ditada: basta uma palavra dela bater. */
  function chao(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  /* TAGS (§44) — assuntos para a análise de depois. Só cadastro por ora.
     Uma grafia por assunto: "Sítio", "sitio" e "sítio" são a mesma tag — a
     primeira grafia que ele usou é a que fica. */
  function todasAsTags() {
    var vistas = {}, lista = [];
    function junta(t) { (t || []).forEach(function (x) { var k = chao(x); if (!vistas[k]) { vistas[k] = true; lista.push(x); } }); }
    cat().projetos.forEach(function (p) { junta(p.tags); });
    cat().tarefas.forEach(function (t) { junta(t.tags); });
    return lista.sort(function (a, b) { return chao(a) < chao(b) ? -1 : 1; });
  }
  function normalizarTag(texto) {
    var limpo = String(texto || '').trim().replace(/^#/, '').replace(/\s+/g, ' ');
    if (!limpo) return '';
    var k = chao(limpo);
    var existente = todasAsTags().filter(function (x) { return chao(x) === k; })[0];
    return existente || limpo;
  }
  function porTag(obj, texto) {
    var tag = normalizarTag(texto);
    if (!tag || !obj) return null;
    obj.tags = obj.tags || [];
    if (obj.tags.some(function (x) { return chao(x) === chao(tag); })) return tag;
    obj.tags.push(tag);
    obj.ultimoToque = agora();
    salvar();
    return tag;
  }
  function tirarTag(obj, tag) {
    if (!obj || !obj.tags) return;
    obj.tags = obj.tags.filter(function (x) { return chao(x) !== chao(tag); });
    obj.ultimoToque = agora();
    salvar();
  }

  // palavras que aparecem em qualquer frase e não dizem do que se trata
  var VAZIAS = ('para como mais coisa coisas fazer feito ficar deixar colocar botar novo nova novos novas ' +
    'perto longe aqui onde quando depois antes ainda entao talvez porque sobre entre tudo nada algo ' +
    'isso esse essa aquele aquela gente dele dela deles delas pode poder podia quero queria seria ' +
    'estar esta muito pouco bem melhor pior grande pequeno todo toda todos todas outro outra ' +
    'casa sitio lado parte vezes ideia').split(' ');
  function buscar(termo) {
    var palavras = chao(termo).split(/[^a-z0-9]+/).filter(function (w) {
      return w.length >= 4 && VAZIAS.indexOf(w) === -1;
    });
    var vazio = { projetos: [], tarefas: [], sementes: [] };
    if (!palavras.length) return vazio;
    function bate(campos) {
      var texto = chao(campos.join(' '));
      return palavras.some(function (w) { return texto.indexOf(w) !== -1; });
    }
    return {
      projetos: cat().projetos.filter(function (p) { return bate([p.nome, p.resultado]); }),
      tarefas:  tarefasVivas().filter(function (t) { return bate([t.texto]); }),
      sementes: cat().sementes.filter(function (s) { return bate([s.nome, s.frase]); })
    };
  }

  /* A semente nunca é apagada: ela muda de ESTADO, e o estado é o registro —
     de como o app foi usado e do que aconteceu com cada ideia dela.
       nova            — como nasce, de quem quer que tenha plantado
       descartada      — com motivo obrigatório: quem plantou tem que poder ler
       projeto/tarefa  — aprovada: pode virar pré-projeto / tarefa avulsa
       futuro          — aprovada mas não para agora (§51): "plantar futuramente"
       virou_projeto / virou_tarefa — terminais, com o id do que nasceu dela */
  var ESTADOS_SEMENTE = ['nova', 'descartada', 'projeto', 'tarefa', 'futuro', 'virou_projeto', 'virou_tarefa'];

  function novaSemente(texto) {
    var bruto = (texto || '').trim();
    return {
      id: id('s'),
      nome: apelido(bruto, 60),
      frase: bruto,
      porque: '',
      autor: 'eu',
      estado: 'nova',
      motivo: '',          // do descarte
      virouId: null,       // projeto ou tarefa que nasceu dela
      classificadaEm: null,
      criadaEm: agora(), ultimoToque: agora()
    };
  }

  // ── acesso ────────────────────────────────────────────────────────

  function cat()  { return estado.catalogo; }
  function tudo() { return estado; }

  function lerBilhete() { return estado.bilhete || ''; }

  function escreverBilhete(texto) {
    estado.bilhete = texto;
    salvar();
  }

  /* Nunca é considerado mudança na importação: é recado do usuário, não dado
     que eu possa sobrescrever com uma proposta minha. */
  function estaVazio() {
    return !cat().projetos.length && !cat().tarefas.length && !cat().sementes.length;
  }

  function achar(lista, alvo) {
    return lista.filter(function (x) { return x.id === alvo; })[0] || null;
  }

  function projeto(pid)  { return achar(cat().projetos, pid); }
  function tarefa(tid)   { return achar(tarefasVivas(), tid); }
  function pendencia(xid) { return achar(cat().pendencias, xid); }

  function passosDe(pid) {
    return tarefasVivas()
      .filter(function (t) { return t.projetoId === pid; })
      .sort(function (a, b) { return a.ordem - b.ordem; });
  }

  function avulsas() {
    return tarefasVivas()
      .filter(function (t) { return !t.projetoId; })
      .sort(function (a, b) { return a.ordem - b.ordem; });
  }

  // ── derivações ────────────────────────────────────────────────────

  /* O que se lê na coluna. Titular, reserva e planejamento são escolhidos;
     planejada e pronta CAEM SOZINHAS conforme o planejamento fecha e o envelope
     enche. Dinheiro só existe depois de planejar (§36): na fila todo projeto é
     pré-projeto, sem custo — orçar é trabalho da vaga de planejamento. */
  function etiquetaDe(p) {
    if (p.papel === 'titular')      return { chave: 'titular', texto: 'titular' };
    if (p.papel === 'reserva')      return { chave: 'reserva', texto: 'reserva' };
    if (p.papel === 'planejamento') return { chave: 'planejamento', texto: 'em planejamento' };
    if (p.estado === 'preparo') {
      return aptaParaExecucao(p)
        ? { chave: 'pronto', texto: 'planejada · pronta' }
        : { chave: 'planejada', texto: 'planejada' };
    }
    if (p.estado === 'fila') {
      return p.muda.estado === 'pronta'
        ? { chave: 'pre', texto: 'muda · pronta' }
        : { chave: 'pre', texto: 'muda' };
    }
    if (p.estado === 'descartado') return { chave: 'descartada', texto: 'muda descartada' };
    var s = SITUACOES.filter(function (x) { return x.v === situacaoDe(p); })[0];
    return { chave: p.estado, texto: s ? s.t : p.estado };
  }

  function situacaoDe(p) {
    var achada = SITUACOES.filter(function (s) {
      return s.estado === p.estado && (s.papel || '') === (p.papel || '');
    })[0];
    return achada ? achada.v : p.estado;
  }

  /* Só um projeto por vaga: assumir titular tira o titular de quem o tinha,
     senão a regra dura da §7 perde o sentido. */
  function definirSituacao(pid, chave) {
    var p = projeto(pid);
    var s = SITUACOES.filter(function (x) { return x.v === chave; })[0];
    if (!p || !s) return;

    if (s.papel && VAGA_UNICA.indexOf(s.papel) !== -1) {
      cat().projetos.forEach(function (q) {
        if (q.id !== pid && q.papel === s.papel) { q.papel = ''; q.estado = 'fila'; }
      });
    }
    p.estado = s.estado;
    p.papel = s.papel;
    p.ultimoToque = agora();

    /* Entrar na vaga de planejamento com a folha em branco é onde tudo empaca.
       "Em branco" é não ter tarefa DE PLANEJAMENTO: um pré-projeto que já veio
       com a execução esboçada entrava sem esqueleto, contava como planejamento
       fechado e caía sozinho nas planejadas na abertura seguinte. */
    if (s.papel === 'planejamento' && !passosDe(pid).some(function (t) { return t.etapa === 'planejamento'; })) {
      semearPlanejamento(pid);
    }

    salvar();
  }

  /* Esqueleto de planejamento: as mesmas cinco tarefas servem para quase todo
     projeto. Apagar o que não serve é muito mais barato que criar do zero. */
  var COMERCIAL = { horario: 'personalizado', de: '08:00', ate: '18:00',
                    dias: 'util', diasEscolhidos: [1, 2, 3, 4, 5], meses: TODOS_MESES.slice() };

  var ESQUELETO = [
    { texto: 'Decidir como vai ser feito',
      ondePrecisaEstar: 'computador', duracaoTotal: 90 },
    { texto: 'Medir e levantar as quantidades',
      ondePrecisaEstar: 'sitio', duracaoTotal: 120, exigeClima: 'tolera_chuva_fina' },
    { texto: 'Conferir o que já tenho — ferramenta e material',
      ondePrecisaEstar: 'sitio', duracaoTotal: 45, exigeClima: 'tolera_chuva_fina' },
    { texto: 'Orçar o que falta',
      ondePrecisaEstar: 'computador', duracaoTotal: 60, quando: COMERCIAL }
    /* "Comprar o que falta" saiu (§56): comprar não é tarefa — o orçar produz
       os ITENS em falta, e eles se compram pela folha da rua ou encomendando. */
  ];

  function semearPlanejamento(pid) {
    var anterior = null;
    ESQUELETO.forEach(function (molde, i) {
      var t = novaTarefa(pid, i + 1);
      Object.keys(molde).forEach(function (k) {
        t[k] = (k === 'quando') ? JSON.parse(JSON.stringify(molde[k])) : molde[k];
      });
      t.etapa = 'planejamento';
      t.esforco = 'leve';
      t.restanteEstimado = t.duracaoTotal;
      if (anterior) t.dependeDe = [anterior];
      anterior = t.id;
      cat().tarefas.push(t);
    });
    salvar();
  }

  /* O envelope é gatilho de elegibilidade, não controle financeiro: dispara
     uma vez e depois o app para de olhar para dinheiro. */
  function envelopeCheio(p) {
    return p.custoEstimado !== null && p.custoEstimado !== undefined
        && Number(p.guardado) >= Number(p.custoEstimado);
  }

  function prerequisitosPendentes(p) {
    return (p.prerequisitos || [])
      .map(projeto)
      .filter(function (q) { return q && q.estado !== 'concluido'; });
  }

  /* A porta trancada: o próximo projeto e o que o segura, em texto seco.
     Projeto em planejamento ou executando não está trancado — está andando. */
  function motivoTrancado(p) {
    if (['ativo', 'preparo', 'concluido', 'encerrado', 'descartado'].indexOf(p.estado) !== -1) return null;

    // na fila só pré-requisito tranca: dinheiro é assunto de projeto planejado
    var faltando = prerequisitosPendentes(p);
    if (faltando.length) {
      return 'Espera ' + faltando.map(function (q) { return q.nome || 'projeto sem nome'; }).join(' e ') + '.';
    }
    return null;
  }

  /* Ordem é preferência; dependeDe é lei. O projeto apresenta um candidato só:
     o de menor ordem entre os que passam nos filtros estruturais. Os filtros
     de situação (clima, tempo, energia, horário) são da consulta. */
  function passoCorrente(pid) {
    return passosDe(pid).filter(desimpedida)[0] || null;
  }

  // ── vagas: a cascata ──────────────────────────────────────────────
  /* Só a entrada no planejamento é escolha, porque só ali existe mais de um
     candidato. Dali para cima o caminho é único — reserva sobe para titular,
     planejamento sobe para reserva — e perguntar seria teatro. */

  function projetoPorPapel(v) {
    return cat().projetos.filter(function (p) { return p.papel === v; })[0] || null;
  }

  /* Periódica nunca "fecha" — ela reinicia. Contá-la como aberta trancaria o
     concluir de qualquer projeto que tenha uma rotina dentro. Ativa conta. */
  function tarefasAbertasDe(pid, etapa) {
    return passosDe(pid).filter(function (t) {
      if (etapa && t.etapa !== etapa) return false;
      var e = estadoDe(t.id);
      if (e === 'ativa') return true;
      return e === 'aberta' && !periodica(t);
    });
  }

  function periodica(t) { return !!(t && t.prazo && t.prazo.tipo === 'periodico'); }

  /* Os dois portões do delta, juntos: "sei como e quanto custa" (planejamento
     fechado) e "tenho o dinheiro" (envelope cheio). Faltando um, a vaga de
     reserva fica aberta esperando — vaga vazia é informação, não falha. */
  /* Planejada e apta: plano fechado, dinheiro na mão, nada segurando. Estas são
     as candidatas — e entre elas o app não escolhe nem sugere, porque escolher
     é a recompensa de ter terminado a anterior. */
  function aptaParaExecucao(p) {
    if (!p || p.estado !== 'preparo' || p.papel) return false;
    if (prerequisitosPendentes(p).length) return false;
    return envelopeCheio(p);
  }

  function planejadas() {
    return cat().projetos.filter(function (p) {
      return p.estado === 'preparo' && !p.papel;
    }).sort(function (a, b) {
      var pa = aptaParaExecucao(a), pb = aptaParaExecucao(b);
      if (pa !== pb) return pa ? -1 : 1;                    // prontas primeiro
      if (pa) return a.ultimoToque < b.ultimoToque ? -1 : 1; // entre iguais, tanto faz
      return proporcaoGuardada(b) - proporcaoGuardada(a);    // 90% antes de 30%
    });
  }

  function proporcaoGuardada(p) {
    var meta = Number(p.custoEstimado) || 0;
    if (!meta) return -1;                 // sem orçamento é o mais longe de todos
    return Math.min(1, (Number(p.guardado) || 0) / meta);
  }

  function planejamentoFechado(p) {
    return !!p && !tarefasAbertasDe(p.id, 'planejamento').length;
  }

  function oQueFaltaParaSubir(p) {
    if (!p) return null;

    if (p.papel === 'planejamento') {
      var abertas = tarefasAbertasDe(p.id, 'planejamento').length;
      return abertas
        ? (abertas === 1 ? 'Falta 1 tarefa de planejamento.' : 'Faltam ' + abertas + ' tarefas de planejamento.')
        : 'Planejamento fechado.';
    }

    var presos = prerequisitosPendentes(p);
    if (presos.length) {
      return 'Espera ' + presos.map(function (q) { return q.nome || 'o pré-requisito'; }).join(' e ') + '.';
    }
    if (p.custoEstimado === null || p.custoEstimado === undefined) return 'Sem orçamento levantado.';
    if (!envelopeCheio(p)) return 'Faltam ' + moeda(p.custoEstimado - p.guardado) + '.';
    return 'Pronta para entrar.';
  }

  /* Só o que tem UM candidato é automático. Planejamento com as tarefas
     fechadas vira planejada e libera a vaga; reserva sobe para titular. Subir
     de planejada para reserva NÃO entra aqui: ali existem várias, e a escolha
     é sua — de propósito, guardada para o momento em que uma obra fecha. */
  /* A cascata é automática mas nunca calada: cada movimento entra numa fila de
     avisos que a tela drena e mostra. A fila vive só em memória — é aviso de
     agora, não registro. */
  var avisosCascata = [];

  function avisosDeCascata() {
    var lista = avisosCascata;
    avisosCascata = [];
    return lista;
  }

  function cascatearVagas() {
    var destino = {}, ordem = [];
    var mexeu = true;

    function mover(p, vaga, estado, rotulo) {
      p.papel = vaga;
      if (estado) p.estado = estado;
      p.ultimoToque = agora();
      if (!destino[p.id]) ordem.push(p);
      destino[p.id] = rotulo || vaga;
      mexeu = true;
    }

    while (mexeu) {
      mexeu = false;

      var pl = projetoPorPapel('planejamento');
      if (pl && planejamentoFechado(pl)) mover(pl, '', 'preparo', 'planejadas');

      var r = projetoPorPapel('reserva');
      if (!projetoPorPapel('titular') && r) mover(r, 'titular');
    }

    if (!ordem.length) return [];
    salvar();
    var movidos = ordem.map(function (p) { return { projeto: p, vaga: destino[p.id] }; });
    avisosCascata = avisosCascata.concat(movidos);
    return movidos;
  }

  /* A única promoção que é escolha, junto com a entrada no planejamento. */
  function promoverParaReserva(pid) {
    var p = projeto(pid);
    if (!aptaParaExecucao(p)) return [];
    p.papel = 'reserva';
    p.estado = 'ativo';
    p.ultimoToque = agora();
    salvar();
    var movidos = cascatearVagas();
    // pode ter subido direto a titular se a vaga estava vazia
    if (!movidos.length) {
      movidos = [{ projeto: p, vaga: 'reserva' }];
      avisosCascata = avisosCascata.concat(movidos);
    }
    return movidos;
  }

  /* Plano velho é plano suspeito: devolve à vaga de planejamento com uma tarefa
     só, e ele volta para planejadas quando ela fechar. */
  function revisarPlano(pid) {
    var p = projeto(pid);
    if (!p) return null;
    var ocupante = projetoPorPapel('planejamento');
    if (ocupante && ocupante.id !== pid) return { bloqueado: ocupante };

    p.papel = 'planejamento';
    p.estado = 'preparo';
    p.ultimoToque = agora();

    var t = novaTarefa(pid, 0);
    t.texto = 'Revisar o plano: preços, medidas e disponibilidade';
    t.etapa = 'planejamento';
    t.ondePrecisaEstar = 'computador';
    t.duracaoTotal = t.restanteEstimado = 60;
    t.ordem = passosDe(pid).length + 1;
    cat().tarefas.push(t);
    salvar();
    return { tarefa: t };
  }

  function diasDesde(iso) {
    if (!iso) return 0;
    var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    return Math.max(0, Math.round((new Date(hoje() + 'T00:00:00') - d) / 86400000));
  }

  /* Sair da vaga por qualquer porta abre lugar para quem está embaixo. Concluir
     pede relato, suspender e cancelar pedem motivo — toda parada tem razão
     registrada, e é isso que a revisão vai ler daqui a meses. */
  var DESFECHOS = {
    concluido: 'concluido',
    suspenso:  'parado',
    cancelado: 'encerrado'
  };

  function fecharProjeto(pid, tipo, texto) {
    var p = projeto(pid);
    if (!p || !DESFECHOS[tipo]) return [];
    // guarda de onde saiu: retomar devolve para lá, não para o começo da fila
    p.fecho = { tipo: tipo, em: hoje(), texto: texto || '', antes: p.estado };
    p.estado = DESFECHOS[tipo];
    p.papel = '';
    p.ultimoToque = agora();
    salvar();
    return cascatearVagas();
  }

  /* Desfazer tem que ser barato. Volta para onde estava — planejada continua
     planejada, obra em execução vira planejada (a vaga você dá de novo), e
     pré-projeto volta para a fila. Antes tudo caía na fila e o plano pronto
     virava pré-projeto de novo. */
  function retomarProjeto(pid) {
    var p = projeto(pid);
    if (!p) return;
    var antes = p.fecho && p.fecho.antes;
    p.estado = (antes === 'ativo' || antes === 'preparo') ? 'preparo' : 'fila';
    p.papel = '';
    p.fecho = null;
    p.ultimoToque = agora();
    salvar();
  }

  // a tarefa em andamento é vontade declarada: o projeto dela não sai da vaga
  function temTarefaAtiva(pid) {
    return passosDe(pid).some(function (t) { return estadoDe(t.id) === 'ativa'; });
  }

  function promoverParaPlanejamento(pid) {
    var p = projeto(pid);
    // só muda PRONTA entra em planejamento: plantando pela metade não vira obra
    if (p && p.estado === 'fila' && !mudaPronta(p)) return null;
    // as vantagens viram a motivação da obra, se ela ainda não tiver uma
    if (p && !(p.ganhos || []).length) {
      p.ganhos = cadeiasVivas(p.muda.vantagens).map(function (c) { return c.join(' → '); });
    }
    var anterior = projetoPorPapel('planejamento');
    definirSituacao(pid, 'planejamento');   // expulsa o ocupante e semeia o esqueleto
    return anterior && anterior.id !== pid ? anterior : null;
  }

  // ── muda: teto, portão, estados ───────────────────────────────────

  /* Cinco e só — prontas ou plantando; descartadas não contam. Mais que isso
     ninguém lapida de verdade: vira lista, e lista de projeto é onde ele se
     perde brincando de planejar. O teto é parede, como as vagas (§17). */
  var TETO_MUDAS = 5;
  function mudasVivas() { return cat().projetos.filter(function (p) { return p.estado === 'fila'; }); }
  function motivoTetoMudas() {
    return mudasVivas().length >= TETO_MUDAS
      ? 'Já há ' + TETO_MUDAS + ' mudas. Descarte ou promova uma antes de lapidar outra.'
      : null;
  }

  function cadeiasVivas(lista) {
    return (lista || []).filter(function (c) { return c.length && c[0]; });
  }

  /* Pronta exige TUDO (decisão dele): o que é, 2 vantagens, 2 desvantagens,
     as quatro despesas (0 vale; "não sei" vira estimativa por cima), o
     sentimento e o que inviabiliza. O que falta vem em texto, para a tela. */
  function faltaParaPronta(p) {
    var m = p.muda, d = m.despesas, falta = [];
    var v = cadeiasVivas(m.vantagens).length, dv = cadeiasVivas(m.desvantagens).length;
    if (!(p.nome || '').trim()) falta.push('o que é');
    if (v < 2) falta.push((2 - v) + (2 - v === 1 ? ' vantagem' : ' vantagens'));
    if (dv < 2) falta.push((2 - dv) + (2 - dv === 1 ? ' desvantagem' : ' desvantagens'));
    if (d.inicial === null || d.inicial === undefined) falta.push('o valor inicial');
    if (d.fixaMensal === null || d.fixaMensal === undefined) falta.push('o valor fixo mensal');
    if (d.geraProduto === null || d.geraProduto === undefined) falta.push('se gera produto ou serviço');
    if (d.geraProduto && !(d.produto || '').trim()) falta.push('qual produto ou serviço');
    if (d.retornoMensal === null || d.retornoMensal === undefined) falta.push('o retorno mensal');
    if (!(m.sentimento || '').trim()) falta.push('como você se sentiria');
    if (!(m.inviabiliza || '').trim()) falta.push('o que isso inviabiliza');
    return falta;
  }
  function mudaPronta(p) { return p.muda.estado === 'pronta'; }

  function marcarMudaPronta(pid) {
    var p = projeto(pid);
    if (!p || p.estado !== 'fila') return null;
    var falta = faltaParaPronta(p);
    if (falta.length) return falta;
    p.muda.estado = 'pronta'; p.muda.prontaEm = agora(); p.ultimoToque = agora();
    salvar();
    return [];
  }
  function voltarAPlantar(pid) {
    var p = projeto(pid);
    if (!p || p.estado !== 'fila') return;
    p.muda.estado = 'plantando'; p.muda.prontaEm = null; p.ultimoToque = agora();
    salvar();
  }
  /* Descartar guarda tudo: a muda vira registro, com o motivo. Fica na página
     de projetos, num grupo próprio, e não conta no teto. */
  function descartarMuda(pid, motivo) {
    var p = projeto(pid);
    motivo = (motivo || '').trim();
    if (!p || p.estado !== 'fila' || !motivo) return null;
    p.estado = 'descartado'; p.papel = '';
    p.muda.estado = 'descartada'; p.muda.motivo = motivo; p.muda.descartadaEm = agora();
    p.ultimoToque = agora();
    salvar();
    return p;
  }
  function reabrirMuda(pid) {
    var p = projeto(pid);
    if (!p || p.estado !== 'descartado') return null;
    if (motivoTetoMudas()) return null;
    p.estado = 'fila';
    p.muda.estado = 'plantando'; p.muda.motivo = ''; p.muda.descartadaEm = null;
    p.ultimoToque = agora();
    salvar();
    return p;
  }

  /* A leitura fria das despesas: os números ditos numa frase, sem opinião.
     "Custa R$ 6.000 para começar e R$ 150 por mês; devolve uns R$ 400 por mês —
     se paga em ~2 anos." */
  function leituraFria(p) {
    var d = p.muda.despesas;
    var temIni = d.inicial !== null && d.inicial !== undefined;
    var temFixa = d.fixaMensal !== null && d.fixaMensal !== undefined;
    var temRet = d.retornoMensal !== null && d.retornoMensal !== undefined;
    var ini = Number(d.inicial) || 0, fixa = Number(d.fixaMensal) || 0, ret = Number(d.retornoMensal) || 0;
    if (!temIni && !temFixa && !temRet) return '';
    var frase = '';
    if (temIni) frase = ini > 0 ? 'custa ' + moeda(ini) + ' para começar' : 'não custa nada para começar';
    if (temFixa && fixa > 0) frase += (frase ? ' e ' : 'custa ') + moeda(fixa) + ' por mês';
    if (temRet) {
      if (ret > 0) {
        frase += (frase ? '; ' : '') + 'devolve uns ' + moeda(ret) + ' por mês';
        var liquido = ret - fixa;
        if (liquido > 0 && ini > 0) {
          var meses = Math.ceil(ini / liquido);
          frase += ' — se paga em ' + (meses >= 24 ? '~' + Math.round(meses / 12) + ' anos'
            : meses >= 12 ? '~1 ano' : meses + (meses === 1 ? ' mês' : ' meses'));
        } else if (liquido <= 0 && fixa > 0) {
          frase += ' — não cobre o fixo';
        }
      } else {
        frase += (frase ? '; ' : '') + 'não devolve dinheiro';
      }
    }
    return frase ? frase.charAt(0).toUpperCase() + frase.slice(1) + '.' : '';
  }

  /* Filtros estruturais: valem em qualquer situação. Os de momento — clima,
     tempo, energia, horário — são do motor da consulta. */
  function desimpedida(t) {
    if (estadoDe(t.id) !== 'aberta') return false;

    // travou nela: espera o pensamento que você mesmo mandou fazer
    var trava = vistaDe(t.id).travadaPor;
    if (trava && estadoDe(trava) !== 'feita') return false;

    // espera algo chegar (§40): material na loja, resposta de terceiro
    if (esperasDe(t.id).length) return false;

    // avulsa juntando dinheiro (§41): sem o custo coberto, não entra
    if (juntandoDinheiro(t)) return false;

    /* Cancelada conta como resolvida: você decidiu que aquilo não vai
       acontecer, e segurar o que vem depois por causa de uma decisão sua já
       tomada é o app teimando contra você. */
    return !(t.dependeDe || []).some(function (dep) {
      return !resolvida(dep);
    });
  }

  function resolvida(tid) {
    var e = estadoDe(tid);
    return e === 'feita' || e === 'encerrada';
  }

  /* Por que esta tarefa não está disponível — sempre apontando para uma
     decisão sua, nunca para uma regra do app. */
  function juntandoDinheiro(t) {
    return !t.projetoId && Number(t.custo) > 0 && Number(t.guardado || 0) < Number(t.custo);
  }
  function faltaDinheiro(t) { return Math.max(0, Number(t.custo) - Number(t.guardado || 0)); }

  function porQueEspera(t) {
    if (juntandoDinheiro(t)) return 'juntando dinheiro — faltam ' + moeda(faltaDinheiro(t));
    var esp = esperasDe(t.id)[0];
    if (esp && esp.fase === 'falta') return 'falta comprar ' + esp.descricao;
    if (esp) return 'espera ' + esp.descricao + ' — ' + textoPendencia(esp).toLowerCase().replace(/\.$/, '');
    var trava = vistaDe(t.id).travadaPor;
    if (trava && estadoDe(trava) !== 'feita') {
      var p = tarefa(trava);
      return p ? p.texto : 'espera outra tarefa';
    }
    var dep = (t.dependeDe || []).filter(function (d) { return estadoDe(d) !== 'feita'; })[0];
    if (dep) {
      var a = tarefa(dep);
      return 'depois de ' + (a ? a.texto : 'outro passo') + ', que você pôs antes';
    }
    return null;
  }

  function blocoDe(t) {
    if (!t.podeParar) return restanteDe(t.id);
    return t.blocoMinimo || Math.max(15, Math.round(t.duracaoTotal / 4 / 5) * 5);
  }

  // ── quando ────────────────────────────────────────────────────────

  /* Resolve os atalhos para os números que o motor lê. Preset é conveniência
     de tela; o filtro nunca olha o nome do preset. */
  function janelaDe(t) {
    var q = t.quando || quandoPadrao();
    var h = HORARIOS.filter(function (x) { return x.v === q.horario; })[0] || HORARIOS[0];
    var d = DIAS_SEMANA.filter(function (x) { return x.v === q.dias; })[0] || DIAS_SEMANA[0];
    return {
      de:  q.horario === 'personalizado' ? (q.de || '00:00')  : (h.de  || '00:00'),
      ate: q.horario === 'personalizado' ? (q.ate || '23:59') : (h.ate || '23:59'),
      dias: q.dias === 'personalizado' ? (q.diasEscolhidos || []) : d.dias,
      meses: (q.meses && q.meses.length) ? q.meses : TODOS_MESES
    };
  }

  /* Prazo e possibilidade podem se contradizer, e descobrir isso três meses
     depois — quando a tarefa simplesmente nunca apareceu — é caríssimo.
     O app AVISA, nunca impede: a decisão continua sendo do usuário. */
  function avisosDe(t) {
    var avisos = [];
    var j = janelaDe(t);

    if (!j.dias.length) avisos.push('Nenhum dia da semana marcado: esta tarefa não pode ser oferecida nunca.');
    if (!j.meses.length) avisos.push('Nenhum mês marcado: esta tarefa não pode ser oferecida nunca.');

    if (j.meses.length < 12 && t.prazo && t.prazo.tipo === 'periodico') {
      var fora = 12 - j.meses.length;
      if (t.prazo.cadenciaDias < fora * 28) {
        avisos.push('A cada ' + t.prazo.cadenciaDias + ' dias, mas só em ' +
          j.meses.map(function (m) { return NOMES_MES[m - 1]; }).join(', ') +
          ' — vai ficar ' + fora + ' meses sem poder acontecer.');
      }
    }

    if (t.prazo && t.prazo.tipo === 'data' && t.prazo.em) {
      var d = new Date(t.prazo.em + 'T00:00:00');
      if (!isNaN(d)) {
        if (j.dias.indexOf(d.getDay()) === -1) {
          avisos.push(formatarData(t.prazo.em) + ' é ' + NOMES_DIA[d.getDay()] +
            ', que você deixou de fora dos dias possíveis.');
        }
        if (j.meses.indexOf(d.getMonth() + 1) === -1) {
          avisos.push(formatarData(t.prazo.em) + ' cai em ' + NOMES_MES[d.getMonth()] +
            ', que você deixou de fora dos meses possíveis.');
        }
      }
    }

    // as duas se contradizem: guardada para a chuva, mas não pode chuva nenhuma
    if (t.guardadaParaChuva && t.exigeClima === 'firme') {
      avisos.push('Guardada para a chuva, mas só com tempo firme: num dia de chuva ela não passa, ' +
        'e num dia seco fica guardada — escolha um dos dois.');
    }

    if (t.podeParar === false && t.duracaoTotal > 480) {
      avisos.push('Não pode parar e leva mais de 8 h: nenhuma janela de tempo vai comportar.');
    }

    /* Travamento silencioso: execução só é oferecida depois que o planejamento
       fecha, e o planejamento espera a execução. As duas ficam presas para
       sempre e nada na tela explica. */
    if (t.etapa === 'planejamento') {
      (t.dependeDe || []).forEach(function (d) {
        var dep = tarefa(d);
        if (dep && dep.etapa === 'execucao' && !resolvida(d)) {
          avisos.push('Depende de "' + dep.texto + '", que é de execução — e execução só é ' +
            'oferecida depois que o planejamento fecha. As duas ficam presas.');
        }
      });
    }
    return avisos;
  }

  function formatarData(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }

  /* Periódico reinicia do dia em que foi feito, não da data original.
     Decisão de 17/08/2026; a §22 previa a possibilidade de virar exceção
     por tarefa se a deriva incomodar. */
  function ultimaVezDe(tid) {
    var achado = null;
    eventosEmOrdem().forEach(function (ev) {
      if (ev.tarefaId !== tid) return;
      // "já fiz" pelo não dá é feito também — a rotina reinicia daquele dia
      if (ev.tipo === 'terminou' || (ev.tipo === 'nao_deu' && ev.motivo === 'ja_fiz')) achado = diaDe(ev.quando);
    });
    if (achado) return achado;
    var t = tarefa(tid);
    return (t && t.prazo && t.prazo.ultimaVez) || null;
  }

  // ── pendências ────────────────────────────────────────────────────

  function diasAte(data) {
    var alvo = new Date(data + 'T00:00:00');
    var agoraDia = new Date(hoje() + 'T00:00:00');
    return Math.round((alvo - agoraDia) / 86400000);
  }

  /* Único lugar do sistema com cor de alarme, e de propósito: bater o olho e
     ver tudo verde é uma saída de leitura zero. A cobrança aqui é sobre a
     performance de terceiro, nunca sobre a do usuário — por isso a regra 2
     não se aplica. Não vaza para nenhuma outra tela. */
  function nivelPendencia(x) {
    if (x.fase === 'falta') return 'falta';   // sem data: ainda nem foi comprado
    var folga = diasAte(x.previsto);
    if (folga < 0) return 'vermelho';
    if (folga <= BEIRA_DO_PRAZO) return 'amarelo';
    return 'verde';
  }

  function textoPendencia(x) {
    if (x.fase === 'falta') return 'Falta comprar' + (x.via === 'internet' ? ' — internet.' : ' — rua.');
    var folga = diasAte(x.previsto);
    if (folga < 0)  return 'Era para ter chegado há ' + (-folga) + (folga === -1 ? ' dia.' : ' dias.');
    if (folga === 0) return 'Chega hoje.';
    if (folga === 1) return 'Chega amanhã.';
    return 'Chega em ' + folga + ' dias.';
  }

  function pendenciasAbertas() {
    var peso = { vermelho: 0, amarelo: 1, verde: 2, falta: 3 };
    return pendenciasVivas()
      .filter(function (x) { return !x.resolvida && !vista.compradas[x.id]; })
      .sort(function (a, b) {
        var d = peso[nivelPendencia(a)] - peso[nivelPendencia(b)];
        return d || diasAte(a.previsto) - diasAte(b.previsto);
      });
  }

  function inserirPendencia(descricao) {
    var x = novaPendencia(descricao);
    cat().pendencias.push(x);
    salvar();
    return x;
  }

  /* A espera VINCULADA (§40): "esta tarefa espera isto chegar". Enquanto a
     pendência estiver aberta, a tarefa fica trancada — sai do páreo da bota e
     a mesa diz o quê e quando. Chegou destranca; cancelada gera a tarefa de
     resolver, no projeto certo. */
  function esperarPara(tid, descricao, previsto) {
    var t = tarefa(tid);
    descricao = (descricao || '').trim();
    if (!t || !descricao) return null;
    var x = novaPendencia(descricao);
    x.tarefaId = tid;
    x.projetoId = t.projetoId || null;
    if (previsto) x.previsto = previsto;
    cat().pendencias.push(x);
    salvar();
    return x;
  }
  function pendenciasVivas() {
    var lapides = {};
    (cat().apagados || []).forEach(function (l) { lapides[l.id] = true; });
    return cat().pendencias.concat(vista.itensExtras.filter(function (x) {
      return !achar(cat().pendencias, x.id) && !lapides[x.id];
    }));
  }
  function esperasDe(tid) {
    return pendenciasVivas().filter(function (x) {
      return x.tarefaId === tid && !x.resolvida && !vista.compradas[x.id];
    });
  }

  /* ── itens de compra (§56) ── */
  // acrescentar um item em falta à tarefa (ou solto no projeto): mesa
  function faltarItem(tid, descricao, via) {
    descricao = (descricao || '').trim();
    if (!descricao) return null;
    var t = tid ? tarefa(tid) : null;
    var x = novoItem(descricao, via);
    if (t) { x.tarefaId = t.id; x.projetoId = t.projetoId || null; }
    cat().pendencias.push(x);
    salvar();
    return x;
  }
  // comprei (na loja, riscando a lista): EVENTO — funciona na bota e na mesa
  function comprarItem(quem, xid) {
    return registrar(quem, 'comprou', { itemId: xid });
  }
  /* A lista dita na conclusão (§57): "o que comprar?" respondido ali mesmo,
     uma linha por item. É EVENTO — funciona na bota — e a mesa absorve. */
  function listarCompra(quem, compraId, descricoes) {
    var t = tarefa(compraId);
    var linhas = (descricoes || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (!t || !linhas.length) return null;
    var base = Date.now().toString(36);
    var itens = linhas.map(function (d, i) {
      var x = novoItem(d, 'rua');
      x.id = 'x_' + compraId + '_' + base + i;
      x.tarefaId = compraId;
      x.projetoId = t.projetoId || null;
      return x;
    });
    return registrar(quem, 'listou', { tarefaId: compraId, itensNovos: itens });
  }
  // as compras vazias que dependem desta tarefa: é para elas que se pede a lista
  function comprasVaziasDependentesDe(tid) {
    return tarefasVivas().filter(function (o) {
      return o.tipo === 'compra' && (o.dependeDe || []).indexOf(tid) !== -1 &&
        estadoDe(o.id) === 'aberta' && estadoDaCompra(o.id).fase === 'vazia';
    });
  }
  // encomendei (internet): ganha a data e vira espera de sempre — mesa
  function encomendarItem(xid, previsto) {
    var x = pendencia(xid);
    if (!x) return null;
    x.fase = 'esperando';
    if (previsto) x.previsto = previsto;
    salvar();
    return x;
  }
  function mudarViaItem(xid, via) {
    var x = pendencia(xid);
    if (!x) return;
    x.via = via;
    salvar();
  }
  /* A mesa traz para o catálogo o que os eventos disseram: itens nascidos no
     não dá e compras riscadas na rua. Idempotente — roda a cada abertura. */
  function absorverCompras() {
    var mudou = false;
    vista.itensExtras.forEach(function (x) {
      if (!achar(cat().pendencias, x.id)) { cat().pendencias.push(JSON.parse(JSON.stringify(x))); mudou = true; }
    });
    Object.keys(vista.compradas).forEach(function (xid) {
      var x = achar(cat().pendencias, xid);
      if (x && !x.resolvida) { x.resolvida = 'chegou'; mudou = true; }
    });
    if (mudou) salvar();
    return mudou;
  }
  // a lista de compras da rua: itens em falta, via rua, ainda não comprados
  function itensDaRua() {
    return pendenciasVivas().filter(function (x) {
      return x.fase === 'falta' && x.via !== 'internet' && !x.resolvida && !vista.compradas[x.id];
    });
  }

  /* COMPRA PELA INTERNET CONCLUÍDA (§52): cada item da lista vira uma espera
     PRÓPRIA — entregas chegam em datas diferentes e cada uma se acompanha no
     semáforo do Aguardando. Se alguma tarefa dependia da compra, as esperas
     nascem vinculadas a ela: o material que falta segura quem precisa dele,
     não a compra já feita. Só a mesa chama isto (pendência é catálogo). */
  // §54 morreu na §56: compra não é mais tarefa, então não há "concluir a
  // compra" — o item nasce em falta e vira espera ao ser encomendado.

  /* Tirar é diferente de resolver (§55): a espera cadastrada errada, ou que
     já não faz sentido, sai sem deixar registro nem gerar tarefa. Com lápide,
     senão o merge (§47) a ressuscitava do outro aparelho. */
  function desfazerPendencia(xid) {
    var x = pendencia(xid);
    if (!x) return false;
    lapide(xid);
    cat().pendencias = cat().pendencias.filter(function (p) { return p.id !== xid; });
    salvar();
    return true;
  }

  /* Chegou: destrava a tarefa vinculada. Cancelada: gera a tarefa de resolver,
     porque o projeto não pode ficar esperando para sempre uma coisa que não vem. */
  function resolverPendencia(xid, como) {
    var x = pendencia(xid);
    if (!x) return null;
    x.resolvida = como;

    if (como === 'cancelada') {
      var t = novaTarefa(x.projetoId, 0);
      t.texto = 'Resolver: ' + (x.descricao || 'compra cancelada');
      t.ondePrecisaEstar = 'computador';
      t.duracaoTotal = t.restanteEstimado = 45;
      t.ordem = (x.projetoId ? passosDe(x.projetoId).length : avulsas().length) + 1;
      cat().tarefas.push(t);
      salvar();
      return t;
    }
    salvar();
    return null;
  }

  function moeda(v) {
    var n = Number(v) || 0;
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function duracao(min) {
    var m = Number(min) || 0;
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' h ' + r + ' min' : h + ' h';
  }

  function janelaDoPreset(preset, atual) {
    if (!preset) return null;
    if (preset === 'dia_util') {
      return { preset: 'dia_util', de: '00:00', ate: '23:59', apenasDiasUteis: true };
    }
    if (preset === 'comercial') {
      return { preset: 'comercial', de: '08:00', ate: '18:00', apenasDiasUteis: true };
    }
    return {
      preset: 'personalizado',
      de: (atual && atual.de) || '08:00',
      ate: (atual && atual.ate) || '12:00',
      apenasDiasUteis: atual ? !!atual.apenasDiasUteis : true
    };
  }

  // ── escrita ───────────────────────────────────────────────────────

  function inserirProjeto() {
    if (motivoTetoMudas()) return null;   // toda obra nasce muda, e o teto é parede
    var p = novoProjeto();
    p.ordemFila = cat().projetos.length + 1;
    cat().projetos.push(p);
    salvar();
    return p;
  }

  /* Conveniência de digitação, não herança de modelo: o passo novo nasce com o
     contexto do anterior já preenchido e o usuário muda o que difere. Nada
     fica amarrado — cada tarefa guarda os próprios valores. */
  function herdarDoAnterior(t, anterior) {
    ['ondePrecisaEstar', 'onde', 'exigeClima', 'exigeSoloFirme', 'esforco',
     'precisaAjuda', 'boaComCriancas', 'perigosaComCriancas'].forEach(function (k) {
      t[k] = anterior[k];
    });
  }

  function inserirCompra(pid, etapa) {
    var passos = pid ? passosDe(pid) : avulsas();
    var t = novaTarefa(pid, passos.length + 1);
    t.tipo = 'compra';
    t.texto = '';
    t.etapa = etapa || 'execucao';
    cat().tarefas.push(t);
    salvar();
    return t;
  }

  function inserirPasso(pid, modelo) {
    var passos = pid ? passosDe(pid) : avulsas();
    var t = novaTarefa(pid, passos.length + 1);
    if (modelo) herdarDoAnterior(t, modelo);
    cat().tarefas.push(t);
    salvar();
    return t;
  }

  function lapide(id) {
    cat().apagados = (cat().apagados || []).filter(function (l) { return l.id !== id; });
    cat().apagados.push({ id: id, em: agora() });
  }

  function removerProjeto(pid) {
    lapide(pid);
    cat().tarefas.filter(function (t) { return t.projetoId === pid; }).forEach(function (t) { lapide(t.id); });
    cat().projetos = cat().projetos.filter(function (p) { return p.id !== pid; });
    cat().tarefas = cat().tarefas.filter(function (t) { return t.projetoId !== pid; });
    cat().projetos.forEach(function (p) {
      p.prerequisitos = (p.prerequisitos || []).filter(function (q) { return q !== pid; });
    });
    salvar();
  }

  function removerTarefa(tid) {
    var era = tarefa(tid);
    lapide(tid);
    cat().tarefas = cat().tarefas.filter(function (t) { return t.id !== tid; });
    cat().tarefas.forEach(function (t) {
      t.dependeDe = (t.dependeDe || []).filter(function (d) { return d !== tid; });
    });
    /* Destrave nascido no diário não mora no catálogo: mora dentro do evento
       que o criou. Apagar é tirá-lo dali — e soltar a tarefa que ele travava. */
    Object.keys(estado.diarios).forEach(function (q) {
      (estado.diarios[q].eventos || []).forEach(function (ev) {
        if (ev.tarefaNova && ev.tarefaNova.id === tid) { delete ev.tarefaNova; delete ev.travadaPor; }
      });
    });
    salvar();
    // apagar a última de planejamento também fecha o planejamento
    if (era && era.etapa === 'planejamento') cascatearVagas();
  }

  /* Reordena por arraste e renumera. O vínculo aponta para o id da tarefa,
     nunca para a posição — senão arrastar reescreveria as dependências. */
  function reordenar(idsNaOrdem) {
    idsNaOrdem.forEach(function (tid, i) {
      var t = tarefa(tid);
      if (t) { t.ordem = i + 1; t.ultimoToque = agora(); }
    });
    salvar();
  }

  /* Mover de etapa arrasta a corrente, e a direção importa:
       para PLANEJAMENTO vem junto o que vem ANTES (as dependências);
       para EXECUÇÃO vem junto o que vem DEPOIS (os dependentes).
     Sem isso nasce um travamento silencioso: uma tarefa de planejamento que
     dependa de uma de execução nunca acontece, porque a execução só é oferecida
     depois que o planejamento fecha — e o planejamento espera a execução. */
  function moverEtapa(tid, etapa) {
    var raiz = tarefa(tid);
    if (!raiz) return [];

    var vistos = {}, fila = [tid];
    while (fila.length) {
      var id = fila.shift();
      if (vistos[id]) continue;
      var t = tarefa(id);
      if (!t || t.projetoId !== raiz.projetoId) continue;   // corrente não pula de projeto
      vistos[id] = t;

      if (etapa === 'planejamento') {
        (t.dependeDe || []).forEach(function (d) { fila.push(d); });
      } else {
        tarefasVivas().forEach(function (o) {
          if ((o.dependeDe || []).indexOf(id) !== -1) fila.push(o.id);
        });
      }
    }

    var movidas = [];
    Object.keys(vistos).forEach(function (id) {
      var t = vistos[id];
      if (t.etapa !== etapa) { t.etapa = etapa; t.ultimoToque = agora(); movidas.push(t); }
    });
    if (movidas.length) {
      salvar();
      // a última de planejamento arrastada para execução fecha o planejamento:
      // a vaga tem que andar, como quando ela é concluída
      cascatearVagas();
    }
    return movidas;
  }

  function inserirSemente(texto) {
    var s = novaSemente(texto);
    cat().sementes.push(s);
    salvar();
    return s;
  }

  function semente(sid) { return achar(cat().sementes, sid); }

  /* Classificar é a análise de sementes: um toque por semente. Descartar exige
     motivo — se ele descarta sozinho uma ideia dela, ela lê o porquê na
     Sementeira. Os estados terminais não voltam: o que virou, virou. */
  function classificarSemente(sid, estado, motivo) {
    var s = semente(sid);
    if (!s || ESTADOS_SEMENTE.indexOf(estado) < 0) return null;
    if (s.estado === 'virou_projeto' || s.estado === 'virou_tarefa') return null;
    if (estado.indexOf('virou_') === 0) return null;
    motivo = (motivo || '').trim();
    if (estado === 'descartada' && !motivo) return null;
    s.estado = estado;
    s.motivo = estado === 'descartada' ? motivo : '';
    s.classificadaEm = agora();
    s.ultimoToque = agora();
    salvar();
    return s;
  }

  function fecharSemente(s, estado, oQueNasceu) {
    s.estado = estado;
    s.virouId = oQueNasceu.id;
    s.classificadaEm = s.ultimoToque = agora();
  }

  /* Semente vira pré-projeto: entra em `fila`, sem tarefas e sem custo.
     Detalhar é trabalho da vaga de planejamento, não deste momento. */
  function promoverSemente(sid) {
    var s = semente(sid);
    if (!s || s.virouId) return null;
    var p = inserirProjeto();
    if (!p) return null;                  // teto de mudas
    p.nome = s.nome;
    p.resultado = s.frase;
    p.origem = 'semente';
    fecharSemente(s, 'virou_projeto', p);
    salvar();
    return p;
  }

  /* Semente vira tarefa avulsa: só o nome vai; o resto se preenche na ficha,
     como qualquer tarefa criada do zero. */
  function semearTarefa(sid) {
    var s = semente(sid);
    if (!s || s.virouId) return null;
    var t = inserirPasso(null, null);
    t.texto = s.nome;
    fecharSemente(s, 'virou_tarefa', t);
    salvar();
    return t;
  }

  // as aprovadas para tarefa, ainda à espera: é delas que a nova avulsa pode partir
  function sementesParaTarefa() {
    return cat().sementes.filter(function (s) { return s.estado === 'tarefa'; });
  }

  // ── diário: o que aconteceu ───────────────────────────────────────
  /* A frente de campo NUNCA escreve no catálogo. Ela acrescenta eventos ao
     diário da própria pessoa — um arquivo por pessoa, um escritor por arquivo,
     conflito impossível por construção. O estado corrente é derivado dos dois
     lados do mesmo jeito, então ninguém precisa "aplicar" nada no outro. */

  var vista = { tarefas: {}, pessoas: {}, extras: [], compradas: {}, itensExtras: [], separadas: {} };

  function diarioDe(quem) {
    if (!estado.diarios[quem]) estado.diarios[quem] = { pessoa: quem, eventos: [] };
    return estado.diarios[quem];
  }

  /* POR ONDE (§54): todo evento carrega a superfície em que nasceu — bota,
     mesa-execucao (a consulta aberta no PC), mesa-organizacao (o catálogo),
     rua, folha-diarista, sementeira. É matéria-prima do modo analisar: dizer
     onde o trabalho de verdade acontece. Quem desenha a tela diz quem é. */
  var fonteVia = null;
  function quandoRegistrar(fn) { fonteVia = fn; }

  function registrar(quem, tipo, dados) {
    var ev = { id: id('ev'), quando: agora(), quem: quem, tipo: tipo };
    if (fonteVia) { try { var v = fonteVia(); if (v) ev.via = v; } catch (e) {} }
    Object.keys(dados || {}).forEach(function (k) { ev[k] = dados[k]; });
    diarioDe(quem).eventos.push(ev);
    salvar();   // já refaz a vista
    /* Fechar uma tarefa pode fechar um planejamento, e a vaga tem que andar na
       hora — na bota inclusive. Antes só a mesa cascateava, e o projeto ficava
       na vaga de planejamento emitindo execução até alguém abrir o PC. */
    if (tipo === 'terminou' || tipo === 'encerrou' || tipo === 'nao_deu') cascatearVagas();
    return ev;
  }

  function eventosEmOrdem() {
    var todos = [];
    Object.keys(estado.diarios).forEach(function (p) {
      todos = todos.concat(estado.diarios[p].eventos || []);
    });
    return todos.sort(function (a, b) { return a.quando < b.quando ? -1 : 1; });
  }

  function derivar() {
    vista = { tarefas: {}, pessoas: {}, extras: [], compradas: {}, itensExtras: [], separadas: {} };

    cat().tarefas.forEach(function (t) {
      vista.tarefas[t.id] = {
        estado: t.estado, restante: t.restanteEstimado,
        recado: t.recado || '', coletado: {}, sessoes: 0
      };
    });
    cat().pessoas.forEach(function (p) { vista.pessoas[p.id] = pessoaVazia(); });

    eventosEmOrdem().forEach(aplicarEvento);
    return vista;
  }

  function pessoaVazia() {
    return { tarefaAtiva: null, calado: null, oferta: null, recusas: {} };
  }

  function aplicarEvento(ev) {
    var pessoa = vista.pessoas[ev.quem] || (vista.pessoas[ev.quem] = pessoaVazia());

    /* Itens (§56): comprado na bota é evento; o catálogo só aprende quando a
       mesa absorve — mas a vista já sabe, então a tarefa destrava na hora. */
    if (ev.tipo === 'comprou' && ev.itemId) vista.compradas[ev.itemId] = true;
    /* Delegado pela bota (§60): evento até a mesa absorver — a vista já tira
       a tarefa do páreo; o catálogo aprende quando a mesa abrir. */
    if (ev.tipo === 'separou' && ev.tarefaId && (cat().absorvidas || []).indexOf(ev.id) === -1) {
      vista.separadas[ev.tarefaId] = { para: DIARISTA, dia: ev.dia || diaSeguinte() };
    }
    (ev.itensNovos || (ev.itemNovo ? [ev.itemNovo] : [])).forEach(function (novo) {
      if (!achar(cat().pendencias, novo.id) &&
          !vista.itensExtras.some(function (x) { return x.id === novo.id; })) {
        vista.itensExtras.push(novo);
      }
    });

    // o não dá pode criar um destrave, e criar tarefa no campo é acontecimento,
    // não decisão de mesa — por isso ela nasce dentro do próprio evento
    if (ev.tarefaNova) {
      if (!vista.tarefas[ev.tarefaNova.id]) {
        vista.extras.push(ev.tarefaNova);
        vista.tarefas[ev.tarefaNova.id] = {
          estado: 'aberta', restante: ev.tarefaNova.restanteEstimado,
          recado: ev.tarefaNova.recado || '', coletado: {}, sessoes: 0
        };
      }
    }

    var alvo = vista.tarefas[ev.tarefaId];
    if (!alvo) return;

    if (ev.tipo === 'iniciou') {
      alvo.estado = 'ativa';
      alvo.sessoes += 1;
      pessoa.tarefaAtiva = ev.tarefaId;
    }
    /* Periódica não termina — reinicia. Marcá-la como feita a tirava do páreo
       para sempre depois da primeira vez, e o FAMACHA nunca mais aparecia. */
    var rotina = periodica(tarefa(ev.tarefaId));

    if (ev.tipo === 'terminou') {
      alvo.estado = rotina ? 'aberta' : 'feita';
      alvo.restante = rotina ? restanteCheio(ev.tarefaId) : 0;
      pessoa.tarefaAtiva = null;
    }
    if (ev.tipo === 'reabriu') {
      alvo.estado = 'aberta';
      var t = tarefa(ev.tarefaId);
      if (t && !alvo.restante) alvo.restante = t.duracaoTotal;
    }
    if (ev.tipo === 'parou') {
      alvo.estado = 'aberta';
      alvo.restante = Math.max(0, ev.restante);
      if (ev.nota) alvo.recado = ev.nota;
      if (ev.travadaPor) alvo.travadaPor = ev.travadaPor;
      pessoa.tarefaAtiva = null;
    }
    if (ev.tipo === 'encerrou') {
      alvo.estado = 'encerrada';
      pessoa.tarefaAtiva = null;
    }
    if (ev.tipo === 'nao_deu') {
      if (ev.motivo === 'ja_fiz') alvo.estado = rotina ? 'aberta' : 'feita';
      if (ev.restanteNovo) alvo.restante = ev.restanteNovo;
      if (ev.travadaPor) alvo.travadaPor = ev.travadaPor;
      /* Recusada por impossibilidade, ela não pode ser a próxima resposta —
         era o que acontecia com "outro motivo": a oferta grudada devolvia a
         mesma tarefa na hora. Sai do páreo por umas horas e a grudada solta. */
      pessoa.recusas[ev.tarefaId] = ev.quando;
      pessoa.oferta = null;
    }
    // guarda o instante, não o dia: a pausa conta a partir da recusa
    if (ev.tipo === 'nao_quero') pessoa.calado = ev.quando;

    /* A oferta gruda. Dava para sair e voltar no app, responder diferente e
       ver outra tarefa — percorrer pela porta dos fundos, de graça. Agora
       responder de novo continua livre, só não RENDE nada: enquanto a tarefa
       oferecida couber na situação nova, ela continua sendo a resposta.
       Guarda o instante: a cola vale pelo dia (ver ofertaDe). */
    if (ev.tipo === 'ofertou') pessoa.oferta = { tarefaId: ev.tarefaId, quando: ev.quando };
  }

  function restanteCheio(tid) {
    var t = tarefa(tid);
    return t ? t.duracaoTotal : 0;
  }

  // ── o que a frente de campo escreve ───────────────────────────────

  var AVANCO = { pouco: 0.20, metade: 0.50, quase_tudo: 0.85 };

  function iniciar(quem, tid) { return registrar(quem, 'iniciou', { tarefaId: tid }); }

  /* A anotação é opcional e é pedida na conclusão, não no cadastro: quando a
     tarefa acabou você sabe o que valia registrar; ao cadastrar, não sabe. */
  function terminar(quem, tid, anotacao) {
    return registrar(quem, 'terminou', { tarefaId: tid, anotacao: anotacao || '' });
  }

  // desfazer tem que ser barato: nada dentro do app pode dar medo
  function reabrir(quem, tid) {
    return registrar(quem, 'reabriu', { tarefaId: tid });
  }

  /* A LINHA DO TEMPO DO PROJETO — o que aconteceu, na ordem em que aconteceu.
     Planejamento entra junto: é ali que as medidas e as decisões nascem, e
     separar as duas etapas aqui quebraria justamente o raciocínio que a lista
     existe para devolver. Canceladas entram com o motivo, porque elas explicam
     os buracos: sem isso, três meses depois ninguém sabe por que a tela nunca
     foi comprada. */
  function historicoDe(pid) {
    var dono = {};
    passosDe(pid).forEach(function (t) { dono[t.id] = t; });

    var linhas = {};
    eventosEmOrdem().forEach(function (ev) {
      var t = dono[ev.tarefaId];
      if (!t) return;
      if (ev.tipo === 'terminou') {
        linhas[t.id] = { tarefa: t, tipo: 'feita', quando: ev.quando, nota: ev.anotacao || '', quem: ev.quem };
      }
      if (ev.tipo === 'encerrou') {
        linhas[t.id] = { tarefa: t, tipo: 'cancelada', quando: ev.quando, nota: ev.nota || '' };
      }
      if (ev.tipo === 'reabriu') delete linhas[t.id];   // voltou a ser futuro
    });

    return Object.keys(linhas).map(function (k) { return linhas[k]; })
      .sort(function (a, b) { return a.quando < b.quando ? -1 : 1; });
  }

  function anotacoesDe(tid) {
    return eventosEmOrdem()
      .filter(function (ev) { return ev.tarefaId === tid && ev.anotacao; })
      .map(function (ev) { return { quando: diaDe(ev.quando), texto: ev.anotacao }; });
  }

  /* Parar tem duas naturezas e elas não podem ser confundidas: chuva e criança
     são terça-feira, não travamento. Só o segundo caso pede a linha e gera
     trabalho — o primeiro grava o avanço e cala a boca. */
  function parar(quem, tid, avanco, motivo, nota) {
    var t = tarefa(tid);
    var corte = (AVANCO[avanco] || 0) * (t ? t.duracaoTotal : 0);
    var dados = {
      tarefaId: tid,
      restante: Math.max(0, restanteDe(tid) - corte),
      avanco: avanco,
      motivo: motivo,                    // 'saiu' | 'travou'
      nota: nota || ''
    };
    if (motivo === 'travou' && nota) {
      var pensar = tarefaDePensar(t, nota);
      dados.tarefaNova = pensar;
      dados.travadaPor = pensar.id;      // a original espera o pensamento
    }
    return registrar(quem, 'parou', dados);
  }

  function tarefaDePensar(t, nota) {
    var nova = novaTarefa(t ? t.projetoId : null, 0);
    // herda a etapa: destrave de planejamento nascendo como execução nunca era
    // oferecido (a vaga de planejamento só emite planejamento) — travava tudo
    if (t && t.etapa) nova.etapa = t.etapa;
    nova.texto = 'Pensar em como destravar: ' + (t ? t.texto : 'a tarefa');
    nova.ondePrecisaEstar = 'computador';
    nova.duracaoTotal = nova.restanteEstimado = 30;
    nova.esforco = 'leve';
    nova.exigeClima = 'indiferente';
    nova.recado = nota;
    return nova;
  }

  /* §9 — recurso gera tarefa, condição gera silêncio. Faltou ferramenta é
     ação de hoje; começou a chover não há o que fazer sobre a chuva. */
  var MOTIVOS_NAO_DA = [
    { v: 'ferramenta_sumiu',  t: 'A ferramenta sumiu',            destrave: 'Procurar a ferramenta: ' },
    { v: 'ferramenta_quebrou', t: 'A ferramenta quebrou',          destrave: 'Consertar ou substituir: ' },
    // compra não é tarefa (§56): estes dois geram um ITEM em falta, preso à
    // própria tarefa recusada — ela fica trancada até o item chegar
    { v: 'sem_ferramenta',    t: 'Não tenho essa ferramenta',      destrave: null, item: true },
    { v: 'faltou_material',   t: 'Faltou material',                destrave: null, item: true },
    { v: 'terceiro',          t: 'Preciso falar com alguém',       destrave: 'Falar com quem falta: ' },
    { v: 'ja_fiz',            t: 'Já fiz',                         destrave: null },
    { v: 'tempo_virou',       t: 'O tempo virou',                  destrave: null },
    { v: 'demora_mais',       t: 'Demora mais do que eu achava',   destrave: null },
    { v: 'outro',             t: 'Outro motivo',                   destrave: null }
  ];

  function naoDeu(quem, tid, motivo, nota) {
    var t = tarefa(tid);
    var regra = MOTIVOS_NAO_DA.filter(function (m) { return m.v === motivo; })[0];
    var dados = { tarefaId: tid, motivo: motivo, nota: nota || '' };

    if (motivo === 'demora_mais') {
      dados.restanteNovo = Math.round(restanteDe(tid) * 1.5);
    }
    /* Faltou material / não tenho a ferramenta: nasce um ITEM em falta (§56),
       vinculado à própria tarefa recusada — ela sai do páreo até o item chegar.
       O item nasce dentro do evento (a bota não escreve catálogo); a vista o
       deriva na hora e a mesa o absorve para o catálogo ao abrir. */
    if (regra && regra.item) {
      var item = novoItem(nota || (t ? t.texto : 'o que faltou'), 'rua');
      item.id = 'x_' + dados.tarefaId + '_' + Date.now().toString(36);
      item.tarefaId = tid;
      item.projetoId = t ? t.projetoId : null;
      dados.itemNovo = item;
    }
    if (regra && regra.destrave) {
      var d = novaTarefa(t ? t.projetoId : null, 0);
      if (t && t.etapa) d.etapa = t.etapa;   // mesma razão da tarefa de pensar
      d.texto = regra.destrave + (nota || (t ? t.texto : ''));
      d.ondePrecisaEstar = (motivo === 'terceiro') ? 'fora' : 'sitio';
      d.duracaoTotal = d.restanteEstimado = 20;
      d.esforco = 'leve';
      d.exigeClima = 'indiferente';
      dados.tarefaNova = d;
      dados.travadaPor = d.id;
    }
    return registrar(quem, 'nao_deu', dados);
  }

  /* Clima é registro do dia, não critério de consulta: fica guardado como
     série temporal para um dia a estação meteorológica ocupar esse lugar sem
     mudar mais nada. Perguntado uma vez por dia; depois vira confirmação. */
  /* USO (§38): onde as horas foram. Uma linha por sessão — abrir → sair —,
     com o app (mesa · bota · sementeira), início, fim, minutos e segundos por
     tela. É dado, não julgamento: nada disto aparece em tela nenhuma; é
     matéria-prima para o modo analisar saber se o app deixa a pessoa mais
     ativa ou só mais ocupada na mesa. Sessão de menos de 15 s não entra. */
  var uso = { app: '', desde: null, tela: '', telaDesde: 0, telas: {}, quem: 'pe_eu', ultimaAtividade: 0 };
  var OCIO_MS = 5 * 60 * 1000;   // tela aberta e parada não é uso

  function usoIniciar(quem, app) {
    var t = Date.now();
    uso = { app: app, desde: agora(), tela: '', telaDesde: t, telas: {}, quem: quem, ultimaAtividade: t };
  }
  function usoTela(nome, ateMs) {
    var t = ateMs || Date.now();
    if (uso.tela) uso.telas[uso.tela] = (uso.telas[uso.tela] || 0) + Math.max(0, Math.round((t - uso.telaDesde) / 1000));
    uso.tela = nome || '';
    uso.telaDesde = t;
  }
  /* Fecha a sessão. `ateMs` é o instante em que ela acabou de verdade — no
     ócio, a última atividade, não o agora. */
  function usoFechar(ateMs) {
    if (!uso.desde) return null;
    var fim = ateMs || Date.now();
    usoTela(uso.tela, fim);       // fecha a tela corrente até o fim
    var seg = Math.round((fim - new Date(uso.desde).getTime()) / 1000);
    var ev = null;
    if (seg >= 15) {
      ev = registrar(uso.quem, 'esteve', {
        app: uso.app, de: uso.desde, ate: new Date(fim).toISOString(),
        minutos: Math.round(seg / 6) / 10, telas: uso.telas
      });
    }
    // a sessão seguinte começa no próximo toque, se o app voltar sem recarregar
    uso = { app: uso.app, desde: null, tela: uso.tela, telaDesde: Date.now(), telas: {}, quem: uso.quem, ultimaAtividade: uso.ultimaAtividade };
    return ev;
  }
  function usoRetomar() {
    var t = Date.now();
    if (!uso.desde) { uso.desde = agora(); uso.telaDesde = t; uso.telas = {}; }
    uso.ultimaAtividade = t;
  }
  /* Toque, tecla, mouse, rolagem: é atividade. Parado 5 min com a tela aberta,
     a sessão fecha no instante do último toque; o próximo toque abre outra. */
  function usoAtividade() {
    var t = Date.now();
    if (!uso.desde) return usoRetomar();
    if (t - uso.ultimaAtividade > OCIO_MS) { usoFechar(uso.ultimaAtividade); return usoRetomar(); }
    uso.ultimaAtividade = t;
  }
  function usoVerificarOcio() {
    if (uso.desde && Date.now() - uso.ultimaAtividade > OCIO_MS) usoFechar(uso.ultimaAtividade);
  }

  // ── o diarista (§39): braço, não usuário ──────────────────────────
  /* Ele não consulta, não recusa, não trava: recebe uma folha e faz até onde
     der. Quem escreve em nome dele é o Dan. Separar tira a tarefa do páreo do
     Dan; fechar o dia registra no diário COMO DELE (`quem: pe_diarista`) — o
     registro é honesto sobre quem fez. Só tarefa que já existe: de projeto em
     vaga de execução ou avulsa, aberta. Coisa nova vai na lata, fora do app. */
  function podeSeparar(t) {
    if (!t || t.separada || t.etapa !== 'execucao' || t.tipo === 'compra') return false;
    if (estadoDe(t.id) !== 'aberta') return false;
    if (!t.projetoId) return true;
    var p = projeto(t.projetoId);
    return !!p && (p.papel === 'titular' || p.papel === 'reserva');
  }
  function separadas() {
    return tarefasVivas().filter(function (t) { return t.separada; })
      .sort(function (a, b) { return (a.separada.ordem || 0) - (b.separada.ordem || 0); });
  }
  function separarTarefa(tid, dia) {
    var t = tarefa(tid);
    if (!podeSeparar(t)) return null;
    var ultima = separadas().slice(-1)[0];
    t.separada = { para: DIARISTA, dia: dia || diaSeguinte(), ordem: ultima ? (ultima.separada.ordem || 0) + 1 : 1 };
    t.ultimoToque = agora();
    salvar();
    return t;
  }
  function desfazerSeparacao(tid) {
    var t = tarefa(tid);
    if (!t || !t.separada) return;
    t.separada = null; t.ultimoToque = agora();
    salvar();
  }
  function reordenarSeparadas(ids) {
    ids.forEach(function (id, i) { var t = tarefa(id); if (t && t.separada) t.separada.ordem = i + 1; });
    salvar();
  }
  function definirDiaDiarista(dia) {
    separadas().forEach(function (t) { t.separada.dia = dia; });
    salvar();
  }
  function diaSeguinte() {
    var d = new Date(); d.setDate(d.getDate() + 1);
    return diaLocal(d);
  }
  /* Fechar o dia: o que ele fez entra como dele. `como`: feita · metade
     (com o que sobrou, em minutos) · nao_fez. Em todos os casos a tarefa sai
     da folha e volta ao páreo do Dan, se ainda estiver aberta. */
  function fecharDiarista(tid, como, sobrouMin, nota) {
    var t = tarefa(tid);
    if (!t || !t.separada) return null;
    var dia = t.separada.dia;
    t.separada = null; t.ultimoToque = agora();
    var ev = null;
    if (como === 'feita') {
      ev = registrar(DIARISTA, 'terminou', { tarefaId: tid, anotacao: nota || '', dia: dia });
    } else if (como === 'metade') {
      ev = registrar(DIARISTA, 'parou', { tarefaId: tid, restante: Math.max(5, Number(sobrouMin) || 0),
        avanco: 'metade', motivo: 'saiu', nota: nota || '', dia: dia });
    } else {
      salvar();
    }
    return ev;
  }
  /* A FOLHA DA RUA (§43): tudo que é "fora" e está em jogo — avulsa ou projeto
     em vaga (planejamento inclusive: orçar na loja é rua). Aproveitar a viagem,
     não cobrança: só aparece quando ele diz que vai sair. Ordem é a rota dele. */
  function tarefasDaRua() {
    return tarefasVivas().filter(function (t) {
      if (t.ondePrecisaEstar !== 'fora' || t.separada || t.tipo === 'compra') return false;
      if (estadoDe(t.id) !== 'aberta') return false;
      if (!desimpedida(t)) return false;
      if (!t.projetoId) return true;
      var p = projeto(t.projetoId);
      return !!p && (p.papel === 'titular' || p.papel === 'reserva' || p.papel === 'planejamento');
    }).sort(function (a, b) { return (a.rua || 0) - (b.rua || 0) || a.ordem - b.ordem; });
  }
  function reordenarRua(ids) {
    ids.forEach(function (id, i) { var t = tarefa(id); if (t) t.rua = i + 1; });
    salvar();
  }

  /* Separada, pelo catálogo OU por evento ainda não absorvido. É o que o
     motor e a vitrine consultam. */
  function separadaDe(tid) {
    var t = tarefa(tid);
    if (t && t.separada) return t.separada;
    return vista.separadas[tid] || null;
  }
  // delegar pela bota (§60): evento; a mesa monta a folha ao absorver
  function separarPorEvento(quem, tid) {
    return registrar(quem, 'separou', { tarefaId: tid, dia: diaSeguinte() });
  }
  function absorverSeparadas() {
    var mudou = false;
    eventosEmOrdem().forEach(function (ev) {
      if (ev.tipo !== 'separou') return;
      if ((cat().absorvidas || []).indexOf(ev.id) !== -1) return;
      var t = tarefa(ev.tarefaId);
      if (t && !t.separada && podeSeparar(t)) {
        separarTarefa(ev.tarefaId, ev.dia);
      }
      cat().absorvidas.push(ev.id);
      delete vista.separadas[ev.tarefaId];
      mudou = true;
    });
    if (mudou) salvar();
    return mudou;
  }

  /* EMPACOU (§60): a tarefa que aparece na vitrine dia após dia sem ninguém
     encostar merece a pergunta — e a resposta é dele para ele mesmo, material
     para refinar o projeto na mesa e para a revisão. */
  function diasNaVitrine(tid) {
    var dias = {};
    eventosEmOrdem().forEach(function (ev) {
      if (ev.tipo === 'vitrine' && (ev.tarefas || []).indexOf(tid) !== -1) {
        dias[ev.dia || diaDe(ev.quando)] = true;
      }
    });
    return Object.keys(dias).length;
  }
  function ultimoTrabalho(tid) {
    var achado = null;
    eventosEmOrdem().forEach(function (ev) {
      if (ev.tarefaId !== tid) return;
      if (['iniciou', 'terminou', 'parou', 'nao_deu', 'encerrou'].indexOf(ev.tipo) !== -1) achado = ev;
    });
    return achado;
  }
  function ultimoEmpacou(tid) {
    var achado = null;
    eventosEmOrdem().forEach(function (ev) {
      if (ev.tipo === 'empacou' && ev.tarefaId === tid) achado = ev;
    });
    return achado;
  }
  function perguntaEmpacou(tid) {
    if (estadoDe(tid) !== 'aberta') return false;
    if (diasNaVitrine(tid) < 4) return false;
    var trab = ultimoTrabalho(tid);
    if (trab && diasDesde(diaDe(trab.quando)) < 4) return false;
    var emp = ultimoEmpacou(tid);
    if (emp && diasDesde(diaDe(emp.quando)) < 7) return false;
    return true;
  }
  function empacar(quem, tid, nota) {
    return registrar(quem, 'empacou', { tarefaId: tid, nota: (nota || '').trim() });
  }
  // a nota do empacou aparece na mesa até alguém trabalhar na tarefa de novo
  function notaEmpacou(tid) {
    var emp = ultimoEmpacou(tid);
    if (!emp || !emp.nota) return null;
    var trab = ultimoTrabalho(tid);
    if (trab && trab.quando > emp.quando) return null;
    return { nota: emp.nota, quando: emp.quando };
  }

  function minutosSeparados() {
    return separadas().reduce(function (s, t) { return s + (restanteDe(t.id) || t.duracaoTotal || 0); }, 0);
  }

  /* ANOTAÇÕES (§45) — o ✎. Caderno, não documento: cada anotação é um evento
     no diário (`anotou`), então sincroniza como tudo, por união, sem conflito.
     Riscar é outro evento (`riscou`): some da lista, fica no registro. */
  function anotar(quem, texto, app) {
    texto = String(texto || '').trim();
    if (!texto) return null;
    return registrar(quem, 'anotou', { texto: texto, app: app || '' });
  }
  function riscarAnotacao(quem, anotacaoId) {
    return registrar(quem, 'riscou', { anotacaoId: anotacaoId });
  }
  function anotacoes() {
    var riscadas = {};
    eventosEmOrdem().forEach(function (ev) { if (ev.tipo === 'riscou') riscadas[ev.anotacaoId] = true; });
    return eventosEmOrdem()
      .filter(function (ev) { return ev.tipo === 'anotou' && !riscadas[ev.id]; })
      .reverse();
  }

  /* O COFRE (§48): guardado não se edita — se aporta (ou se retira). Cada
     movimento é evento no diário (`aportou`, valor com sinal), para a análise
     poder ver, um dia, que um projeto nunca andou porque o cofre vivia sendo
     esvaziado. O número no projeto é a soma; o diário é o registro. */
  function aportar(quem, pid, valor) {
    var p = projeto(pid);
    valor = Number(valor) || 0;
    if (!p || !valor) return null;
    var atual = Number(p.guardado) || 0;
    if (valor < 0 && -valor > atual) valor = -atual;   // não tira mais do que há
    p.guardado = Math.round((atual + valor) * 100) / 100;
    p.ultimoToque = agora();
    var ev = registrar(quem, 'aportou', { projetoId: pid, valor: valor, saldo: p.guardado });
    return ev;
  }
  function aportesDe(pid) {
    return eventosEmOrdem().filter(function (ev) { return ev.tipo === 'aportou' && ev.projetoId === pid; }).reverse();
  }

  /* A vitrine registrada (§58): o que foi mostrado na véspera, para o modo
     analisar cruzar um dia "o que vi ontem" com "o que fiz hoje". */
  function verVitrine(quem, tarefas, dia) {
    return registrar(quem, 'vitrine', { tarefas: tarefas, dia: dia });
  }

  function registrarClima(quem, tempo, barro) {
    return registrar(quem, 'clima', { dia: hoje(), tempo: tempo, barro: !!barro });
  }

  function climaDeHoje() {
    var achado = null;
    eventosEmOrdem().forEach(function (ev) {
      if (ev.tipo === 'clima' && ev.dia === hoje()) achado = ev;
    });
    return achado;
  }

  function naoQuero(quem, tid, nota) {
    return registrar(quem, 'nao_quero', { tarefaId: tid, nota: nota || '' });
  }

  /* Estimativa errada é normal e não gera nada (§8) — só devolve tempo. */
  function devolverTempo(quem, tid, minutos) {
    return registrar(quem, 'parou', {
      tarefaId: tid, restante: minutos, avanco: null, motivo: 'estimativa', nota: ''
    });
  }

  function encerrar(quem, tid, nota) {
    return registrar(quem, 'encerrou', { tarefaId: tid, nota: nota || '' });
  }

  /* Quantas tarefas esta destrava — alimenta o peso +10 da §7 sem campo novo. */
  function destravaQuantas(tid) {
    var n = 0;
    tarefasVivas().forEach(function (t) {
      if ((t.dependeDe || []).indexOf(tid) !== -1) n++;
      if (vistaDe(t.id).travadaPor === tid) n++;
    });
    return n;
  }

  // leitura do estado corrente — catálogo + diário, sempre pelos dois
  function vistaDe(tid) {
    return vista.tarefas[tid] || { estado: 'aberta', restante: 0, recado: '', coletado: {}, sessoes: 0 };
  }

  function estadoDe(tid) {
    var t = achar(cat().tarefas, tid) || achar(vista.extras, tid);
    if (t && t.tipo === 'compra') {
      var doDiario = vistaDe(tid).estado;
      if (doDiario === 'encerrada') return 'encerrada';   // cancelado à mão vale
      return estadoDaCompra(tid).completa ? 'feita' : 'aberta';
    }
    return vistaDe(tid).estado;
  }

  /* O estado do passo-compra, derivado dos itens:
       vazia     — sem item nenhum: a lista ainda vem (tranca quem depende)
       lista     — há item em falta para comprar
       esperando — tudo comprado/encomendado; falta chegar
       completa  — tudo na mão: o passo está feito, sozinho */
  function estadoDaCompra(tid) {
    var itens = pendenciasVivas().filter(function (x) { return x.tarefaId === tid; });
    function resolvido(x) { return !!x.resolvida || !!vista.compradas[x.id]; }
    var abertos = itens.filter(function (x) { return !resolvido(x); });
    var emFalta = abertos.filter(function (x) { return x.fase === 'falta'; });
    var fase = !itens.length ? 'vazia'
      : !abertos.length ? 'completa'
      : emFalta.length ? 'lista' : 'esperando';
    return { fase: fase, completa: fase === 'completa', itens: itens.length,
             resolvidos: itens.length - abertos.length, emFalta: emFalta.length };
  }
  function restanteDe(tid) { return vistaDe(tid).restante; }
  function recadoDe(tid)   { return vistaDe(tid).recado; }

  function tarefasVivas() {
    return cat().tarefas.concat(vista.extras);
  }

  function tarefaAtivaDe(quem) {
    var p = vista.pessoas[quem];
    return p && p.tarefaAtiva ? tarefa(p.tarefaAtiva) : null;
  }

  /* Registrada mesmo quando repete: a contagem de reconsultas antes de aceitar
     é material da revisão — quantas vezes você tentou trocar a resposta. */
  function ofertar(quem, tid) { return registrar(quem, 'ofertou', { tarefaId: tid }); }

  /* A cola vale pelo dia. Sem validade, a tarefa da reserva oferecida ontem
     (quando a titular não cabia) continuava sendo a resposta hoje, por cima
     da titular que agora cabe — a cascata deixava de mandar. */
  function ofertaDe(quem) {
    var p = vista.pessoas[quem];
    if (!p || !p.oferta) return null;
    return diaDe(p.oferta.quando) === hoje() ? p.oferta.tarefaId : null;
  }

  // "não dá" tira a tarefa do páreo pela mesma janela do "não quero"
  function recusadaHaPouco(quem, tid) {
    var p = vista.pessoas[quem];
    var quando = p && p.recusas && p.recusas[tid];
    if (!quando) return false;
    return (Date.now() - new Date(quando).getTime()) < JANELA_RECUSA_H * 3600000;
  }

  function voltaAOferecerEm(quem) {
    var p = vista.pessoas[quem];
    if (!p || !p.calado) return null;
    var volta = new Date(new Date(p.calado).getTime() + JANELA_RECUSA_H * 3600000);
    return volta > new Date() ? volta : null;
  }

  function diaEncerradoPara(quem) { return !!voltaAOferecerEm(quem); }

  function horaDe(d) {
    return ('0' + d.getHours()).slice(-2) + 'h' + ('0' + d.getMinutes()).slice(-2);
  }

  // ── entrada e saída ───────────────────────────────────────────────

  /* Conferência do kit: o que você já pegou antes de sair. Não é catálogo (não
     é decisão) nem diário (não é acontecimento) — é rascunho de trinta minutos,
     e por isso mora numa chave própria e fica de fora da exportação. Some
     sozinha quando a tarefa fecha. */
  var CHAVE_KIT = 'app-sitio-kit';
  var kit = {};

  function carregarKit() {
    try { kit = JSON.parse(localStorage.getItem(CHAVE_KIT)) || {}; } catch (e) { kit = {}; }
  }

  function salvarKit() {
    try { localStorage.setItem(CHAVE_KIT, JSON.stringify(kit)); } catch (e) {}
  }

  function conferido(tid, item) { return !!(kit[tid] && kit[tid][item]); }

  function alternarConferido(tid, item) {
    if (!kit[tid]) kit[tid] = {};
    if (kit[tid][item]) delete kit[tid][item];
    else kit[tid][item] = 1;
    salvarKit();
  }

  function limparKit(tid) {
    if (!kit[tid]) return;
    delete kit[tid];
    salvarKit();
  }

  function exportar() { return JSON.stringify(estado, null, 2); }

  /* Importar não escreve direto. A regra 11 diz que nada entra no estado sem
     confirmação — então a leitura devolve o estado candidato e um resumo do
     que muda, e só `confirmarImportacao` grava. Vale para arquivo meu ou seu. */
  function lerImportacao(texto) {
    var candidato = costurar(JSON.parse(texto));
    return { estado: candidato, resumo: compararEstados(estado, candidato) };
  }

  function confirmarImportacao(candidato) {
    // o bilhete é do usuário: nenhuma proposta minha pode apagá-lo
    var meu = estado.bilhete;
    estado = candidato;
    if (meu && !estado.bilhete) estado.bilhete = meu;
    salvar();
    derivar();
    return estado;
  }

  var COLECOES = ['projetos', 'tarefas', 'pendencias', 'sementes'];

  function rotuloDe(x) { return x.nome || x.texto || x.descricao || x.id; }

  /* Carimbo de tempo é escrituração, não conteúdo — e se regenera a cada
     leitura. Comparar com ele dentro faria toda importação parecer que muda
     o mundo inteiro. */
  var RUIDO = ['criadaEm', 'criadoEm', 'ultimoToque'];

  function semRuido(obj) {
    var limpo = {};
    Object.keys(obj).forEach(function (k) {
      if (RUIDO.indexOf(k) === -1) limpo[k] = obj[k];
    });
    return JSON.stringify(limpo);
  }

  function porId(lista) {
    var mapa = {};
    lista.forEach(function (x) { mapa[x.id] = x; });
    return mapa;
  }

  function compararEstados(antigo, novo) {
    return COLECOES.map(function (nome) {
      var a = porId(antigo.catalogo[nome] || []);
      var b = porId(novo.catalogo[nome] || []);
      var entram = [], saem = [], mudam = [];

      Object.keys(b).forEach(function (k) {
        if (!a[k]) entram.push(rotuloDe(b[k]));
        else if (semRuido(a[k]) !== semRuido(b[k])) mudam.push(rotuloDe(b[k]));
      });
      Object.keys(a).forEach(function (k) {
        if (!b[k]) saem.push(rotuloDe(a[k]));
      });

      return { colecao: nome, entram: entram, saem: saem, mudam: mudam };
    }).filter(function (r) {
      return r.entram.length || r.saem.length || r.mudam.length;
    });
  }

  return {
    PERFIS: PERFIS, LOCAIS: LOCAIS, CLIMAS: CLIMAS, ESFORCOS: ESFORCOS, PESOS: PESOS,
    juntandoDinheiro: juntandoDinheiro, faltaDinheiro: faltaDinheiro,
    SITUACOES: SITUACOES, MOTIVOS_NAO_DA: MOTIVOS_NAO_DA,
    HORARIOS: HORARIOS, DIAS_SEMANA: DIAS_SEMANA, ETAPAS: ETAPAS,
    NOMES_DIA: NOMES_DIA, NOMES_MES: NOMES_MES, TODOS_MESES: TODOS_MESES,
    janelaDe: janelaDe, avisosDe: avisosDe, ultimaVezDe: ultimaVezDe,
    formatarData: formatarData, anotacoesDe: anotacoesDe, reabrir: reabrir,
    historicoDe: historicoDe, periodica: periodica, diaDe: diaDe, diaLocal: diaLocal,
    recusadaHaPouco: recusadaHaPouco, avisosDeCascata: avisosDeCascata,
    temTarefaAtiva: temTarefaAtiva,

    // sincronização
    quandoSalvar: quandoSalvar, quandoRegistrar: quandoRegistrar, receberCatalogo: receberCatalogo, unirDiario: unirDiario,
    fotografarCatalogo: fotografarCatalogo, fotoDoCatalogo: fotoDoCatalogo, voltarAFoto: voltarAFoto,
    catalogoVazio: catalogoVazio, versaoDoCatalogo: versaoDoCatalogo, relerSeOutraAbaGravou: relerSeOutraAbaGravou,
    usoIniciar: usoIniciar, usoTela: usoTela, usoFechar: usoFechar, usoRetomar: usoRetomar,
    usoAtividade: usoAtividade, usoVerificarOcio: usoVerificarOcio,
    DIARISTA: DIARISTA, podeSeparar: podeSeparar, separadas: separadas, separarTarefa: separarTarefa,
    desfazerSeparacao: desfazerSeparacao, reordenarSeparadas: reordenarSeparadas,
    definirDiaDiarista: definirDiaDiarista, fecharDiarista: fecharDiarista, minutosSeparados: minutosSeparados,
    tarefasDaRua: tarefasDaRua, reordenarRua: reordenarRua,
    separadaDe: separadaDe, separarPorEvento: separarPorEvento, absorverSeparadas: absorverSeparadas,
    perguntaEmpacou: perguntaEmpacou, empacar: empacar, notaEmpacou: notaEmpacou,
    semear: semear, absorverSementes: absorverSementes, sementesDe: sementesDe,
    anotar: anotar, riscarAnotacao: riscarAnotacao, anotacoes: anotacoes,
    aportar: aportar, aportesDe: aportesDe,
    apelido: apelido,
    nomeDe: nomeDe,

    // diário
    derivar: derivar, tarefasVivas: tarefasVivas, desimpedida: desimpedida,
    estadoDe: estadoDe, restanteDe: restanteDe, recadoDe: recadoDe,
    vistaDe: vistaDe, porQueEspera: porQueEspera, destravaQuantas: destravaQuantas,
    tarefaAtivaDe: tarefaAtivaDe, diaEncerradoPara: diaEncerradoPara,
    voltaAOferecerEm: voltaAOferecerEm, horaDe: horaDe,
    ofertar: ofertar, ofertaDe: ofertaDe,
    iniciar: iniciar, terminar: terminar, parar: parar,
    naoDeu: naoDeu, naoQuero: naoQuero, encerrar: encerrar, devolverTempo: devolverTempo,
    registrarClima: registrarClima, climaDeHoje: climaDeHoje, verVitrine: verVitrine,


    carregar: carregar, salvar: salvar, tudo: tudo, cat: cat, estaVazio: estaVazio,
    lerBilhete: lerBilhete, escreverBilhete: escreverBilhete,
    projeto: projeto, tarefa: tarefa, pendencia: pendencia,
    passosDe: passosDe, avulsas: avulsas,

    situacaoDe: situacaoDe, definirSituacao: definirSituacao, etiquetaDe: etiquetaDe,
    envelopeCheio: envelopeCheio, motivoTrancado: motivoTrancado,
    TETO_MUDAS: TETO_MUDAS, mudasVivas: mudasVivas, motivoTetoMudas: motivoTetoMudas,
    faltaParaPronta: faltaParaPronta, mudaPronta: mudaPronta, marcarMudaPronta: marcarMudaPronta,
    voltarAPlantar: voltarAPlantar, descartarMuda: descartarMuda, reabrirMuda: reabrirMuda,
    leituraFria: leituraFria, cadeiasVivas: cadeiasVivas,
    prerequisitosPendentes: prerequisitosPendentes, passoCorrente: passoCorrente,
    resolvida: resolvida, tarefasAbertasDe: tarefasAbertasDe,
    projetoPorPapel: projetoPorPapel, planejamentoFechado: planejamentoFechado,
    aptaParaExecucao: aptaParaExecucao, planejadas: planejadas,
    oQueFaltaParaSubir: oQueFaltaParaSubir, cascatearVagas: cascatearVagas,
    fecharProjeto: fecharProjeto, retomarProjeto: retomarProjeto,
    promoverParaPlanejamento: promoverParaPlanejamento,
    promoverParaReserva: promoverParaReserva, revisarPlano: revisarPlano,
    diasDesde: diasDesde,
    blocoDe: blocoDe, janelaDoPreset: janelaDoPreset,

    pendenciasAbertas: pendenciasAbertas, nivelPendencia: nivelPendencia,
    esperarPara: esperarPara, esperasDe: esperasDe,
    desfazerPendencia: desfazerPendencia,
    faltarItem: faltarItem, comprarItem: comprarItem, encomendarItem: encomendarItem,
    mudarViaItem: mudarViaItem, absorverCompras: absorverCompras, itensDaRua: itensDaRua,
    inserirCompra: inserirCompra, estadoDaCompra: estadoDaCompra,
    listarCompra: listarCompra, comprasVaziasDependentesDe: comprasVaziasDependentesDe,
    textoPendencia: textoPendencia, inserirPendencia: inserirPendencia,
    resolverPendencia: resolverPendencia,

    conferido: conferido, alternarConferido: alternarConferido, limparKit: limparKit,
    moeda: moeda, duracao: duracao, agora: agora, hoje: hoje,

    moverEtapa: moverEtapa,
    inserirProjeto: inserirProjeto, inserirPasso: inserirPasso,
    removerProjeto: removerProjeto, removerTarefa: removerTarefa,
    reordenar: reordenar,
    inserirSemente: inserirSemente, semente: semente,
    classificarSemente: classificarSemente, promoverSemente: promoverSemente,
    semearTarefa: semearTarefa, sementesParaTarefa: sementesParaTarefa, buscar: buscar,
    todasAsTags: todasAsTags, normalizarTag: normalizarTag, porTag: porTag, tirarTag: tirarTag,
    ESTADOS_SEMENTE: ESTADOS_SEMENTE,

    exportar: exportar,
    lerImportacao: lerImportacao, confirmarImportacao: confirmarImportacao
  };
})();
