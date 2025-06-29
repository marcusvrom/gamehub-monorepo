const express = require('express');
const router = express.Router();
const db = require('./database');
const authMiddleware = require('./auth');

// Função auxiliar para tratamento de erros
const handleRequest = async (res, callback) => {
  try {
    await callback();
  } catch (err) {
    console.error('ERRO NA ROTA DE PRODUTOS:', err.stack);
    if (!res.headersSent) {
      if (err.code === '23505') { // Erro de violação de constraint única (ex: SKU duplicado)
        return res.status(409).json({ message: 'Erro: SKU já cadastrado.', code: err.code });
      }
      res.status(500).json({ message: 'Erro interno do servidor.', error: err.message });
    }
  }
};

// --- CRUD DE PRODUTOS ---
router.get('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { rows } = await db.query('SELECT * FROM products ORDER BY category, name');
    res.json(rows);
  });
});

router.get('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json(rows[0]);
  });
});

router.post('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { name, description, sku, price, stock_quantity, category, is_active } = req.body;
    if (!name || price === undefined || stock_quantity === undefined) {
      return res.status(400).json({ message: 'Nome, preço e quantidade em estoque são obrigatórios.' });
    }
    const sql = `
      INSERT INTO products (name, description, sku, price, stock_quantity, category, is_active) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *
    `;
    const params = [name, description, sku, price, stock_quantity, category, is_active ?? true];
    const { rows } = await db.query(sql, params);
    res.status(201).json(rows[0]);
  });
});

router.put('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const { name, description, sku, price, stock_quantity, category, is_active } = req.body;
    if (!name || price === undefined || stock_quantity === undefined) {
      return res.status(400).json({ message: 'Nome, preço e quantidade em estoque são obrigatórios.' });
    }
    const sql = `
      UPDATE products 
      SET name = $1, description = $2, sku = $3, price = $4, stock_quantity = $5, category = $6, is_active = $7 
      WHERE id = $8
    `;
    const params = [name, description, sku, price, stock_quantity, category, is_active, id];
    const result = await db.query(sql, params);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json({ message: 'Produto atualizado com sucesso!' });
  });
});

router.delete('/:id', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { id } = req.params;
    const result = await db.query('DELETE FROM products WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ message: 'Produto não encontrado.' });
    res.json({ message: 'Produto deletado com sucesso!' });
  });
});

module.exports = router;