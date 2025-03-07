const express = require('express');
const https = require('https');
const fs = require('fs');
const fetch = require('node-fetch');
const app = express();

// Configurar o parsing de JSON para as requisições
app.use(express.json());

// Função para manter o bot ativo com auto-ping
function manterBotAtivo() {
  const interval = 4 * 60 * 1000; // 4 minutos
  const projectURL = `https://${process.env.PROJECT_DOMAIN}.glitch.me`;
  
  console.log(`\n🔄 CONFIGURANDO AUTO-PING: ${projectURL}`);
  console.log(`🕒 Intervalo: ${interval/1000/60} minutos`);
  
  // Ping inicial para garantir que estamos ativos
  setTimeout(() => {
    console.log(`\n[${new Date().toISOString()}] 🔄 PING INICIAL`);
    pingServer();
  }, 10000); // 10 segundos após inicialização
  
  // Pings em intervalos regulares
  setInterval(() => {
    pingServer();
  }, interval);
  
  function pingServer() {
    const now = new Date().toISOString();
    console.log(`\n[${now}] 🔄 EXECUTANDO AUTO-PING`);
    
    // Fazer uma requisição para nosso próprio servidor
    const req = https.get(`${projectURL}/ping`, (res) => {
      console.log(`[${now}] ✅ AUTO-PING CONCLUÍDO - Status: ${res.statusCode}`);
    });
    
    // Definir um timeout para a requisição
    req.setTimeout(10000, () => {
      req.abort();
      console.log(`[${now}] ⚠️ AUTO-PING TIMEOUT - Servidor pode estar dormindo`);
    });
    
    req.on('error', (err) => {
      console.log(`[${now}] ❌ ERRO NO AUTO-PING: ${err.message}`);
    });
  }
}

// Middleware simples para logar requisições
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  
  console.log(`[${timestamp}] ${method} ${url}`);
  next();
});

// Endpoint de ping para o auto-ping
app.get('/ping', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📡 PING RECEBIDO`);
  res.status(200).json({ 
    status: 'OK',
    message: 'Ping recebido com sucesso',
    timestamp: timestamp
  });
});

// Endpoint de health check para o Better Uptime
app.get('/health', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔍 HEALTH CHECK`);
  
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: timestamp
  });
});

