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
    'https://spacego-frontend.vercel.app', // Убраны лишние пробелы
    'https://web.telegram.org', // Убраны лишние пробелы
    'https://t.me' // Убраны лишние пробелы
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
    fileSize: 5000 * 1024, // 500KB максимум для экономии места
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
  if (buffer.length > 5000 * 1024) {
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

// Получение корневых категорий
app.get('/api/categories', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, parent_id FROM categories WHERE parent_id IS NULL ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка загрузки корневых категорий:', err);
    res.status(500).json({ error: 'Ошибка загрузки корневых категорий' });
  }
});

// Получение подкатегорий по parentId
app.get('/api/categories/:parentId', async (req, res) => {
  const { parentId } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, name, parent_id FROM categories WHERE parent_id = $1 ORDER BY name',
      [parentId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка загрузки подкатегорий:', err);
    res.status(500).json({ error: 'Ошибка загрузки подкатегорий' });
  }
});

app.get('/api/ads', async (req, res) => {
  const {
    category_id,
    min_price,
    max_price,
    location,
    // Существующие фильтры
    rooms,
    total_area_min,
    total_area_max,
    floor_min,
    floor_max,
    total_floors_min,
    total_floors_max,
    building_type,
    condition_detail,
    furniture,
    transaction_type,
    // Новые фильтры
    plot_area_min,
    plot_area_max,
    land_category,
    terrain,
    access_road,
    allowed_use,
    property_type,
    material_type,
    heating_type,
    floors_min,
    floors_max,
    utilities,
    room_type,
    area_room_min,
    area_room_max,
    area_apartment_min,
    area_apartment_max,
    neighbors,
    garage_type,
    area_min,
    area_max,
    heating,
    security,
    gas,
    water,
    sewage,
    electricity,
    garage,
    outbuildings,
    bathhouse,
    completion_quarter,
    completion_year,
    finish_type,
    developer,
    mortgage_friendly,
    guests_min,
    guests_max,
    bedrooms_min,
    bedrooms_max,
    amenities,
    checkin_time,
    checkout_time,
    rules,
    pets_allowed,
    smoking_allowed,
    services,
    wifi,
    breakfast,
    reception,
    cleaning,
    air_conditioning,
    power_supply_kw,
    entrance_type,
    ceiling_height,
    rooms_count,
    has_photo,
    deal_from_owner,
    bathroom_type,
    balcony,
    lift,
    parking,
    metro,
    metro_distance,
    year_built,
    is_negotiable,
    owner_type
  } = req.query;

  try {
    let query = `
      SELECT
        a.id, a.title, a.description, a.price, a.condition, a.created_at, a.photo_url, a.user_id, a.location, a.property_details,
        c.name AS category_name
      FROM ads a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE 1=1
    `;
    let params = [];
    let paramIndex = 1;

    if (category_id) {
      const subcategoriesQuery = 'SELECT id FROM categories WHERE parent_id = $1';
      const subcategoriesResult = await pool.query(subcategoriesQuery, [category_id]);
      const subcategoryIds = subcategoriesResult.rows.map(row => row.id);

      if (subcategoryIds.length > 0) {
        const allCategoryIds = [parseInt(category_id), ...subcategoryIds.map(id => parseInt(id))];
        query += ` AND a.category_id = ANY($${paramIndex}::int[])`;
        params.push(allCategoryIds);
        paramIndex++;
      } else {
        query += ` AND a.category_id = $${paramIndex}`;
        params.push(parseInt(category_id));
        paramIndex++;
      }
    }

    if (min_price) {
      query += ` AND a.price >= $${paramIndex}`;
      params.push(parseFloat(min_price));
      paramIndex++;
    }
    if (max_price) {
      query += ` AND a.price <= $${paramIndex}`;
      params.push(parseFloat(max_price));
      paramIndex++;
    }
    if (location) {
      query += ` AND a.location ILIKE $${paramIndex}`;
      params.push(`%${location}%`);
      paramIndex++;
    }
    
    // --- ФИЛЬТРЫ НЕДВИЖИМОСТИ ---
    if (transaction_type) {
      query += ` AND a.property_details->>'transaction_type' = $${paramIndex}`;
      params.push(transaction_type);
      paramIndex++;
    }
    if (rooms) {
      query += ` AND a.property_details->>'rooms' = $${paramIndex}`;
      params.push(rooms.toString());
      paramIndex++;
    }
    if (total_area_min) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC >= $${paramIndex}`;
      params.push(parseFloat(total_area_min));
      paramIndex++;
    }
    if (total_area_max) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC <= $${paramIndex}`;
      params.push(parseFloat(total_area_max));
      paramIndex++;
    }
    if (floor_min) {
      query += ` AND (a.property_details->>'floor')::NUMERIC >= $${paramIndex}`;
      params.push(parseInt(floor_min));
      paramIndex++;
    }
    if (floor_max) {
      query += ` AND (a.property_details->>'floor')::NUMERIC <= $${paramIndex}`;
      params.push(parseInt(floor_max));
      paramIndex++;
    }
    if (total_floors_min) {
      query += ` AND (a.property_details->>'total_floors')::NUMERIC >= $${paramIndex}`;
      params.push(parseInt(total_floors_min));
      paramIndex++;
    }
    if (total_floors_max) {
      query += ` AND (a.property_details->>'total_floors')::NUMERIC <= $${paramIndex}`;
      params.push(parseInt(total_floors_max));
      paramIndex++;
    }
    if (building_type) {
      query += ` AND a.property_details->>'building_type' = $${paramIndex}`;
      params.push(building_type);
      paramIndex++;
    }
    if (condition_detail) {
      query += ` AND a.property_details->>'condition_detail' = $${paramIndex}`;
      params.push(condition_detail);
      paramIndex++;
    }
    if (furniture) {
      query += ` AND a.property_details->>'furniture' = $${paramIndex}`;
      params.push(furniture);
      paramIndex++;
    }
    
    // --- ЗЕМЕЛЬНЫЕ УЧАСТКИ ---
    if (plot_area_min) {
      query += ` AND (a.property_details->>'plot_area')::NUMERIC >= $${paramIndex}`;
      params.push(parseFloat(plot_area_min));
      paramIndex++;
    }
    if (plot_area_max) {
      query += ` AND (a.property_details->>'plot_area')::NUMERIC <= $${paramIndex}`;
      params.push(parseFloat(plot_area_max));
      paramIndex++;
    }
    if (land_category) {
      query += ` AND a.property_details->>'land_category' = $${paramIndex}`;
      params.push(land_category);
      paramIndex++;
    }
    if (terrain) {
      query += ` AND a.property_details->>'terrain' = $${paramIndex}`;
      params.push(terrain);
      paramIndex++;
    }
    if (access_road) {
      query += ` AND a.property_details->>'access_road' = $${paramIndex}`;
      params.push(access_road);
      paramIndex++;
    }
    if (allowed_use) {
      query += ` AND a.property_details->>'allowed_use' ILIKE $${paramIndex}`;
      params.push(`%${allowed_use}%`);
      paramIndex++;
    }
    
    // --- ДОМА / КОТТЕДЖИ ---
    if (property_type) {
      query += ` AND a.property_details->>'property_type' = $${paramIndex}`;
      params.push(property_type);
      paramIndex++;
    }
    if (material_type) {
      query += ` AND a.property_details->>'wall_material' = $${paramIndex}`;
      params.push(material_type);
      paramIndex++;
    }
    if (heating_type) {
      query += ` AND a.property_details->>'heating_system' = $${paramIndex}`;
      params.push(heating_type);
      paramIndex++;
    }
    if (floors_min) {
      query += ` AND (a.property_details->>'total_floors')::NUMERIC >= $${paramIndex}`;
      params.push(parseInt(floors_min));
      paramIndex++;
    }
    if (floors_max) {
      query += ` AND (a.property_details->>'total_floors')::NUMERIC <= $${paramIndex}`;
      params.push(parseInt(floors_max));
      paramIndex++;
    }
    
    // --- КОМНАТЫ ---
    if (room_type) {
      query += ` AND a.property_details->>'room_type' = $${paramIndex}`;
      params.push(room_type);
      paramIndex++;
    }
    if (area_room_min) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC >= $${paramIndex}`;
      params.push(parseFloat(area_room_min));
      paramIndex++;
    }
    if (area_room_max) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC <= $${paramIndex}`;
      params.push(parseFloat(area_room_max));
      paramIndex++;
    }
    if (area_apartment_min) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC >= $${paramIndex}`;
      params.push(parseFloat(area_apartment_min));
      paramIndex++;
    }
    if (area_apartment_max) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC <= $${paramIndex}`;
      params.push(parseFloat(area_apartment_max));
      paramIndex++;
    }
    
    // --- ГАРАЖИ ---
    if (garage_type) {
      query += ` AND a.property_details->>'property_type' = $${paramIndex}`;
      params.push(garage_type);
      paramIndex++;
    }
    if (area_min) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC >= $${paramIndex}`;
      params.push(parseFloat(area_min));
      paramIndex++;
    }
    if (area_max) {
      query += ` AND (a.property_details->>'total_area')::NUMERIC <= $${paramIndex}`;
      params.push(parseFloat(area_max));
      paramIndex++;
    }
    
    // --- КОММУНИКАЦИИ (чекбоксы) ---
    if (gas === 'true') {
      query += ` AND (a.property_details->>'gas')::BOOLEAN = true`;
    } else if (gas === 'false') {
      query += ` AND (a.property_details->>'gas')::BOOLEAN = false`;
    }
    if (water === 'true') {
      query += ` AND (a.property_details->>'water')::BOOLEAN = true`;
    } else if (water === 'false') {
      query += ` AND (a.property_details->>'water')::BOOLEAN = false`;
    }
    if (sewage === 'true') {
      query += ` AND (a.property_details->>'sewage')::BOOLEAN = true`;
    } else if (sewage === 'false') {
      query += ` AND (a.property_details->>'sewage')::BOOLEAN = false`;
    }
    if (electricity === 'true') {
      query += ` AND (a.property_details->>'electricity')::BOOLEAN = true`;
    } else if (electricity === 'false') {
      query += ` AND (a.property_details->>'electricity')::BOOLEAN = false`;
    }
    if (garage === 'true') {
      query += ` AND (a.property_details->>'garage')::BOOLEAN = true`;
    } else if (garage === 'false') {
      query += ` AND (a.property_details->>'garage')::BOOLEAN = false`;
    }
    if (outbuildings === 'true') {
      query += ` AND (a.property_details->>'outbuildings')::BOOLEAN = true`;
    } else if (outbuildings === 'false') {
      query += ` AND (a.property_details->>'outbuildings')::BOOLEAN = false`;
    }
    if (bathhouse === 'true') {
      query += ` AND (a.property_details->>'bathhouse')::BOOLEAN = true`;
    } else if (bathhouse === 'false') {
      query += ` AND (a.property_details->>'bathhouse')::BOOLEAN = false`;
    }
    if (heating === 'true') {
      query += ` AND (a.property_details->>'heating_system')::BOOLEAN = true`;
    } else if (heating === 'false') {
      query += ` AND (a.property_details->>'heating_system')::BOOLEAN = false`;
    }
    if (security === 'true') {
      query += ` AND (a.property_details->>'security')::BOOLEAN = true`;
    } else if (security === 'false') {
      query += ` AND (a.property_details->>'security')::BOOLEAN = false`;
    }
    
    // --- НОВОСТРОЙКИ ---
    if (completion_quarter) {
      query += ` AND a.property_details->>'delivery_date' ILIKE $${paramIndex}`;
      params.push(`%${completion_quarter}%`);
      paramIndex++;
    }
    if (completion_year) {
      query += ` AND a.property_details->>'delivery_date' ILIKE $${paramIndex}`;
      params.push(`%${completion_year}%`);
      paramIndex++;
    }
    if (developer) {
      query += ` AND a.property_details->>'developer' ILIKE $${paramIndex}`;
      params.push(`%${developer}%`);
      paramIndex++;
    }
    if (mortgage_friendly === 'true') {
      query += ` AND (a.property_details->>'mortgage_friendly')::BOOLEAN = true`;
    }
    
    // --- ПОСУТОЧНАЯ / ГОСТИНИЦЫ ---
    if (guests_min) {
      query += ` AND (a.property_details->>'guests')::NUMERIC >= $${paramIndex}`;
      params.push(parseInt(guests_min));
      paramIndex++;
    }
    if (guests_max) {
      query += ` AND (a.property_details->>'guests')::NUMERIC <= $${paramIndex}`;
      params.push(parseInt(guests_max));
      paramIndex++;
    }
    if (bedrooms_min) {
      query += ` AND (a.property_details->>'bedrooms')::NUMERIC >= $${paramIndex}`;
      params.push(parseInt(bedrooms_min));
      paramIndex++;
    }
    if (bedrooms_max) {
      query += ` AND (a.property_details->>'bedrooms')::NUMERIC <= $${paramIndex}`;
      params.push(parseInt(bedrooms_max));
      paramIndex++;
    }
    
    // --- УДОБСТВА (чекбоксы) ---
    if (wifi === 'true') {
      query += ` AND (a.property_details->>'wifi')::BOOLEAN = true`;
    }
    if (breakfast === 'true') {
      query += ` AND (a.property_details->>'breakfast')::BOOLEAN = true`;
    }
    if (reception === 'true') {
      query += ` AND (a.property_details->>'reception')::BOOLEAN = true`;
    }
    if (cleaning === 'true') {
      query += ` AND (a.property_details->>'cleaning')::BOOLEAN = true`;
    }
    if (air_conditioning === 'true') {
      query += ` AND (a.property_details->>'ac')::BOOLEAN = true`;
    }
    if (pets_allowed === 'true') {
      query += ` AND (a.property_details->>'pets_allowed')::BOOLEAN = true`;
    }
    if (smoking_allowed === 'true') {
      query += ` AND (a.property_details->>'smoking_allowed')::BOOLEAN = true`;
    }
    
    // --- ОБЩИЕ ДЛЯ НЕДВИЖИМОСТИ ---
    if (bathroom_type) {
      query += ` AND a.property_details->>'bathroom_type' = $${paramIndex}`;
      params.push(bathroom_type);
      paramIndex++;
    }
    if (balcony) {
      query += ` AND a.property_details->>'balcony' = $${paramIndex}`;
      params.push(balcony);
      paramIndex++;
    }
    if (lift) {
      query += ` AND a.property_details->>'lift' = $${paramIndex}`;
      params.push(lift);
      paramIndex++;
    }
    if (parking) {
      query += ` AND a.property_details->>'parking' = $${paramIndex}`;
      params.push(parking);
      paramIndex++;
    }
    if (metro) {
      query += ` AND a.property_details->>'metro' ILIKE $${paramIndex}`;
      params.push(`%${metro}%`);
      paramIndex++;
    }
    if (metro_distance) {
      query += ` AND (a.property_details->>'metro_distance')::NUMERIC <= $${paramIndex}`;
      params.push(parseInt(metro_distance));
      paramIndex++;
    }
    if (ceiling_height) {
      query += ` AND (a.property_details->>'ceiling_height')::NUMERIC >= $${paramIndex}`;
      params.push(parseFloat(ceiling_height));
      paramIndex++;
    }
    if (year_built) {
      query += ` AND (a.property_details->>'year_built')::NUMERIC >= $${paramIndex}`;
      params.push(parseInt(year_built));
      paramIndex++;
    }
    
    // --- КОММЕРЧЕСКАЯ ---
    if (power_supply_kw) {
      query += ` AND (a.property_details->>'power')::NUMERIC >= $${paramIndex}`;
      params.push(parseFloat(power_supply_kw));
      paramIndex++;
    }
    if (entrance_type) {
      query += ` AND a.property_details->>'entrance_type' = $${paramIndex}`;
      params.push(entrance_type);
      paramIndex++;
    }
    if (rooms_count) {
      query += ` AND (a.property_details->>'rooms_count')::NUMERIC >= $${paramIndex}`;
      params.push(parseInt(rooms_count));
      paramIndex++;
    }
    
    // --- ДОПОЛНИТЕЛЬНЫЕ ---
    if (has_photo === 'true') {
      query += ` AND a.photo_url IS NOT NULL`;
    }
    
    query += ' ORDER BY a.created_at DESC LIMIT 50';

    console.log("SQL Query:", query);
    console.log("Params:", params);

    const result = await pool.query(query, params);

    const ads = result.rows.map(ad => {
      if (ad.photo_url) {
        try {
          ad.photo_urls = JSON.parse(ad.photo_url);
        } catch (e) {
          console.error("Ошибка парсинга photo_url:", e);
          ad.photo_urls = [];
        }
        delete ad.photo_url; 
      } else {
        ad.photo_urls = [];
      }

      if (ad.property_details) {
        try {
          // Уже парсится на бэкенде
        } catch (e) {
          console.error("Ошибка парсинга property_details:", e);
          ad.property_details = {};
        }
      } else {
        ad.property_details = {};
      }
      return ad;
    });

    res.json(ads);
  } catch (err) {
    console.error('Ошибка загрузки объявлений с фильтром:', err);
    res.status(500).json({ error: 'Ошибка загрузки объявлений' });
  }
});

// Создание объявления
app.post('/api/ads', upload.array('photos', 10), async (req, res) => {
  const { title, description, price, categoryId, condition, location, propertyDetails } = req.body;
  const authHeader = req.headers.authorization;

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

    let parsedPropertyDetails = null;
    if (propertyDetails) {
      if (typeof propertyDetails === 'string') {
        try {
          parsedPropertyDetails = JSON.parse(propertyDetails);
        } catch (e) {
          return res.status(400).json({ error: 'Некорректный формат propertyDetails' });
        }
      } else if (typeof propertyDetails === 'object') {
        parsedPropertyDetails = propertyDetails;
      } else {
        return res.status(400).json({ error: 'Некорректный формат propertyDetails' });
      }
    }

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

    const photoUrlJson = photoUrls.length > 0 ? JSON.stringify(photoUrls) : null

    const insertResult = await pool.query(
      `INSERT INTO ads (user_id, category_id, title, description, price, condition, photo_url, location, property_details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [userId, categoryId, title, description, parseFloat(price), condition, photoUrlJson, location || null, JSON.stringify(parsedPropertyDetails)]
    )

    const adId = insertResult.rows[0].id;

    // Получаем созданное объявление, парсим photo_url и property_details
    const adResult = await pool.query(`
      SELECT
        a.id, a.title, a.description, a.price, a.condition, a.created_at, a.photo_url, a.user_id, a.location, a.property_details,
        c.name AS category_name
      FROM ads a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.id = $1
    `, [adId]);

    const ad = adResult.rows[0];
    if (ad.photo_url) {
      try {
        ad.photo_urls = JSON.parse(ad.photo_url);
        delete ad.photo_url;
      } catch (e) {
        ad.photo_urls = [];
      }
    } else {
      ad.photo_urls = [];
    }

    if (ad.property_details) {
      try {
        // ad.property_details = JSON.parse(ad.property_details); // Уже парсится на бэкенде
      } catch (e) {
        console.error("Ошибка парсинга property_details в /api/ads (новое объявление):", e);
        ad.property_details = {};
      }
    } else {
      ad.property_details = {};
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

// Получение информации о пользователе по ID
app.get('/api/user/:userId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const token = authHeader.split(' ')[1];
  const { userId } = req.params;

  try {
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

// Получение объявлений текущего пользователя (НОВЫЙ ЭНДПОИНТ)
app.get('/api/my-ads', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    const userId = decoded.userId;

    const result = await pool.query(`
      SELECT
        a.id, a.title, a.description, a.price, a.condition, a.created_at, a.photo_url, a.user_id, a.location, a.property_details,
        c.name AS category_name
      FROM ads a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC
    `, [userId]);

    const ads = result.rows.map(ad => {
      if (ad.photo_url) {
        try {
          ad.photo_urls = JSON.parse(ad.photo_url);
        } catch (e) {
          console.error("Ошибка парсинга photo_url в /api/my-ads:", e);
          ad.photo_urls = [];
        }
        delete ad.photo_url;
      } else {
        ad.photo_urls = [];
      }

      if (ad.property_details) {
        try {
          // ad.property_details = JSON.parse(ad.property_details); // Уже парсится на бэкенде
        } catch (e) {
          console.error("Ошибка парсинга property_details в /api/my-ads:", e);
          ad.property_details = {};
        }
      } else {
        ad.property_details = {};
      }

      return ad;
    });

    res.json(ads);
  } catch (err) {
    console.error('Ошибка загрузки моих объявлений:', err);
    res.status(500).json({ error: 'Ошибка загрузки моих объявлений' });
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