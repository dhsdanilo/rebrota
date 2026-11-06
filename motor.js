/* App do sítio — o leque.
 *
 * §64: o app deixou de escolher. Não há sorteio, nem filtro de situação (tempo
 * disponível, clima, chão, esforço, companhia): quem julga o que fazer agora é
 * ele. O motor só diz o que está DISPONÍVEL — o que dá para fazer — e a
 * vitrine mostra o leque inteiro, sem botão de oferta e sem custo.
 *
 * O que ainda decide se uma tarefa aparece é estrutural:
 *   - o projeto dela está numa vaga (ativo ou planejamento); sem vaga não emite;
 *   - nada a segura (dependência, espera, dinheiro, travou, delegada);
 *   - o dia-alvo cabe no dia da semana e no mês dela (hora do dia não conta);
 *   - rotina só aparece quando venceu ou entrou na janela de adiantar.
 */

var Motor = (function () {
  'use strict';

  var M = Modelo;

  var VAGAS = ['ativo', 'planejamento'];

  /* Execução espera o planejamento do próprio projeto terminar. É a regra que
     impede cavar 38 buracos antes de saber se o eucalipto cabe no bolso. */
  function planejamentoAberto(pid) {
    return M.passosDe(pid).some(function (t) {
      return t.etapa === 'planejamento' && M.estadoDe(t.id) === 'aberta';
    });
  }

  /* Projeto sem vaga não emite tarefa nenhuma — nem por prazo, nem por
     periódico. Só as vagas abertas e as avulsas chegam ao leque; é o teto de
     frentes que impede o volume de obrigação de crescer. */
  function emitindo(t) {
    if (t.tipo === 'compra') return false;   // passo-compra não se oferece: se compra (§57)
    if (M.separadaDe(t.id)) return false;   // na folha do diarista (ou delegada pela bota, §60)
    if (!t.projetoId) return true;
    var p = M.projeto(t.projetoId);
    if (!p || VAGAS.indexOf(p.papel) === -1) return false;
    /* A vaga de planejamento é para decidir, não para fazer: execução só sai
       de projeto ativo. Sem isto, fechar a última tarefa de planejamento
       fazia a execução começar a aparecer antes de o projeto ser promovido —
       e a promoção é escolha, de propósito. */
    if (t.etapa === 'execucao' && p.papel === 'planejamento') return false;
    if (t.etapa === 'execucao' && planejamentoAberto(t.projetoId)) return false;
    return true;
  }

  // ── datas ─────────────────────────────────────────────────────────

  function diasDeFolga(iso, agora) {
    var alvo = new Date(iso + 'T00:00:00');
    var hoje = new Date(M.diaLocal(agora) + 'T00:00:00');
    return Math.round((alvo - hoje) / 86400000);
  }

  /* 1 = data marcada chegou · 2 = rotina vencida · 3 = o resto (§7) */
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

  function folgaDe(t, agora) {
    if (t.agendada && t.agendada.em) return diasDeFolga(t.agendada.em, agora);
    if (t.prazo && t.prazo.em) return diasDeFolga(t.prazo.em, agora);
    return 0;
  }

  /* Rotina antes da hora: só entra no leque dentro da janela de adiantar
     ("até N dias antes de vencer"). Feita ontem, não volta amanhã. */
  function periodicoAdiantado(t, agora) {
    return M.periodica(t) && atrasoPeriodico(t, agora) < 0;
  }

  function podeAdiantar(t, agora) {
    var n = (t.prazo && t.prazo.antecipavelDias) || 0;
    return n > 0 && atrasoPeriodico(t, agora) >= -n;
  }

  /* Dia da semana e mês — a hora do dia não conta mais (§64). */
  function cabeNoDia(t, alvo) {
    var j = M.janelaDe(t);
    return j.dias.indexOf(alvo.getDay()) !== -1 && j.meses.indexOf(alvo.getMonth() + 1) !== -1;
  }

  // ── o leque ───────────────────────────────────────────────────────

  /* Todas as tarefas disponíveis dos projetos ativos (e em planejamento), mais
     as urgentes de qualquer origem — data marcada e rotina vencida, que podem
     ser avulsas. Avulsa comum fica de fora: ela mora na própria lista. "Fora"
     também: rua é a folha da rua. Ordem: urgentes primeiro, depois um projeto
     por vez, na ordem das tarefas dele. */
  function vitrine(quando) {
    var alvo = quando || new Date();

    var pool = M.tarefasVivas().filter(function (t) {
      if (M.estadoDe(t.id) !== 'aberta' || t.tipo === 'compra') return false;
      if (t.ondePrecisaEstar === 'fora') return false;
      if (!emitindo(t) || !M.desimpedida(t)) return false;
      if (!cabeNoDia(t, alvo)) return false;
      if (periodicoAdiantado(t, alvo) && !podeAdiantar(t, alvo)) return false;
      return true;
    });

    var usadas = {}, lista = [];
    function poe(t, rotulo) {
      if (t && !usadas[t.id]) { usadas[t.id] = true; lista.push({ tarefa: t, rotulo: rotulo }); }
    }

    // 1. as urgentes: data marcada (mais perto primeiro), depois rotina vencida (mais atrasada primeiro)
    var urgentes = pool.filter(function (t) { var f = faixaDe(t, alvo); return f === 1 || f === 2; });
    urgentes.sort(function (a, b) {
      var fa = faixaDe(a, alvo), fb = faixaDe(b, alvo);
      if (fa !== fb) return fa - fb;
      return fa === 1 ? folgaDe(a, alvo) - folgaDe(b, alvo)
                      : atrasoPeriodico(b, alvo) - atrasoPeriodico(a, alvo);
    });
    urgentes.forEach(function (t) {
      poe(t, faixaDe(t, alvo) === 1 ? 'data marcada' : 'rotina · já passou da hora');
    });

    // 2. um projeto por vez: ativos, depois planejamento
    VAGAS.forEach(function (papel) {
      M.projetosPorPapel(papel).forEach(function (proj) {
        pool.filter(function (t) { return t.projetoId === proj.id; })
          .sort(function (a, b) { return a.ordem - b.ordem; })
          .forEach(function (t) { poe(t, papel === 'planejamento' ? 'em planejamento' : 'ativo'); });
      });
    });

    return lista;
  }

  return { vitrine: vitrine, faixaDe: faixaDe, emitindo: emitindo };
})();
