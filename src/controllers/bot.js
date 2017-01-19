var express           = require('express'),
    router            = express.Router(),
    moment            = require('moment'),
    rn                = require('random-number'),
    auth              = require('../../middlewares/auth'),
    webScrapping      = require('../../modules/crawler/'),
    classifier        = require('../../modules/natural_processing/classifier'),
    extractor         = require('../../modules/natural_processing/extractor'),
    weighter          = require('../../modules/natural_processing/weight'),
    Bot               = require('../models/Bot'),
    Documento         = require('../models/Documento');

router.post('/bot/cadastrar',                 auth.isAuthenticated, cadastrar);
router.put('/bot/:id/atualizar',              auth.isAuthenticated, atualizar);
router.get('/bot/:id/consulta',               auth.isAuthenticated, consultar);
router.delete('/bot/:id/remover',             auth.isAuthenticated, remover);
router.post('/bot/:id/documento/cadastrar',   auth.isAuthenticated, cadastrarDocumento);

function cadastrar (req, res, next) {

  if(req.body.dados) {

    var dadosReq = req.body.dados;
    dadosReq.dataCriacao = moment().format();

    Bot.cadastrar(dadosReq, function(err, dados){

      if(err || !dados) {
        res.status(404).json({
          erro: 'not_found',
          mensagem: 'Bot não encontrado'
        });

      } else {
        res.status(200).json({
          dados: dados,
          mensagem: 'Bot salvo com sucesso'
        });
      }

    });

  } else {

    res.status(400).json({
      erro: 'bad_request',
      mensagem: 'Erro de parâmetro(s)'
    });

  }

}

function atualizar (req, res, next) {

  if(req.params.id){

    var dadosReq = {
      id: req.params.id,
      dados: req.body.dados
    }

    Bot.atualizar(dadosReq, function(err, dados) {

      if(err || !dados) {
        res.status(404).json({
          erro: 'not_found',
          mensagem: 'Bot não encontrado'
        });
      } else {

        if(dados){

          res.status(200).json({
            dados: dados,
            mensagem: 'Bot atualizado com sucesso'
          });

        } else {

          res.status(404).json({
            erro: 'not_found',
            mensagem: 'Bot não encontrado'
          });

        }

      }

    });

  } else {

    res.status(400).json({
      erro: 'bad_request',
      mensagem: 'Erro(s) de parâmetro(s)'
    });

  }

}

function consultar (req, res, next) {

  if(!req.params.id || !req.query.q) {
    return res.status(400).json({
      erro: 'bad_request',
      mensagem: 'Erro(s) de parâmetro(s)'
    });
  }

  var sentenceOriginal = req.query.q;
  var dados = { idBot : req.params.id, query : null, limite: 5};

  Bot.pegarPeloIdBot(dados.idBot, function(err, bot) {

    if (err) {
      return res.status(404).json({
        erro: 'not_found',
        mensagem: 'Bot não encontrado'
      });
    }

    var random          = null;
    var resposta        = null;

    dados.query = extractor.extract(sentenceOriginal, { stemmering: true, lowercase: true, accent: true });

    var classify = classifier.classify(dados.query);

    switch (classify) {

      case "questionamento":

        dados.query = extractor.extract(sentenceOriginal, { characters: true, stopwords: true, tokenizer: true, stemmering: true })[0];

        Documento.consultarPeloIdBot(dados, function(err, documentos) {
          if (err) {
            return res.status(500).json({
              erro: 'internal_server_error',
              mensagem: 'Erro Interno'
            });
          } else if(!documentos || documentos == "") {
            Documento.consultarRandom(dados, function(err, documentos) {
              resposta = respostaRandom(bot.frases.semResposta);
              resposta = resposta + "\n" + respostaRandom(bot.frases.engajamento);
              return res.status(200).json({ resposta: resposta, sugestoes: documentos || [] });
            });
          } else {
            // com resposta
            resposta = weighter.weightDocuments({ documents: documentos, query: dados.query });
            Documento.consultarRandom(dados, function(err, documentos) {
              return res.status(200).json({ resposta: resposta, sugestoes: documentos || [] });
            });
          }
        });

        break;

      case "apresentacao":
      case "agradecimento":
      case "encerramento":
      case "abertura":

        var tipo = "apresentacao";

        if (classify == "agradecimento") {
          tipo = bot.frases.agradecimento;
        } else if(classify == "encerramento") {
          tipo = bot.frases.encerramento;
        } else {
          tipo = bot.frases.abertura;
        }

        resposta = respostaRandom(tipo);
        return res.status(200).json({ resposta: resposta });
        break;

      default:
        Documento.consultarRandom(dados, function(err, documentos) {
          resposta = respostaRandom(bot.frases.semResposta);
          resposta = resposta + "\n" + respostaRandom(bot.frases.engajamento);
          return res.status(200).json({ resposta: resposta, sugestoes: documentos || [] });
        });

    }

  });

}

function respostaRandom (sentenca) {

  var random = rn({ min: 0, max: sentenca.length-1, integer: true });

  return sentenca[random];

}

function remover (req, res, next) {

  if(req.params.id) {

    Bot.remover(req.params.id, function(err){

      if(err) {
        res.status(404).json({
          erro: 'not_found',
          mensagem: 'Bot não encontrado'
        });
      } else {
        res.status(200).json({
          mensagem: 'Bot removido com sucesso',
        });
      }

    });

  } else {

    res.status(400).json({
      erro: 'bad_request',
      mensagem: 'Erro(s) de parâmetro(s)'
    });

  }

}

function cadastrarDocumento (req, res, next) {

  if(req.params.id && req.body.dados) {

    var dados       = req.body.dados || [];
    var tipo        = req.body.tipo || req.body.dados.tipo;
    var idBot       = req.params.id;
    var data        = moment().format();

    if(!tipo){
      return res.status(400).json({
        mensagem: 'Erro de parâmetro(s)'
      });
    }

    dados.dataCriacao  = data;

    if(dados.uri) {

      webScrapping.process(dados, function(err, dados){

        if(err) {
          return res.status(404).json({
            erro: 'not_found',
            mensagem: 'Página não encontrada'
          });
        }

        inserirDocumento(dados, idBot, function(err, dados){

          if(err) {
            return res.status(404).json({
              erro: 'not_found',
              mensagem: 'Página não encontrada'
            });
          }

          res.status(200).json({
            dados: dados,
            mensagem: 'Documento inserido com sucesso!'
          });

        });

      });

    } else {

      inserirDocumento(dados, idBot, function(err, dados){

        if(err) {
          return res.status(404).json({
            erro: 'not_found',
            mensagem: 'Página não encontrada'
          });
        }

        res.status(200).json({
          dados: dados,
          mensagem: 'Documento inserido com sucesso!'
        });

      });
    }

  } else {

    res.status(400).json({
      erro: 'bad_request',
      mensagem: 'Erro de parâmetro(s)'
    });

  }

}

function inserirDocumento (dados, idBot, callback) {

    if(!dados.length) {
      dados = [dados];
    }
    var documentos = [];
    for (var i = 0; i < dados.length; i++) {
      dados[i] = {
        titulo: dados[i].titulo,
        conteudo: dados[i].conteudo,
        idBot: idBot,
        tags: {
          titulo:   extractor.extract([dados[i].titulo]),
          conteudo: extractor.extract(dados[i].conteudo)
        }
      };
    }

    console.log(dados[0]);

    return;

    Documento.cadastrarDocumento(dados, function(err, documento){

      if(err)  return callback(true);

      callback(false, documento);

    });

}

module.exports = router;
