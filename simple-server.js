// Importações básicas
const express = require("express");
const bodyParser = require("body-parser");
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const cron = require("node-cron");
const fetch = require("node-fetch");
const path = require("path");
require("dotenv").config();

// Configuração do banco de dados
const adapter = new FileSync(".data/forms-db.json");
const db = low(adapter);

// Inicializar banco de dados com estrutura padrão
db.defaults({
  forms: [],
  channels: [],
}).write();

// Inicializar o Express
const app = express();

// Middleware para analisar JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configurar pasta de arquivos estáticos (coloque isto ANTES de outras rotas)
app.use(express.static(path.join(__dirname, "public")));

// Rota principal
app.get("/", (req, res) => {
  res.send("Slack Form Bot está funcionando!");
});

// Rota de teste
app.get("/test", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Servidor está funcionando corretamente",
    timestamp: new Date().toISOString(),
  });
});

// Regex atualizada para o formato real das mensagens
const formPattern =
  /NOVO\s+FORMUL[AÁ]RIO\s*-\s*([^-]+?)\s*-\s*responder\s+at[eé]\s+(?:dia\s+)?(\d{1,2})\s*\/\s*(\d{1,2})/i;

// Rota específica para o desafio do Slack
app.post("/slack/events", (req, res) => {
  console.log("Recebida requisição POST em /slack/events");
  console.log("Headers:", JSON.stringify(req.headers));
  console.log("Body:", JSON.stringify(req.body));

  // Verificar se é um desafio de URL
  if (req.body && req.body.type === "url_verification") {
    console.log("Respondendo ao desafio do Slack:", req.body.challenge);
    return res.json({ challenge: req.body.challenge });
  }

  // Responder com sucesso para outros eventos
  res.status(200).send();

  // Processar eventos de forma assíncrona
  if (req.body && req.body.event) {
    processSlackEvent(req.body);
  }
});

