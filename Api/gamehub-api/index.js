require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./database');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DE CORS PARA PRODUÇÃO ---
// Define explicitamente que apenas seu frontend pode fazer requisições
const corsOptions = {
  origin: 'https://vemprogamehub.com',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: 'Content-Type,Authorization',
  optionsSuccessStatus: 204
};

// Usa as opções de CORS para todas as requisições
app.use(cors(corsOptions));
// Garante que as requisições OPTIONS (pre-flight) sejam tratadas corretamente
app.options('*', cors(corsOptions));
app.use(express.json());
app.use('/api', routes);

// --- 3. TAREFA AGENDADA PARA VERIFICAR ASSINATURAS ---
// A expressão '0 1 * * *' significa: "Às 01:00, todos os dias"
cron.schedule('0 1 * * *', () => {
  console.log('Executando verificação diária de assinaturas vencidas...');
  
  const sql = `
    UPDATE clients 
    SET subscription_status = 'PENDENTE' 
    WHERE client_type = 'CLUBE' 
      AND subscription_status = 'PAGA' 
      AND next_billing_date <= CURRENT_DATE;
  `;

  db.run(sql, function(err) {
    if (err) {
      console.error('Erro ao atualizar assinaturas vencidas:', err.message);
    } else {
      console.log(`Verificação concluída. ${this.changes} assinaturas atualizadas para PENDENTE.`);
    }
  });
}, {
  scheduled: true,
  timezone: "America/Sao_Paulo" // Garante que rode no fuso horário correto
});


// Inicializa as tabelas do banco de dados (se não existirem)
db.createTables().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}).catch(err => {
    console.error("Falha ao inicializar o banco de dados. O servidor não será iniciado.", err);
    process.exit(1);
});