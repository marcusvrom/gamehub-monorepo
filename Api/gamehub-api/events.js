const express = require('express');
const router = express.Router();
const db = require('./database');
const authMiddleware = require('./auth');

const handleRequest = async (res, callback) => {
  try {
    await callback();
  } catch (err) {
    console.error('ERRO NA ROTA DE EVENTOS:', err.stack);
    if (!res.headersSent) {
      if (err.code === '23505') { // Erro de violação de constraint única (ex: SKU duplicado)
        return res.status(409).json({ message: 'Erro: Evento já cadastrado.', code: err.code });
      }
      res.status(500).json({ message: 'Erro interno do servidor.', error: err.message });
    }
  }
};

// --- CRUD DE EVENTOS ---

// --- CRUD DE EVENTOS ---

// GET - Listar todos os eventos
router.get('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const sql = `
      SELECT e.*, COUNT(er.id)::integer AS participant_count
      FROM events e
      LEFT JOIN event_registrations er ON e.id = er.event_id
      GROUP BY e.id
      ORDER BY e.start_time DESC
    `;
    const { rows } = await db.query(sql);
    res.json(rows);
  });
});

// GET - Obter detalhes de um evento E seus participantes
router.get('/:id', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { id } = req.params;
        const eventResult = await db.query('SELECT * FROM events WHERE id = $1', [id]);
        if (eventResult.rows.length === 0) return res.status(404).json({ message: 'Evento não encontrado.' });
        
        const participantsSql = `
            SELECT er.*, c.name as client_name 
            FROM event_registrations er
            JOIN clients c ON er.client_id = c.id
            WHERE er.event_id = $1
            ORDER BY er.registration_date
        `;
        const participantsResult = await db.query(participantsSql, [id]);

        res.json({
            event: eventResult.rows[0],
            participants: participantsResult.rows
        });
    });
});

// POST - Criar um novo evento
router.post('/', authMiddleware, async (req, res) => {
  console.log('[POST /events] Rota iniciada. Body:', req.body);
  await handleRequest(res, async () => {
    const { name, description, start_time, end_time, ticket_price, capacity, status } = req.body;
    if (!name || !start_time || !end_time) {
      console.log('[POST /events] Erro de validação.');
      return res.status(400).json({ message: 'Nome, data de início e data de fim são obrigatórios.' });
    }
    
    console.log('[POST /events] Parâmetros validados. Preparando SQL...');
    const sql = `
      INSERT INTO events (name, description, start_time, end_time, ticket_price, capacity, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *
    `;
    const params = [name, description, start_time, end_time, ticket_price || 0, capacity, status || 'AGENDADO'];
    
    console.log('[POST /events] Executando query...');
    const { rows } = await db.query(sql, params);
    console.log('[POST /events] Query executada com sucesso. Enviando resposta.');
    
    res.status(201).json(rows[0]);
  });
});

// PUT - Atualizar um evento existente
router.put('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { name, description, start_time, end_time, ticket_price, capacity, status } = req.body;
    if (!name || !start_time || !end_time) return res.status(400).json({ message: 'Nome, data de início e data de fim são obrigatórios.' });
    
    const sql = `UPDATE events SET name = $1, description = $2, start_time = $3, end_time = $4, ticket_price = $5, capacity = $6, status = $7 WHERE id = $8`;
    const params = [name, description, start_time, end_time, ticket_price || 0, capacity, status, id];
    const result = await db.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Evento não encontrado.' });
    res.json({ message: 'Evento atualizado com sucesso!' });
  });
});

// DELETE - Deletar um evento
router.delete('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const result = await db.query('DELETE FROM events WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Evento não encontrado.' });
    res.json({ message: 'Evento deletado com sucesso!' });
  });
});

// --- GERENCIAMENTO DE PARTICIPANTES ---

// POST - Inscrever um cliente em um evento
router.post('/:id/registrations', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { id: event_id } = req.params;
        const { client_id } = req.body;

        if (!client_id) return res.status(400).json({ message: 'O ID do cliente é obrigatório.' });

        const sql = `INSERT INTO event_registrations (event_id, client_id) VALUES ($1, $2) RETURNING *`;
        const { rows } = await db.query(sql, [event_id, client_id]);
        res.status(201).json(rows[0]);
    });
});

// PATCH - Marcar uma inscrição como paga
router.patch('/registrations/:id/mark-as-paid', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { id: registrationId } = req.params;
        const { payment_method } = req.body;

        await db.query('BEGIN');
        
        // Atualiza o status da inscrição
        const updateSql = `UPDATE event_registrations SET payment_status = 'PAGO', payment_method = $1 WHERE id = $2 RETURNING *`;
        const result = await db.query(updateSql, [payment_method, registrationId]);
        if (result.rowCount === 0) throw new Error('Inscrição não encontrada.');
        
        const registration = result.rows[0];

        // Busca o preço do ingresso e o nome do evento
        const eventResult = await db.query('SELECT ticket_price, name FROM events WHERE id = $1', [registration.event_id]);
        const event = eventResult.rows[0];

        // Adiciona a transação ao histórico financeiro
        const transactionSql = `INSERT INTO transactions (client_id, transaction_type, amount_paid, payment_method, notes) VALUES ($1, 'EVENTO', $2, $3, $4)`;
        await db.query(transactionSql, [registration.client_id, event.ticket_price, payment_method, `Pagamento Ingresso: ${event.name}`]);

        await db.query('COMMIT');
        res.json({ message: 'Inscrição marcada como paga com sucesso!' });
    });
});

// DELETE - Remover uma inscrição de um evento
router.delete('/registrations/:id', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { id: registrationId } = req.params;
        const result = await db.query('DELETE FROM event_registrations WHERE id = $1', [registrationId]);
        if (result.rowCount === 0) return res.status(404).json({ message: 'Inscrição não encontrada.' });
        res.json({ message: 'Inscrição removida com sucesso.' });
    });
});

module.exports = router;