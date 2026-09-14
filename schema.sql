CREATE TABLE IF NOT EXISTS rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT DEFAULT '',
  buy_price REAL DEFAULT 0,
  sell_price REAL DEFAULT 0,
  band REAL DEFAULT 0.1,
  enabled_buy INTEGER DEFAULT 0,
  enabled_sell INTEGER DEFAULT 0,
  channel TEXT DEFAULT 'wx',
  triggered INTEGER DEFAULT 0,
  current_price REAL DEFAULT 0,
  last_sent_at INTEGER DEFAULT 0,
  sent_today INTEGER DEFAULT 0,
  sent_date TEXT DEFAULT '',
  created_at INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);
