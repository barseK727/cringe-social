// ============================================================
// КРИНЖОСЕТЬ — ПОЛНОСТЬЮ РАБОЧИЙ ФРОНТЕНД
// ============================================================

const { useState, useEffect, useCallback, useRef, useMemo } = React;

// --- УТИЛИТЫ ---
const API = {
    async request(endpoint, options = {}) {
        const res = await fetch(endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Ошибка запроса');
        }
        return data;
    }
};

// --- КОМПОНЕНТ АВТОРИЗАЦИИ ---
const Auth = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [form, setForm] = useState({ username: '', email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const endpoint = isLogin ? '/api/login' : '/api/register';
            const payload = isLogin 
                ? { email: form.email, password: form.password }
                : { username: form.username, email: form.email, password: form.password };

            const data = await API.request(endpoint, {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (data.success) {
                localStorage.setItem('session_token', data.token);
                localStorage.setItem('user_data', JSON.stringify(data.user));
                onLogin(data.user, data.token);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return React.createElement('div', { className: 'auth-container' },
        React.createElement('h1', null, isLogin ? 'Вход' : 'Регистрация'),
        React.createElement('p', { className: 'subtitle' }, isLogin ? 'Добро пожаловать в КРИНЖОСЕТЬ' : 'Присоединяйся к КРИНЖОСЕТИ'),
        React.createElement('form', { onSubmit: handleSubmit },
            !isLogin && React.createElement('input', {
                type: 'text',
                placeholder: 'Имя пользователя',
                value: form.username,
                onChange: (e) => setForm({ ...form, username: e.target.value }),
                required: true,
                disabled: loading
            }),
            React.createElement('input', {
                type: 'email',
                placeholder: 'Email',
                value: form.email,
                onChange: (e) => setForm({ ...form, email: e.target.value }),
                required: true,
                disabled: loading
            }),
            React.createElement('input', {
                type: 'password',
                placeholder: 'Пароль (мин. 6 символов)',
                value: form.password,
                onChange: (e) => setForm({ ...form, password: e.target.value }),
                required: true,
                minLength: 6,
                disabled: loading
            }),
            error && React.createElement('div', { className: 'error-message' }, error),
            React.createElement('button', { 
                type: 'submit', 
                disabled: loading 
            }, loading ? 'Загрузка...' : (isLogin ? 'Войти' : 'Зарегистрироваться'))
        ),
        React.createElement('div', { 
            className: 'switch', 
            onClick: () => { setIsLogin(!isLogin); setError(''); }
        },
            isLogin ? 'Нет аккаунта? Зарегистрируйся' : 'Уже есть аккаунт? Войди'
        )
    );
};

// --- КОМПОНЕНТ ПОСТА ---
const Post = ({ post, currentUserId, onLike, onDelete, onComment }) => {
    const [liked, setLiked] = useState(post.is_liked === 1);
    const [likesCount, setLikesCount] = useState(post.likes_count || 0);
    const [showComments, setShowComments] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [comments, setComments] = useState(post.comments || []);
    const isOwner = post.user_id === currentUserId;

    const handleLike = async () => {
        const method = liked ? 'DELETE' : 'POST';
        
        try {
            const data = await API.request('/api/like', {
                method,
                body: JSON.stringify({ postId: post.id, userId: currentUserId })
            });
            if (data.success) {
                setLiked(!liked);
                setLikesCount(data.likes);
                if (onLike) onLike();
            }
        } catch (err) {
            console.error('Ошибка лайка:', err);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Удалить этот пост?')) return;
        
        try {
            await API.request(`/api/posts/${post.id}?userId=${currentUserId}`, {
                method: 'DELETE'
            });
            if (onDelete) onDelete(post.id);
        } catch (err) {
            console.error('Ошибка удаления:', err);
        }
    };

    const handleAddComment = async () => {
        if (!commentText.trim()) return;

        try {
            const data = await API.request('/api/comments', {
                method: 'POST',
                body: JSON.stringify({
                    postId: post.id,
                    userId: currentUserId,
                    content: commentText.trim()
                })
            });
            if (data.success) {
                setComments([...comments, data.comment]);
                setCommentText('');
                if (onComment) onComment();
            }
        } catch (err) {
            console.error('Ошибка добавления комментария:', err);
        }
    };

    useEffect(() => {
        if (!window.socket) return;

        const handleNewComment = ({ postId, comment }) => {
            if (postId === post.id) {
                setComments(prev => [...prev, comment]);
            }
        };

        window.socket.on('new_comment', handleNewComment);
        return () => {
            window.socket.off('new_comment', handleNewComment);
        };
    }, [post.id]);

    useEffect(() => {
        if (!window.socket) return;

        const handleLikeUpdate = ({ postId, likes }) => {
            if (postId === post.id) {
                setLikesCount(likes);
            }
        };

        window.socket.on('post_liked', handleLikeUpdate);
        return () => {
            window.socket.off('post_liked', handleLikeUpdate);
        };
    }, [post.id]);

    return React.createElement('div', { className: 'post' },
        React.createElement('div', { className: 'post-header' },
            React.createElement('div', { className: 'post-avatar' }, post.avatar || '👤'),
            React.createElement('div', { className: 'post-author' }, post.username),
            React.createElement('div', { className: 'post-time' }, 
                new Date(post.created_at).toLocaleString('ru-RU')
            ),
            isOwner && React.createElement('button', { 
                className: 'delete-post-btn',
                onClick: handleDelete,
                title: 'Удалить пост'
            }, '🗑️')
        ),
        React.createElement('div', { className: 'post-content' }, post.content),
        React.createElement('div', { className: 'post-actions' },
            React.createElement('button', { 
                className: `like-btn ${liked ? 'liked' : ''}`,
                onClick: handleLike 
            },
                liked ? '❤️' : '🤍', ' ', likesCount
            ),
            React.createElement('button', { 
                onClick: () => setShowComments(!showComments) 
            },
                '💬 ', (post.comments_count || 0) + (comments.length - (post.comments?.length || 0))
            )
        ),
        showComments && React.createElement('div', { className: 'comments-section' },
            comments.map((comment, i) => 
                React.createElement('div', { key: i, className: 'comment' },
                    React.createElement('span', { className: 'comment-avatar' }, comment.avatar || '👤'),
                    React.createElement('div', { className: 'comment-content' },
                        React.createElement('div', { className: 'comment-author' }, comment.username),
                        React.createElement('div', { className: 'comment-text' }, comment.content),
                        React.createElement('div', { className: 'comment-time' }, 
                            new Date(comment.created_at).toLocaleString('ru-RU')
                        )
                    )
                )
            ),
            React.createElement('div', { className: 'comment-input' },
                React.createElement('input', {
                    type: 'text',
                    placeholder: 'Написать комментарий...',
                    value: commentText,
                    onChange: (e) => setCommentText(e.target.value),
                    onKeyDown: (e) => {
                        if (e.key === 'Enter') handleAddComment();
                    }
                }),
                React.createElement('button', { onClick: handleAddComment }, '➤')
            )
        )
    );
};

// --- ОСНОВНОЙ КОМПОНЕНТ ---
const App = () => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null);
    const [posts, setPosts] = useState([]);
    const [users, setUsers] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [newPostContent, setNewPostContent] = useState('');
    const [friendRequests, setFriendRequests] = useState([]);
    const [friends, setFriends] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState('feed');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const socketRef = useRef(null);
    const chatInputRef = useRef(null);

    // --- ВОССТАНОВЛЕНИЕ СЕССИИ ---
    useEffect(() => {
        const savedToken = localStorage.getItem('session_token');
        const savedUser = localStorage.getItem('user_data');
        
        if (savedToken && savedUser) {
            const userData = JSON.parse(savedUser);
            setUser(userData);
            setToken(savedToken);
            verifySession(savedToken, userData.id);
        }
    }, []);

    const verifySession = async (token, userId) => {
        try {
            const data = await API.request('/api/verify', {
                method: 'POST',
                body: JSON.stringify({ token })
            });
            if (data.success) {
                setUser(data.user);
                setToken(token);
                initSocket(data.user.id);
            } else {
                localStorage.removeItem('session_token');
                localStorage.removeItem('user_data');
                setUser(null);
                setToken(null);
            }
        } catch (err) {
            localStorage.removeItem('session_token');
            localStorage.removeItem('user_data');
            setUser(null);
            setToken(null);
        }
    };

    // --- WEBSOCKET ---
    const initSocket = useCallback((userId) => {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        const socket = io();
        socketRef.current = socket;
        window.socket = socket;

        socket.on('connect', () => {
            console.log('🔌 Socket подключён');
            socket.emit('auth', userId);
        });

        socket.on('online_users', (users) => {
            setOnlineUsers(users);
        });

        socket.on('new_message', (message) => {
            if (selectedChat && (message.from_user === selectedChat || message.to_user === selectedChat)) {
                setMessages(prev => [...prev, message]);
            }
        });

        socket.on('new_post', (post) => {
            setPosts(prev => [post, ...prev]);
        });

        socket.on('post_deleted', (postId) => {
            setPosts(prev => prev.filter(p => p.id !== postId));
        });

        socket.on('friend_request', (data) => {
            loadFriendRequests();
            alert('📨 Новая заявка в друзья!');
        });

        socket.on('friend_accepted', (data) => {
            loadFriends();
            loadFriendRequests();
            alert('🎉 Пользователь принял вашу заявку!');
        });

        return () => {
            socket.disconnect();
        };
    }, [selectedChat]);

    // --- ЗАГРУЗКА ДАННЫХ ---
    const loadPosts = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const data = await API.request(`/api/posts?userId=${user.id}`);
            setPosts(data);
        } catch (err) {
            setError('Ошибка загрузки постов');
        } finally {
            setLoading(false);
        }
    }, [user]);

    const loadUsers = useCallback(async (search = '') => {
        try {
            const url = `/api/users${search ? `?search=${encodeURIComponent(search)}` : ''}${user ? `&userId=${user.id}` : ''}`;
            const data = await API.request(url);
            setUsers(data);
        } catch (err) {
            console.error('Ошибка загрузки пользователей:', err);
        }
    }, [user]);

    const loadFriends = useCallback(async () => {
        if (!user) return;
        try {
            const data = await API.request(`/api/friends/${user.id}`);
            setFriends(data);
        } catch (err) {
            console.error('Ошибка загрузки друзей:', err);
        }
    }, [user]);

    const loadFriendRequests = useCallback(async () => {
        if (!user) return;
        try {
            const data = await API.request(`/api/friends/requests/${user.id}`);
            setFriendRequests(data);
        } catch (err) {
            console.error('Ошибка загрузки заявок:', err);
        }
    }, [user]);

    const loadMessages = useCallback(async (userId) => {
        try {
            const data = await API.request(`/api/messages/${user.id}/${userId}`);
            setMessages(data);
        } catch (err) {
            console.error('Ошибка загрузки сообщений:', err);
        }
    }, [user]);

    // --- ДЕЙСТВИЯ ---
    const handleLogin = (userData, token) => {
        setUser(userData);
        setToken(token);
        localStorage.setItem('session_token', token);
        localStorage.setItem('user_data', JSON.stringify(userData));
        initSocket(userData.id);
    };

    const handleLogout = async () => {
        try {
            await API.request('/api/logout', {
                method: 'POST',
                body: JSON.stringify({ userId: user.id })
            });
        } catch (err) {
            console.error('Ошибка выхода:', err);
        }
        
        localStorage.removeItem('session_token');
        localStorage.removeItem('user_data');
        if (socketRef.current) {
            socketRef.current.disconnect();
        }
        setUser(null);
        setToken(null);
        setPosts([]);
        setUsers([]);
        setMessages([]);
    };

    const createPost = useCallback(async () => {
        if (!newPostContent.trim() || !user) return;

        try {
            const data = await API.request('/api/posts', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    content: newPostContent.trim()
                })
            });
            if (data.success) {
                setNewPostContent('');
            }
        } catch (err) {
            setError('Ошибка создания поста');
        }
    }, [newPostContent, user]);

    const sendMessage = useCallback(async (content) => {
        if (!selectedChat || !content.trim() || !socketRef.current) return;

        const messageData = {
            toUserId: selectedChat,
            content: content.trim()
        };

        socketRef.current.emit('send_message', messageData);
        setMessages(prev => [...prev, { 
            from_user: user.id,
            to_user: selectedChat,
            content: content.trim(),
            created_at: new Date().toISOString(),
            is_read: 0
        }]);
    }, [selectedChat, user]);

    const sendFriendRequest = useCallback(async (friendId) => {
        try {
            await API.request('/api/friends/request', {
                method: 'POST',
                body: JSON.stringify({ userId: user.id, friendId })
            });
            alert('✅ Заявка отправлена!');
            loadUsers(searchQuery);
        } catch (err) {
            console.error('Ошибка:', err);
        }
    }, [user, searchQuery, loadUsers]);

    const acceptFriendRequest = useCallback(async (friendId) => {
        try {
            await API.request('/api/friends/accept', {
                method: 'POST',
                body: JSON.stringify({ userId: user.id, friendId })
            });
            loadFriendRequests();
            loadFriends();
            loadUsers(searchQuery);
        } catch (err) {
            console.error('Ошибка:', err);
        }
    }, [user, searchQuery, loadFriendRequests, loadFriends, loadUsers]);

    const rejectFriendRequest = useCallback(async (friendId) => {
        try {
            await API.request('/api/friends/reject', {
                method: 'POST',
                body: JSON.stringify({ userId: user.id, friendId })
            });
            loadFriendRequests();
        } catch (err) {
            console.error('Ошибка:', err);
        }
    }, [user, loadFriendRequests]);

    const deletePost = useCallback((postId) => {
        setPosts(prev => prev.filter(p => p.id !== postId));
    }, []);

    // --- ИНИЦИАЛИЗАЦИЯ ---
    useEffect(() => {
        if (user) {
            loadPosts();
            loadUsers();
            loadFriends();
            loadFriendRequests();
        }
    }, [user, loadPosts, loadUsers, loadFriends, loadFriendRequests]);

    // --- ПОИСК ---
    useEffect(() => {
        const delay = setTimeout(() => {
            if (activeTab === 'search') {
                loadUsers(searchQuery);
            }
        }, 300);
        return () => clearTimeout(delay);
    }, [searchQuery, loadUsers, activeTab]);

    // --- РЕНДЕР ---
    if (!user) {
        return React.createElement(Auth, { onLogin: handleLogin });
    }

    const selectedUser = users.find(u => u.id === selectedChat);

    return React.createElement('div', { className: 'app' },
        React.createElement('div', { className: 'main-layout' },
            // --- САЙДБАР ---
            React.createElement('div', { className: 'sidebar' },
                // ЛОГОТИП КРИНЖОСЕТЬ
                React.createElement('div', { className: 'logo' },
                    'КРИНЖОСЕТЬ',
                    React.createElement('span', null, '⚡ Всё по-настоящему')
                ),
                React.createElement('div', { className: 'user-card' },
                    React.createElement('div', { className: 'avatar-large' }, user.avatar || '👤'),
                    React.createElement('div', { className: 'username' }, user.username),
                    React.createElement('div', { className: 'email' }, user.email)
                ),
                React.createElement('div', { className: 'sidebar-nav' },
                    React.createElement('button', { 
                        className: activeTab === 'feed' ? 'active' : '',
                        onClick: () => { setActiveTab('feed'); }
                    }, '📰 Лента'),
                    React.createElement('button', { 
                        className: activeTab === 'friends' ? 'active' : '',
                        onClick: () => { setActiveTab('friends'); }
                    }, '👥 Друзья', 
                        friendRequests.length > 0 && React.createElement('span', { className: 'badge' }, friendRequests.length)
                    ),
                    React.createElement('button', { 
                        className: activeTab === 'search' ? 'active' : '',
                        onClick: () => { setActiveTab('search'); loadUsers(''); }
                    }, '🔍 Поиск'),
                    React.createElement('button', { onClick: handleLogout }, '🚪 Выйти')
                )
            ),

            // --- ОСНОВНОЙ КОНТЕНТ ---
            React.createElement('div', { className: 'main-content' },
                // Лента
                activeTab === 'feed' && React.createElement('div', { className: 'feed' },
                    React.createElement('div', { className: 'create-post' },
                        React.createElement('div', { className: 'post-label' }, '📝 Что у тебя нового?'),
                        React.createElement('textarea', {
                            placeholder: 'Поделись мыслями...',
                            value: newPostContent,
                            onChange: (e) => setNewPostContent(e.target.value),
                            rows: 3,
                            disabled: loading
                        }),
                        React.createElement('div', { className: 'post-actions-row' },
                            React.createElement('button', { 
                                onClick: createPost,
                                disabled: loading || !newPostContent.trim()
                            }, '📝 Опубликовать')
                        )
                    ),
                    error && React.createElement('div', { className: 'error-message' }, error),
                    loading && React.createElement('div', { className: 'loading' },
                        React.createElement('div', { className: 'spinner' })
                    ),
                    posts.length === 0 && !loading 
                        ? React.createElement('div', { className: 'empty-state' },
                            React.createElement('div', { className: 'empty-icon' }, '📭'),
                            React.createElement('div', { className: 'empty-title' }, 'Здесь пока пусто'),
                            React.createElement('div', { className: 'empty-desc' }, 'Добавь друзей, чтобы видеть их посты!')
                          )
                        : posts.map(post => 
                            React.createElement(Post, {
                                key: post.id,
                                post: post,
                                currentUserId: user.id,
                                onLike: loadPosts,
                                onDelete: deletePost,
                                onComment: loadPosts
                            })
                        )
                ),

                // Вкладка Друзья
                activeTab === 'friends' && React.createElement('div', { className: 'friends-tab' },
                    React.createElement('div', { className: 'tab-title' }, '👥 Друзья'),
                    React.createElement('div', { className: 'tab-subtitle' }, 'Общайся с друзьями и будь в курсе событий'),
                    
                    friendRequests.length > 0 && React.createElement('div', { className: 'friend-requests' },
                        React.createElement('div', { className: 'requests-title' }, '📨 Заявки в друзья'),
                        friendRequests.map(req => 
                            React.createElement('div', { key: req.id, className: 'friend-request' },
                                React.createElement('div', { className: 'request-user' },
                                    React.createElement('div', { className: 'request-avatar' }, req.avatar || '👤'),
                                    React.createElement('span', { className: 'request-name' }, req.username)
                                ),
                                React.createElement('div', { className: 'request-actions' },
                                    React.createElement('button', { 
                                        className: 'accept-btn',
                                        onClick: () => acceptFriendRequest(req.id)
                                    }, '✅ Принять'),
                                    React.createElement('button', { 
                                        className: 'reject-btn',
                                        onClick: () => rejectFriendRequest(req.id)
                                    }, '❌ Отклонить')
                                )
                            )
                        )
                    ),
                    
                    React.createElement('div', { className: 'friends-list' },
                        friends.length === 0 
                            ? React.createElement('div', { className: 'empty-state' },
                                React.createElement('div', { className: 'empty-icon' }, '👻'),
                                React.createElement('div', { className: 'empty-title' }, 'Пока никого нет'),
                                React.createElement('div', { className: 'empty-desc' }, 'Найди друзей через поиск и добавь их!')
                              )
                            : friends.map(friend => 
                                React.createElement('div', { key: friend.id, className: 'friend-item' },
                                    React.createElement('div', { className: 'friend-avatar' }, friend.avatar || '👤'),
                                    React.createElement('div', { className: 'friend-info' },
                                        React.createElement('div', { className: 'friend-name' }, friend.username),
                                        React.createElement('span', { 
                                            className: `friend-status ${onlineUsers.includes(friend.id) ? 'online' : 'offline'}`
                                        },
                                            onlineUsers.includes(friend.id) ? '🟢 Онлайн' : '⚪ Офлайн'
                                        )
                                    ),
                                    React.createElement('div', { className: 'friend-actions' },
                                        React.createElement('button', { 
                                            className: 'write-btn',
                                            onClick: () => {
                                                setSelectedChat(friend.id);
                                                loadMessages(friend.id);
                                                setActiveTab('feed');
                                            }
                                        }, '✉️ Написать')
                                    )
                                )
                            )
                    )
                ),

                // Поиск
                activeTab === 'search' && React.createElement('div', { className: 'search-tab' },
                    React.createElement('div', { className: 'tab-title' }, '🔍 Поиск'),
                    React.createElement('div', { className: 'tab-subtitle' }, 'Найди друзей и добавь их'),
                    React.createElement('input', {
                        type: 'text',
                        className: 'search-input',
                        placeholder: 'Введите имя или email...',
                        value: searchQuery,
                        onChange: (e) => setSearchQuery(e.target.value)
                    }),
                    users.filter(u => u.id !== user.id).map(u => {
                        const isFriend = u.friend_status === 'accepted';
                        const isPending = u.friend_status === 'pending';
                        
                        return React.createElement('div', { key: u.id, className: 'search-result' },
                            React.createElement('div', { className: 'search-user' },
                                React.createElement('span', { className: 'search-avatar' }, u.avatar || '👤'),
                                React.createElement('div', null,
                                    React.createElement('div', { className: 'search-username' }, u.username),
                                    React.createElement('div', { className: 'search-email' }, u.email)
                                ),
                                React.createElement('span', { 
                                    className: `search-status ${onlineUsers.includes(u.id) ? 'online' : 'offline'}`
                                },
                                    onlineUsers.includes(u.id) ? '🟢 Онлайн' : '⚪ Офлайн'
                                )
                            ),
                            React.createElement('div', { className: 'search-actions' },
                                isFriend 
                                    ? React.createElement('button', { className: 'friend-btn', disabled: true }, '✅ В друзьях')
                                    : isPending
                                    ? React.createElement('button', { className: 'pending-btn', disabled: true }, '⏳ Заявка отправлена')
                                    : React.createElement('button', { 
                                        className: 'add-friend-btn',
                                        onClick: () => sendFriendRequest(u.id)
                                    }, '➕ Добавить'),
                                React.createElement('button', { 
                                    className: 'chat-btn-small',
                                    onClick: () => {
                                        setSelectedChat(u.id);
                                        loadMessages(u.id);
                                        setActiveTab('feed');
                                    }
                                }, '💬')
                            )
                        );
                    })
                )
            ),

            // --- ПРАВАЯ ПАНЕЛЬ (ЧАТ) ---
            React.createElement('div', { className: 'right-sidebar' },
                React.createElement('div', { className: 'chat-box' },
                    React.createElement('div', { className: 'chat-title' },
                        React.createElement('span', { className: 'chat-icon' }, '💬'),
                        'Сообщения'
                    ),
                    selectedUser 
                        ? React.createElement('div', null,
                            React.createElement('div', { className: 'chat-header' },
                                React.createElement('div', { className: 'chat-partner' },
                                    React.createElement('span', { className: 'partner-avatar' }, selectedUser.avatar || '👤'),
                                    selectedUser.username
                                ),
                                React.createElement('span', { 
                                    className: `chat-status ${onlineUsers.includes(selectedUser.id) ? 'online' : 'offline'}`
                                },
                                    onlineUsers.includes(selectedUser.id) ? '🟢 Онлайн' : '⚪ Офлайн'
                                )
                            ),
                            React.createElement('div', { className: 'chat-messages', id: 'chatMessages' },
                                messages.length === 0 
                                    ? React.createElement('div', { className: 'empty-chat' },
                                        React.createElement('div', { className: 'empty-icon' }, '💭'),
                                        React.createElement('div', { className: 'empty-text' }, 'Начните общение!')
                                      )
                                    : messages.map((msg, i) => 
                                        React.createElement('div', {
                                            key: i,
                                            className: `chat-message ${msg.from_user === user.id ? 'me' : 'other'}`
                                        },
                                            msg.content,
                                            React.createElement('div', { className: 'msg-time' },
                                                new Date(msg.created_at).toLocaleTimeString('ru-RU')
                                            )
                                        )
                                    )
                            ),
                            React.createElement('div', { className: 'chat-input' },
                                React.createElement('input', {
                                    ref: chatInputRef,
                                    placeholder: 'Сообщение...',
                                    onKeyDown: (e) => {
                                        if (e.key === 'Enter') {
                                            sendMessage(e.target.value);
                                            e.target.value = '';
                                        }
                                    }
                                }),
                                React.createElement('button', { 
                                    onClick: () => {
                                        const input = chatInputRef.current;
                                        if (input) {
                                            sendMessage(input.value);
                                            input.value = '';
                                        }
                                    }
                                }, '➤')
                            )
                        )
                        : React.createElement('div', { className: 'empty-chat' },
                            React.createElement('div', { className: 'empty-icon' }, '👥'),
                            React.createElement('div', { className: 'empty-text' }, 'Выберите друга для чата')
                        )
                )
            )
        )
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));