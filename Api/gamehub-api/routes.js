const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');
const authMiddleware = require('./auth');

const router = express.Router();

// Função auxiliar para centralizar o tratamento de erros
const handleRequest = async (res, callback) => {
  try {
    await callback();
  } catch (err) {
    console.error('ERRO NA ROTA:', err.stack);
    if (!res.headersSent) {
      if (err.code === '23505') { 
        return res.status(409).json({ message: 'Erro: Dados duplicados. A informação já pode estar cadastrada.', code: err.code });
      }
      res.status(500).json({ message: 'Erro interno do servidor.', error: err.message });
    }
  }
};

// --- ROTA DE LOGIN ---
router.post('/login', async (req, res) => {
  await handleRequest(res, async () => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });

    const result = await db.query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = result.rows[0];
    if (!admin) return res.status(404).json({ message: "Usuário não encontrado." });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ message: "Senha incorreta." });

    const token = jwt.sign({ id: admin.id, username: admin.username }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ message: "Login bem-sucedido!", token });
  });
});

// --- CRUD DE CLIENTES ---
router.post('/clients', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { name, birth_date, cpf, phone, email, address, neighborhood, city, client_type, hours_balance, subscription_status, subscription_date, next_billing_date, guardian_name, guardian_cpf, guardian_phone, guardian_relationship, agreed_to_terms, agreed_to_marketing } = req.body;
    if (!name || !cpf) return res.status(400).json({ message: 'Nome e CPF são obrigatórios.' });

    const sql = `INSERT INTO clients (name, birth_date, cpf, phone, email, address, neighborhood, city, client_type, hours_balance, subscription_status, subscription_date, next_billing_date, guardian_name, guardian_cpf, guardian_phone, guardian_relationship, agreed_to_terms, agreed_to_marketing) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`;
    const params = [name, birth_date, cpf, phone, email, address, neighborhood, city, client_type || 'AVULSO', hours_balance || 0, subscription_status || 'N/A', subscription_date, next_billing_date, guardian_name, guardian_cpf, guardian_phone, guardian_relationship, agreed_to_terms, agreed_to_marketing || false];
    const result = await db.query(sql, params);
    res.status(201).json({ message: "Cliente cadastrado com sucesso!", id: result.rows[0].id });
  });
});

router.get('/clients', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { rows } = await db.query("SELECT * FROM clients ORDER BY name");
    res.json(rows);
  });
});

router.get('/clients/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { rows } = await db.query("SELECT * FROM clients WHERE id = $1", [id]);
    if (rows.length === 0) return res.status(404).json({ message: "Cliente não encontrado" });
    res.json(rows[0]);
  });
});

router.put('/clients/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { name, birth_date, cpf, phone, email, address, neighborhood, city, client_type, subscription_status, subscription_date, next_billing_date, guardian_name, guardian_cpf, guardian_phone, guardian_relationship, agreed_to_terms, agreed_to_marketing } = req.body;
    if (!name || !cpf) return res.status(400).json({ message: 'Nome e CPF são obrigatórios.' });
    
    const sql = `UPDATE clients SET name = $1, birth_date = $2, cpf = $3, phone = $4, email = $5, address = $6, neighborhood = $7, city = $8, client_type = $9, subscription_status = $10, subscription_date = $11, next_billing_date = $12, guardian_name = $13, guardian_cpf = $14, guardian_phone = $15, guardian_relationship = $16, agreed_to_terms = $17, agreed_to_marketing = $18 WHERE id = $19`;
    const params = [name, birth_date, cpf, phone, email, address, neighborhood, city, client_type, subscription_status, subscription_date, next_billing_date, guardian_name, guardian_cpf, guardian_phone, guardian_relationship, agreed_to_terms, agreed_to_marketing, id];
    const result = await db.query(sql, params);

    if (result.rowCount === 0) return res.status(404).json({ message: "Cliente não encontrado" });
    res.json({ message: "Cliente atualizado com sucesso!" });
  });
});

router.delete('/clients/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const result = await db.query('DELETE FROM clients WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Cliente não encontrado" });
    res.json({ message: 'Cliente deletado com sucesso!' });
  });
});

// --- AÇÕES ESPECÍFICAS DE CLIENTES ---
router.post('/clients/:id/add-hours-transaction', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id: client_id } = req.params;
    const { hours_to_add, amount_paid, rate_used } = req.body;
    if (!hours_to_add || !amount_paid) return res.status(400).json({ message: 'Dados da transação inválidos.' });

    await db.query('BEGIN');
    await db.query(`UPDATE clients SET hours_balance = hours_balance + $1 WHERE id = $2`, [hours_to_add, client_id]);
    await db.query(`INSERT INTO transactions (client_id, transaction_type, hours_added, amount_paid, rate_used) VALUES ($1, 'ADD_HOURS', $2, $3, $4)`, [client_id, hours_to_add, amount_paid, rate_used]);
    await db.query('COMMIT');
    res.status(201).json({ message: 'Horas adicionadas e transação registrada com sucesso!' });
  });
});

