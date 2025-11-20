const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const multer = require('multer')
require('dotenv').config()

const app = express()

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://spacego-frontend.vercel.app',
    'https://web.telegram.org',
    'https://t.me'
  ],
  credentials: true
}))
app.use(bodyParser.json({ limit: '5mb' }))
app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }))

// Подключение к PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
})

// Настройка multer для обработки файлов в памяти
const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024, // 500KB максимум для экономии места
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Только изображения разрешены!'), false)
    }
  }
})

// Функция для конвертации в base64 с проверкой размера
function processImage(buffer, mimeType) {
  // Проверяем размер
  if (buffer.length > 500 * 1024) {
    throw new Error('Изображение слишком большое. Максимум 500KB.')
  }
  
  // Конвертируем в base64
  const base64Image = buffer.toString('base64')
  const dataUrl = `data:${mimeType};base64,${base64Image}`
  
  return {
    dataUrl,
    size: buffer.length
  }
}

// === ЭНДПОИНТЫ ===

// Регистрация
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' })
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10)
    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email',
      [email, hashedPassword]
    )
    res.json({ success: true, user: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' })
    }
    console.error(err)
    res.status(500).json({ error: 'Ошибка регистрации' })
  }
})

// Авторизация
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' })
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' })
    }
    const user = result.rows[0]
    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(401).json({ error: 'Неверный email или пароль' })
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' })
    res.json({ success: true, token, user: { id: user.id, email: user.email } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ошибка авторизации' })
  }
})

// Получение категорий
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM categories ORDER BY name')
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ошибка загрузки категорий' })
  }
})

// Получение всех объявлений (ОБНОВЛЕННЫЙ - добавлен user_id)
app.get('/api/ads', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id, a.title, a.description, a.price, a.condition, a.created_at, a.photo_url, a.user_id,
        c.name AS category_name
      FROM ads a
      LEFT JOIN categories c ON a.category_id = c.id
      ORDER BY a.created_at DESC
      LIMIT 50
    `)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ошибка загрузки объявлений' })
  }
})

// Добавление объявления с несколькими фото (до 10)
app.post('/api/ads', upload.array('photos', 10), async (req, res) => {
  const { title, description, price, categoryId, condition } = req.body
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' })
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret')
    const userId = decoded.userId

    if (!title || !description || !price || !categoryId || !condition) {
      return res.status(400).json({ error: 'Все поля обязательны' })
    }

    // Обрабатываем до 10 фото
    let photoUrls = []
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < Math.min(req.files.length, 10); i++) {
        const file = req.files[i]
        try {
          const processedImage = processImage(file.buffer, file.mimetype)
          photoUrls.push(processedImage.dataUrl)
          console.log(`✅ Фото ${i + 1} обработано: ${Math.round(processedImage.size / 1024)}KB`)
        } catch (err) {
          console.error(`Ошибка обработки фото ${i + 1}:`, err.message)
          return res.status(400).json({ error: `Ошибка фото ${i + 1}: ${err.message}` })
        }
      }
    }

    // Сохраняем как JSON-массив в photo_url (TEXT поле)
    const photoUrlJson = photoUrls.length > 0 ? JSON.stringify(photoUrls) : null

    const result = await pool.query(
      `INSERT INTO ads (user_id, category_id, title, description, price, condition, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING 
         id, title, description, price, condition, created_at, photo_url, user_id`,
      [userId, categoryId, title, description, parseFloat(price), condition, photoUrlJson]
    )

    // Парсим photo_url обратно в массив для ответа
    const ad = result.rows[0]
    if (ad.photo_url) {
      try {
        ad.photo_urls = JSON.parse(ad.photo_url)
        delete ad.photo_url
      } catch (e) {
        ad.photo_urls = []
      }
    } else {
      ad.photo_urls = []
    }

    res.json({ success: true, ad })
  } catch (err) {
    console.error('Ошибка создания объявления:', err)
    res.status(500).json({ error: 'Ошибка сохранения объявления' })
  }
})

// Получение информации о текущем пользователе
app.get('/api/user', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' })
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret')
    const userId = decoded.userId

    const result = await pool.query('SELECT id, email, created_at FROM users WHERE id = $1', [userId])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    res.json({ success: true, user: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ошибка загрузки профиля' })
  }
})

// Получение информации о пользователе по ID (НОВЫЙ ЭНДПОИНТ)
app.get('/api/user/:userId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const token = authHeader.split(' ')[1];
  const { userId } = req.params;

  try {
    // Проверяем токен (но не ограничиваем доступ только своим профилем)
    jwt.verify(token, process.env.JWT_SECRET || 'secret');
    
    const result = await pool.query(
      'SELECT id, email, created_at FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    res.json({ success: true, user });
  } catch (err) {
    console.error('Ошибка загрузки пользователя:', err);
    res.status(500).json({ error: 'Ошибка загрузки данных пользователя' });
  }
});

// Обработчик ошибок multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Файл слишком большой. Максимум 500KB.' })
    }
  }
  res.status(500).json({ error: error.message })
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' })
})

// Запуск сервера
const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`)
  console.log(`📸 Модуль работы с фото активирован (базовая версия)`)
  console.log(`✅ Health check доступен по /health`)
})