# Slack Form Bot

Bot para detectar automaticamente mensagens sobre formulários no Slack e enviar lembretes antes dos prazos.

## Funcionalidades

- Detecta automaticamente mensagens sobre formulários
- Extrai título, prazo e descrição
- Envia lembretes 2 dias e 1 dia antes dos prazos

## Formato da Mensagem

Para que o bot detecte um formulário, use o seguinte formato:

```
Novo formulário: "Título do Formulário" Prazo: AAAA-MM-DD Descrição: "Descrição do formulário"
```

Exemplo:

```
Novo formulário: "Avaliação de Desempenho Q2" Prazo: 2023-06-30 Descrição: "Todos os funcionários devem preencher o formulário de avaliação do segundo trimestre"
```

### Passo 6: Obter a URL do seu projeto Glitch

1. No topo da página, clique no nome do seu projeto
2. Selecione "Share" (ou "Compartilhar")
3. Copie a "Live Site" URL (algo como `https://seu-projeto.glitch.me`)

### Passo 7: Configurar o App no Slack

1. Acesse [api.slack.com/apps](https://api.slack.com/apps)
2. Clique em "Create New App"
3. Escolha "From scratch"
4. Dê um nome ao seu app (ex: "Form Reminder Bot") e selecione seu workspace
5. Clique em "Create App"

### Passo 8: Configurar o Bot User

1. No menu lateral, clique em "App Home"
2. Role para baixo até a seção "App Display Name"
3. Defina o nome do seu bot (ex: "Form Reminder Bot")
4. Ative a opção "Always Show My Bot as Online" se desejar
5. Salve as alterações

### Passo 9: Configurar Permissões

1. No menu lateral, vá para "OAuth & Permissions"
2. Em "Bot Token Scopes", adicione as seguintes permissões:
   - `chat:write` (para enviar mensagens)
   - `channels:history` (para ler mensagens em canais)
   - `groups:history` (para ler mensagens em grupos privados)
   - `reactions:write` (para adicionar reações)
3. Clique em "Install to Workspace" para instalar o app no seu workspace
4. Após a instalação, copie o "Bot User OAuth Token" (começa com `xoxb-`)
5. Cole este token no arquivo `.env` do Glitch como `SLACK_BOT_TOKEN`

### Passo 10: Configurar Event Subscriptions

1. No menu lateral, vá para "Event Subscriptions"
2. Ative os eventos clicando no botão "On"
3. Em "Request URL", cole sua URL do Glitch + `/slack/events`:
   ```
   https://seu-projeto.glitch.me/slack/events
   ```
4. Aguarde a verificação (deve mostrar "Verified" com uma marca verde)
5. Em "Subscribe to bot events", adicione:
   - `message.channels` (para mensagens em canais públicos)
   - `message.groups` (para mensagens em canais privados)
6. Clique em "Save Changes"

### Passo 11: Obter o Signing Secret

1. No menu lateral, vá para "Basic Information"
2. Em "App Credentials", encontre e copie o "Signing Secret"
3. Cole este valor no arquivo `.env` do Glitch como `SLACK_SIGNING_SECRET`

### Passo 12: Reinstalar o App

1. No menu lateral, vá para "OAuth & Permissions"
2. Clique em "Install to Workspace" ou "Reinstall to Workspace"

### Passo 13: Adicionar o Bot a um Canal

1. No Slack, vá para um canal onde deseja usar o bot
2. Digite `/invite @nome-do-seu-bot`

### Passo 14: Testar o Bot

1. Envie uma mensagem no formato especificado:
   ```
   Novo formulário: "Avaliação de Desempenho Q2" Prazo: 2023-06-30 Descrição: "Todos os funcionários devem preencher o formulário de avaliação do segundo trimestre"
   ```
2. O bot deve adicionar uma reação ✅ à mensagem e responder na thread

### Passo 15: Configurar UptimeRobot (opcional)

Para manter seu bot ativo 24/7:

1. Crie uma conta em [UptimeRobot](https://uptimerobot.com/)
2. Adicione um novo monitor do tipo HTTP(s)
3. Configure para fazer ping na URL do seu projeto Glitch a cada 5 minutos

Agora você tem um bot do Slack totalmente funcional hospedado no Glitch que detecta automaticamente mensagens sobre formulários e envia lembretes antes dos prazos!