// Função aprimorada para limpar o texto de formatação do Slack
function cleanText(text) {
  console.log("[LIMPEZA] Texto original:", text);
  
  // Extrair texto de links formatados do Slack <URL|Texto>
  let cleanedText = text.replace(/<([^|]+)\|([^>]+)>/g, (match, url, displayText) => {
    console.log("[LIMPEZA] Link encontrado:", match, "-> Substituído por:", displayText);
    return displayText;
  });
  
  console.log("[LIMPEZA] Após substituir links:", cleanedText);
  
  // Remover outros links <URL> por string vazia
  cleanedText = cleanedText.replace(/<([^>]+)>/g, '');
  
  console.log("[LIMPEZA] Após remover outros links:", cleanedText);
  
  // Remover formatação de negrito, itálico, etc.
  cleanedText = cleanedText.replace(/[*_~`]/g, '');
  
  console.log("[LIMPEZA] Após remover formatação:", cleanedText);
  
  // Normalizar hífens e traços
  cleanedText = cleanedText.replace(/[–—]/g, '-');
  
  // Normalizar acentos em palavras comuns
  cleanedText = cleanedText.replace(/até/gi, 'ate');
  
  // Cortar o texto em frases que indicam o fim da informação relevante
  const cutPhrases = ['não carregar', 'não clicar', 'link', 'olá a todos', 'olá pessoal', 'alo malta'];
  
  for (const phrase of cutPhrases) {
    const index = cleanedText.toLowerCase().indexOf(phrase);
    if (index !== -1) {
      cleanedText = cleanedText.substring(0, index);
      console.log(`[LIMPEZA] Texto cortado em "${phrase}"`, cleanedText);
      break;
    }
  }
  
  // Normalizar espaços
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
  
  console.log("[LIMPEZA] Texto final limpo:", cleanedText);
  
  return cleanedText;
}

// Função para processar comandos do Slack
function processCommand(text, channelId) {
  // Dividir o texto em partes para analisar o comando
  const parts = text.trim().split(' ');
  const command = parts[0].toLowerCase();
  
  // Verificar qual comando foi enviado
  if (command === '!listar') {
    return listarFormularios(channelId);
  } 
  else if (command === '!status') {
    return verificarStatus();
  }
  else if (command === '!excluir') {
    // Comando para excluir formulário
    const formId = parts[1]; // Pega o ID após o comando
    if (!formId) {
      // Se não foi fornecido um ID, mostrar a lista de formulários
      return listarFormulariosParaExclusao(channelId);
    } else {
      // Se foi fornecido um ID, tenta excluir o formulário
      return excluirFormulario(formId, channelId);
    }
  }
  else if (command === '!limpar') {
    // Comando para limpar todos os formulários
    return limparTodosFormularios(channelId);
  }
  else if (command === '!ajuda') {
    return mostrarAjuda();
  }
  
  // Se não for um comando conhecido, retorna null
  return null;
}

// Função para listar formulários
function listarFormularios(channelId) {
  try {
    // Carregar os formulários do banco de dados
    const db = JSON.parse(fs.readFileSync('.data/forms-db.json', 'utf8'));
    const forms = db.forms || [];
    
    // Filtrar formulários para o canal específico, se fornecido
    const channelForms = channelId 
      ? forms.filter(form => form.channelId === channelId) 
      : forms;
    
    if (channelForms.length === 0) {
      return {
        text: "Não há formulários registrados para este canal."
      };
    }
    
    // Criar uma mensagem formatada com a lista de formulários
    let message = "*Formulários registrados:*\n\n";
    
    channelForms.forEach(form => {
      const deadline = new Date(form.deadline);
      const formattedDate = `${deadline.getDate().toString().padStart(2, '0')}/${(deadline.getMonth() + 1).toString().padStart(2, '0')}`;
      
      message += `*Título:* ${form.title}\n`;
      message += `*Prazo:* ${formattedDate}\n`;
      message += `*Status:* ${form.status}\n`;
      message += `*ID:* ${form.id}\n\n`;
    });
    
    return {
      text: message
    };
  } catch (error) {
    console.error('Erro ao listar formulários:', error);
    return {
      text: `Erro ao listar formulários: ${error.message}`
    };
  }
}

// Função para verificar o status do bot
function verificarStatus() {
  const uptime = process.uptime();
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  
  let uptimeStr = '';
  if (days > 0) uptimeStr += `${days}d `;
  if (hours > 0) uptimeStr += `${hours}h `;
  if (minutes > 0) uptimeStr += `${minutes}m `;
  uptimeStr += `${seconds}s`;
  
  // Contar formulários ativos
  let activeFormCount = 0;
  try {
    const db = JSON.parse(fs.readFileSync('.data/forms-db.json', 'utf8'));
    activeFormCount = db.forms.filter(form => form.status === 'active').length;
  } catch (error) {
    console.error('Erro ao contar formulários ativos:', error);
  }
  
  return {
    text: `*Status do Bot*\n\n` +
          `✅ *Bot ativo:* Sim\n` +
          `⏱️ *Tempo de atividade:* ${uptimeStr}\n` +
          `📝 *Formulários ativos:* ${activeFormCount}\n` +
          `🔄 *Auto-ping:* Configurado (a cada 4 minutos)\n` +
          `🔔 *Lembretes:* 1 dia antes e no último dia\n` +
          `🧹 *Limpeza automática:* Configurada (diariamente à meia-noite)`
  };
}

// Função para listar formulários com opção de exclusão
function listarFormulariosParaExclusao(channelId) {
  // Carregar os formulários do banco de dados
  const db = JSON.parse(fs.readFileSync('.data/forms-db.json', 'utf8'));
  const forms = db.forms || [];
  
  // Filtrar formulários para o canal específico, se fornecido
  const channelForms = channelId 
    ? forms.filter(form => form.channelId === channelId) 
    : forms;
  
  if (channelForms.length === 0) {
    return {
      text: "Não há formulários registrados para este canal."
    };
  }
  
  // Criar uma mensagem formatada com a lista de formulários
  let message = "*Formulários disponíveis para exclusão:*\n\n";
  
  channelForms.forEach(form => {
    const deadline = new Date(form.deadline);
    const formattedDate = `${deadline.getDate().toString().padStart(2, '0')}/${(deadline.getMonth() + 1).toString().padStart(2, '0')}`;
    
    message += `*ID:* ${form.id}\n`;
    message += `*Título:* ${form.title}\n`;
    message += `*Prazo:* ${formattedDate}\n`;
    message += `*Status:* ${form.status}\n`;
    message += `Para excluir, digite: \`!excluir ${form.id}\`\n\n`;
  });
  
  message += "_Atenção: A exclusão de formulários é permanente e não pode ser desfeita._\n";
  message += "_Para excluir todos os formulários, digite: `!limpar`_";
  
  return {
    text: message
  };
}

