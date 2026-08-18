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

  /* Estado e papel eram dois controles que se contradiziam — dava para marcar
     "titular" e "fila" ao mesmo tempo. Viraram um só; os dois campos por baixo
     continuam, porque o motor de elegibilidade lê cada um por um motivo. */
  var SITUACOES = [
    { v: 'fila',         t: 'fila — pré-projeto', estado: 'fila',      papel: '' },
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
        absorvidas: []
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
      if (cru) estado = costurar(JSON.parse(cru));
    } catch (e) {
      console.warn('Não consegui ler o guardado. Começando vazio.', e);
    }
    carregarKit();
    derivar();
    return estado;
  }

  /* Gravar o catálogo refaz a vista: uma tarefa recém-criada precisa existir
     para o motor com o restante certo antes de qualquer evento — senão ela
     entrava no páreo com restante zero e "cabia" em qualquer janela. */
  var aoSalvar = null;      // quem quer saber que algo foi gravado (a sincronização)
  var silencio = false;     // gravação vinda de fora não avisa de volta

  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
    } catch (e) {
      console.warn('Não consegui gravar. Use exportar como paraquedas.', e);
    }
    derivar();
    if (aoSalvar && !silencio) aoSalvar();
  }

  function quandoSalvar(fn) { aoSalvar = fn; }

  // ── sincronização: o que o modelo oferece ao Sync ────────────────

  /* O catálogo que veio de fora substitui o daqui: só a mesa escreve, e este
     aparelho não é a mesa. Devolve se mudou algo. */
  function receberCatalogo(remoto) {
    var novo = costurar({ catalogo: remoto, diarios: estado.diarios, bilhete: estado.bilhete });
    if (JSON.stringify(novo.catalogo) === JSON.stringify(estado.catalogo)) return false;
    estado.catalogo = novo.catalogo;
    silencio = true; salvar(); silencio = false;
    return true;
  }

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
    // zona + ponto diziam a mesma coisa e viraram um campo só
    if (t.zona || t.ponto) {
      t.onde = t.onde || [t.zona, t.ponto].filter(Boolean).join(' · ');
      delete t.zona; delete t.ponto;
    }
    // ferramenta e material viraram lista
    t.ferramentas = comoLista(t.ferramentas);
    t.materiais = comoLista(t.materiais);

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
  function costurarProjeto(p)  { return completar(p, novoProjeto()); }
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
      criadoEm: agora(),
      ultimoToque: agora()
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
      guardadaParaChuva: false,
      exigeSoloFirme: false,

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

  function novaPendencia(descricao) {
    return {
      id: id('x'),
      descricao: descricao || '',
      projetoId: null,
      tarefaId: null,          // a tarefa que ela destrava quando chegar
      desde: hoje(),
      previsto: hoje(),
      resolvida: null          // null | 'chegou' | 'cancelada'
    };
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

  /* A semente nunca é apagada: ela muda de ESTADO, e o estado é o registro —
     de como o app foi usado e do que aconteceu com cada ideia dela.
       nova            — como nasce, de quem quer que tenha plantado
       descartada      — com motivo obrigatório: quem plantou tem que poder ler
       projeto/tarefa  — aprovada: pode virar pré-projeto / tarefa avulsa
       virou_projeto / virou_tarefa — terminais, com o id do que nasceu dela */
  var ESTADOS_SEMENTE = ['nova', 'descartada', 'projeto', 'tarefa', 'virou_projeto', 'virou_tarefa'];

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
     pré-projeto, juntando e pronto CAEM SOZINHOS conforme o custo aparece e o
     envelope enche — o usuário não escolhe esses três. */
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
      if (p.custoEstimado === null || p.custoEstimado === undefined) {
        return { chave: 'pre', texto: 'pré-projeto' };
      }
      return envelopeCheio(p)
        ? { chave: 'pronto', texto: 'pronto' }
        : { chave: 'juntando', texto: 'juntando dinheiro' };
    }
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
      ondePrecisaEstar: 'computador', duracaoTotal: 60, quando: COMERCIAL },
    { texto: 'Comprar o que falta',
      ondePrecisaEstar: 'fora', duracaoTotal: 180, podeParar: false, quando: COMERCIAL }
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
    if (['ativo', 'preparo', 'concluido', 'encerrado'].indexOf(p.estado) !== -1) return null;

    var faltando = prerequisitosPendentes(p);
    if (faltando.length) {
      return 'Espera ' + faltando.map(function (q) { return q.nome || 'projeto sem nome'; }).join(' e ') + '.';
    }
    if (p.custoEstimado === null || p.custoEstimado === undefined) return 'Sem orçamento levantado.';
    if (!envelopeCheio(p)) return 'Faltam ' + moeda(p.custoEstimado - p.guardado) + '.';
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
    var anterior = projetoPorPapel('planejamento');
    definirSituacao(pid, 'planejamento');   // expulsa o ocupante e semeia o esqueleto
    return anterior && anterior.id !== pid ? anterior : null;
  }

  /* Filtros estruturais: valem em qualquer situação. Os de momento — clima,
     tempo, energia, horário — são do motor da consulta. */
  function desimpedida(t) {
    if (estadoDe(t.id) !== 'aberta') return false;

    // travou nela: espera o pensamento que você mesmo mandou fazer
    var trava = vistaDe(t.id).travadaPor;
    if (trava && estadoDe(trava) !== 'feita') return false;

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
  function porQueEspera(t) {
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
    var folga = diasAte(x.previsto);
    if (folga < 0) return 'vermelho';
    if (folga <= BEIRA_DO_PRAZO) return 'amarelo';
    return 'verde';
  }

  function textoPendencia(x) {
    var folga = diasAte(x.previsto);
    if (folga < 0)  return 'Era para ter chegado há ' + (-folga) + (folga === -1 ? ' dia.' : ' dias.');
    if (folga === 0) return 'Chega hoje.';
    if (folga === 1) return 'Chega amanhã.';
    return 'Chega em ' + folga + ' dias.';
  }

  function pendenciasAbertas() {
    var peso = { vermelho: 0, amarelo: 1, verde: 2 };
    return cat().pendencias
      .filter(function (x) { return !x.resolvida; })
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

  function inserirPasso(pid, modelo) {
    var passos = pid ? passosDe(pid) : avulsas();
    var t = novaTarefa(pid, passos.length + 1);
    if (modelo) herdarDoAnterior(t, modelo);
    cat().tarefas.push(t);
    salvar();
    return t;
  }

  function removerProjeto(pid) {
    cat().projetos = cat().projetos.filter(function (p) { return p.id !== pid; });
    cat().tarefas = cat().tarefas.filter(function (t) { return t.projetoId !== pid; });
    cat().projetos.forEach(function (p) {
      p.prerequisitos = (p.prerequisitos || []).filter(function (q) { return q !== pid; });
    });
    salvar();
  }

  function removerTarefa(tid) {
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
    if (movidas.length) salvar();
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

  var vista = { tarefas: {}, pessoas: {}, extras: [] };

  function diarioDe(quem) {
    if (!estado.diarios[quem]) estado.diarios[quem] = { pessoa: quem, eventos: [] };
    return estado.diarios[quem];
  }

  function registrar(quem, tipo, dados) {
    var ev = { id: id('ev'), quando: agora(), quem: quem, tipo: tipo };
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
    vista = { tarefas: {}, pessoas: {}, extras: [] };

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
        linhas[t.id] = { tarefa: t, tipo: 'feita', quando: ev.quando, nota: ev.anotacao || '' };
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
    { v: 'sem_ferramenta',    t: 'Não tenho essa ferramenta',      destrave: 'Comprar a ferramenta: ' },
    { v: 'faltou_material',   t: 'Faltou material',                destrave: 'Encomendar o material: ' },
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
    if (regra && regra.destrave) {
      var d = novaTarefa(t ? t.projetoId : null, 0);
      d.texto = regra.destrave + (nota || (t ? t.texto : ''));
      d.ondePrecisaEstar = (motivo === 'terceiro') ? 'fora'
                         : (motivo === 'sem_ferramenta' || motivo === 'faltou_material') ? 'computador'
                         : 'sitio';
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

  function estadoDe(tid)   { return vistaDe(tid).estado; }
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
    PERFIS: PERFIS, LOCAIS: LOCAIS, CLIMAS: CLIMAS, ESFORCOS: ESFORCOS,
    SITUACOES: SITUACOES, MOTIVOS_NAO_DA: MOTIVOS_NAO_DA,
    HORARIOS: HORARIOS, DIAS_SEMANA: DIAS_SEMANA, ETAPAS: ETAPAS,
    NOMES_DIA: NOMES_DIA, NOMES_MES: NOMES_MES, TODOS_MESES: TODOS_MESES,
    janelaDe: janelaDe, avisosDe: avisosDe, ultimaVezDe: ultimaVezDe,
    formatarData: formatarData, anotacoesDe: anotacoesDe, reabrir: reabrir,
    historicoDe: historicoDe, periodica: periodica, diaDe: diaDe, diaLocal: diaLocal,
    recusadaHaPouco: recusadaHaPouco, avisosDeCascata: avisosDeCascata,
    temTarefaAtiva: temTarefaAtiva,

    // sincronização
    quandoSalvar: quandoSalvar, receberCatalogo: receberCatalogo, unirDiario: unirDiario,
    semear: semear, absorverSementes: absorverSementes, sementesDe: sementesDe,

    // diário
    derivar: derivar, tarefasVivas: tarefasVivas, desimpedida: desimpedida,
    estadoDe: estadoDe, restanteDe: restanteDe, recadoDe: recadoDe,
    vistaDe: vistaDe, porQueEspera: porQueEspera, destravaQuantas: destravaQuantas,
    tarefaAtivaDe: tarefaAtivaDe, diaEncerradoPara: diaEncerradoPara,
    voltaAOferecerEm: voltaAOferecerEm, horaDe: horaDe,
    ofertar: ofertar, ofertaDe: ofertaDe,
    iniciar: iniciar, terminar: terminar, parar: parar,
    naoDeu: naoDeu, naoQuero: naoQuero, encerrar: encerrar, devolverTempo: devolverTempo,
    registrarClima: registrarClima, climaDeHoje: climaDeHoje,


    carregar: carregar, salvar: salvar, tudo: tudo, cat: cat, estaVazio: estaVazio,
    lerBilhete: lerBilhete, escreverBilhete: escreverBilhete,
    projeto: projeto, tarefa: tarefa, pendencia: pendencia,
    passosDe: passosDe, avulsas: avulsas,

    situacaoDe: situacaoDe, definirSituacao: definirSituacao, etiquetaDe: etiquetaDe,
    envelopeCheio: envelopeCheio, motivoTrancado: motivoTrancado,
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
    semearTarefa: semearTarefa, sementesParaTarefa: sementesParaTarefa,
    ESTADOS_SEMENTE: ESTADOS_SEMENTE,

    exportar: exportar,
    lerImportacao: lerImportacao, confirmarImportacao: confirmarImportacao
  };
})();
