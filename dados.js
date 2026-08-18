/* Proposta escrita pelo Claude. O app lê este arquivo ao abrir:
 * se ainda não houver nada gravado, entra direto; se já houver, vira uma
 * proposta na coluna da esquerda e nada é gravado sem você aceitar.
 */
window.DADOS_CLAUDE =
{
  "versao": 3,
  "catalogo": {
    "pessoas": [
      { "id": "pe_eu", "nome": "Eu", "perfil": "proprietario" }
    ],

    "projetos": [
      {
        "id": "p_piso_corredor",
        "nome": "Piso laminado do corredor",
        "resultado": "Corredor acabado, sem obra dentro de casa",
        "ganhos": [],
        "estado": "ativo",
        "papel": "titular",
        "origem": "avulso",
        "prerequisitos": [],
        "ordemFila": 1,
        "custoEstimado": 0,
        "guardado": 0
      },
      {
        "id": "p_cercado",
        "nome": "Cercado dos cachorros",
        "resultado": "Os três cães em área própria, e o quintal de volta para as crianças",
        "ganhos": [
          "Playground sem cocô e sem brinquedo destruído",
          "Delimita já o lado onde ficarão as aves"
        ],
        "estado": "preparo",
        "papel": "planejamento",
        "origem": "avulso",
        "prerequisitos": [],
        "ordemFila": 2,
        "custoEstimado": null,
        "guardado": 0
      },
      {
        "id": "p_eletrica_cerca",
        "nome": "Elétrica pela cerca",
        "resultado": "Cabo do galpão fora do chão e a entrada do sítio iluminada",
        "ganhos": [
          "Acaba o risco de a roçadeira encontrar o cabo energizado",
          "Os 35 m da estrada com luz",
          "Cabo sombreado pelo travessão dura muito mais"
        ],
        "estado": "fila",
        "papel": "",
        "origem": "avulso",
        "prerequisitos": ["p_cercado"],
        "ordemFila": 3,
        "custoEstimado": null,
        "guardado": 0
      }
    ],

    "tarefas": [
      {
        "id": "t_piso_01", "projetoId": "p_piso_corredor", "ordem": 1,
        "texto": "Terminar a instalação do piso laminado do corredor",
        "duracaoTotal": 180, "restanteEstimado": 60,
        "podeParar": true,
        "exigeClima": "indiferente",
        "ondePrecisaEstar": "sitio", "onde": "corredor de casa",
        "esforco": "leve",
        "dependeDe": [], "estado": "aberta",
        "recado": "Só o que falta foi cadastrado, não a obra inteira."
      },
      {
        "id": "t_piso_02", "projetoId": "p_piso_corredor", "ordem": 2,
        "texto": "Instalar os rodapés do corredor",
        "duracaoTotal": 180, "restanteEstimado": 180,
        "podeParar": true,
        "exigeClima": "indiferente",
        "ondePrecisaEstar": "sitio", "onde": "corredor de casa",
        "esforco": "leve", "perigosaComCriancas": true,
        "janelaHora": { "preset": "personalizado", "de": "08:00", "ate": "12:00", "apenasDiasUteis": true },
        "ferramentas": "trena, serra, furadeira",
        "materiais": "rodapé, cola, acabamento de canto",
        "dependeDe": ["t_piso_01"], "estado": "aberta",
        "recado": "De manhã, com as crianças na escola: o corredor precisa ficar sem ninguém passando enquanto seca."
      },

      {
        "etapa": "planejamento", "id": "t_cerc_01", "projetoId": "p_cercado", "ordem": 1,
        "texto": "Decidir como vai ser feito — vão, peça e travessão",
        "duracaoTotal": 90, "restanteEstimado": 90,
        "podeParar": true,
        "exigeClima": "indiferente",
        "ondePrecisaEstar": "computador", "onde": "",
        "esforco": "leve",
        "dependeDe": [], "estado": "aberta",
        "recado": "Vão casado com o comprimento da peça de eucalipto, emendando no centro do poste. 2,5 m dá cerca mais rígida; 3 m economiza 7 postes."
      },
      {
        "etapa": "planejamento", "id": "t_cerc_02", "projetoId": "p_cercado", "ordem": 2,
        "texto": "Medir os 90 m e marcar a posição de cada poste",
        "duracaoTotal": 120, "restanteEstimado": 120,
        "podeParar": true,
        "exigeClima": "tolera_chuva_fina",
        "ondePrecisaEstar": "sitio", "onde": "do poste da rua até o canto",
        "esforco": "leve",
        "ferramentas": "trena, nível, estacas, barbante",
        "coleta": [
          { "id": "c_extensao", "rotulo": "extensão medida", "tipo": "numero", "unidade": "m" },
          { "id": "c_postes", "rotulo": "postes que vão caber", "tipo": "numero", "unidade": "un" }
        ],
        "dependeDe": ["t_cerc_01"], "estado": "aberta"
      },
      {
        "etapa": "planejamento", "id": "t_cerc_03", "projetoId": "p_cercado", "ordem": 3,
        "texto": "Conferir o que já tenho — postes instalados, tela e ferramenta",
        "duracaoTotal": 45, "restanteEstimado": 45,
        "podeParar": true,
        "exigeClima": "tolera_chuva_fina",
        "ondePrecisaEstar": "sitio", "onde": "linha da cerca e galpão",
        "esforco": "leve",
        "coleta": [
          { "id": "c_tela_tenho", "rotulo": "metros de tela que já tenho", "tipo": "numero", "unidade": "m" },
          { "id": "c_postes_tenho", "rotulo": "postes já instalados", "tipo": "numero", "unidade": "un" },
          { "id": "c_falta_ferr", "rotulo": "ferramenta que falta ou está ruim", "tipo": "texto", "unidade": "" }
        ],
        "dependeDe": ["t_cerc_02"], "estado": "aberta"
      },
      {
        "etapa": "planejamento", "id": "t_cerc_04", "projetoId": "p_cercado", "ordem": 4,
        "texto": "Orçar eucalipto tratado, tela e ferragem",
        "duracaoTotal": 60, "restanteEstimado": 60,
        "podeParar": true,
        "exigeClima": "indiferente",
        "ondePrecisaEstar": "computador", "onde": "",
        "esforco": "leve",
        "janelaHora": { "preset": "comercial", "de": "08:00", "ate": "18:00", "apenasDiasUteis": true },
        "coleta": [
          { "id": "c_custo", "rotulo": "custo total", "tipo": "dinheiro", "unidade": "" },
          { "id": "c_prazo", "rotulo": "prazo de entrega", "tipo": "numero", "unidade": "dias" }
        ],
        "dependeDe": ["t_cerc_03"], "estado": "aberta"
      },
      {
        "etapa": "planejamento", "id": "t_cerc_05", "projetoId": "p_cercado", "ordem": 5,
        "texto": "Comprar eucalipto, tela e ferragem galvanizada",
        "duracaoTotal": 180, "restanteEstimado": 180,
        "podeParar": false,
        "exigeClima": "indiferente",
        "ondePrecisaEstar": "fora", "onde": "",
        "esforco": "leve",
        "janelaHora": { "preset": "comercial", "de": "08:00", "ate": "18:00", "apenasDiasUteis": true },
        "materiais": "eucalipto tratado, tela, grampo e parafuso galvanizado",
        "dependeDe": ["t_cerc_04"], "estado": "aberta",
        "recado": "Ao comprar, abrir uma pendência de entrega em Aguardando."
      },
      {
        "id": "t_cerc_06", "projetoId": "p_cercado", "ordem": 6,
        "texto": "Tirar as mudas de cerca viva do caminho e replantá-las",
        "duracaoTotal": 120, "restanteEstimado": 120,
        "podeParar": true,
        "exigeClima": "tolera_chuva_fina", "guardadaParaChuva": true,
        "ondePrecisaEstar": "sitio", "onde": "replantar rente ao outro cercado, para tampar a visão",
        "esforco": "leve", "boaComCriancas": true,
        "ferramentas": "pá, enxada, carrinho de mão",
        "dependeDe": ["t_cerc_02"], "estado": "aberta",
        "recado": "Guardada para dia de chuva de propósito: muda transplantada pega melhor em solo úmido, e o dia seco fica livre para cavar."
      },
      {
        "id": "t_cerc_07", "projetoId": "p_cercado", "ordem": 7,
        "texto": "Cavar os buracos dos 35 m da estrada",
        "duracaoTotal": 300, "restanteEstimado": 300,
        "podeParar": true, "blocoMinimo": 60,
        "exigeClima": "firme", "exigeSoloFirme": true,
        "ondePrecisaEstar": "sitio", "onde": "trecho rente à estrada",
        "esforco": "pesado",
        "ferramentas": "cavadeira, barra, EPI",
        "dependeDe": ["t_cerc_06"], "estado": "aberta"
      },
      {
        "id": "t_cerc_08", "projetoId": "p_cercado", "ordem": 8,
        "texto": "Plantar os postes dos 35 m",
        "duracaoTotal": 240, "restanteEstimado": 240,
        "podeParar": true, "blocoMinimo": 60,
        "exigeClima": "firme", "exigeSoloFirme": true,
        "ondePrecisaEstar": "sitio", "onde": "trecho rente à estrada",
        "esforco": "pesado",
        "ferramentas": "nível, marreta, pá, EPI",
        "materiais": "postes de eucalipto",
        "dependeDe": ["t_cerc_07", "t_cerc_05"], "estado": "aberta"
      },
      {
        "id": "t_cerc_09", "projetoId": "p_cercado", "ordem": 9,
        "texto": "Montar o travessão por cima dos 35 m",
        "duracaoTotal": 180, "restanteEstimado": 180,
        "podeParar": true, "blocoMinimo": 60,
        "exigeClima": "firme",
        "ondePrecisaEstar": "sitio", "onde": "trecho rente à estrada",
        "esforco": "pesado",
        "ferramentas": "furadeira, nível, EPI",
        "materiais": "eucalipto do travessão, parafuso galvanizado",
        "dependeDe": ["t_cerc_08"], "estado": "aberta",
        "recado": "O cabo do galpão é fixado por baixo dele depois — o travessão vem primeiro."
      },
      {
        "id": "t_cerc_10", "projetoId": "p_cercado", "ordem": 10,
        "texto": "Cavar os buracos dos 55 m simples",
        "duracaoTotal": 420, "restanteEstimado": 420,
        "podeParar": true, "blocoMinimo": 60,
        "exigeClima": "firme", "exigeSoloFirme": true,
        "ondePrecisaEstar": "sitio", "onde": "trecho que desvia da estrada",
        "esforco": "pesado",
        "ferramentas": "cavadeira, barra, EPI",
        "dependeDe": ["t_cerc_06"], "estado": "aberta"
      },
      {
        "id": "t_cerc_11", "projetoId": "p_cercado", "ordem": 11,
        "texto": "Plantar os postes dos 55 m",
        "duracaoTotal": 360, "restanteEstimado": 360,
        "podeParar": true, "blocoMinimo": 60,
        "exigeClima": "firme", "exigeSoloFirme": true,
        "ondePrecisaEstar": "sitio", "onde": "trecho que desvia da estrada",
        "esforco": "pesado",
        "ferramentas": "nível, marreta, pá, EPI",
        "materiais": "postes de eucalipto",
        "dependeDe": ["t_cerc_10", "t_cerc_05"], "estado": "aberta"
      },
      {
        "id": "t_cerc_12", "projetoId": "p_cercado", "ordem": 12,
        "texto": "Esticar a tela nos 90 m",
        "duracaoTotal": 300, "restanteEstimado": 300,
        "podeParar": true, "blocoMinimo": 60,
        "exigeClima": "tolera_chuva_fina",
        "ondePrecisaEstar": "sitio", "onde": "linha inteira da cerca",
        "esforco": "pesado", "precisaAjuda": true,
        "ferramentas": "esticador, alicate, grampeador, EPI",
        "materiais": "tela, grampo galvanizado",
        "dependeDe": ["t_cerc_08", "t_cerc_11"], "estado": "aberta"
      },

      {
        "id": "t_elet_01", "projetoId": "p_eletrica_cerca", "ordem": 1,
        "texto": "Fixar o cabo do galpão sob o travessão",
        "duracaoTotal": 120, "restanteEstimado": 120,
        "podeParar": true,
        "exigeClima": "firme",
        "ondePrecisaEstar": "sitio", "onde": "trecho rente à estrada",
        "esforco": "leve",
        "ferramentas": "furadeira, alicate, escada",
        "materiais": "abraçadeira resistente a UV",
        "dependeDe": [], "estado": "aberta",
        "recado": "Com folga, nunca esticado e nunca grampeado atravessando o cabo. Ferragem galvanizada ou inox."
      },
      {
        "id": "t_elet_02", "projetoId": "p_eletrica_cerca", "ordem": 2,
        "texto": "Refazer a descida com laço de gotejamento e religar o galpão",
        "duracaoTotal": 180, "restanteEstimado": 180,
        "podeParar": false,
        "exigeClima": "firme", "exigeSoloFirme": true,
        "ondePrecisaEstar": "sitio", "onde": "descida para a travessia da estrada",
        "esforco": "leve", "perigosaComCriancas": true,
        "ferramentas": "alicate, multímetro, EPI",
        "materiais": "eletroduto, vedação",
        "dependeDe": ["t_elet_01"], "estado": "aberta",
        "recado": "O cabo desce, faz barriga para baixo e só então entra no duto. Vedar a boca de cima, senão a água escorre para dentro."
      },
      {
        "id": "t_elet_03", "projetoId": "p_eletrica_cerca", "ordem": 3,
        "texto": "Passar o conduíte da iluminação nos 35 m",
        "duracaoTotal": 120, "restanteEstimado": 120,
        "podeParar": true,
        "exigeClima": "firme",
        "ondePrecisaEstar": "sitio", "onde": "trecho rente à estrada",
        "esforco": "leve",
        "ferramentas": "furadeira, alicate, escada",
        "materiais": "eletroduto, cabo da iluminação",
        "dependeDe": [], "estado": "aberta",
        "recado": "Conduíte separado do cabo do galpão."
      },
      {
        "id": "t_elet_04", "projetoId": "p_eletrica_cerca", "ordem": 4,
        "texto": "Instalar as luminárias nos postes",
        "duracaoTotal": 180, "restanteEstimado": 180,
        "podeParar": true,
        "exigeClima": "firme",
        "ondePrecisaEstar": "sitio", "onde": "trecho rente à estrada",
        "esforco": "leve",
        "ferramentas": "furadeira, alicate, multímetro, escada",
        "materiais": "luminárias",
        "dependeDe": ["t_elet_03"], "estado": "aberta"
      }
    ],

    "pendencias": [],

    "sementes": [
      {
        "id": "s_trepadeira",
        "nome": "Trepadeira na cerca nova",
        "frase": "Amor-agarradinho subindo pelo cercado dos cachorros",
        "porque": "Enfeita a cerca. A cerca viva que estava ali não ficaria boa nesse lugar, por isso as mudas saíram.",
        "autor": "eu"
      },
      {
        "id": "s_dps",
        "nome": "DPS e aterramento do galpão",
        "frase": "Proteger o inversor e a oficina contra surto, com DPS classe I+II e aterramento medido",
        "porque": "O manual põe isso como prioridade 1 de energia por causa da densidade de descargas. Um lance longo alimentando oficina aumenta a exposição.",
        "autor": "eu"
      }
    ]
  },

  "diarios": {
    "pe_eu": { "pessoa": "pe_eu", "eventos": [] }
  }
};
