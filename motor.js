/* App do sítio — motor da consulta.
 *
 * Recebe a situação informada e devolve UMA tarefa. Nunca uma lista.
 *
 * A ordem em que as coisas mandam:
 *   1. filtro     — o que é possível nesta situação exata (§6)
 *   2. faixa      — data marcada > periódico vencido > o resto (§7)
 *   3. cascata    — titular > reserva > planejamento, dentro da faixa 3
 *   4. peso       — só ordena dentro do que sobrou
 *
 * Cada projeto apresenta UM candidato: o de menor ordem entre os elegíveis.
 * Assim o peso nunca embaralha a sequência de uma obra — ele arbitra só entre
 * projetos, avulsas e periódicos.
 */

var Motor = (function () {
  'use strict';

  var M = Modelo;

  /* As janelas grandes dependem da hora: oferecer "a manhã" às três da tarde é
     o app mentindo sobre um tempo que já passou, e o usuário responde uma coisa
     que não existe. O aparelho sabe que horas são — a §21 só proíbe automatizar
     o CLIMA, porque informar o tempo é escolha consciente. Que horas são não
     tem escolha dentro. */
  var TEMPOS = [
    { v: 30,  t: '30 min' },
    { v: 60,  t: '1 h' },
    { v: 120, t: '2 h' }
  ];

  function temposDe(quando) {
    var h = (quando || new Date()).getHours();
    var lista = TEMPOS.slice();

    if (h < 12) {
      lista.push({ v: 240, t: 'a manhã' });
      // depois das dez, "o dia" já não é verdade
      if (h < 10) lista.push({ v: 480, t: 'o dia' });
    } else if (h < 18) {
      lista.push({ v: 240, t: 'a tarde' });
    } else {
      lista.push({ v: 180, t: 'a noite' });
    }
    return lista;
  }

  function situacaoVazia() {
    return {
      quem: 'pe_eu',
      local: null,          // 'sitio' | 'computador' | 'fora'
      minutos: null,
      tempo: null,          // 'sol' | 'nublado' | 'chuva_fina' | 'chuva_forte'
      barro: null,
      criancas: false,
      ajuda: false,
      energia: 'normal',    // 'normal' | 'pouca'
      segundaChamada: false // inclui tolera_chuva_fina
    };
  }

  // ── situação do relógio ───────────────────────────────────────────

  function minutosDoDia(d) { return d.getHours() * 60 + d.getMinutes(); }

  function paraMinutos(hhmm) {
    var p = String(hhmm || '').split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  /* Os três eixos do "é possível acontecer": hora do dia, dia da semana e mês
     do ano. O aparelho sabe os três sem perguntar nada. */
  function cabeNaJanela(t, agora) {
    var j = M.janelaDe(t);
    if (j.dias.indexOf(agora.getDay()) === -1) return false;
    if (j.meses.indexOf(agora.getMonth() + 1) === -1) return false;
    var m = minutosDoDia(agora);
    return m >= paraMinutos(j.de) && m <= paraMinutos(j.ate);
  }

  /* Execução espera o planejamento do próprio projeto terminar. É a regra que
     impede cavar 38 buracos antes de saber se o eucalipto cabe no bolso. */
  function planejamentoAberto(pid) {
    return M.passosDe(pid).some(function (t) {
      return t.etapa === 'planejamento' && M.estadoDe(t.id) === 'aberta';
    });
  }

  function chovendo(s) { return s.tempo === 'chuva_fina' || s.tempo === 'chuva_forte'; }

  var VAGAS = ['titular', 'reserva', 'planejamento'];

  // ── filtro (§6) ───────────────────────────────────────────────────

  function cabeNoTempo(t, minutos) {
    var restante = M.restanteDe(t.id);
    return t.podeParar ? minutos >= M.blocoDe(t) : minutos >= restante;
  }

  function passaNaSituacao(t, s, agora) {
    if (t.ondePrecisaEstar !== s.local) return false;
    if (!cabeNaJanela(t, agora)) return false;
    if (!cabeNoTempo(t, s.minutos)) return false;

    if (s.energia === 'pouca' && t.esforco !== 'leve') return false;
    if (t.precisaAjuda && !s.ajuda) return false;
    if (s.criancas && t.perigosaComCriancas) return false;

    // fora do sítio, clima e chão não dizem nada
    if (s.local !== 'sitio') return true;

    if (t.exigeSoloFirme && s.barro) return false;

    if (t.exigeClima === 'firme' && chovendo(s)) return false;
    if (t.exigeClima === 'tolera_chuva_fina') {
      if (s.tempo === 'chuva_forte') return false;
      // dá para fazer molhando: só na segunda chamada, com a ressalva na cara
      if (s.tempo === 'chuva_fina' && !s.segundaChamada) return false;
    }
    return true;
  }

  /* Guardada para a chuva sai do páreo normal em dia seco — capacidade é uma
     coisa, economia é outra. Vai para a segunda porta. */
  function noPareoNormal(t, s) {
    return !(t.guardadaParaChuva && !chovendo(s));
  }

  /* Projeto sem vaga não emite tarefa nenhuma — nem por prazo, nem por
     periódico. Só as três vagas abertas e as avulsas chegam ao páreo; é o teto
     de frentes que impede o volume de obrigação de crescer. */
  function emitindo(t) {
    if (t.separada) return false;   // está na folha do diarista: não é do Dan hoje
    if (!t.projetoId) return true;
    var p = M.projeto(t.projetoId);
    if (!p || VAGAS.indexOf(p.papel) === -1) return false;
    /* A vaga de planejamento é para decidir, não para fazer: execução só sai
       de titular ou reserva. Sem isto, fechar a última tarefa de planejamento
       fazia a execução começar a ser oferecida antes de o projeto ser
       promovido — e a promoção é escolha, de propósito. */
    if (t.etapa === 'execucao' && p.papel === 'planejamento') return false;
    if (t.etapa === 'execucao' && planejamentoAberto(t.projetoId)) return false;
    return true;
  }

  /* Periódico antes da hora: não antecipável fica de fora até vencer;
     antecipável só entra pela segunda porta (§6). Antes os dois vinham pelo
     páreo normal como tarefa comum — feito hoje, aparecia de novo amanhã. */
  function periodicoAdiantado(t, agora) {
    return M.periodica(t) && atrasoPeriodico(t, agora) < 0;
  }

  /* Adiantar tem limite: "até N dias antes de vencer". Feita ontem, a rotina
     não volta pela segunda porta amanhã — e ninguém precisa dizer "não quero"
     para uma coisa que acabou de fazer. */
  function podeAdiantar(t, agora) {
    var n = (t.prazo && t.prazo.antecipavelDias) || 0;
    return n > 0 && atrasoPeriodico(t, agora) >= -n;
  }

  function elegiveis(s, agora) {
    return M.tarefasVivas().filter(function (t) {
      if (M.recusadaHaPouco(s.quem, t.id)) return false;
      if (periodicoAdiantado(t, agora) && !podeAdiantar(t, agora)) return false;
      return emitindo(t) && M.desimpedida(t) && passaNaSituacao(t, s, agora);
    });
  }

  // ── faixas (§7) ───────────────────────────────────────────────────

  function diasDeFolga(iso, agora) {
    var alvo = new Date(iso + 'T00:00:00');
    var hoje = new Date(M.diaLocal(agora) + 'T00:00:00');
    return Math.round((alvo - hoje) / 86400000);
  }

  function faixaDe(t, agora) {
    if (t.agendada && t.agendada.em && diasDeFolga(t.agendada.em, agora) <= 0) return 1;
    if (t.prazo && t.prazo.tipo === 'data' && t.prazo.em) {
      return diasDeFolga(t.prazo.em, agora) <= 0 ? 1 : 3;
    }
    if (t.prazo && t.prazo.tipo === 'periodico') {
      return atrasoPeriodico(t, agora) >= 0 ? 2 : 3;
    }
    return 3;
  }

  /* Conta do dia em que foi feito, não da data original — decisão de 17/08.
     Sem "última vez" preenchida, conta da criação da tarefa. */
  function atrasoPeriodico(t, agora) {
    var base = M.ultimaVezDe(t.id) || M.diaDe(t.criadaEm);
    var venc = new Date(base + 'T00:00:00');
    venc.setDate(venc.getDate() + (t.prazo.cadenciaDias || 30));
    return -diasDeFolga(M.diaLocal(venc), agora);
  }

  // ── peso da faixa 3 ───────────────────────────────────────────────
  /* Números são ponto de partida para calibrar no uso, como manda a §7.
     O encaixe de tempo saiu de propósito: obra grande ocupa 100% de qualquer
     janela por definição e ganharia sempre. Tempo agora é só filtro. */

  function peso(t, s) {
    var p = 0;
    var proj = t.projetoId ? M.projeto(t.projetoId) : null;

    p += 10 * M.destravaQuantas(t.id);
    if (t.precisaAjuda && s.ajuda) p += 7;
    if (t.boaComCriancas && s.criancas) p += 5;
    if (proj && proj.estado === 'ativo') p += 4;

    var restante = M.restanteDe(t.id);
    if (t.duracaoTotal && restante <= t.duracaoTotal * 0.25) p += 3;
    if (proj && proj.natureza === 'acumulavel') p -= 2;

    return p;
  }

  // ── cascata (§7) ──────────────────────────────────────────────────
  /* Se existe qualquer tarefa elegível na titular, é titular — regra dura, não
     peso. A reserva só aparece quando a titular está seca, e o planejamento só
     quando as duas estão. Cada projeto apresenta um candidato só. */

  function candidatoDoProjeto(pid, pool) {
    return pool.filter(function (t) { return t.projetoId === pid; })
      .sort(function (a, b) { return a.ordem - b.ordem; })[0] || null;
  }

  function projetoComPapel(papel) {
    return M.cat().projetos.filter(function (p) { return p.papel === papel; })[0] || null;
  }

  function poolDaFaixa3(pool) {
    // avulsas sempre disputam: são o lastro que responde quando tudo trava
    var candidatos = pool.filter(function (t) { return !t.projetoId; });

    for (var i = 0; i < VAGAS.length; i++) {
      var proj = projetoComPapel(VAGAS[i]);
      var c = proj ? candidatoDoProjeto(proj.id, pool) : null;
      if (c) { candidatos.push(c); break; }
    }
    return candidatos;
  }

  // ── escolha ───────────────────────────────────────────────────────

  function escolher(s, quando) {
    var agora = quando || new Date();

    if (M.diaEncerradoPara(s.quem)) return { vazio: 'dia_encerrado' };

    var ativa = M.tarefaAtivaDe(s.quem);
    if (ativa) return { ativa: ativa };

    // periódico antecipável antes da hora é assunto da segunda porta, só dela
    var todas = elegiveis(s, agora).filter(function (t) { return !periodicoAdiantado(t, agora); });

    var r = decidir(todas.filter(function (t) { return noPareoNormal(t, s); }), s, agora);
    if (r) return marcarMolhada(r, s);

    /* Nada no páreo normal. Guardar o dia seco só faz sentido se houver outra
       coisa para gastar o dia seco com — não havendo, guardar é desperdício e
       esconder a única tarefa disponível atrás de um botão é pior ainda. */
    r = decidir(todas, s, agora);
    if (r) { r.guardada = true; return marcarMolhada(r, s); }

    return { vazio: 'nada', temSegundaPorta: !!segundaPorta(s, agora).length };
  }

  // a ressalva "você vai se molhar" viaja com a resposta, não só com o botão
  function marcarMolhada(r, s) {
    if (s.segundaChamada && r.tarefa && r.tarefa.exigeClima === 'tolera_chuva_fina' && chovendo(s)) {
      r.molhada = true;
    }
    return r;
  }

  function decidir(pool, s, agora) {
    var f1 = pool.filter(function (t) { return faixaDe(t, agora) === 1; });
    if (f1.length) {
      f1.sort(function (a, b) { return folgaDe(a, agora) - folgaDe(b, agora); });
      return { tarefa: f1[0], faixa: 1 };
    }

    /* A oferta anterior gruda enquanto continuar possível. Responder de novo é
       livre e continua de graça — só não muda a resposta, e é isso que fecha o
       percorrer por reconsulta. Mudar de verdade a situação (menos tempo, menos
       energia) tira a tarefa do páreo, e aí ela cai sozinha. Data marcada,
       acima, passa na frente mesmo assim. */
    var grudada = M.ofertaDe(s.quem);
    if (grudada) {
      var mesma = pool.filter(function (t) { return t.id === grudada; })[0];
      if (mesma) return { tarefa: mesma, faixa: faixaDe(mesma, agora), grudada: true };
    }

    var f2 = pool.filter(function (t) { return faixaDe(t, agora) === 2; });
    if (f2.length) {
      f2.sort(function (a, b) { return atrasoPeriodico(b, agora) - atrasoPeriodico(a, agora); });
      return { tarefa: f2[0], faixa: 2 };
    }

    var f3 = poolDaFaixa3(pool.filter(function (t) { return faixaDe(t, agora) === 3; }));
    if (!f3.length) return null;

    f3.sort(function (a, b) {
      var d = peso(b, s) - peso(a, s);
      return d || (a.criadaEm < b.criadaEm ? -1 : 1);   // empate: a mais antiga
    });
    return { tarefa: f3[0], faixa: 3 };
  }

  function folgaDe(t, agora) {
    if (t.agendada && t.agendada.em) return diasDeFolga(t.agendada.em, agora);
    if (t.prazo && t.prazo.em) return diasDeFolga(t.prazo.em, agora);
    return 0;
  }

  /* A segunda porta é aberta pelo usuário, nunca oferecida como sugestão.
     Descansar é o caminho padrão. */
  function segundaPorta(s, agora) {
    return elegiveis(s, agora).filter(function (t) {
      if (t.guardadaParaChuva && !chovendo(s)) return true;
      if (periodicoAdiantado(t, agora) && podeAdiantar(t, agora)) return true;
      return false;
    });
  }

  function escolherSegundaPorta(s, quando) {
    var agora = quando || new Date();
    var lista = segundaPorta(s, agora);
    lista.sort(function (a, b) { return peso(b, s) - peso(a, s); });
    return lista[0] || null;
  }

  /* Chuva e nada limpo: repete o filtro incluindo tolera_chuva_fina e diz a
     ressalva na cara — "isto dá, mas você vai se molhar". */
  function temSegundaChamada(s, agora) {
    if (!chovendo(s)) return false;
    var molhado = Object.assign({}, s, { segundaChamada: true });
    return escolher(molhado, agora).tarefa != null;
  }

  return {
    TEMPOS: TEMPOS, temposDe: temposDe,
    situacaoVazia: situacaoVazia,
    escolher: escolher,
    escolherSegundaPorta: escolherSegundaPorta,
    segundaPorta: segundaPorta,
    temSegundaChamada: temSegundaChamada,
    elegiveis: elegiveis,
    peso: peso, faixaDe: faixaDe, cabeNaJanela: cabeNaJanela
  };
})();
