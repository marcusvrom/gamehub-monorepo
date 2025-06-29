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

        // 1. Criamos uma "tabela virtual" em memória com TODAS as fontes de receita usando WITH e UNION ALL
        const baseQuery = `
            WITH all_revenue AS (
                -- Receitas da tabela de transações (horas e pacotes)
                SELECT 
                    id,
                    client_id,
                    transaction_date AS revenue_date,
                    amount_paid,
                    payment_method,
                    transaction_type,
                    notes
                FROM transactions
                WHERE transaction_date AT TIME ZONE $1 BETWEEN $2 AND $3

                UNION ALL

                -- Receitas da tabela de sales (produtos do PDV)
                SELECT
                    id,
                    client_id,
                    sale_date AS revenue_date,
                    total_amount AS amount_paid,
                    payment_method,
                    'VENDA_PRODUTO' AS transaction_type,
                    'Venda de produtos' AS notes
                FROM sales
                WHERE sale_date AT TIME ZONE $1 BETWEEN $2 AND $3
            )
        `;

        // 2. Agora, executamos nossas queries de agregação sobre essa tabela virtual "all_revenue"
        const summarySql = baseQuery + `
            SELECT
                COALESCE(SUM(amount_paid), 0) AS "totalRevenue",
                COUNT(id) AS "totalTransactions",
                COALESCE(SUM(CASE WHEN payment_method = 'PIX' THEN amount_paid ELSE 0 END), 0) AS "revenueByPix",
                COALESCE(SUM(CASE WHEN payment_method IN ('CREDITO', 'DEBITO') THEN amount_paid ELSE 0 END), 0) AS "revenueByCard",
                COALESCE(SUM(CASE WHEN payment_method = 'DINHEIRO' THEN amount_paid ELSE 0 END), 0) AS "revenueByCash"
            FROM all_revenue
        `;

        const dailyRevenueSql = baseQuery + `
            SELECT 
                date(revenue_date AT TIME ZONE '${timezone}') AS "name", 
                SUM(amount_paid) AS "value"
            FROM all_revenue
            GROUP BY date(revenue_date AT TIME ZONE '${timezone}')
            ORDER BY name ASC
        `;
        
        // A query de transações detalhadas também precisa ser unificada, mas é mais complexa.
        // Por simplicidade, vamos mantê-la lendo apenas de 'transactions' por enquanto, ou podemos unificá-la também.
        // Vamos unificar para o relatório ficar completo:
        const transactionsSql = baseQuery + `
            SELECT *
            FROM all_revenue
            ORDER BY revenue_date DESC
            LIMIT $4 OFFSET $5
        `;

        const totalCountSql = baseQuery + `SELECT COUNT(id) AS total FROM all_revenue`;

        const [summaryResult, dailyRevenueResult, transactionsResult, totalCountResult] = await Promise.all([
            db.query(summarySql, [timezone, startDate, endDate]),
            db.query(dailyRevenueSql, [timezone, startDate, endDate]),
            db.query(transactionsSql, [timezone, startDate, endDate, pageSize, offset]),
            db.query(totalCountSql, [timezone, startDate, endDate])
        ]);
        
        const totalItems = totalCountResult.rows[0].total;

        // Montamos a resposta final com os dados unificados
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