// Função para excluir um formulário específico
function excluirFormulario(formId, channelId) {
  try {
    // Carregar o banco de dados
    const dbPath = '.data/forms-db.json';
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    
    // Encontrar o formulário pelo ID
    const formIndex = db.forms.findIndex(form => form.id === formId);
    
    if (formIndex === -1) {
      return {
        text: `❌ Erro: Formulário com ID ${formId} não encontrado.`
      };
    }
    
    // Verificar se o formulário pertence ao canal atual (segurança adicional)
    if (channelId && db.forms[formIndex].channelId !== channelId) {
      return {
        text: `❌ Erro: Você só pode excluir formulários do canal atual.`
      };
    }
    
    // Guardar informações do formulário para a mensagem de confirmação
    const deletedForm = db.forms[formIndex];
    const deadline = new Date(deletedForm.deadline);
    const formattedDate = `${deadline.getDate().toString().padStart(2, '0')}/${(deadline.getMonth() + 1).toString().padStart(2, '0')}`;
    
    // Remover o formulário do array
    db.forms.splice(formIndex, 1);
    
    // Salvar o banco de dados atualizado
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    
    console.log(`Formulário ${formId} excluído com sucesso.`);
    
    // Retornar mensagem de confirmação
    return {
      text: `✅ Formulário excluído com sucesso!\n\n*Detalhes do formulário excluído:*\n*Título:* ${deletedForm.title}\n*Prazo:* ${formattedDate}`
    };
    
  } catch (error) {
    console.error('Erro ao excluir formulário:', error);
    return {
      text: `❌ Erro ao excluir formulário: ${error.message}`
    };
  }
}

// Função para limpar todos os formulários
function limparTodosFormularios(channelId) {
  try {
    // Carregar o banco de dados
    const dbPath = '.data/forms-db.json';
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    
    // Contar formulários antes da limpeza
    const totalForms = db.forms.length;
    const channelForms = channelId 
      ? db.forms.filter(form => form.channelId === channelId).length 
      : totalForms;
    
    if (channelForms === 0) {
      return {
        text: "Não há formulários para limpar neste canal."
      };
    }
    
    // Se um canal específico foi fornecido, remover apenas os formulários desse canal
    if (channelId) {
      db.forms = db.forms.filter(form => form.channelId !== channelId);
    } else {
      // Caso contrário, remover todos os formulários
      db.forms = [];
    }
    
    // Salvar o banco de dados atualizado
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    
    console.log(`Todos os formulários ${channelId ? 'do canal' : ''} foram limpos.`);
    
    // Retornar mensagem de confirmação
    return {
      text: `✅ Limpeza concluída! ${channelForms} formulários foram removidos.`
    };
    
  } catch (error) {
    console.error('Erro ao limpar formulários:', error);
    return {
      text: `❌ Erro ao limpar formulários: ${error.message}`
    };
  }
}

// Função para mostrar ajuda com comandos disponíveis
function mostrarAjuda() {
  return {
    text: "*Comandos disponíveis:*\n\n" +
          "`!listar` - Lista todos os formulários registrados\n" +
          "`!status` - Mostra o status atual do bot\n" +
          "`!excluir` - Mostra formulários disponíveis para exclusão\n" +
          "`!excluir [ID]` - Exclui o formulário com o ID especificado\n" +
          "`!limpar` - Remove todos os formulários do canal atual\n" +
          "`!ajuda` - Mostra esta mensagem de ajuda\n\n" +
          "*Funcionalidades automáticas:*\n" +
          "• Detecção automática de novos formulários\n" +
          "• Lembretes automáticos 1 dia antes e no último dia para preenchimento\n" +
          "• Limpeza automática de formulários expirados à meia-noite"
  };
}

