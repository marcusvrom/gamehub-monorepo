const express = require('express');
const router = express.Router();
const db = require('./database');
const authMiddleware = require('./auth');

// Helper para rotas
const handleRequest = async (res, callback) => {
  try {
    await callback();
  } catch (err) {
    console.error('ERRO NA ROTA DE RELATÓRIO:', err.stack);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Erro interno do servidor.', error: err.message });
    }
  }
};

// Rota para o resumo do dashboard
router.get('/dashboard-summary', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const today = new Date().toISOString().split('T')[0];

        // Usamos Promise.all para rodar as queries em paralelo
        const [revenueToday, revenue7Days, sessionsToday, newClientsToday] = await Promise.all([
            db.query(`SELECT SUM(amount_paid) as total FROM transactions WHERE date(transaction_date) = $1`, [today]),
            db.query(`SELECT SUM(amount_paid) as total FROM transactions WHERE transaction_date >= CURRENT_DATE - INTERVAL '7 days'`),
            db.query(`SELECT COUNT(id) as total FROM sessions WHERE date(entry_time) = $1`, [today]),
            db.query(`SELECT COUNT(id) as total FROM clients WHERE date(created_at) = $1`, [today])
        ]);

        res.json({
            revenueToday: revenueToday.rows[0].total || 0,
            revenue7Days: revenue7Days.rows[0].total || 0,
            sessionsToday: sessionsToday.rows[0].total || 0,
            newClientsToday: newClientsToday.rows[0].total || 0,
        });
    });
});

// Rota para dados do gráfico de horários de pico (últimos 30 dias)
router.get('/peak-hours', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const sql = `
            SELECT EXTRACT(HOUR FROM entry_time) as hour, COUNT(id) as session_count
            FROM sessions
            WHERE entry_time >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY hour
            ORDER BY hour;
        `;
        const { rows } = await db.query(sql);
        res.json(rows);
    });
});

module.exports = router;