const express = require('express');
const router = express.Router();
const db = require('./database');
const authMiddleware = require('./auth');


router.get('/', authMiddleware, async (req, res) => {
  try {
    const sql = `
      SELECT g.*, s.name as station_name 
      FROM games g
      JOIN stations s ON g.station_id = s.id
      ORDER BY g.title
    `;
    const { rows } = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error('ERRO AO LISTAR JOGOS:', err.stack);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, station_id, media_type, purchase_date, notes } = req.body;
    if (!title || !station_id || !media_type) {
      return res.status(400).json({ message: 'Título, estação e tipo de mídia são obrigatórios.' });
    }
    const sql = `
      INSERT INTO games (title, station_id, media_type, purchase_date, notes) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING *
    `;
    const params = [title, station_id, media_type, purchase_date || null, notes];
    const { rows } = await db.query(sql, params);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('ERRO AO CRIAR JOGO:', err.stack);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, station_id, media_type, purchase_date, notes } = req.body;
    if (!title || !station_id || !media_type) {
      return res.status(400).json({ message: 'Título, estação e tipo de mídia são obrigatórios.' });
    }
    const sql = `
      UPDATE games 
      SET title = $1, station_id = $2, media_type = $3, purchase_date = $4, notes = $5
      WHERE id = $6
    `;
    const params = [title, station_id, media_type, purchase_date || null, notes, id];
    const result = await db.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Jogo não encontrado.' });
    res.json({ message: 'Jogo atualizado com sucesso!' });
  } catch (err) {
    console.error('ERRO AO ATUALIZAR JOGO:', err.stack);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM games WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Jogo não encontrado.' });
    res.json({ message: 'Jogo deletado com sucesso!' });
  } catch (err) {
    console.error('ERRO AO DELETAR JOGO:', err.stack);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

module.exports = router;