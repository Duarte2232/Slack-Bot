// Importações básicas
const express = require('express');
const bodyParser = require('body-parser');

// Inicializar o Express
const app = express();

// Middleware para analisar JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rota principal
app.get('/', (req, res) => {
  res.send('Slack Form Bot está funcionando!');
});

// Rota de teste
app.get('/test', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Servidor está funcionando corretamente',
    timestamp: new Date().toISOString()
  });
});

// Rota específica para o desafio do Slack
app.post('/slack/events', (req, res) => {
  console.log('Recebida requisição POST em /slack/events');
  console.log('Headers:', JSON.stringify(req.headers));
  console.log('Body:', JSON.stringify(req.body));
  
  // Verificar se é um desafio de URL
  if (req.body && req.body.type === 'url_verification') {
    console.log('Respondendo ao desafio do Slack:', req.body.challenge);
    return res.json({ challenge: req.body.challenge });
  }
  
  // Responder com sucesso para outros eventos
  res.status(200).send();
});

// Definir porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
}); 