// Função para limpar o texto e cortar tudo após a primeira palavra "link"
function cleanText(text) {
  if (!text) return "";

  // Cortar o texto na palavra "link" se ela existir
  const linkPattern = /\blink\b/i; // Encontra a palavra "link" como palavra completa
  const match = text.match(linkPattern);

  if (match) {
    const linkIndex = match.index;
    text = text.substring(0, linkIndex);
  }

  // Remover formatações de negrito, itálico, etc.
  let cleaned = text.replace(/[\*_~]/g, "");

  // Substituir links incorporados <URL|texto> por apenas o texto
  cleaned = cleaned.replace(/<([^|]+)\|([^>]+)>/g, "$2");

  // Substituir links simples <URL> por texto vazio
  cleaned = cleaned.replace(/<([^>]+)>/g, "");

  // Normalizar espaços múltiplos
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

// Função para processar eventos do Slack de forma assíncrona
async function processSlackEvent(payload) {
  try {
    // Verificar se é uma mensagem
    if (
      payload.event &&
      payload.event.type === "message" &&
      !payload.event.bot_id
    ) {
      const message = payload.event;

      // Verificar se é um comando
      if (message.text && message.text.startsWith("!")) {
        await processCommand(message);
        return;
      }

      // Verificar se a mensagem corresponde ao padrão de formulário
      if (message.text) {
        console.log("\n----- ANÁLISE DE MENSAGEM -----");
        console.log(`[ORIGINAL] ${message.text}`);

        // Limpar o texto e ignorar tudo após "link"
        const processedText = cleanText(message.text);
        console.log(`[PROCESSADO] ${processedText}`);

        // Tentar encontrar o padrão no texto limpo
        const match = processedText.match(formPattern);

        if (match) {
          // Extrair título e data
          const title = match[1].trim();
          const day = match[2].padStart(2, "0");
          const month = match[3].padStart(2, "0");

          // Usar o ano atual para a data
          const currentYear = new Date().getFullYear();
          const deadline = `${currentYear}-${month}-${day}`;

          console.log("[SUCESSO] Formulário detectado:");
          console.log(`  - Título: "${title}"`);
          console.log(`  - Data: ${day}/${month}/${currentYear}`);

          // Resto do código para adicionar o formulário...
          const formId = Date.now().toString();
          db.get("forms")
            .push({
              id: formId,
              title,
              deadline,
              description: "",
              addedBy: message.user,
              addedAt: new Date().toISOString(),
              notifiedTwoDays: false,
              notifiedOneDay: false,
              channel: message.channel,
            })
            .write();

          // Registrar o canal para lembretes se ainda não estiver registrado
          const channels = db.get("channels").value();
          if (!channels.includes(message.channel)) {
            db.get("channels").push(message.channel).write();
          }

          // Enviar confirmação
          await sendSlackMessage(
            message.channel,
            `✅ Formulário detectado e adicionado ao sistema!\n*Título:* ${title}\n*Prazo:* ${day}/${month}\n\nLembretes serão enviados automaticamente 2 dias e 1 dia antes do prazo.`,
            message.ts
          );

          // Adicionar reação
          await addReaction(message.channel, message.ts, "white_check_mark");
        } else {
          console.log("[ERRO] Padrão de formulário não encontrado");
          console.log("[DICA] Verifique se a mensagem segue o formato:");
          console.log('  "NOVO FORMULÁRIO - [título] - responder até [data]"');

          // Mostrar a expressão regular para depuração
          console.log(`[REGEX] ${formPattern}`);
        }
        console.log("----- FIM DA ANÁLISE -----\n");
      }
    }
  } catch (error) {
    console.error("[ERRO CRÍTICO] Erro ao processar evento do Slack:", error);
  }
}

// Função para processar comandos
async function processCommand(message) {
  const command = message.text.trim().toLowerCase();

  if (command === "!listar") {
    await listForms(message.channel, message.ts);
  } else if (command === "!status") {
    await checkStatus(message.channel, message.ts);
  }
}

// Função para listar formulários
async function listForms(channel, thread_ts) {
  try {
    const forms = db.get("forms").value();

    if (forms.length === 0) {
      await sendSlackMessage(
        channel,
        "Não há formulários registrados no momento.",
        thread_ts
      );
      return;
    }

    // Ordenar formulários por prazo (mais próximos primeiro)
    forms.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    let message = "*Formulários Registrados:*\n\n";

    for (const form of forms) {
      const deadlineDate = new Date(form.deadline);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const diffTime = deadlineDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let statusEmoji = "⏳";
      let statusText = `(faltam ${diffDays} dias)`;

      if (diffDays <= 0) {
        statusEmoji = "⚠️";
        statusText = "(prazo expirado)";
      } else if (diffDays === 1) {
        statusEmoji = "🔥";
        statusText = "(último dia)";
      } else if (diffDays <= 2) {
        statusEmoji = "⚠️";
        statusText = `(faltam ${diffDays} dias)`;
      }

      // Formatar a data para exibição (DD/MM)
      const deadlineParts = form.deadline.split("-");
      const formattedDate = `${deadlineParts[2]}/${deadlineParts[1]}`;

      message += `${statusEmoji} *${form.title}*\n   Prazo: ${formattedDate} ${statusText}\n   ID: ${form.id}\n\n`;
    }

    await sendSlackMessage(channel, message, thread_ts);
  } catch (error) {
    console.error("Erro ao listar formulários:", error);
    await sendSlackMessage(
      channel,
      "Erro ao listar formulários. Por favor, tente novamente.",
      thread_ts
    );
  }
}

// Função para verificar status do bot
async function checkStatus(channel, thread_ts) {
  try {
    const forms = db.get("forms").value();
    const channels = db.get("channels").value();

    const uptime = process.uptime();
    const uptimeHours = Math.floor(uptime / 3600);
    const uptimeMinutes = Math.floor((uptime % 3600) / 60);

    const message =
      `*Status do Bot:*\n\n` +
      `✅ Bot está funcionando normalmente\n` +
      `⏱️ Tempo online: ${uptimeHours}h ${uptimeMinutes}m\n` +
      `📋 Formulários registrados: ${forms.length}\n` +
      `💬 Canais monitorados: ${channels.length}\n` +
      `🔄 Verificação de prazos: Diariamente às 19:00\n`;

    await sendSlackMessage(channel, message, thread_ts);
  } catch (error) {
    console.error("Erro ao verificar status:", error);
    await sendSlackMessage(
      channel,
      "Erro ao verificar status. Por favor, tente novamente.",
      thread_ts
    );
  }
}

// Função para enviar mensagem ao Slack
async function sendSlackMessage(channel, text, thread_ts = null) {
  try {
    const url = "https://slack.com/api/chat.postMessage";
    const body = {
      channel: channel,
      text: text,
      parse: "mrkdwn",
    };

    if (thread_ts) {
      body.thread_ts = thread_ts;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error("Erro ao enviar mensagem:", data.error);
    }
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error);
  }
}

// Função para adicionar reação
async function addReaction(channel, timestamp, reaction) {
  try {
    const url = "https://slack.com/api/reactions.add";
    const body = {
      channel: channel,
      timestamp: timestamp,
      name: reaction,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error("Erro ao adicionar reação:", data.error);
    }
  } catch (error) {
    console.error("Erro ao adicionar reação:", error);
  }
}

// Configurar verificação diária de prazos
cron.schedule("0 19 * * *", async () => {
  console.log("Verificando prazos de formulários...");
  await checkDeadlines();
});

