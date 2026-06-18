// ============================================================
// СЕРВЕРНАЯ ЧАСТЬ — СЕССИИ, КОММЕНТАРИИ, ОПТИМИЗАЦИЯ
// ============================================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// ============================================================
// БАЗА ДАННЫХ
// ============================================================

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('❌ Ошибка БД:', err);
    else console.log('✅ База данных подключена');
});

// Включаем поддержку FOREIGN KEY
db.run('PRAGMA foreign_keys = ON');

db.serialize(() => {
    // Таблица пользователей
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            avatar TEXT DEFAULT '👤',
            bio TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_online BOOLEAN DEFAULT 0,
            session_token TEXT
        )
    `);

    // Таблица постов
    db.run(`
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            image TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Таблица комментариев
    db.run(`
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Таблица лайков
    db.run(`
        CREATE TABLE IF NOT EXISTS likes (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(post_id, user_id)
        )
    `);

    // Таблица друзей
    db.run(`
        CREATE TABLE IF NOT EXISTS friends (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            friend_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, friend_id)
        )
    `);

    // Таблица сообщений
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            from_user TEXT NOT NULL,
            to_user TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT 0,
            FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (to_user) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    console.log('✅ Все таблицы созданы');
});

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

// Получить пользователя по ID
function getUserById(id) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT id, username, email, avatar, bio, created_at, last_seen, is_online FROM users WHERE id = ?',
            [id],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Получить пользователя по токену сессии
function getUserByToken(token) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT id, username, email, avatar, bio FROM users WHERE session_token = ?',
            [token],
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            }
        );
    });
}

// Получить посты с комментариями
function getPostsWithComments(userId = null, limit = 30, offset = 0) {
    return new Promise((resolve, reject) => {
        let query = `
            SELECT 
                p.*,
                u.username,
                u.avatar,
                COUNT(DISTINCT l.id) as likes_count,
                COUNT(DISTINCT c.id) as comments_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN likes l ON p.id = l.post_id
            LEFT JOIN comments c ON p.id = c.post_id
        `;
        
        const params = [userId || null, userId || null];
        
        if (userId) {
            query += `
                WHERE p.user_id = ? OR p.user_id IN (
                    SELECT friend_id FROM friends 
                    WHERE user_id = ? AND status = 'accepted'
                    UNION
                    SELECT user_id FROM friends 
                    WHERE friend_id = ? AND status = 'accepted'
                )
            `;
            params.push(userId, userId, userId);
        }
        
        query += `
            GROUP BY p.id
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);
        
        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// Получить комментарии к посту
function getComments(postId) {
    return new Promise((resolve, reject) => {
        db.all(
            `
            SELECT c.*, u.username, u.avatar
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.post_id = ?
            ORDER BY c.created_at ASC
            `,
            [postId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

// ============================================================
// API РОУТЫ
// ============================================================

// --- РЕГИСТРАЦИЯ ---
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = uuidv4();
        const sessionToken = uuidv4();
        
        db.run(
            'INSERT INTO users (id, username, email, password, session_token) VALUES (?, ?, ?, ?, ?)',
            [id, username, email, hashedPassword, sessionToken],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Пользователь уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                res.status(201).json({ 
                    success: true, 
                    user: { id, username, email },
                    token: sessionToken
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- ЛОГИН ---
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        // Генерируем новый токен сессии
        const sessionToken = uuidv4();
        db.run(
            'UPDATE users SET session_token = ?, is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?',
            [sessionToken, user.id]
        );

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar || '👤',
                bio: user.bio
            },
            token: sessionToken
        });
    });
});

// --- ПРОВЕРКА СЕССИИ ---
app.post('/api/verify', (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(401).json({ error: 'Нет токена' });
    }

    getUserByToken(token).then(user => {
        if (!user) {
            return res.status(401).json({ error: 'Неверный токен' });
        }
        res.json({ success: true, user });
    }).catch(err => {
        res.status(500).json({ error: 'Ошибка сервера' });
    });
});

// --- ВЫХОД ---
app.post('/api/logout', (req, res) => {
    const { userId } = req.body;
    
    if (userId) {
        db.run('UPDATE users SET session_token = NULL, is_online = 0 WHERE id = ?', [userId]);
    }
    
    res.json({ success: true });
});

