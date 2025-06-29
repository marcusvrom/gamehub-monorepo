const express = require('express');
const router = express.Router();
const db = require('./database');
const authMiddleware = require('./auth');

const handleRequest = async (res, callback) => {
  try {
    await callback();
  } catch (err) {
    console.error('ERRO NA ROTA DE JOGOS:', err.stack);
    if (!res.headersSent) res.status(500).json({ message: 'Erro interno do servidor.' });
  }
};

// GET - Listar todos os jogos
router.get('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const sql = `SELECT g.*, s.name as station_name FROM games g JOIN stations s ON g.station_id = s.id ORDER BY g.title`;
    const { rows } = await db.query(sql);
    res.json(rows);
  });
});

// POST - Adicionar um novo jogo
router.post('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { title, station_id, media_type, purchase_date, notes, purchase_price } = req.body;
    if (!title || !station_id || !media_type) return res.status(400).json({ message: 'Título, estação e tipo de mídia são obrigatórios.' });
    
    const sql = `INSERT INTO games (title, station_id, media_type, purchase_date, notes, purchase_price) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
    const params = [title, station_id, media_type, purchase_date || null, notes, purchase_price || 0];
    const { rows } = await db.query(sql, params);
    res.status(201).json(rows[0]);
  });
});

// PUT - Atualizar um jogo existente
router.put('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { title, station_id, media_type, purchase_date, notes, purchase_price } = req.body;
    if (!title || !station_id || !media_type) return res.status(400).json({ message: 'Título, estação e tipo de mídia são obrigatórios.' });
    
    const sql = `UPDATE games SET title = $1, station_id = $2, media_type = $3, purchase_date = $4, notes = $5, purchase_price = $6 WHERE id = $7`;
    const params = [title, station_id, media_type, purchase_date || null, notes, purchase_price || 0, id];
    const result = await db.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Jogo não encontrado.' });
    res.json({ message: 'Jogo atualizado com sucesso!' });
  });
});

// DELETE - Deletar um jogo
router.delete('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const result = await db.query('DELETE FROM games WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Jogo não encontrado.' });
    res.json({ message: 'Jogo deletado com sucesso!' });
  });
});

module.exports = router;