router.post('/clients/:id/buy-package', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id: client_id } = req.params;
    const { package_id } = req.body;
    const packageResult = await db.query('SELECT * FROM packages WHERE id = $1', [package_id]);
    const packageData = packageResult.rows[0];
    if (!packageData) return res.status(404).json({ message: 'Pacote não encontrado.' });
    
    const { hours_included, price, name: packageName } = packageData;
    await db.query('BEGIN');
    await db.query(`UPDATE clients SET hours_balance = hours_balance + $1 WHERE id = $2`, [hours_included, client_id]);
    await db.query(`INSERT INTO transactions (client_id, transaction_type, hours_added, amount_paid, notes) VALUES ($1, 'PACKAGE_PURCHASE', $2, $3, $4)`, [client_id, hours_included, price, `Compra do ${packageName}`]);
    await db.query('COMMIT');
    res.status(200).json({ message: 'Pacote comprado e horas adicionadas com sucesso!' });
  });
});

router.patch('/clients/:id/upgrade-to-club', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { next_billing_date } = req.body;
    if (!next_billing_date) return res.status(400).json({ message: 'A próxima data de cobrança é obrigatória.' });
    const sql = `UPDATE clients SET client_type = 'CLUBE', subscription_status = 'PAGA', subscription_date = CURRENT_DATE, next_billing_date = $1 WHERE id = $2`;
    const result = await db.query(sql, [next_billing_date, id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Cliente não encontrado.' });
    res.json({ message: 'Cliente agora é um membro do Clube!' });
  });
});

router.patch('/clients/:id/renew-subscription', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { new_next_billing_date } = req.body;
    if (!new_next_billing_date) return res.status(400).json({ message: 'A nova data de cobrança é obrigatória.' });
    const sql = `UPDATE clients SET subscription_status = 'PAGA', next_billing_date = $1 WHERE id = $2`;
    const result = await db.query(sql, [new_next_billing_date, id]);
    if (result.rowCount === 0) return res.status(404).json({ message: "Cliente não encontrado" });
    res.json({ message: 'Assinatura renovada com sucesso!' });
  });
});

// --- ROTAS DE SESSÕES ---
router.post('/sessions/check-in', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { client_id } = req.body;
    const clientResult = await db.query('SELECT hours_balance FROM clients WHERE id = $1', [client_id]);
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ message: 'Cliente não encontrado.' });
    if (client.hours_balance <= 0) return res.status(400).json({ message: 'Cliente sem saldo de horas.' });
    const sessionResult = await db.query('SELECT id FROM sessions WHERE client_id = $1 AND exit_time IS NULL', [client_id]);
    if (sessionResult.rows[0]) return res.status(409).json({ message: 'Este cliente já possui uma sessão de jogo ativa.' });
    const entry_time = new Date();
    const insertResult = await db.query('INSERT INTO sessions (client_id, entry_time) VALUES ($1, $2) RETURNING id', [client_id, entry_time]);
    res.status(201).json({ message: 'Check-in realizado com sucesso!', session_id: insertResult.rows[0].id });
  });
});
  
router.post('/sessions/check-out', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { client_id } = req.body;
    const { rows } = await db.query(`SELECT * FROM sessions WHERE client_id = $1 AND exit_time IS NULL`, [client_id]);
    const session = rows[0];
    if (!session) return res.status(404).json({ message: "Nenhuma sessão ativa encontrada para este cliente." });

    const entryTime = new Date(session.entry_time);
    const exitTime = new Date();
    const durationMillis = exitTime.getTime() - entryTime.getTime();
    const durationMinutes = Math.round(durationMillis / 60000);
    const durationHours = durationMillis / (1000 * 60 * 60);

    await db.query(`UPDATE sessions SET exit_time = $1, duration_minutes = $2 WHERE id = $3`, [exitTime, durationMinutes, session.id]);
    await db.query(`UPDATE clients SET hours_balance = hours_balance - $1 WHERE id = $2`, [durationHours, client_id]);
    res.json({ message: `Check-out realizado. Duração: ${durationMinutes} minutos.` });
  });
});

router.get('/sessions/client/:client_id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { client_id } = req.params;
    const { rows } = await db.query('SELECT * FROM sessions WHERE client_id = $1 ORDER BY entry_time DESC', [client_id]);
    res.json(rows);
  });
});
  
router.get('/sessions/active', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const sql = `SELECT s.id, s.entry_time, c.name, c.hours_balance, c.id AS client_id FROM sessions s JOIN clients c ON s.client_id = c.id WHERE s.exit_time IS NULL`;
    const { rows } = await db.query(sql);
    const sessionsWithPrediction = rows.map(session => {
      const entryTime = new Date(session.entry_time);
      const balanceInMilliseconds = parseFloat(session.hours_balance) * 60 * 60 * 1000;
      const predictedExitTimestamp = entryTime.getTime() + balanceInMilliseconds;
      return { ...session, predicted_exit_time: new Date(predictedExitTimestamp).toISOString() };
    });
    res.json(sessionsWithPrediction);
  });
});

