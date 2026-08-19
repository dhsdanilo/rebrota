/* Rebrota — previsão do tempo (§53).
 *
 * Open-Meteo, grátis e sem chave, nas coordenadas de Sete Barras. A §21 da
 * spec proíbe AUTOMATIZAR o clima — informar o tempo é escolha consciente, e
 * isso fica: o registro do dia continua sendo a resposta dele na consulta.
 * O que entra aqui é LEITURA (§41): a consulta mostra "lá fora: 29° · sol"
 * e ele confirma num toque; a mesa mostra a semana; a saudação ganha frases
 * que só entram quando são verdade.
 *
 * Sem internet, cala. A leitura "de agora" só vale por 3 h — mais velho que
 * isso, melhor não dizer nada do que dizer o tempo de ontem.
 */

var Tempo = (function () {
  'use strict';

  var CHAVE = 'app-sitio-tempo';
  // o sítio: Sete Barras, Vale do Ribeira (piso de vale, ~70 m)
  var LAT = -24.3878, LON = -47.9264;
  var VALIDADE_MS = 30 * 60 * 1000;      // não pedir de novo antes de meia hora
  var FRESCO_MS = 3 * 60 * 60 * 1000;    // "lá fora agora" só com leitura de até 3 h

  var dados = null;
  var ouvintes = [];

  function carregar() {
    try { dados = JSON.parse(localStorage.getItem(CHAVE)); } catch (e) { dados = null; }
  }
  function guardar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) {}
  }

  function ouvir(fn) { ouvintes.push(fn); }
  function avisar() { ouvintes.forEach(function (f) { try { f(); } catch (e) {} }); }

  /* Os códigos WMO do Open-Meteo, dobrados para o vocabulário do app.
     45–48 é neblina — aqui ela é nublado que ainda não decidiu. */
  function tempoDe(code) {
    if (code <= 1) return 'sol';
    if (code <= 48) return 'nublado';
    if (code <= 57 || code === 61 || code === 80) return 'chuva_fina';
    return 'chuva_forte';
  }

  var ROTULOS = { sol: 'sol', nublado: 'nublado', chuva_fina: 'chuva fina', chuva_forte: 'chuva forte' };
  function rotulo(t) { return ROTULOS[t] || t; }

  function buscar() {
    if (!navigator.onLine) return Promise.resolve(dados);
    if (dados && Date.now() - dados.em < VALIDADE_MS) return Promise.resolve(dados);
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
      '&current=temperature_2m,weather_code' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=America%2FSao_Paulo&forecast_days=5';
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      dados = {
        em: Date.now(),
        atual: { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code },
        dias: (j.daily.time || []).map(function (d, i) {
          return { dia: d, code: j.daily.weather_code[i],
                   max: Math.round(j.daily.temperature_2m_max[i]),
                   min: Math.round(j.daily.temperature_2m_min[i]) };
        })
      };
      guardar();
      avisar();
      return dados;
    }).catch(function () { return dados; });
  }

  // a leitura de agora — ou null, se a última busca já não diz nada de agora
  function agora() {
    if (!dados || !dados.atual) return null;
    if (Date.now() - dados.em > FRESCO_MS) return null;
    var t = tempoDe(dados.atual.code);
    return { temp: dados.atual.temp, tempo: t, rotulo: rotulo(t), calor: dados.atual.temp >= 30 };
  }

  // os próximos dias — ou null; o primeiro é hoje
  function semana() {
    if (!dados || !(dados.dias || []).length) return null;
    if (Date.now() - dados.em > 24 * 60 * 60 * 1000) return null;
    return dados.dias;
  }

  carregar();
  return { buscar: buscar, agora: agora, semana: semana, ouvir: ouvir, tempoDe: tempoDe, rotulo: rotulo };
})();
