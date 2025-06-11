require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./database');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de CORS para Produção
const corsOptions = {
  origin: 'https://vemprogamehub.com',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: 'Content-Type,Authorization',
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use('/api', routes);

// Roda todo dia à 1h da manhã (fuso de São Paulo)
cron.schedule('0 1 * * *', async () => { 
  console.log('Executando verificação diária de assinaturas vencidas...');
  
  const sql = `
    UPDATE clients 
    SET subscription_status = 'PENDENTE' 
    WHERE client_type = 'CLUBE' 
      AND subscription_status = 'PAGA' 
      AND next_billing_date <= CURRENT_DATE;
  `;

  try {
    const result = await db.query(sql);
    if (result.rowCount > 0) {
      console.log(`Verificação concluída. ${result.rowCount} assinaturas atualizadas para PENDENTE.`);
    } else {
      console.log('Verificação concluída. Nenhuma assinatura vencida encontrada.');
    }
  } catch (err) {
    console.error('Erro ao executar a tarefa agendada de assinaturas:', err.message);
  }
}, {
  scheduled: true,
  timezone: "America/Sao_Paulo"
});


// Função de inicialização para garantir que as tabelas sejam criadas antes de o servidor iniciar
const startServer = async () => {
  try {
    await db.createTables(); // Espera a criação das tabelas
    app.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  } catch (err) {
    console.error("Falha fatal ao inicializar. O servidor não será iniciado.", err);
    process.exit(1);
  }
};

startServer();