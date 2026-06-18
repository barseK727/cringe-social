// ============================================================
// СЕРВЕРНАЯ ЧАСТЬ — С ДРУЗЬЯМИ И УДАЛЕНИЕМ ПОСТОВ
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
    }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// ============================================================
// БАЗА ДАННЫХ SQLITE
// ============================================================

const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Ошибка БД:', err);
    else console.log('✅ База данных подключена');
});

db.serialize(() => {
    // Пользователи
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
            is_online BOOLEAN DEFAULT 0
        )
    `);

    // Посты
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

    // Лайки
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

    // Друзья
    db.run(`
        CREATE TABLE IF NOT EXISTS friends (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            friend_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending', -- pending, accepted, rejected
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, friend_id)
        )
    `);

    // Сообщения
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

    console.log('✅ Все таблицы созданы/проверены');
});

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function getUserById(id) {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, username, email, avatar, bio, created_at, last_seen, is_online FROM users WHERE id = ?', [id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getPosts(userId = null, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
        let query = `
            SELECT 
                p.*,
                u.username,
                u.avatar,
                COUNT(DISTINCT l.id) as likes_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN likes l ON p.id = l.post_id
        `;
        const params = [userId || null];
        
        if (userId) {
            // Показываем посты только друзей и свои
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
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getFriends(userId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                u.id, u.username, u.email, u.avatar, u.is_online, u.last_seen,
                f.status,
                CASE 
                    WHEN f.user_id = ? THEN f.friend_id
                    ELSE f.user_id
                END as friend_id
            FROM friends f
            JOIN users u ON (u.id = f.friend_id OR u.id = f.user_id)
            WHERE (f.user_id = ? OR f.friend_id = ?)
            AND f.status = 'accepted'
            AND u.id != ?
        `, [userId, userId, userId, userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getFriendRequests(userId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                u.id, u.username, u.email, u.avatar, u.is_online,
                f.id as request_id,
                f.created_at
            FROM friends f
            JOIN users u ON u.id = f.user_id
            WHERE f.friend_id = ? AND f.status = 'pending'
        `, [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// ============================================================
// API РОУТЫ
// ============================================================

// --- АУТЕНТИФИКАЦИЯ ---

app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = uuidv4();
        
        db.run(
            'INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)',
            [id, username, email, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Пользователь с таким email или именем уже существует' });
                    }
                    return res.status(500).json({ error: 'Ошибка сервера' });
                }
                res.status(201).json({ 
                    success: true, 
                    user: { id, username, email },
                    message: 'Регистрация успешна!'
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

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

        db.run('UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar || '👤',
                bio: user.bio
            }
        });
    });
});

// --- ПОЛЬЗОВАТЕЛИ ---

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

app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await getUserById(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// --- ПОСТЫ ---

app.get('/api/posts', (req, res) => {
    const userId = req.query.userId || null;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    
    getPosts(userId, limit, offset).then(posts => {
        res.json(posts);
    }).catch(err => {
        res.status(500).json({ error: 'Ошибка сервера' });
    });
});

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
                res.status(201).json({ 
                    success: true, 
                    post: { id, user_id: userId, content, image, created_at: new Date().toISOString() }
                });
            }
        }
    );
});

app.delete('/api/posts/:id', (req, res) => {
    const postId = req.params.id;
    const userId = req.query.userId;
    
    if (!userId) {
        return res.status(400).json({ error: 'userId обязателен' });
    }
    
    // Проверяем, что пост принадлежит пользователю
    db.get('SELECT user_id FROM posts WHERE id = ?', [postId], (err, post) => {
        if (err || !post) {
            return res.status(404).json({ error: 'Пост не найден' });
        }
        
        if (post.user_id !== userId) {
            return res.status(403).json({ error: 'Нет прав на удаление этого поста' });
        }
        
        db.run('DELETE FROM posts WHERE id = ?', [postId], function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                res.json({ success: true, message: 'Пост удалён' });
            }
        });
    });
});

// --- ЛАЙКИ ---

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
                    res.json({ success: true, likes: row ? row.count : 0 });
                });
            }
        }
    );
});

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
                    res.json({ success: true, likes: row ? row.count : 0 });
                });
            }
        }
    );
});

// --- ДРУЗЬЯ ---

app.post('/api/friends/request', (req, res) => {
    const { userId, friendId } = req.body;
    
    if (!userId || !friendId) {
        return res.status(400).json({ error: 'userId и friendId обязательны' });
    }
    
    if (userId === friendId) {
        return res.status(400).json({ error: 'Нельзя добавить себя в друзья' });
    }
    
    const id = uuidv4();
    db.run(
        'INSERT OR IGNORE INTO friends (id, user_id, friend_id, status) VALUES (?, ?, ?, ?)',
        [id, userId, friendId, 'pending'],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                // Уведомляем через сокет
                const recipientSocketId = onlineUsers.get(friendId);
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('friend_request', {
                        fromUserId: userId,
                        requestId: id
                    });
                }
                res.json({ success: true, message: 'Заявка отправлена' });
            }
        }
    );
});

app.post('/api/friends/accept', (req, res) => {
    const { userId, friendId } = req.body;
    
    if (!userId || !friendId) {
        return res.status(400).json({ error: 'userId и friendId обязательны' });
    }
    
    db.run(
        'UPDATE friends SET status = "accepted", updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND friend_id = ?',
        [friendId, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                // Уведомляем через сокет
                const recipientSocketId = onlineUsers.get(friendId);
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('friend_accepted', {
                        userId: userId
                    });
                }
                res.json({ success: true, message: 'Заявка принята' });
            }
        }
    );
});

app.post('/api/friends/reject', (req, res) => {
    const { userId, friendId } = req.body;
    
    if (!userId || !friendId) {
        return res.status(400).json({ error: 'userId и friendId обязательны' });
    }
    
    db.run(
        'DELETE FROM friends WHERE user_id = ? AND friend_id = ?',
        [friendId, userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                res.json({ success: true, message: 'Заявка отклонена' });
            }
        }
    );
});

app.get('/api/friends/:userId', (req, res) => {
    const userId = req.params.userId;
    
    getFriends(userId).then(friends => {
        res.json(friends);
    }).catch(err => {
        res.status(500).json({ error: 'Ошибка сервера' });
    });
});

app.get('/api/friends/requests/:userId', (req, res) => {
    const userId = req.params.userId;
    
    getFriendRequests(userId).then(requests => {
        res.json(requests);
    }).catch(err => {
        res.status(500).json({ error: 'Ошибка сервера' });
    });
});

// --- СООБЩЕНИЯ ---

app.get('/api/messages/:userId1/:userId2', (req, res) => {
    const { userId1, userId2 } = req.params;
    
    db.all(
        `SELECT * FROM messages 
         WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
         ORDER BY created_at ASC LIMIT 100`,
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
        socket.userId = userId;
        onlineUsers.set(userId, socket.id);
        
        db.run('UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
        
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

    socket.on('send_message', async (data) => {
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
// ЗАПУСК СЕРВЕРА
// ============================================================

server.listen(PORT, () => {
    console.log(`
    🚀 СЕРВЕР ЗАПУЩЕН!
    📡 Порт: ${PORT}
    🌐 URL: http://localhost:${PORT}
    📊 БД: SQLite (database.sqlite)
    `);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Необработанная ошибка:', err);
});