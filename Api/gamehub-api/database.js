const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// O Pool irá se conectar usando a URL do banco fornecida pelo ambiente
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Verificando e criando tabelas...');

    // Tabela de Admins
    await client.query(`CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, username VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL)`);
    const password = await bcrypt.hash('GH@gamehub@2025', 10);
    await client.query(`INSERT INTO admins (username, password) VALUES ('admin', $1) ON CONFLICT (username) DO NOTHING`, [password]);
    
    // Tabela de Clientes
    await client.query(`CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, birth_date DATE, cpf VARCHAR(255) UNIQUE, phone VARCHAR(255), email VARCHAR(255) UNIQUE, address TEXT, neighborhood VARCHAR(255), city VARCHAR(255), client_type VARCHAR(50) DEFAULT 'AVULSO' NOT NULL, hours_balance NUMERIC(10, 2) DEFAULT 0, subscription_status VARCHAR(50) DEFAULT 'N/A' NOT NULL, subscription_date DATE, next_billing_date DATE, guardian_name VARCHAR(255), guardian_cpf VARCHAR(255), guardian_phone VARCHAR(255), guardian_relationship VARCHAR(255), agreed_to_terms BOOLEAN DEFAULT false NOT NULL, agreed_to_marketing BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`);
    
    // Tabela de Estações
    await client.query(`CREATE TABLE IF NOT EXISTS stations (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, type VARCHAR(50) NOT NULL, status VARCHAR(50) DEFAULT 'AVAILABLE' NOT NULL)`);
    
    // TABELA FALTANTE ADICIONADA AQUI
    await client.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE, station_id INTEGER REFERENCES stations(id) ON DELETE CASCADE, start_time TIMESTAMPTZ NOT NULL, end_time TIMESTAMPTZ NOT NULL, status VARCHAR(50) DEFAULT 'CONFIRMED' NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`);

    // Tabela de Pacotes
    await client.query(`CREATE TABLE IF NOT EXISTS packages (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, description TEXT, hours_included NUMERIC(10, 2) NOT NULL, price NUMERIC(10, 2) NOT NULL, is_active BOOLEAN DEFAULT true NOT NULL)`);
    
    // Tabela de Sessões (versão corrigida)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE, -- <-- COLUNA ADICIONADA
        entry_time TIMESTAMPTZ NOT NULL,
        exit_time TIMESTAMPTZ,
        duration_minutes INTEGER
      )
    `);
    
    // Tabela de Transações
    await client.query(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE, transaction_type VARCHAR(50) NOT NULL, hours_added NUMERIC(10, 2), amount_paid NUMERIC(10, 2), rate_used NUMERIC(10, 2), notes TEXT, transaction_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`);
    
    // Tabela de Configurações
    await client.query(`CREATE TABLE IF NOT EXISTS settings (setting_key VARCHAR(255) PRIMARY KEY NOT NULL, setting_value TEXT NOT NULL)`);
    
    // Insere dados padrão nas Configurações
    await client.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('hourly_rate_regular', '10.00') ON CONFLICT (setting_key) DO NOTHING`);
    await client.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('hourly_rate_club', '8.00') ON CONFLICT (setting_key) DO NOTHING`);

    await client.query('COMMIT');
    console.log('Tabelas verificadas/criadas com sucesso.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erro ao inicializar o banco de dados:', e.stack);
    throw e;
  } finally {
    client.release();
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  createTables: createTables
};