const express = require('express');
const router = express.Router();
const db = require('./database');
const authMiddleware = require('./auth');

const handleRequest = async (res, callback) => {
  try {
    await callback();
  } catch (err) {
    console.error('ERRO NA ROTA DE VENDAS:', err.stack);
    if (!res.headersSent) {
      if (err.code === '23505') { // Erro de violação de constraint única (ex: SKU duplicado)
        return res.status(409).json({ message: 'Erro: VENDA já cadastrada.', code: err.code });
      }
      res.status(500).json({ message: 'Erro interno do servidor.', error: err.message });
    }
  }
};

router.post('/', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { client_id, payment_method, items } = req.body;

    if (!payment_method || !items || items.length === 0) {
      return res.status(400).json({ message: 'Dados da venda incompletos.' });
    }

    // Inicia uma transação com o banco de dados
    await db.query('BEGIN');
    
    try {
      // 1. Calcula o valor total e verifica o estoque
      let totalAmount = 0;
      for (const item of items) {
        const productResult = await db.query('SELECT price, stock_quantity FROM products WHERE id = $1', [item.product_id]);
        const product = productResult.rows[0];
        if (!product) throw new Error(`Produto com ID ${item.product_id} não encontrado.`);
        if (product.stock_quantity < item.quantity) {
          throw new Error(`Estoque insuficiente para o produto ${product.name}.`);
        }
        totalAmount += product.price * item.quantity;
      }

      // 2. Cria o registro da venda principal
      const saleSql = `INSERT INTO sales (client_id, total_amount, payment_method) VALUES ($1, $2, $3) RETURNING id`;
      const saleResult = await db.query(saleSql, [client_id || null, totalAmount, payment_method]);
      const saleId = saleResult.rows[0].id;

      // 3. Insere cada item da venda e atualiza o estoque
      for (const item of items) {
        const productResult = await db.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
        const pricePerItem = productResult.rows[0].price;

        const saleItemSql = `INSERT INTO sale_items (sale_id, product_id, quantity_sold, price_per_item) VALUES ($1, $2, $3, $4)`;
        await db.query(saleItemSql, [saleId, item.product_id, item.quantity, pricePerItem]);

        const updateStockSql = `UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2`;
        await db.query(updateStockSql, [item.quantity, item.product_id]);
      }

      // 4. Se tudo deu certo, confirma a transação
      await db.query('COMMIT');
      res.status(201).json({ message: 'Venda registrada com sucesso!', saleId: saleId });

    } catch (e) {
      // 5. Se algo deu errado, desfaz todas as operações
      await db.query('ROLLBACK');
      throw e; // O erro será pego pelo handleRequest
    }
  });
});

module.exports = router;