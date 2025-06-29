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

// GET - Listar todos os eventos
router.get('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { rows } = await db.query('SELECT * FROM events ORDER BY start_time DESC');
    res.json(rows);
  });
});

// POST - Criar um novo evento
router.post('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { name, description, start_time, end_time, ticket_price, capacity, status } = req.body;
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ message: 'Nome, data de início e data de fim são obrigatórios.' });
    }
    const sql = `
      INSERT INTO events (name, description, start_time, end_time, ticket_price, capacity, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *
    `;
    const params = [name, description, start_time, end_time, ticket_price || 0, capacity, status || 'AGENDADO'];
    const { rows } = await db.query(sql, params);
    res.status(201).json(rows[0]);
  });
});

// PUT - Atualizar um evento existente
router.put('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { name, description, start_time, end_time, ticket_price, capacity, status } = req.body;
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ message: 'Nome, data de início e data de fim são obrigatórios.' });
    }
    const sql = `
      UPDATE events SET name = $1, description = $2, start_time = $3, end_time = $4, ticket_price = $5, capacity = $6, status = $7
      WHERE id = $8
    `;
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

module.exports = router;