// Função para enviar mensagem para o Slack
async function enviarMensagemSlack(channelId, text) {
  try {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    
    if (!slackToken) {
      throw new Error('Token do Slack não configurado');
    }
    
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${slackToken}`
      },
      body: JSON.stringify({
        channel: channelId,
        text: text
      })
    });
    
    const data = await response.json();
    
    if (!data.ok) {
      throw new Error(`Erro ao enviar mensagem para o Slack: ${data.error}`);
    }
    
    return data;
  } catch (error) {
    console.error('Erro ao enviar mensagem para o Slack:', error);
    return null;
  }
}

// Função para registrar um novo formulário
function registerForm(title, deadline, channelId, messageTs) {
  try {
    // Carregar o banco de dados
    const dbPath = '.data/forms-db.json';
    let db;
    
    try {
      db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (error) {
      // Se o arquivo não existir ou estiver corrompido, criar um novo banco de dados
      db = { forms: [], channels: [] };
    }
    
    // Gerar um ID único para o formulário
    const formId = Date.now().toString();
    
    // Criar o novo formulário
    const newForm = {
      id: formId,
      title: title,
      deadline: deadline,
      channelId: channelId,
      messageTs: messageTs,
      status: 'active',
      createdAt: new Date().toISOString(),
      oneDayReminderSent: null,  // Agora armazena a data em que foi enviado
      finalDayReminderSent: null // Agora armazena a data em que foi enviado
    };
    
    // Adicionar o formulário ao banco de dados
    db.forms.push(newForm);
    
    // Verificar se o canal já está registrado
    if (!db.channels.includes(channelId)) {
      db.channels.push(channelId);
    }
    
    // Salvar o banco de dados atualizado
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    
    console.log(`Novo formulário registrado: ${title}, Prazo: ${deadline}`);
    
    return newForm;
  } catch (error) {
    console.error('Erro ao registrar formulário:', error);
    return null;
  }
}

// Função para verificar prazos e enviar lembretes
async function checkDeadlines() {
  try {
    console.log(`\n[${new Date().toISOString()}] 🔔 VERIFICANDO PRAZOS DE FORMULÁRIOS`);
    
    // Carregar o banco de dados
    const dbPath = '.data/forms-db.json';
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const forms = db.forms || [];
    
    // Data atual
    const now = new Date();
    const currentHour = now.getHours();
    
    // Verificar se é hora de enviar notificações (19:00)
    const shouldSendNotifications = currentHour === 19;
    
    // Para cálculo de dias, normalizar para início do dia
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    // Verificar cada formulário
    for (const form of forms) {
      // Pular formulários já marcados como expirados
      if (form.status === 'expired') continue;
      
      // Converter deadline para objeto Date
      const deadline = new Date(form.deadline);
      deadline.setHours(23, 59, 59, 999); // Definir para final do dia
      
      // Calcular diferença em dias
      const diffTime = deadline.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      console.log(`Formulário: ${form.title}, Prazo: ${deadline.toISOString()}, Dias restantes: ${diffDays}`);
      
      // Verificar se é o dia do prazo (0 dias restantes)
      if (diffDays === 0) {
        // Se for hora de enviar notificações e o lembrete do dia final não foi enviado hoje
        if (shouldSendNotifications && !isReminderSentToday(form, 'finalDay')) {
          console.log(`Enviando lembrete de ÚLTIMO DIA para: ${form.title}`);
          
          // Formatar a data no formato DD/MM
          const formattedDate = `${deadline.getDate().toString().padStart(2, '0')}/${(deadline.getMonth() + 1).toString().padStart(2, '0')}`;
          
          // Enviar mensagem de lembrete
          const message = `⚠️ *LEMBRETE: ÚLTIMO DIA* ⚠️\n\nHoje (${formattedDate}) é o *ÚLTIMO DIA* para responder ao formulário:\n*${form.title}*\n\nNão deixe para depois!`;
          await enviarMensagemSlack(form.channelId, message);
          
          // Marcar que o lembrete do dia final foi enviado hoje
          form.finalDayReminderSent = today.toISOString().split('T')[0];
          
          // Salvar o banco de dados atualizado
          fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        }
      }
      // Verificar se falta 1 dia para o prazo
      else if (diffDays === 1) {
        // Se for hora de enviar notificações e o lembrete de 1 dia não foi enviado hoje
        if (shouldSendNotifications && !isReminderSentToday(form, 'oneDay')) {
          console.log(`Enviando lembrete de 1 DIA para: ${form.title}`);
          
          // Formatar a data no formato DD/MM
          const formattedDate = `${deadline.getDate().toString().padStart(2, '0')}/${(deadline.getMonth() + 1).toString().padStart(2, '0')}`;
          
          // Enviar mensagem de lembrete
          const message = `⚠️ *LEMBRETE* ⚠️\n\nO formulário *${form.title}* deve ser respondido até *amanhã (${formattedDate})*.\n\nNão deixe para a última hora!`;
          await enviarMensagemSlack(form.channelId, message);
          
          // Marcar que o lembrete de 1 dia foi enviado hoje
          form.oneDayReminderSent = today.toISOString().split('T')[0];
          
          // Salvar o banco de dados atualizado
          fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        }
      }
      
      // Verificar se o prazo já passou (sempre, independente da hora)
      if (diffDays < 0 && form.status !== 'expired') {
        console.log(`Marcando formulário como expirado: ${form.title}`);
        
        // Marcar o formulário como expirado
        form.status = 'expired';
        
        // Salvar o banco de dados atualizado
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
      }
    }
    
    console.log(`[${new Date().toISOString()}] ✅ VERIFICAÇÃO DE PRAZOS CONCLUÍDA`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ ERRO AO VERIFICAR PRAZOS:`, error);
  }
}

