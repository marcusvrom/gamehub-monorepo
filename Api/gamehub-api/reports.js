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
        
        // 1. A tabela virtual agora une transações de horas com ITENS de vendas
        const baseQuery = `
            WITH all_events AS (
                -- Parte A: Transações de Horas e Pacotes
                SELECT
                    t.id,
                    t.transaction_date AS event_date,
                    'HORAS/PACOTE' AS event_type,
                    t.notes AS description,
                    t.amount_paid AS value,
                    t.payment_method,
                    c.name AS client_name,
                    t.hours_added AS quantity
                FROM transactions t
                LEFT JOIN clients c ON t.client_id = c.id
                
                UNION ALL

                -- Parte B: Itens de Vendas de Produtos
                SELECT
                    si.id,
                    s.sale_date AS event_date,
                    'PRODUTO' AS event_type,
                    p.name AS description, -- A descrição agora é o nome do produto
                    si.price_per_item * si.quantity_sold AS value,
                    s.payment_method,
                    COALESCE(c.name, 'Venda Avulsa') AS client_name,
                    si.quantity_sold as quantity
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.id
                JOIN products p ON si.product_id = p.id
                LEFT JOIN clients c ON s.client_id = c.id
            )
            SELECT * FROM all_events E
        `;

        const rangeFilter = `WHERE E.event_date AT TIME ZONE '${timezone}' BETWEEN $1 AND $2`;

        // 2. As queries de paginação rodam sobre essa nova estrutura
        const transactionsSql = `${baseQuery} ${rangeFilter} ORDER BY E.event_date DESC LIMIT $3 OFFSET $4`;
        const totalCountSql = `WITH all_events AS (SELECT id, transaction_date AS event_date FROM transactions UNION ALL SELECT id, sale_date AS event_date FROM sales) SELECT COUNT(*) AS total FROM all_events E ${rangeFilter}`;

        const [summaryAndChartData, transactionsResult, totalCountResult] = await Promise.all([
            getSummaryData(startDate, endDate, timezone),
            db.query(transactionsSql, [startDate, endDate, pageSize, offset]),
            db.query(totalCountSql, [startDate, endDate])
        ]);
        
        const totalItems = totalCountResult.rows[0].total;

        res.json({
            summary: summaryAndChartData.summary,
            dailyRevenue: summaryAndChartData.dailyRevenue,
            transactions: {
                items: transactionsResult.rows,
                totalItems: Number(totalItems),
                currentPage: Number(page),
                totalPages: Math.ceil(totalItems / pageSize)
            }
        });
    });
});


// Nova rota para o gráfico de produtos mais vendidos
router.get('/top-products', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ message: 'Datas são obrigatórias.'});

        const sql = `
            SELECT p.name, SUM(si.quantity_sold) as value
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id
            WHERE s.sale_date BETWEEN $1 AND $2
            GROUP BY p.name
            ORDER BY value DESC
            LIMIT 5
        `;
        const { rows } = await db.query(sql, [startDate, endDate]);
        res.json(rows);
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

router.get('/peak-hours-by-day', authMiddleware, async (req, res) => {
    await handleRequest(res, async () => {
        const timezone = 'America/Sao_Paulo';
        
        // Esta query extrai o dia da semana (ISODOW: 1=Segunda, 7=Domingo) e a hora
        // para cada sessão nos últimos 30 dias.
        const sql = `
            SELECT 
                EXTRACT(ISODOW FROM entry_time AT TIME ZONE $1) as day_of_week, 
                EXTRACT(HOUR FROM entry_time AT TIME ZONE $1) as hour, 
                COUNT(id) as "value" -- ngx-charts espera a propriedade "value"
            FROM sessions
            WHERE 
                entry_time >= CURRENT_DATE - INTERVAL '30 days' AND
                exit_time IS NOT NULL
            GROUP BY day_of_week, hour
            ORDER BY day_of_week, hour;
        `;
        const { rows } = await db.query(sql, [timezone]);
        res.json(rows);
    });
});

async function getSummaryData(startDate, endDate, timezone) {
    const baseQuery = `
        WITH all_revenue AS (
            SELECT transaction_date AS revenue_date, amount_paid, payment_method FROM transactions
            WHERE (transaction_date AT TIME ZONE $1) BETWEEN $2 AND $3
            UNION ALL
            SELECT sale_date AS revenue_date, total_amount AS amount_paid, payment_method FROM sales
            WHERE (sale_date AT TIME ZONE $1) BETWEEN $2 AND $3
        )
    `;

    // Query para os KPIs de resumo
    const summarySql = baseQuery + `
        SELECT
            COALESCE(SUM(amount_paid), 0) AS "totalRevenue",
            COUNT(*) AS "totalTransactions",
            COALESCE(SUM(CASE WHEN payment_method = 'PIX' THEN amount_paid ELSE 0 END), 0) AS "revenueByPix",
            COALESCE(SUM(CASE WHEN payment_method IN ('CREDITO', 'DEBITO') THEN amount_paid ELSE 0 END), 0) AS "revenueByCard",
            COALESCE(SUM(CASE WHEN payment_method = 'DINHEIRO' THEN amount_paid ELSE 0 END), 0) AS "revenueByCash"
        FROM all_revenue
    `;

    // Query para o gráfico de faturamento diário
    const dailyRevenueSql = baseQuery + `
        SELECT 
            date(revenue_date AT TIME ZONE $1) AS "name", 
            SUM(amount_paid) AS "value"
        FROM all_revenue
        GROUP BY date(revenue_date AT TIME ZONE $1)
        ORDER BY name ASC
    `;

    // Executa as duas queries em paralelo
    const [summaryResult, dailyRevenueResult] = await Promise.all([
        db.query(summarySql, [timezone, startDate, endDate]),
        db.query(dailyRevenueSql, [timezone, startDate, endDate])
    ]);
    
    return {
        summary: summaryResult.rows[0],
        dailyRevenue: dailyRevenueResult.rows
    };
}

module.exports = router;