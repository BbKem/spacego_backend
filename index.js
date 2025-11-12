const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const multer = require('multer')
const sharp = require('sharp')
require('dotenv').config()

const app = express()

// Увеличиваем лимиты для обработки base64 изображений
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://spacego-frontend.vercel.app',
    'https://web.telegram.org',
    'https://t.me'
  ],
  credentials: true
}))
app.use(bodyParser.json({ limit: '10mb' }))
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }))

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
    fileSize: 2 * 1024 * 1024, // 2MB максимум
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Только изображения разрешены!'), false)
    }
  }
})

// Функция для сжатия изображения
async function compressImage(buffer) {
  try {
    const compressedBuffer = await sharp(buffer)
      .resize(600, 600, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ 
        quality: 65,
        progressive: true
      })
      .toBuffer()
    
    const base64Image = compressedBuffer.toString('base64')
    const dataUrl = `data:image/jpeg;base64,${base64Image}`
    
    return {
      dataUrl,
      size: compressedBuffer.length
    }
  } catch (error) {
    throw new Error('Ошибка обработки изображения')
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

// Получение всех объявлений
app.get('/api/ads', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id, a.title, a.description, a.price, a.condition, a.created_at, a.photo_url,
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

// Добавление объявления с фото
app.post('/api/ads', upload.single('photo'), async (req, res) => {
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

    let photoUrl = null

    // Обрабатываем фото если есть
    if (req.file) {
      try {
        const compressedImage = await compressImage(req.file.buffer)
        photoUrl = compressedImage.dataUrl
        console.log(`✅ Изображение сжато: ${Math.round(compressedImage.size / 1024)}KB`)
      } catch (compressError) {
        console.error('Ошибка сжатия изображения:', compressError)
        return res.status(400).json({ error: 'Ошибка обработки изображения' })
      }
    }

    const result = await pool.query(
      `INSERT INTO ads (user_id, category_id, title, description, price, condition, photo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING 
         id, title, description, price, condition, created_at, photo_url`,
      [userId, categoryId, title, description, parseFloat(price), condition, photoUrl]
    )

    res.json({ success: true, ad: result.rows[0] })

  } catch (err) {
    console.error('Ошибка создания объявления:', err)
    res.status(500).json({ error: 'Ошибка сохранения объявления' })
  }
})

// Получение информации о пользователе
app.get('/api/user', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' })
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret')
    const userId = decoded.userId

    const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [userId])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    res.json({ success: true, user: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Ошибка загрузки профиля' })
  }
})

// Обработчик ошибок multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Файл слишком большой. Максимум 2MB.' })
    }
  }
  res.status(500).json({ error: error.message })
})

// Запуск сервера
const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`)
  console.log(`📸 Модуль работы с фото активирован`)
})