// Função auxiliar para verificar se um lembrete foi enviado hoje
function isReminderSentToday(form, reminderType) {
  const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
  
  if (reminderType === 'oneDay') {
    return form.oneDayReminderSent === today;
  } else if (reminderType === 'finalDay') {
    return form.finalDayReminderSent === today;
  }
  
  return false;
}

// Função para limpar formulários expirados
function cleanupExpiredForms() {
  try {
    console.log(`\n[${new Date().toISOString()}] 🧹 INICIANDO LIMPEZA DE FORMULÁRIOS EXPIRADOS`);
    
    // Carregar o banco de dados
    const dbPath = '.data/forms-db.json';
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    
    // Filtrar apenas formulários não expirados
    const activeFormsCount = db.forms.length;
    db.forms = db.forms.filter(form => form.status !== 'expired');
    const removedCount = activeFormsCount - db.forms.length;
    
    // Salvar o banco de dados atualizado
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    
    console.log(`[${new Date().toISOString()}] ✅ LIMPEZA CONCLUÍDA - ${removedCount} formulários expirados removidos`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ ERRO AO LIMPAR FORMULÁRIOS EXPIRADOS:`, error);
  }
}

// Função para testar o regex em diferentes partes do texto
function testRegexOnText(regex, text) {
  console.log("[REGEX TEST] Testando regex em texto completo:", regex.test(text));
  
  // Testar em diferentes partes do texto
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 5; j < Math.min(words.length + 1, i + 20); j++) {
      const segment = words.slice(i, j).join(' ');
      if (regex.test(segment)) {
        console.log("[REGEX TEST] Encontrado match em segmento:", segment);
        return segment;
      }
    }
  }
  
  return null;
}

// Função para processar eventos do Slack
async function processSlackEvent(event) {
  try {
    // Verificar se é uma mensagem
    if (event.type === 'message' && event.text) {
      const text = event.text;
      const channelId = event.channel;
      
      console.log(`\n----- ANÁLISE DE MENSAGEM -----`);
      console.log(`[ORIGINAL] ${text}`);
      
      // Verificar se é um comando
      if (text.startsWith('!')) {
        console.log(`[COMANDO] Processando comando: ${text}`);
        const response = processCommand(text, channelId);
        
        if (response) {
          // Enviar resposta para o Slack
          await enviarMensagemSlack(channelId, response.text);
          console.log(`[SUCESSO] Comando processado com sucesso`);
          console.log(`----- FIM DA ANÁLISE -----\n`);
          return true;
        } else {
          console.log(`[ERRO] Comando não reconhecido`);
          console.log(`----- FIM DA ANÁLISE -----\n`);
          return false;
        }
      }
      
      // Limpar o texto de formatação do Slack
      const cleanedText = cleanText(text);
      console.log(`[PROCESSADO] ${cleanedText}`);
      
      // Regex mais flexível para detectar formulários
      const formPattern = /NOVO FORMULÁRIO\s*-\s*([^-]+)-\s*responder\s+at[eé](?:\s+dia)?\s*(\d{1,2})\/(\d{1,2})(?:\s*-|\s|$)/i;
      
      // Testar o regex em diferentes partes do texto
      const matchSegment = testRegexOnText(formPattern, cleanedText);
      
      // Testar o regex diretamente e mostrar o resultado
      const regexTest = formPattern.test(cleanedText);
      console.log(`[REGEX TEST] Padrão de formulário detectado: ${regexTest}`);
      
      // Se o regex falhar, mostrar uma mensagem de depuração
      if (!regexTest) {
        console.log(`[DICA] Regex não detectou o padrão. Formato esperado: "NOVO FORMULÁRIO - Título - responder ate [dia] DD/MM"`);
        console.log(`[REGEX] Padrão atual: ${formPattern}`);
      }
      
      const match = cleanedText.match(formPattern);
      
      if (match) {
        console.log(`[REGEX] Padrão de formulário detectado`);
        console.log(`[MATCH] Grupos capturados:`, match);
        
        // Extrair título e data
        const title = match[1].trim();
        const day = parseInt(match[2]);
        const month = parseInt(match[3]);
        
        // Obter o ano atual
        const currentDate = new Date();
        let year = currentDate.getFullYear();
        
        // Criar objeto de data para o prazo
        let deadline = new Date(year, month - 1, day);
        
        // Se a data já passou este ano, assumir que é para o próximo ano
        if (deadline < currentDate) {
          year++;
          deadline = new Date(year, month - 1, day);
        }
        
        console.log(`[SUCESSO] Formulário detectado: "${title}" com prazo ${day}/${month}/${year}`);
        
        // Registrar o formulário
        const form = registerForm(title, deadline.toISOString(), channelId, event.ts);
        
        if (form) {
          // Formatar a data no formato DD/MM
          const formattedDate = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}`;
          
          // Enviar mensagem de confirmação
          const confirmationMessage = `✅ *Novo formulário detectado!*\n\n*Título:* ${form.title}\n*Prazo:* ${formattedDate}\n*ID:* ${form.id}\n\n_Lembretes serão enviados 1 dia antes e no último dia para preenchimento às 19:00._`;
          await enviarMensagemSlack(channelId, confirmationMessage);
          
          console.log(`----- FIM DA ANÁLISE -----\n`);
          return true;
        }
      } else {
        console.log(`[DICA] Nenhum formulário detectado. Use o formato: NOVO FORMULÁRIO - Título do formulário - responder ate [dia] DD/MM`);
        console.log(`----- FIM DA ANÁLISE -----\n`);
      }
    }
    
    return false;
  } catch (error) {
    console.error(`[ERRO] Erro ao processar evento do Slack:`, error);
    console.log(`----- FIM DA ANÁLISE COM ERRO -----\n`);
    return false;
  }
}