// --- ПОЛУЧИТЬ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ---
app.get('/api/users', (req, res) => {
    const search = req.query.search || '';
    const currentUserId = req.query.userId;
    
    let query = 'SELECT id, username, email, avatar, is_online, last_seen FROM users';
    const params = [];
    
    if (search) {
        query += ' WHERE username LIKE ? OR email LIKE ?';
        params.push(`%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY username ASC';
    
    db.all(query, params, (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Ошибка сервера' });
        } else {
            // Добавляем информацию о дружбе
            if (currentUserId) {
                const userIds = rows.map(u => u.id);
                if (userIds.length > 0) {
                    const placeholders = userIds.map(() => '?').join(',');
                    db.all(`
                        SELECT 
                            CASE 
                                WHEN user_id = ? THEN friend_id
                                ELSE user_id
                            END as user_id,
                            status
                        FROM friends
                        WHERE (user_id = ? OR friend_id = ?)
                        AND (${placeholders})
                    `, [currentUserId, currentUserId, currentUserId, ...userIds], (err, friendRows) => {
                        const friendMap = {};
                        friendRows.forEach(f => {
                            friendMap[f.user_id] = f.status;
                        });
                        rows.forEach(u => {
                            u.friend_status = friendMap[u.id] || null;
                        });
                        res.json(rows);
                    });
                } else {
                    res.json(rows);
                }
            } else {
                res.json(rows);
            }
        }
    });
});

// --- ПОЛУЧИТЬ ПОСТЫ ---
app.get('/api/posts', async (req, res) => {
    try {
        const userId = req.query.userId || null;
        const limit = parseInt(req.query.limit) || 30;
        const offset = parseInt(req.query.offset) || 0;
        
        const posts = await getPostsWithComments(userId, limit, offset);
        
        // Для каждого поста получаем комментарии
        for (let post of posts) {
            const comments = await getComments(post.id);
            post.comments = comments;
        }
        
        res.json(posts);
    } catch (err) {
        console.error('Ошибка загрузки постов:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- СОЗДАТЬ ПОСТ ---
app.post('/api/posts', (req, res) => {
    const { userId, content, image } = req.body;
    
    if (!userId || !content) {
        return res.status(400).json({ error: 'UserId и content обязательны' });
    }

    const id = uuidv4();
    db.run(
        'INSERT INTO posts (id, user_id, content, image) VALUES (?, ?, ?, ?)',
        [id, userId, content, image || null],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                // Получаем созданный пост с данными пользователя
                db.get(
                    `
                    SELECT p.*, u.username, u.avatar
                    FROM posts p
                    JOIN users u ON p.user_id = u.id
                    WHERE p.id = ?
                    `,
                    [id],
                    (err, post) => {
                        if (err) {
                            res.status(500).json({ error: 'Ошибка сервера' });
                        } else {
                            post.comments = [];
                            post.likes_count = 0;
                            post.comments_count = 0;
                            post.is_liked = false;
                            
                            // Отправляем новый пост через WebSocket всем
                            io.emit('new_post', post);
                            
                            res.status(201).json({ 
                                success: true, 
                                post
                            });
                        }
                    }
                );
            }
        }
    );
});

// --- УДАЛИТЬ ПОСТ ---
app.delete('/api/posts/:id', (req, res) => {
    const postId = req.params.id;
    const userId = req.query.userId;
    
    if (!userId) {
        return res.status(400).json({ error: 'userId обязателен' });
    }
    
    db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, post) => {
        if (err || !post) {
            return res.status(404).json({ error: 'Пост не найден' });
        }
        
        if (post.user_id !== userId) {
            return res.status(403).json({ error: 'Нет прав на удаление' });
        }
        
        db.run('DELETE FROM posts WHERE id = ?', [postId], function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                io.emit('post_deleted', postId);
                res.json({ success: true });
            }
        });
    });
});

// --- ДОБАВИТЬ КОММЕНТАРИЙ ---
app.post('/api/comments', (req, res) => {
    const { postId, userId, content } = req.body;
    
    if (!postId || !userId || !content) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const id = uuidv4();
    db.run(
        'INSERT INTO comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)',
        [id, postId, userId, content],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                // Получаем созданный комментарий с данными пользователя
                db.get(
                    `
                    SELECT c.*, u.username, u.avatar
                    FROM comments c
                    JOIN users u ON c.user_id = u.id
                    WHERE c.id = ?
                    `,
                    [id],
                    (err, comment) => {
                        if (err) {
                            res.status(500).json({ error: 'Ошибка сервера' });
                        } else {
                            io.emit('new_comment', { postId, comment });
                            res.status(201).json({ success: true, comment });
                        }
                    }
                );
            }
        }
    );
});

// --- ЛАЙКНУТЬ ПОСТ ---
app.post('/api/like', (req, res) => {
    const { postId, userId } = req.body;
    
    if (!postId || !userId) {
        return res.status(400).json({ error: 'postId и userId обязательны' });
    }

    const id = uuidv4();
    db.run(
        'INSERT OR IGNORE INTO likes (id, post_id, user_id) VALUES (?, ?, ?)',
        [id, postId, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                db.get('SELECT COUNT(*) as count FROM likes WHERE post_id = ?', [postId], (err, row) => {
                    const likes = row ? row.count : 0;
                    io.emit('post_liked', { postId, likes });
                    res.json({ success: true, likes });
                });
            }
        }
    );
});

// --- УБРАТЬ ЛАЙК ---
app.delete('/api/like', (req, res) => {
    const { postId, userId } = req.body;
    
    db.run(
        'DELETE FROM likes WHERE post_id = ? AND user_id = ?',
        [postId, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                db.get('SELECT COUNT(*) as count FROM likes WHERE post_id = ?', [postId], (err, row) => {
                    const likes = row ? row.count : 0;
                    io.emit('post_liked', { postId, likes });
                    res.json({ success: true, likes });
                });
            }
        }
    );
});

// --- ДРУЗЬЯ ---
app.post('/api/friends/request', (req, res) => {
    const { userId, friendId } = req.body;
    
    if (!userId || !friendId || userId === friendId) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }
    
    const id = uuidv4();
    db.run(
        'INSERT OR IGNORE INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)',
        [id, userId, friendId, 'pending'],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                const recipientSocketId = onlineUsers.get(friendId);
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('friend_request', { fromUserId: userId });
                }
                res.json({ success: true });
            }
        }
    );
});

app.post('/api/friends/accept', (req, res) => {
    const { userId, friendId } = req.body;
    
    db.run(
        'UPDATE friends SET status = "accepted", updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ?',
        [friendId, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                const recipientSocketId = onlineUsers.get(friendId);
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('friend_accepted', { userId });
                }
                res.json({ success: true });
            }
        }
    );
});

app.post('/api/friends/reject', (req, res) => {
    const { userId, friendId } = req.body;
    
    db.run(
        'DELETE FROM friends WHERE user_id = ? AND friend_id = ?',
        [friendId, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                res.json({ success: true });
            }
        }
    );
});

app.get('/api/friends/:userId', (req, res) => {
    const userId = req.params.userId;
    
    db.all(`
        SELECT 
            u.id, u.username, u.email, u.avatar, u.is_online, u.last_seen
        FROM friends f
        JOIN users u ON (u.id = f.friend_id OR u.id = f.user_id)
        WHERE (f.user_id = ? OR f.friend_id = ?)
        AND f.status = 'accepted'
        AND u.id != ?
    `, [userId, userId, userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Ошибка сервера' });
        } else {
            res.json(rows);
        }
    });
});

app.get('/api/friends/requests/:userId', (req, res) => {
    const userId = req.params.userId;
    
    db.all(`
        SELECT 
            u.id, u.username, u.email, u.avatar,
            f.id as request_id,
            f.created_at
        FROM friends f
        JOIN users u ON u.id = f.user_id
        WHERE f.friend_id = ? AND f.status = 'pending'
    `, [userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Ошибка сервера' });
        } else {
            res.json(rows);
        }
    });
});

// --- СООБЩЕНИЯ ---
app.get('/api/messages/:userId1/:userId2', (req, res) => {
    const { userId1, userId2 } = req.params;
    
    db.all(
        `SELECT * FROM messages 
         WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
         ORDER BY created_at ASC LIMIT 200`,
        [userId1, userId2, userId2, userId1],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                res.json(rows);
            }
        }
    );
});

// ============================================================
// WEBSOCKET
// ============================================================

const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('🔌 Новое подключение:', socket.id);

    socket.on('auth', async (userId) => {
        if (!userId) return;
        
        socket.userId = userId;
        onlineUsers.set(userId, socket.id);
        
        db.run('UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
        
        // Обновляем список онлайн для всех
        broadcastOnlineUsers();
        
        // Отправляем непрочитанные сообщения
        db.all(
            `SELECT * FROM messages WHERE to_user = ? AND is_read = 0 ORDER BY created_at ASC`,
            [userId],
            (err, messages) => {
                if (messages && messages.length > 0) {
                    socket.emit('unread_messages', messages);
                    const ids = messages.map(m => m.id);
                    db.run(
                        `UPDATE messages SET is_read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
                        ids
                    );
                }
            }
        );
    });

    socket.on('send_message', (data) => {
        const { toUserId, content } = data;
        const fromUserId = socket.userId;
        
        if (!fromUserId || !toUserId || !content) return;

        const id = uuidv4();
        const message = {
            id,
            from_user: fromUserId,
            to_user: toUserId,
            content,
            created_at: new Date().toISOString(),
            is_read: 0
        };

        db.run(
            'INSERT INTO messages (id, from_user, to_user, content) VALUES (?, ?, ?, ?)',
            [id, fromUserId, toUserId, content],
            function(err) {
                if (!err) {
                    socket.emit('message_sent', message);
                    
                    const recipientSocketId = onlineUsers.get(toUserId);
                    if (recipientSocketId) {
                        io.to(recipientSocketId).emit('new_message', message);
                    }
                }
            }
        );
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            db.run('UPDATE users SET is_online = 0, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [socket.userId]);
            broadcastOnlineUsers();
            console.log(`❌ Пользователь ${socket.userId} отключился`);
        }
    });
});

function broadcastOnlineUsers() {
    const onlineList = Array.from(onlineUsers.keys());
    io.emit('online_users', onlineList);
}

// ============================================================
// ЗАПУСК
// ============================================================

server.listen(PORT, () => {
    console.log(`
    🚀 СЕРВЕР ЗАПУЩЕН!
    📡 Порт: ${PORT}
    🌐 URL: http://localhost:${PORT}
    `);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Ошибка:', err);
});