// Configurar limpeza diária de formulários expirados
cron.schedule("0 0 * * *", async () => {
  console.log("Removendo formulários expirados...");
  await removeExpiredForms();
});

// Função para verificar prazos e enviar lembretes
async function checkDeadlines() {
  const forms = db.get("forms").value();
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
      db.get("forms")
        .find({ id: form.id })
        .assign({ notifiedTwoDays: true })
        .write();
    }

    // Lembrete de 1 dia
    if (diffDays === 1 && !form.notifiedOneDay) {
      await sendReminder(form, 1);
      db.get("forms")
        .find({ id: form.id })
        .assign({ notifiedOneDay: true })
        .write();
    }

    // Remover formulários expirados (prazo já passou)
    if (diffDays < 0) {
      console.log(
        `Removendo formulário expirado: ${form.title} (${form.deadline})`
      );
      db.get("forms").remove({ id: form.id }).write();
    }
  }
}

// Função para enviar lembretes
async function sendReminder(form, days) {
  try {
    const channels = db.get("channels").value();

    if (channels.length === 0) {
      console.log("Nenhum canal registrado para lembretes");
      return;
    }

    // Formatar a data para exibição (DD/MM)
    const deadlineParts = form.deadline.split("-");
    const formattedDate = `${deadlineParts[2]}/${deadlineParts[1]}`;

    const message = `⚠️ *LEMBRETE DE FORMULÁRIO*\n\n*${
      form.title
    }*\n*Acaba:* ${formattedDate} (${
      days === 1 ? "AMANHÃ" : "em 2 dias"
    })\n\n Preenche a tempo.`;

    for (const channel of channels) {
      try {
        await sendSlackMessage(channel, message);
        console.log(
          `Lembrete enviado para o canal ${channel} sobre o formulário: ${form.title}`
        );
      } catch (error) {
        console.error(
          `Erro ao enviar lembrete para o canal ${channel}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error("Erro ao enviar lembrete:", error);
  }
}

// Função para remover formulários expirados
async function removeExpiredForms() {
  try {
    const forms = db.get("forms").value();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let removedCount = 0;

    for (const form of forms) {
      const deadlineDate = new Date(form.deadline);
      deadlineDate.setHours(0, 0, 0, 0);

      if (deadlineDate < today) {
        console.log(
          `Removendo formulário expirado: ${form.title} (${form.deadline})`
        );
        db.get("forms").remove({ id: form.id }).write();

        removedCount++;
      }
    }

    console.log(
      `Remoção de formulários expirados concluída. ${removedCount} formulário(s) removido(s).`
    );
  } catch (error) {
    console.error("Erro ao remover formulários expirados:", error);
  }
}

// Função simples para manter o bot ativo
function manterBotAtivo() {
  // Ping a cada 4 minutos (240000 ms)
  setInterval(async () => {
    try {
      // Fazer uma requisição HTTP real para a própria rota /test
      const response = await fetch(
        `http://localhost:${process.env.PORT || 3000}/test`
      );
      const data = await response.json();
      console.log(
        `[${new Date().toLocaleTimeString()}] Auto-ping: Bot ativo - ${
          data.status
        }`
      );
    } catch (error) {
      console.error(
        `[${new Date().toLocaleTimeString()}] Erro no auto-ping:`,
        error
      );
    }
  }, 240000);

  console.log(
    "Sistema de auto-ping configurado para manter o bot ativo no Glitch"
  );
}

// Iniciar o auto-ping quando o servidor iniciar
manterBotAtivo();

// Definir porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(
    "Bot iniciado! Verificador de prazos configurado para rodar diariamente às 19:00."
  );
  console.log(
    "Limpeza de formulários expirados configurada para rodar diariamente à meia-noite."
  );
});