// Endpoint para receber eventos do Slack
app.post('/slack/events', async (req, res) => {
  const body = req.body;
  
  // Verificar se é um desafio de URL
  if (body.challenge) {
    return res.send(body.challenge);
  }
  
  // Verificar se é um evento
  if (body.event) {
    // Processar o evento de forma assíncrona
    processSlackEvent(body.event).catch(error => {
      console.error('Erro ao processar evento:', error);
    });
  }
  
  // Responder imediatamente para evitar timeout
  res.status(200).send('OK');
});

// Configurar cron jobs para verificação de prazos e limpeza
const cron = require('node-cron');

// Verificar prazos a cada hora
cron.schedule('0 * * * *', () => {
  checkDeadlines().catch(error => {
    console.error('Erro ao verificar prazos:', error);
  });
});

// Limpar formulários expirados à meia-noite
cron.schedule('0 0 * * *', () => {
  cleanupExpiredForms();
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`URL do servidor: https://${process.env.PROJECT_DOMAIN}.glitch.me`);
  
  // Iniciar o mecanismo de auto-ping
  manterBotAtivo();
  
  // Executar verificação de prazos na inicialização
  checkDeadlines().catch(error => {
    console.error('Erro ao verificar prazos na inicialização:', error);
  });
  
  console.log(`Bot iniciado! Verificador de prazos configurado para rodar a cada hora.`);
  console.log(`Limpeza de formulários expirados configurada para rodar diariamente à meia-noite.`);
});