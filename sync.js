/* Rebrota — sincronização.
 *
 * Um Gist PRIVADO na conta do usuário, com um arquivo por coisa:
 *
 *   catalogo.json         — o que você decide. SÓ A MESA ESCREVE. Bota e o
 *                           celular da esposa apenas leem.
 *   diario-<pessoa>.json  — o que aconteceu. Um por pessoa; cada aparelho junta
 *                           o que tem com o que está lá (união por id do
 *                           evento) e devolve. Ninguém apaga evento de ninguém.
 *
 * Por que isso não dá conflito: catálogo tem um escritor só; diário só cresce,
 * e a união de dois conjuntos de eventos é comutativa. Semente plantada no
 * campo é EVENTO (`semeou`) no diário de quem plantou — a mesa absorve para o
 * catálogo ao abrir. Assim a bota nunca escreve no catálogo.
 *
 * O token fica no localStorage deste aparelho, colado uma vez. Nunca vai para
 * o repositório nem para o export. Sem token, este módulo não faz nada; sem
 * internet, cala.
 */

var Sync = (function () {
  'use strict';

  var CHAVE = 'app-sitio-sync';
  var API = 'https://api.github.com';
  var DESCRICAO = 'rebrota-sync';          // é por ela que o app acha o Gist
  var ESPERA_MS = 2500;                    // junta escritas seguidas num push só

  var cfg = { token: '', gistId: '' };
  var estado = { ultimo: null, erro: '', ocupado: false };
  var ouvintes = [];
  var relogio = null;
  var sujo = { catalogo: false, diarios: false };
  var papel = { escreveCatalogo: false, pessoa: 'pe_eu' };

  // ── configuração ──────────────────────────────────────────────────

  function carregarCfg() {
    try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem(CHAVE)) || {}); } catch (e) {}
  }
  function salvarCfg() { localStorage.setItem(CHAVE, JSON.stringify(cfg)); }

  function ligado() { return !!cfg.token; }

  function ligar(token) {
    cfg.token = String(token || '').trim();
    cfg.gistId = '';
    salvarCfg();
    return sincronizar();
  }

  function desligar() {
    cfg = { token: '', gistId: '' };
    localStorage.removeItem(CHAVE);
    avisar();
  }

  /* Quem sou eu neste aparelho: a mesa escreve o catálogo; a bota, não. A
     tela da esposa passa a pessoa dela e nunca escreve o catálogo. */
  function configurar(opcoes) {
    papel.escreveCatalogo = !!opcoes.escreveCatalogo;
    papel.pessoa = opcoes.pessoa || 'pe_eu';
  }

  function ouvir(fn) { ouvintes.push(fn); }
  function avisar() { ouvintes.forEach(function (fn) { try { fn(situacao()); } catch (e) {} }); }

  function situacao() {
    return { ligado: ligado(), ocupado: estado.ocupado, ultimo: estado.ultimo, erro: estado.erro };
  }

  // ── GitHub ────────────────────────────────────────────────────────

  function pedir(metodo, caminho, corpo) {
    return fetch(API + caminho, {
      method: metodo,
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: corpo ? JSON.stringify(corpo) : undefined
    }).then(function (r) {
      if (r.status === 401) throw new Error('token recusado');
      if (r.status === 404) throw new Error('não achei o gist');
      if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  /* Acha o Gist pela descrição; não havendo, cria — privado. O id fica
     guardado para as próximas vezes serem uma ida só. */
  function acharGist() {
    if (cfg.gistId) return Promise.resolve(cfg.gistId);
    return pedir('GET', '/gists?per_page=100').then(function (lista) {
      var meu = (lista || []).filter(function (g) { return g.description === DESCRICAO; })[0];
      if (meu) { cfg.gistId = meu.id; salvarCfg(); return meu.id; }
      return pedir('POST', '/gists', {
        description: DESCRICAO, public: false,
        files: { 'leia-me.txt': { content: 'Sincronização do Rebrota. Não edite à mão.' } }
      }).then(function (g) { cfg.gistId = g.id; salvarCfg(); return g.id; });
    });
  }

  /* O GET do gist traz o conteúdo dos arquivos pequenos (até 1 MB) já dentro
     da resposta; acima disso vem `truncated` e um raw_url. */
  function lerGist(id) {
    return pedir('GET', '/gists/' + id).then(function (g) {
      var arquivos = {};
      var pendentes = [];
      Object.keys(g.files || {}).forEach(function (nome) {
        var f = g.files[nome];
        if (!f.truncated) { arquivos[nome] = f.content; return; }
        pendentes.push(fetch(f.raw_url).then(function (r) { return r.text(); })
          .then(function (t) { arquivos[nome] = t; }));
      });
      return Promise.all(pendentes).then(function () { return arquivos; });
    });
  }

  function escreverGist(id, arquivos) {
    var files = {};
    // conteúdo null apaga o arquivo do Gist (é assim que a API faz)
    Object.keys(arquivos).forEach(function (n) { files[n] = arquivos[n] === null ? null : { content: arquivos[n] }; });
    return pedir('PATCH', '/gists/' + id, { files: files });
  }

  // ── a sincronização em si ─────────────────────────────────────────

  function lerJson(texto) {
    try { return texto ? JSON.parse(texto) : null; } catch (e) { return null; }
  }

  /* Baixa tudo, junta com o local, sobe o que este aparelho tem direito de
     escrever. Uma passada só; quem chamou de novo no meio espera a próxima. */
  /* CÓPIA AUTOMÁTICA (§47): uma vez por dia a mesa deixa o export inteiro
     (catálogo + diários) num segundo Gist privado, `rebrota-copias`, como
     `copia-AAAA-MM-DD.json`, e guarda as últimas sete. É o paraquedas que ele
     não precisa lembrar de puxar. Falha aqui não derruba a sincronização. */
  var DESCRICAO_COPIAS = 'rebrota-copias';
  var aoCopiar = null;
  function quandoCopiar(fn) { aoCopiar = fn; }

  function acharGistCopias() {
    if (cfg.gistCopias) return Promise.resolve(cfg.gistCopias);
    return pedir('GET', '/gists?per_page=100').then(function (lista) {
      var meu = (lista || []).filter(function (g) { return g.description === DESCRICAO_COPIAS; })[0];
      if (meu) { cfg.gistCopias = meu.id; salvarCfg(); return meu.id; }
      return pedir('POST', '/gists', {
        description: DESCRICAO_COPIAS, public: false,
        files: { 'leia-me.txt': { content: 'Cópias diárias do Rebrota — as últimas sete. Não edite à mão.' } }
      }).then(function (g) { cfg.gistCopias = g.id; salvarCfg(); return g.id; });
    });
  }
  function fazerCopiaDoDia() {
    var hoje = Modelo.hoje();
    return acharGistCopias().then(function (id) {
      return pedir('GET', '/gists/' + id).then(function (g) {
        var files = {};
        files['copia-' + hoje + '.json'] = { content: Modelo.exportar() };
        Object.keys(g.files || {}).filter(function (n) { return /^copia-\d{4}-\d{2}-\d{2}\.json$/.test(n) && n !== 'copia-' + hoje + '.json'; })
          .sort().reverse().slice(6).forEach(function (n) { files[n] = null; });   // fica com 7
        return pedir('PATCH', '/gists/' + id, { files: files });
      });
    }).then(function () {
      cfg.ultimaCopia = hoje; salvarCfg();
      if (aoCopiar) aoCopiar();
    }).catch(function () { /* a cópia tenta de novo na próxima; a sincronização segue */ });
  }

  function sincronizar() {
    if (!ligado() || !navigator.onLine) return Promise.resolve(false);
    if (estado.ocupado) { sujouNoMeio = true; return Promise.resolve(false); }
    sujouNoMeio = false;
    estado.ocupado = true; estado.erro = '';
    avisar();

    var M = Modelo;
    var mudouLocal = false;

    return acharGist().then(lerGist).then(function (arquivos) {
      var subir = {};

      /* 1. catálogo. A mesa é a fonte — mas LÊ ANTES de escrever (§38):
           - versão maior lá do que aqui → o daqui está velho, aceita o de lá
             (é o celular deitado, a janela estreita, a mesa nova, a segunda mesa);
           - catálogo daqui vazio e o de lá cheio → nunca escreve por cima;
           - primeira sincronização deste aparelho como mesa com versões iguais
             → aceita o de lá (o daqui pode ser a amostra do dados.js); se o
             daqui for mais novo, sobe;
           - senão, o daqui é o mais novo: sobe.
           Quem não é mesa aceita o de lá, salvo se o daqui for mais novo (foi
           mesa há pouco e ainda não subiu) — aí espera. */
      /* §47: o de lá se JUNTA ao daqui, item a item — em todo aparelho. Nada
         que só exista de um lado se perde. Antes de juntar, uma foto do daqui
         fica guardada (rede de segurança: "voltar ao de antes" no painel).
         A mesa sobe o resultado quando ele difere do de lá; quem não é mesa
         só junta. */
      var remoto = lerJson(arquivos['catalogo.json']);
      var remotoValido = remoto && typeof remoto === 'object';
      if (remotoValido) {
        M.fotografarCatalogo();
        if (M.receberCatalogo(remoto)) mudouLocal = true;
      }
      if (papel.escreveCatalogo) {
        var meu = JSON.stringify(M.cat());
        if (!remotoValido || JSON.stringify(remoto) !== meu) subir['catalogo.json'] = meu;
        if (!cfg.jaFoiMesa) { cfg.jaFoiMesa = true; salvarCfg(); }

      }

      // 2. diários: união por id, para cada pessoa que existir de um lado ou do outro
      var pessoas = {};
      Object.keys(M.tudo().diarios).forEach(function (p) { pessoas[p] = true; });
      Object.keys(arquivos).forEach(function (n) {
        var m = /^diario-(.+)\.json$/.exec(n);
        if (m) pessoas[m[1]] = true;
      });
      Object.keys(pessoas).forEach(function (p) {
        var deLa = lerJson(arquivos['diario-' + p + '.json']);
        var eventosDeLa = (deLa && Array.isArray(deLa.eventos)) ? deLa.eventos : [];
        var r = M.unirDiario(p, eventosDeLa);
        if (r.entraram) mudouLocal = true;
        // sobe se este aparelho tem algo que lá não tem
        if (r.faltamLa) subir['diario-' + p + '.json'] = JSON.stringify(M.tudo().diarios[p]);
      });

      var idGist = cfg.gistId;
      if (Object.keys(subir).length) return escreverGist(idGist, subir);
      return null;
    }).then(function () {
      // a cópia do dia vai num Gist à parte, para não pesar a sincronização de 2 em 2 min
      if (papel.escreveCatalogo && cfg.ultimaCopia !== Modelo.hoje()) return fazerCopiaDoDia();
    }).then(function () {
      estado.ultimo = new Date().toISOString();
      estado.ocupado = false;
      sujo.catalogo = sujo.diarios = false;
      avisar();
      if (mudouLocal) ouvintes.forEach(function (fn) { try { fn(situacao(), true); } catch (e) {} });
      if (sujouNoMeio) { clearTimeout(relogio); relogio = setTimeout(sincronizar, ESPERA_MS); }
      return mudouLocal;
    }).catch(function (e) {
      estado.ocupado = false;
      estado.erro = e.message || String(e);
      avisar();
      if (sujouNoMeio) { clearTimeout(relogio); relogio = setTimeout(sincronizar, ESPERA_MS); }
      return false;
    });
  }

  /* Escrita local: espera um pouco e sobe. Várias escritas seguidas viram um
     push só. */
  function marcarSujo(oQue) {
    if (oQue === 'catalogo') sujo.catalogo = true; else sujo.diarios = true;
    if (!ligado()) return;
    clearTimeout(relogio);
    relogio = setTimeout(sincronizar, ESPERA_MS);
  }

  /* Gravação que chegou com um envio no ar não pode se perder: ao acabar o
     envio, se ficou sujo no meio, vai de novo. */
  var sujouNoMeio = false;

  /* Além de abrir, voltar e gravar: com a aba visível, olha a nuvem a cada
     2 min. Sem isso a mesa aberta o dia todo não via o que a bota fez até
     alguém trocar de aba — e a semente plantada no pasto parecia sumida. */
  var CADENCIA_MS = 2 * 60 * 1000;
  function iniciar() {
    carregarCfg();
    // voltar para o app é a hora de ver o que os outros aparelhos fizeram
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sincronizar();
    });
    window.addEventListener('online', sincronizar);
    setInterval(function () {
      if (document.visibilityState === 'visible') sincronizar();
    }, CADENCIA_MS);
    return sincronizar();
  }

  return {
    iniciar: iniciar, configurar: configurar, ouvir: ouvir,
    ligado: ligado, ligar: ligar, desligar: desligar, quandoCopiar: quandoCopiar,
    sincronizar: sincronizar, marcarSujo: marcarSujo, situacao: situacao
  };
})();