// Lista completa de IPs do UptimeRobot
const uptimeRobotIPs = [
  '216.144.250.150',
  '69.162.124.226',
  '69.162.124.227',
  '69.162.124.228',
  '69.162.124.229',
  '69.162.124.230',
  '69.162.124.231',
  '69.162.124.232',
  '69.162.124.233',
  '69.162.124.234',
  '69.162.124.235',
  '69.162.124.236',
  '69.162.124.237',
  '69.162.124.238',
  '63.143.42.242',
  '63.143.42.243',
  '63.143.42.244',
  '63.143.42.245',
  '63.143.42.246',
  '63.143.42.247',
  '63.143.42.248',
  '63.143.42.249',
  '63.143.42.250',
  '63.143.42.251',
  '63.143.42.252',
  '63.143.42.253',
  '216.245.221.82',
  '216.245.221.83',
  '216.245.221.84',
  '216.245.221.85',
  '216.245.221.86',
  '216.245.221.87',
  '216.245.221.88',
  '216.245.221.89',
  '216.245.221.90',
  '216.245.221.91',
  '216.245.221.92',
  '216.245.221.93',
  '208.115.199.18',
  '208.115.199.19',
  '208.115.199.20',
  '208.115.199.21',
  '208.115.199.22',
  '208.115.199.23',
  '208.115.199.24',
  '208.115.199.25',
  '208.115.199.26',
  '208.115.199.27',
  '208.115.199.28',
  '208.115.199.29',
  '208.115.199.30',
  '216.144.248.18',
  '216.144.248.19',
  '216.144.248.20',
  '216.144.248.21',
  '216.144.248.22',
  '216.144.248.23',
  '216.144.248.24',
  '216.144.248.25',
  '216.144.248.26',
  '216.144.248.27',
  '216.144.248.28',
  '216.144.248.29',
  '216.144.248.30',
  '46.137.190.132',
  '122.248.234.23',
  '167.99.209.234',
  '178.62.52.237',
  '54.79.28.129',
  '54.94.142.218',
  '104.131.107.63',
  '54.67.10.127',
  '54.64.67.106',
  '159.203.30.41',
  '46.101.250.135',
  '18.221.56.27',
  '52.60.129.180',
  '159.89.8.111',
  '146.185.143.14',
  '139.59.173.249',
  '165.227.83.148',
  '128.199.195.156',
  '138.197.150.151',
  '34.233.66.117',
  '52.70.84.165',
  '54.225.82.45',
  '54.224.73.211',
  '3.79.92.117',
  '3.21.136.87',
  '35.170.215.196',
  '35.153.243.148',
  '18.116.158.121',
  '18.223.50.16',
  '54.241.175.147',
  '3.212.128.62',
  '52.22.236.30',
  '54.167.223.174',
  '3.12.251.153',
  '52.15.147.27',
  '18.116.205.62',
  '3.20.63.178',
  '13.56.33.4',
  '52.8.208.143',
  '34.198.201.66',
  '35.84.118.171',
  '44.227.38.253',
  '35.166.228.98',
  '99.80.173.191',
  '99.80.1.74',
  '3.111.88.158',
  '13.127.188.124',
  '18.180.208.214',
  '54.249.170.27',
  '3.105.190.221',
  '3.105.133.239',
  '78.47.98.55',
  '157.90.155.240',
  '49.13.24.81',
  '168.119.96.239',
  '157.90.156.63',
  '88.99.80.227',
  '49.13.134.145',
  '49.13.130.29',
  '168.119.53.160',
  '142.132.180.39',
  '49.13.164.148',
  '128.140.106.114',
  '78.47.173.76',
  '159.69.158.189',
  '128.140.41.193',
  '167.235.143.113',
  '49.13.167.123',
  '78.46.215.1',
  '78.46.190.63',
  '168.119.123.75',
  '135.181.154.9',
  '37.27.87.149',
  '37.27.34.49',
  '37.27.82.220',
  '65.109.129.165',
  '37.27.28.153',
  '37.27.29.68',
  '37.27.30.213',
  '65.109.142.78',
  '65.109.8.202',
  '5.161.75.7',
  '5.161.61.238',
  '5.78.87.38',
  '5.78.118.142'
];

// Middleware para proteger a rota de status
app.use('/status', (req, res, next) => {
  // Verificar User-Agent
  const userAgent = req.headers["user-agent"] || "";
  const isUptimeRobot = userAgent.includes("UptimeRobot");
  
  // Verificar IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  // Limpar o IP (remover possíveis portas ou informações adicionais)
  const cleanIP = ip.split(',')[0].trim();
  
  // Verificar se o IP está na whitelist
  const isWhitelistedIP = uptimeRobotIPs.includes(cleanIP);
  
  // Log para depuração
  console.log(`[STATUS] Acesso à rota /status - IP: ${cleanIP}, User-Agent: ${userAgent}`);
  console.log(`[STATUS] IP na whitelist: ${isWhitelistedIP}, User-Agent é UptimeRobot: ${isUptimeRobot}`);
  
  // Permitir acesso apenas para UptimeRobot
  if (isUptimeRobot && isWhitelistedIP) {
    console.log('[STATUS] Acesso autorizado para UptimeRobot');
    next();
  } else {
    console.log('[STATUS] Acesso negado - Cliente não autorizado');
    res.status(403).send("Forbidden: Unauthorized client.");
  }
});

// Rota específica para monitoramento do UptimeRobot
app.get("/status", (req, res) => {
  const uptime = process.uptime();
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  const uptimeSeconds = Math.floor(uptime % 60);
  
  const forms = db.get('forms').value();
  
  res.status(200).json({
    status: "OK",
    message: "Bot está funcionando normalmente",
    uptime: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`,
    forms_count: forms.length,
    timestamp: new Date().toISOString()
  });
});
