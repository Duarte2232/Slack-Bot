const express = require('express');
const bodyParser = require('body-parser');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const cron = require('node-cron');
require('dotenv').config();

// Configuração do banco de dados
const adapter = new FileSync('.data/forms-db.json');
const db = low(adapter);

// Inicializar banco de dados com estrutura padrão
db.defaults({
  forms: [],
  channels: []
}).write();

// Configuração do Express
const app = express();

// Middleware para analisar JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rota principal
app.get('/', (req, res) => {
  res.send('Slack Form Bot está funcionando!');
});

// Rota de teste para verificar se o servidor está respondendo
app.get('/test', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Servidor está funcionando corretamente',
    timestamp: new Date().toISOString()
  });
});

// Padrão para detectar mensagens de formulários
const formPattern = /Novo formulário:\s*"([^"]+)"\s*Prazo:\s*(\d{4}-\d{2}-\d{2})\s*Descrição:\s*"([^"]*)"/i;

// Endpoint para verificação do Slack e processamento de eventos
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

// Função para processar eventos do Slack de forma assíncrona
async function processSlackEvent(payload) {
  try {
    // Verificar se é uma mensagem
    if (payload.event && payload.event.type === 'message' && !payload.event.bot_id) {
      const message = payload.event;
      
      // Verificar se a mensagem corresponde ao padrão de formulário
      if (message.text) {
        const match = message.text.match(formPattern);
        
        if (match) {
          const title = match[1];
          const deadline = match[2];
          const description = match[3] || '';
          
          console.log('Formulário detectado:', { title, deadline, description });
          
          // Adicionar formulário ao banco de dados
          const formId = Date.now().toString();
          db.get('forms')
            .push({
              id: formId,
              title,
              deadline,
              description,
              addedBy: message.user,
              addedAt: new Date().toISOString(),
              notifiedTwoDays: false,
              notifiedOneDay: false,
              channel: message.channel
            })
            .write();
          
          // Registrar o canal para lembretes se ainda não estiver registrado
          const channels = db.get('channels').value();
          if (!channels.includes(message.channel)) {
            db.get('channels').push(message.channel).write();
          }
          
          // Enviar confirmação
          await sendSlackMessage(message.channel, 
            `✅ Formulário detectado e adicionado ao sistema!\n*Título:* ${title}\n*Prazo:* ${deadline}\n*Descrição:* ${description || 'Nenhuma descrição fornecida'}\n\nLembretes serão enviados automaticamente 2 dias e 1 dia antes do prazo.`,
            message.ts);
          
          // Adicionar reação
          await addReaction(message.channel, message.ts, 'white_check_mark');
        }
      }
    }
  } catch (error) {
    console.error('Erro ao processar evento do Slack:', error);
  }
}

// Função para enviar mensagem ao Slack
async function sendSlackMessage(channel, text, thread_ts = null) {
  try {
    const url = 'https://slack.com/api/chat.postMessage';
    const body = {
      channel: channel,
      text: text,
      parse: 'mrkdwn'
    };
    
    if (thread_ts) {
      body.thread_ts = thread_ts;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    if (!data.ok) {
      console.error('Erro ao enviar mensagem:', data.error);
    }
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
  }
}

// Função para adicionar reação
async function addReaction(channel, timestamp, reaction) {
  try {
    const url = 'https://slack.com/api/reactions.add';
    const body = {
      channel: channel,
      timestamp: timestamp,
      name: reaction
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify(body)
    });
    
    const data = await response.json();
    if (!data.ok) {
      console.error('Erro ao adicionar reação:', data.error);
    }
  } catch (error) {
    console.error('Erro ao adicionar reação:', error);
  }
}

// Configurar verificação diária de prazos
cron.schedule('0 10 * * *', async () => {
  console.log('Verificando prazos de formulários...');
  await checkDeadlines();
});

// Função para verificar prazos e enviar lembretes
async function checkDeadlines() {
  const forms = db.get('forms').value();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (const form of forms) {
    const deadlineDate = new Date(form.deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    
    const diffTime = deadlineDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Lembrete de 2 dias
    if (diffDays === 2 && !form.notifiedTwoDays) {
      await sendReminder(form, 2);
      db.get('forms')
        .find({ id: form.id })
        .assign({ notifiedTwoDays: true })
        .write();
    }
    
    // Lembrete de 1 dia
    if (diffDays === 1 && !form.notifiedOneDay) {
      await sendReminder(form, 1);
      db.get('forms')
        .find({ id: form.id })
        .assign({ notifiedOneDay: true })
        .write();
    }
  }
}

// Função para enviar lembretes
async function sendReminder(form, days) {
  try {
    const channels = db.get('channels').value();
    
    if (channels.length === 0) {
      console.log('Nenhum canal registrado para lembretes');
      return;
    }
    
    const message = `⚠️ *LEMBRETE DE FORMULÁRIO*\n\n*${form.title}*\n*Prazo:* ${form.deadline} (${days === 1 ? 'AMANHÃ' : 'em 2 dias'})\n*Descrição:* ${form.description || 'Sem descrição'}\n\nPor favor, não se esqueça de preencher este formulário a tempo.`;
    
    for (const channel of channels) {
      try {
        await sendSlackMessage(channel, message);
        console.log(`Lembrete enviado para o canal ${channel} sobre o formulário: ${form.title}`);
      } catch (error) {
        console.error(`Erro ao enviar lembrete para o canal ${channel}:`, error);
      }
    }
  } catch (error) {
    console.error('Erro ao enviar lembrete:', error);
  }
}

// Definir porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log('Bot iniciado! Verificador de prazos configurado para rodar diariamente às 10:00.');
});