// --- ROTAS DE CONFIGURAÇÕES ---
router.get('/settings', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { rows } = await db.query('SELECT * FROM settings');
    const settings = rows.reduce((acc, row) => {
      acc[row.setting_key] = row.setting_value;
      return acc;
    }, {});
    res.json(settings);
  });
});

router.put('/settings', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const settings = req.body;
    const sql = `UPDATE settings SET setting_value = $1 WHERE setting_key = $2`;
    const promises = Object.entries(settings).map(([key, value]) => db.query(sql, [value, key]));
    await Promise.all(promises);
    res.json({ message: 'Configurações atualizadas com sucesso!' });
  });
});

// --- ROTAS DE TRANSAÇÕES ---
router.get('/clients/:id/transactions', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const sql = 'SELECT * FROM transactions WHERE client_id = $1 ORDER BY transaction_date DESC';
    const { rows } = await db.query(sql, [id]);
    res.json(rows);
  });
});

// --- ROTAS DE ESTAÇÕES (STATIONS) ---
router.get('/stations', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { rows } = await db.query('SELECT * FROM stations ORDER BY type, name');
    res.json(rows);
  });
});

router.post('/stations', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { name, type, status } = req.body;
    if (!name || !type) return res.status(400).json({ message: 'Nome e Tipo são obrigatórios.' });
    const sql = `INSERT INTO stations (name, type, status) VALUES ($1, $2, $3) RETURNING id`;
    const { rows } = await db.query(sql, [name, type, status || 'AVAILABLE']);
    res.status(201).json({ id: rows[0].id, message: 'Estação criada com sucesso!' });
  });
});

router.put('/stations/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { name, type, status } = req.body;
    if (!name || !type || !status) return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    const sql = `UPDATE stations SET name = $1, type = $2, status = $3 WHERE id = $4`;
    const result = await db.query(sql, [name, type, status, id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Estação não encontrada.' });
    res.json({ message: 'Estação atualizada com sucesso!' });
  });
});

router.delete('/stations/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const result = await db.query('DELETE FROM stations WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Estação não encontrada.' });
    res.json({ message: 'Estação deletada com sucesso!' });
  });
});

// --- ROTAS DE PACOTES (PACKAGES) ---
router.get('/packages/all', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { rows } = await db.query('SELECT * FROM packages ORDER BY price');
        res.json(rows);
    });
});

router.get('/packages', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { rows } = await db.query('SELECT * FROM packages WHERE is_active = true ORDER BY price');
        res.json(rows);
    });
});

router.post('/packages', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { name, description, hours_included, price, is_active } = req.body;
        const sql = `INSERT INTO packages (name, description, hours_included, price, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id`;
        const { rows } = await db.query(sql, [name, description, hours_included, price, is_active]);
        res.status(201).json({ id: rows[0].id, message: 'Pacote criado com sucesso!' });
    });
});

router.put('/packages/:id', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { id } = req.params;
        const { name, description, hours_included, price, is_active } = req.body;
        const sql = `UPDATE packages SET name = $1, description = $2, hours_included = $3, price = $4, is_active = $5 WHERE id = $6`;
        const result = await db.query(sql, [name, description, hours_included, price, is_active, id]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Pacote não encontrado.' });
        res.json({ message: 'Pacote atualizado com sucesso!' });
    });
});

router.delete('/packages/:id', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { id } = req.params;
        const result = await db.query('DELETE FROM packages WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Pacote não encontrado.' });
        res.json({ message: 'Pacote deletado com sucesso!' });
    });
});

// --- ROTAS DE AGENDAMENTOS (BOOKINGS) ---
router.get('/bookings', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'A data é obrigatória.' });
    const sql = `SELECT b.*, c.name as client_name FROM bookings b JOIN clients c ON b.client_id = c.id WHERE date(b.start_time) = $1 ORDER BY b.start_time`;
    const { rows } = await db.query(sql, [date]);
    res.json(rows);
  });
});

router.post('/bookings', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { client_id, station_id, start_time, end_time, notes } = req.body;
    const checkOverlapSql = `SELECT id FROM bookings WHERE station_id = $1 AND (start_time, end_time) OVERLAPS ($2, $3)`;
    const overlapResult = await db.query(checkOverlapSql, [station_id, start_time, end_time]);
    if (overlapResult.rows.length > 0) {
      return res.status(409).json({ message: 'Conflito de horário. Esta estação já está agendada para este período.' });
    }
    const insertSql = `INSERT INTO bookings (client_id, station_id, start_time, end_time, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id`;
    const { rows } = await db.query(insertSql, [client_id, station_id, start_time, end_time, notes]);
    res.status(201).json({ id: rows[0].id, message: 'Agendamento criado com sucesso!' });
  });
});

router.delete('/bookings/:id', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { id } = req.params;
        const result = await db.query('DELETE FROM bookings WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Agendamento não encontrado.' });
        res.json({ message: 'Agendamento cancelado com sucesso!' });
    });
});

module.exports = router;