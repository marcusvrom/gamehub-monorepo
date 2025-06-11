const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database('./gamehub.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Conectado ao banco de dados gamehub.db.');
});

db.serialize(() => {
  // Tabela de Administradores
  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`, (err) => {
    if (err) return console.error("Erro ao criar tabela admins:", err.message);
    const insertAdmin = `INSERT OR IGNORE INTO admins (username, password) VALUES (?, ?)`;
    const password = 'GH@gamehub@2025';
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return console.error("Erro ao gerar hash:", err);
      db.run(insertAdmin, ['admin', hash]);
    });
  });

  // Tabela de Clientes (com todas as colunas)
  db.run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    birth_date TEXT,
    cpf TEXT UNIQUE,
    phone TEXT,
    email TEXT UNIQUE,
    address TEXT,
    neighborhood TEXT,
    city TEXT,
    client_type TEXT DEFAULT 'AVULSO' NOT NULL,
    hours_balance REAL DEFAULT 0,
    subscription_status TEXT DEFAULT 'N/A' NOT NULL,
    subscription_date DATE,
    next_billing_date DATE,
    guardian_name TEXT,
    guardian_cpf TEXT,
    guardian_phone TEXT,
    guardian_relationship TEXT,
    agreed_to_terms INTEGER NOT NULL DEFAULT 0,
    agreed_to_marketing INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error("Erro ao criar tabela clients:", err.message);
  });

  // Tabela de Sessões de Jogo
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    entry_time DATETIME NOT NULL,
    exit_time DATETIME,
    duration_minutes INTEGER,
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error("Erro ao criar tabela sessions:", err.message);
  });

  // Tabela de Configurações
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    setting_key TEXT PRIMARY KEY NOT NULL,
    setting_value TEXT NOT NULL
  )`, (err) => {
    if (err) return console.error("Erro ao criar tabela settings:", err.message);
    // Insere valores padrão se não existirem
    const insertSettings = `INSERT OR IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)`;
    db.run(insertSettings, ['hourly_rate_regular', '10.00']);
    db.run(insertSettings, ['hourly_rate_club', '8.00']);
  });

  // Tabela de Transações Financeiras
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    hours_added REAL,
    amount_paid REAL,
    rate_used REAL,
    notes TEXT, -- <-- A COLUNA FALTANTE FOI ADICIONADA AQUI
    transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error("Erro ao criar tabela transactions:", err.message);
  });

  // NOVA TABELA: Estações de Jogo
  db.run(`CREATE TABLE IF NOT EXISTS stations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'AVAILABLE' NOT NULL
  )`, (err) => {
    if (err) return console.error("Erro ao criar tabela stations:", err.message);
    // Insere as estações iniciais se a tabela estiver vazia
    const insertStation = `INSERT OR IGNORE INTO stations (id, name, type) VALUES (?, ?, ?)`;
    db.run(insertStation, [1, 'PlayStation 5 - 1', 'PS5']);
    db.run(insertStation, [2, 'PlayStation 5 - 2', 'PS5']);
    db.run(insertStation, [3, 'Xbox Series S - 1', 'XBOX']);
    db.run(insertStation, [4, 'Xbox Series S - 2', 'XBOX']);
    db.run(insertStation, [5, 'Nintendo Switch - TV Principal', 'SWITCH']);
  });

  // NOVA TABELA: Agendamentos
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    station_id INTEGER NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    status TEXT DEFAULT 'CONFIRMED' NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
    FOREIGN KEY (station_id) REFERENCES stations (id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error("Erro ao criar tabela bookings:", err.message);
  });

  // NOVA TABELA: Pacotes de Horas
  db.run(`CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    hours_included REAL NOT NULL,
    price REAL NOT NULL,
    is_active INTEGER DEFAULT 1 NOT NULL
  )`, (err) => {
    if (err) return console.error("Erro ao criar tabela packages:", err.message);
    const insertPackage = `INSERT OR IGNORE INTO packages (name, description, hours_included, price) VALUES (?, ?, ?, ?)`;
    db.run(insertPackage, ['Pacote Bronze', '5 horas para gastar como quiser', 5, 45.00]);
    db.run(insertPackage, ['Pacote Prata', '10 horas com desconto', 10, 85.00]);
    db.run(insertPackage, ['Pacote Ouro', '20 horas, o melhor custo-benefício', 20, 160.00]);
  });
});

module.exports = db;