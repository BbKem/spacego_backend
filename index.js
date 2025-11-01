const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const { Pool } = require('pg')
require('dotenv').config()

const app = express()
app.use(cors())
app.use(bodyParser.json())

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // обязательно для Render
  }
})

// Создание таблицы при старте
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ads (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('✅ Таблица ads готова')
}

// Парсинг initData (упрощённо, без проверки хеша — для демо)
function parseUserIdFromInitData(initData) {
  try {
    const params = new URLSearchParams(initData)
    const userStr = params.get('user')
    if (userStr) {
      const user = JSON.parse(decodeURIComponent(userStr))
      return user.id
    }
  } catch (e) {
    console.error('Ошибка парсинга initData:', e)
  }
  return null
}

// POST /api/ads — добавление объявления
app.post('/api/ads', async (req, res) => {
  const { initData, title, description } = req.body

  if (!initData || !title || !description) {
    return res.status(400).json({ error: 'Не хватает данных' })
  }

  const userId = parseUserIdFromInitData(initData)
  if (!userId) {
    return res.status(401).json({ error: 'Неверная авторизация' })
  }

  try {
    const result = await pool.query(
      'INSERT INTO ads (user_id, title, description) VALUES ($1, $2, $3) RETURNING *',
      [userId, title, description]
    )
    res.json({ success: true, ad: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// GET /api/ads — для отладки (не обязательно для Mini App)
app.get('/api/ads', async (req, res) => {
  const result = await pool.query('SELECT * FROM ads ORDER BY created_at DESC LIMIT 10')
  res.json(result.rows)
})

// Запуск
initDB().then(() => {
  const PORT = process.env.PORT || 4000
  app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`)
  })
})