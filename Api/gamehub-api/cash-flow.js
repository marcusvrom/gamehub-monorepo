const express = require('express');
const router = express.Router();
const db = require('./database');
const authMiddleware = require('./auth');
const handleRequest = require('./utils').handleRequest;

const TIMEZONE = 'America/Sao_Paulo';

// --- ROTAS DE CONTROLE DE CAIXA (Cash Flow) ---

/**
 * GET /today
 * Busca o registro do caixa para o dia atual.
 * Retorna o registro se existir, ou um status 'NOT_OPENED'.
 */
router.get('/today', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // Formato YYYY-MM-DD
    const sql = `SELECT * FROM cash_flow_records WHERE record_date = $1`;
    const { rows } = await db.query(sql, [today]);

    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.json({ status: 'NOT_OPENED' });
    }
  });
});

/**
 * POST /open
 * Abre o caixa do dia com um saldo inicial.
 * Retorna erro se o caixa do dia já foi aberto.
 */
router.post('/open', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { opening_balance } = req.body;
    if (opening_balance === undefined || isNaN(opening_balance)) {
      return res.status(400).json({ message: 'O saldo de abertura é obrigatório.' });
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    // Verifica se o caixa já não foi aberto hoje
    const existingRecord = await db.query('SELECT id FROM cash_flow_records WHERE record_date = $1', [today]);
    if (existingRecord.rows.length > 0) {
      return res.status(409).json({ message: 'O caixa para hoje já foi aberto.' });
    }

    const sql = `INSERT INTO cash_flow_records (record_date, opening_balance, status) VALUES ($1, $2, 'ABERTO') RETURNING *`;
    const { rows } = await db.query(sql, [today, opening_balance]);
    res.status(201).json(rows[0]);
  });
});

/**
 * POST /close
 * Fecha o caixa do dia, salvando os totais.
 */
router.post('/close', authMiddleware, async (req, res) => {
  await handleRequest(res, async () => {
    const { closing_balance, revenue_cash, expenses } = req.body;
    if ([closing_balance, revenue_cash, expenses].some(val => val === undefined || isNaN(val))) {
      return res.status(400).json({ message: 'Todos os campos para fechamento são obrigatórios.' });
    }
    
    const today = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });

    // 1. Calcula o faturamento eletrônico (cartão/pix) do dia
    const electronicRevenueSql = `
        SELECT SUM(amount_paid) as total 
        FROM transactions 
        WHERE date(transaction_date AT TIME ZONE $1) = $2 
        AND payment_method <> 'DINHEIRO'
    `;
    const electronicRevenueResult = await db.query(electronicRevenueSql, [TIMEZONE, today]);
    const revenue_calculated_electronic = electronicRevenueResult.rows[0].total || 0;

    // 2. Atualiza o registro do caixa para 'FECHADO' com todos os totais
    const updateSql = `
        UPDATE cash_flow_records 
        SET 
            closing_balance = $1, 
            revenue_cash = $2, 
            expenses = $3,
            revenue_calculated_electronic = $4,
            status = 'FECHADO', 
            closed_at = NOW()
        WHERE record_date = $5 AND status = 'ABERTO'
        RETURNING *
    `;
    const params = [closing_balance, revenue_cash, expenses, revenue_calculated_electronic, today];
    const { rows, rowCount } = await db.query(updateSql, params);

    if (rowCount === 0) {
      return res.status(404).json({ message: 'Nenhum caixa aberto encontrado para fechar hoje.' });
    }

    res.json(rows[0]);
  });
});

/**
 * GET /history
 * Busca um histórico de caixas fechados por período.
 */
router.get('/history', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'As datas de início e fim são obrigatórias.' });
        }
        const sql = `SELECT * FROM cash_flow_records WHERE record_date BETWEEN $1 AND $2 ORDER BY record_date DESC`;
        const { rows } = await db.query(sql, [startDate, endDate]);
        res.json(rows);
    });
});


module.exports = router;