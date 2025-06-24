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

// Rota para o resumo do dashboard (VERSÃO CORRIGIDA COM FUSO HORÁRIO)
router.get('/dashboard-summary', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const timezone = 'America/Sao_Paulo';

        // Usamos Promise.all para rodar as queries em paralelo, agora com a conversão de fuso horário
        const [revenueToday, revenue7Days, sessionsToday, newClientsToday] = await Promise.all([
            // Faturamento do dia, considerando o fuso horário local
            db.query(`
                SELECT SUM(amount_paid) as total 
                FROM transactions 
                WHERE date(transaction_date AT TIME ZONE $1) = date(NOW() AT TIME ZONE $1)
            `, [timezone]),
            
            // Faturamento dos últimos 7 dias
            db.query(`
                SELECT SUM(amount_paid) as total 
                FROM transactions 
                WHERE (transaction_date AT TIME ZONE $1)::date > (NOW() AT TIME ZONE $1)::date - INTERVAL '7 days'
            `, [timezone]),

            // Sessões iniciadas no dia de hoje local
            db.query(`
                SELECT COUNT(id) as total 
                FROM sessions 
                WHERE date(entry_time AT TIME ZONE $1) = date(NOW() AT TIME ZONE $1)
            `, [timezone]),

            // Novos clientes registrados no dia de hoje local
            db.query(`
                SELECT COUNT(id) as total 
                FROM clients 
                WHERE date(created_at AT TIME ZONE $1) = date(NOW() AT TIME ZONE $1)
            `, [timezone])
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
        const timezone = 'America/Sao_Paulo';
        
        // Esta query mais avançada garante que todas as horas de funcionamento (14-22) apareçam,
        // mesmo que não tenham tido sessões.
        const sql = `
            WITH all_hours AS (
                SELECT generate_series(14, 22) AS hour
            ),
            session_counts AS (
                SELECT 
                    EXTRACT(HOUR FROM entry_time AT TIME ZONE $1) as hour, 
                    COUNT(id) as session_count
                FROM sessions
                WHERE entry_time >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY hour
            )
            SELECT
                ah.hour,
                COALESCE(sc.session_count, 0)::integer as session_count
            FROM all_hours ah
            LEFT JOIN session_counts sc ON ah.hour = sc.hour
            ORDER BY ah.hour;
        `;
        const { rows } = await db.query(sql, [timezone]);
        res.json(rows);
    });
});

router.get('/financial-details', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { startDate, endDate, page = 1, pageSize = 10 } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'As datas de início e fim são obrigatórias.' });
        }

        const offset = (page - 1) * pageSize;
        const timezone = 'America/Sao_Paulo';
        const rangeFilter = `WHERE transaction_date AT TIME ZONE '${timezone}' BETWEEN $1 AND $2`;

        const transactionsSql = `
            SELECT t.*, c.name as client_name 
            FROM transactions t
            LEFT JOIN clients c ON t.client_id = c.id
            ${rangeFilter}
            ORDER BY transaction_date DESC
            LIMIT $3 OFFSET $4
        `;

        const totalCountSql = `SELECT COUNT(id) as total FROM transactions ${rangeFilter}`;

        const [summaryResult, dailyRevenueResult, transactionsResult, totalCountResult] = await Promise.all([
            db.query(`SELECT COALESCE(SUM(amount_paid), 0) as "totalRevenue", ... FROM transactions ${rangeFilter}`, [startDate, endDate]),
            db.query(`SELECT date(transaction_date AT TIME ZONE '${timezone}') as "name", ... FROM transactions ${rangeFilter} GROUP BY ...`, [startDate, endDate]),
            db.query(transactionsSql, [startDate, endDate, pageSize, offset]),
            db.query(totalCountSql, [startDate, endDate])
        ]);
        
        const totalItems = totalCountResult.rows[0].total;

        res.json({
            summary: summaryResult.rows[0],
            dailyRevenue: dailyRevenueResult.rows,
            transactions: {
                items: transactionsResult.rows,
                totalItems: Number(totalItems),
                currentPage: Number(page),
                totalPages: Math.ceil(totalItems / pageSize)
            }
        });
    });
});

router.get('/station-usage', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'As datas de início e fim são obrigatórias.' });
        }

        const timezone = 'America/Sao_Paulo';
        const sql = `
            SELECT
                st.type,
                COUNT(s.id) AS total_sessions,
                COUNT(DISTINCT s.client_id) AS unique_users,
                COALESCE(SUM(s.duration_minutes), 0) AS total_minutes_played,
                COALESCE(AVG(s.duration_minutes), 0) AS average_session_minutes
            FROM sessions s
            JOIN stations st ON s.station_id = st.id
            WHERE 
                s.exit_time IS NOT NULL AND
                s.entry_time AT TIME ZONE $1 BETWEEN $2 AND $3
            GROUP BY st.type
            ORDER BY total_minutes_played DESC;
        `;

        const { rows } = await db.query(sql, [timezone, startDate, endDate]);
        res.json(rows);
    });
});

module.exports = router;