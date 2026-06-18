const { useState, useEffect, useCallback } = React;

// --- КОМПОНЕНТ АВТОРИЗАЦИИ ---
const Auth = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [form, setForm] = useState({ username: '', email: '', password: '' });
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const endpoint = isLogin ? '/api/login' : '/api/register';
        const payload = isLogin 
            ? { email: form.email, password: form.password }
            : { username: form.username, email: form.email, password: form.password };

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Ошибка');
                return;
            }
            if (data.success) {
                onLogin(data.user);
            }
        } catch (err) {
            setError('Ошибка сети');
        }
    };

    return React.createElement('div', { className: 'auth-container' },
        React.createElement('h1', null, isLogin ? 'Вход' : 'Регистрация'),
        React.createElement('form', { onSubmit: handleSubmit },
            !isLogin && React.createElement('input', {
                type: 'text',
                placeholder: 'Имя пользователя',
                value: form.username,
                onChange: (e) => setForm({ ...form, username: e.target.value }),
                required: true
            }),
            React.createElement('input', {
                type: 'email',
                placeholder: 'Email',
                value: form.email,
                onChange: (e) => setForm({ ...form, email: e.target.value }),
                required: true
            }),
            React.createElement('input', {
                type: 'password',
                placeholder: 'Пароль',
                value: form.password,
                onChange: (e) => setForm({ ...form, password: e.target.value }),
                required: true,
                minLength: 6
            }),
            error && React.createElement('div', { className: 'error-message' }, error),
            React.createElement('button', { type: 'submit' }, isLogin ? 'Войти' : 'Зарегистрироваться')
        ),
        React.createElement('div', { className: 'switch', onClick: () => setIsLogin(!isLogin) },
            isLogin ? 'Нет аккаунта? Зарегистрируйся' : 'Уже есть аккаунт? Войди'
        )
    );
};

// --- КОМПОНЕНТ ПОСТА ---
const Post = ({ post, currentUserId, onLike, onDelete }) => {
    const [liked, setLiked] = useState(post.is_liked === 1);
    const [likesCount, setLikesCount] = useState(post.likes_count || 0);
    const isOwner = post.user_id === currentUserId;

    const handleLike = async () => {
        const method = liked ? 'DELETE' : 'POST';
        
        try {
            const res = await fetch('/api/like', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ postId: post.id, userId: currentUserId })
            });
            const data = await res.json();
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
            const res = await fetch(`/api/posts/${post.id}?userId=${currentUserId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                if (onDelete) onDelete(post.id);
            }
        } catch (err) {
            console.error('Ошибка удаления:', err);
        }
    };

    return React.createElement('div', { className: 'post' },
        React.createElement('div', { className: 'post-header' },
            React.createElement('div', { className: 'post-avatar' }, post.avatar || '👤'),
            React.createElement('div', { className: 'post-author' }, post.username),
            React.createElement('div', { className: 'post-time' }, new Date(post.created_at).toLocaleString()),
            isOwner && React.createElement('button', { 
                className: 'delete-post-btn',
                onClick: handleDelete,
                title: 'Удалить пост'
            }, '🗑️')
        ),
        React.createElement('div', { className: 'post-content' }, post.content),
        React.createElement('div', { className: 'post-actions' },
            React.createElement('button', { onClick: handleLike },
                liked ? '❤️' : '🤍', ' ', likesCount
            ),
            React.createElement('button', null, '💬 ', post.comments_count || 0)
        )
    );
};

// --- ОСНОВНОЙ КОМПОНЕНТ ---
const App = () => {
    const [user, setUser] = useState(null);
    const [posts, setPosts] = useState([]);
    const [users, setUsers] = useState([]);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [newPostContent, setNewPostContent] = useState('');
    const [socket, setSocket] = useState(null);
    const [friendRequests, setFriendRequests] = useState([]);
    const [friends, setFriends] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [activeTab, setActiveTab] = useState('feed'); // feed, friends, search

    // --- WEBSOCKET ---
    useEffect(() => {
        if (!user) return;

        const newSocket = io();
        setSocket(newSocket);

        newSocket.on('connect', () => {
            console.log('Socket подключён');
            newSocket.emit('auth', user.id);
        });

        newSocket.on('online_users', (users) => {
            setOnlineUsers(users);
        });

        newSocket.on('new_message', (message) => {
            if (selectedChat && (message.from_user === selectedChat || message.to_user === selectedChat)) {
                setMessages(prev => [...prev, message]);
            }
        });

        newSocket.on('friend_request', (data) => {
            loadFriendRequests();
            alert(`📨 Новая заявка в друзья!`);
        });

        newSocket.on('friend_accepted', (data) => {
            loadFriends();
            loadFriendRequests();
            alert(`🎉 Пользователь принял вашу заявку!`);
        });

        return () => {
            newSocket.close();
        };
    }, [user]);

    // --- ЗАГРУЗКА ДАННЫХ ---
    const loadPosts = useCallback(async () => {
        try {
            const res = await fetch(`/api/posts?userId=${user?.id}`);
            const data = await res.json();
            setPosts(data);
        } catch (err) {
            console.error('Ошибка загрузки постов:', err);
        }
    }, [user]);

    const loadUsers = useCallback(async (search = '') => {
        try {
            const url = `/api/users${search ? `?search=${encodeURIComponent(search)}` : ''}${user ? `&userId=${user.id}` : ''}`;
            const res = await fetch(url);
            const data = await res.json();
            setUsers(data);
        } catch (err) {
            console.error('Ошибка загрузки пользователей:', err);
        }
    }, [user]);

    const loadFriends = useCallback(async () => {
        if (!user) return;
        try {
            const res = await fetch(`/api/friends/${user.id}`);
            const data = await res.json();
            setFriends(data);
        } catch (err) {
            console.error('Ошибка загрузки друзей:', err);
        }
    }, [user]);

    const loadFriendRequests = useCallback(async () => {
        if (!user) return;
        try {
            const res = await fetch(`/api/friends/requests/${user.id}`);
            const data = await res.json();
            setFriendRequests(data);
        } catch (err) {
            console.error('Ошибка загрузки заявок:', err);
        }
    }, [user]);

    const loadMessages = useCallback(async (userId) => {
        try {
            const res = await fetch(`/api/messages/${user.id}/${userId}`);
            const data = await res.json();
            setMessages(data);
        } catch (err) {
            console.error('Ошибка загрузки сообщений:', err);
        }
    }, [user]);

    // --- ДЕЙСТВИЯ С ДРУЗЬЯМИ ---
    const sendFriendRequest = async (friendId) => {
        try {
            const res = await fetch('/api/friends/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, friendId })
            });
            const data = await res.json();
            if (data.success) {
                alert('✅ Заявка отправлена!');
                loadUsers(searchQuery);
            }
        } catch (err) {
            console.error('Ошибка:', err);
        }
    };

    const acceptFriendRequest = async (friendId) => {
        try {
            const res = await fetch('/api/friends/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, friendId })
            });
            const data = await res.json();
            if (data.success) {
                loadFriendRequests();
                loadFriends();
                loadUsers(searchQuery);
            }
        } catch (err) {
            console.error('Ошибка:', err);
        }
    };

    const rejectFriendRequest = async (friendId) => {
        try {
            const res = await fetch('/api/friends/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, friendId })
            });
            const data = await res.json();
            if (data.success) {
                loadFriendRequests();
            }
        } catch (err) {
            console.error('Ошибка:', err);
        }
    };

    // --- ДЕЙСТВИЯ С ПОСТАМИ ---
    const createPost = useCallback(async () => {
        if (!newPostContent.trim() || !user) return;

        try {
            const res = await fetch('/api/posts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    content: newPostContent.trim()
                })
            });
            const data = await res.json();
            if (data.success) {
                setNewPostContent('');
                loadPosts();
            }
        } catch (err) {
            console.error('Ошибка создания поста:', err);
        }
    }, [newPostContent, user, loadPosts]);

    const deletePost = useCallback((postId) => {
        setPosts(prev => prev.filter(p => p.id !== postId));
    }, []);

    // --- ОБРАБОТКА ПОИСКА ---
    useEffect(() => {
        const delay = setTimeout(() => {
            if (showSearch || searchQuery) {
                loadUsers(searchQuery);
            }
        }, 300);
        return () => clearTimeout(delay);
    }, [searchQuery, loadUsers, showSearch]);

    // --- ОТПРАВКА СООБЩЕНИЙ ---
    const sendMessage = useCallback(async (content) => {
        if (!selectedChat || !content.trim()) return;

        const message = {
            toUserId: selectedChat,
            content: content.trim()
        };

        if (socket) {
            socket.emit('send_message', message);
            setMessages(prev => [...prev, { 
                from_user: user.id,
                to_user: selectedChat,
                content: content.trim(),
                created_at: new Date().toISOString(),
                is_read: 0
            }]);
        }
    }, [selectedChat, socket, user]);

    // --- ИНИЦИАЛИЗАЦИЯ ---
    useEffect(() => {
        if (user) {
            loadPosts();
            loadUsers();
            loadFriends();
            loadFriendRequests();
        }
    }, [user, loadPosts, loadUsers, loadFriends, loadFriendRequests]);

    // --- РЕНДЕР ---
    if (!user) {
        return React.createElement(Auth, { onLogin: setUser });
    }

    const selectedUser = users.find(u => u.id === selectedChat);

    return React.createElement('div', { className: 'app' },
        React.createElement('div', { className: 'main-layout' },
            // --- САЙДБАР ---
            React.createElement('div', { className: 'sidebar' },
                React.createElement('div', { className: 'user-card' },
                    React.createElement('div', { className: 'avatar-large' }, user.avatar || '👤'),
                    React.createElement('div', { className: 'username' }, user.username),
                    React.createElement('div', { className: 'email' }, user.email)
                ),
                React.createElement('div', { className: 'sidebar-nav' },
                    React.createElement('button', { 
                        className: activeTab === 'feed' ? 'active' : '',
                        onClick: () => { setActiveTab('feed'); setShowSearch(false); }
                    }, '📰 Лента'),
                    React.createElement('button', { 
                        className: activeTab === 'friends' ? 'active' : '',
                        onClick: () => { setActiveTab('friends'); setShowSearch(false); }
                    }, '👥 Друзья', friendRequests.length > 0 && React.createElement('span', { className: 'badge' }, friendRequests.length)),
                    React.createElement('button', { 
                        className: activeTab === 'search' ? 'active' : '',
                        onClick: () => { setActiveTab('search'); setShowSearch(true); loadUsers(''); }
                    }, '🔍 Поиск'),
                    React.createElement('button', { onClick: () => { setUser(null); socket?.close(); } }, '🚪 Выйти')
                )
            ),

            // --- ОСНОВНАЯ ОБЛАСТЬ ---
            React.createElement('div', { className: 'main-content' },
                // Вкладка Лента
                activeTab === 'feed' && React.createElement('div', { className: 'feed' },
                    React.createElement('div', { className: 'create-post' },
                        React.createElement('textarea', {
                            placeholder: 'Что у тебя нового?',
                            value: newPostContent,
                            onChange: (e) => setNewPostContent(e.target.value),
                            rows: 3
                        }),
                        React.createElement('button', { onClick: createPost }, '📝 Опубликовать')
                    ),
                    posts.length === 0 
                        ? React.createElement('div', { className: 'empty-state' }, 'Нет постов. Добавь друзей, чтобы видеть их посты!')
                        : posts.map(post => 
                            React.createElement(Post, {
                                key: post.id,
                                post: post,
                                currentUserId: user.id,
                                onLike: loadPosts,
                                onDelete: deletePost
                            })
                        )
                ),

                // Вкладка Друзья
                activeTab === 'friends' && React.createElement('div', { className: 'friends-tab' },
                    React.createElement('h2', null, '👥 Друзья'),
                    friendRequests.length > 0 && React.createElement('div', { className: 'friend-requests' },
                        React.createElement('h3', null, '📨 Заявки в друзья'),
                        friendRequests.map(req => 
                            React.createElement('div', { key: req.id, className: 'friend-request' },
                                React.createElement('span', null, req.avatar, ' ', req.username),
                                React.createElement('div', null,
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
                    friends.length === 0 
                        ? React.createElement('div', { className: 'empty-state' }, 'У вас пока нет друзей')
                        : friends.map(friend => 
                            React.createElement('div', { key: friend.id, className: 'friend-item' },
                                React.createElement('span', null, friend.avatar, ' ', friend.username),
                                React.createElement('span', { className: onlineUsers.includes(friend.id) ? 'online-dot' : 'offline-dot' },
                                    onlineUsers.includes(friend.id) ? '🟢 Онлайн' : '⚪ Офлайн'
                                ),
                                React.createElement('button', { 
                                    className: 'chat-btn',
                                    onClick: () => {
                                        setSelectedChat(friend.id);
                                        loadMessages(friend.id);
                                        setActiveTab('feed');
                                    }
                                }, '💬 Написать')
                            )
                        )
                ),

                // Вкладка Поиск
                activeTab === 'search' && React.createElement('div', { className: 'search-tab' },
                    React.createElement('h2', null, '🔍 Поиск пользователей'),
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
                        const isRequestFromMe = u.friend_status === 'pending' && u.id === selectedChat;
                        
                        return React.createElement('div', { key: u.id, className: 'search-result' },
                            React.createElement('div', { className: 'search-user' },
                                React.createElement('span', { className: 'search-avatar' }, u.avatar || '👤'),
                                React.createElement('div', null,
                                    React.createElement('div', { className: 'search-username' }, u.username),
                                    React.createElement('div', { className: 'search-email' }, u.email)
                                ),
                                React.createElement('span', { className: onlineUsers.includes(u.id) ? 'online-dot' : 'offline-dot' },
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
                                    }, '➕ Добавить в друзья'),
                                React.createElement('button', { 
                                    className: 'chat-btn',
                                    onClick: () => {
                                        setSelectedChat(u.id);
                                        loadMessages(u.id);
                                        setActiveTab('feed');
                                    }
                                }, '💬 Написать')
                            )
                        );
                    })
                )
            ),

            // --- ПРАВАЯ ПАНЕЛЬ (ЧАТ) ---
            React.createElement('div', { className: 'right-sidebar' },
                React.createElement('div', { className: 'chat-box' },
                    React.createElement('h3', null, '💬 Сообщения'),
                    selectedUser 
                        ? React.createElement('div', null,
                            React.createElement('div', { className: 'chat-header' },
                                React.createElement('span', null, selectedUser.avatar, ' ', selectedUser.username),
                                React.createElement('span', { className: onlineUsers.includes(selectedUser.id) ? 'online-dot' : 'offline-dot' },
                                    onlineUsers.includes(selectedUser.id) ? '🟢 Онлайн' : '⚪ Офлайн'
                                )
                            ),
                            React.createElement('div', { className: 'chat-messages' },
                                messages.length === 0 
                                    ? React.createElement('div', { className: 'empty-chat' }, 'Начните общение!')
                                    : messages.map((msg, i) => 
                                        React.createElement('div', {
                                            key: i,
                                            className: `chat-message ${msg.from_user === user.id ? 'me' : 'other'}`
                                        },
                                            msg.content,
                                            React.createElement('div', { className: 'msg-time' },
                                                new Date(msg.created_at).toLocaleTimeString()
                                            )
                                        )
                                    )
                            ),
                            React.createElement('div', { className: 'chat-input' },
                                React.createElement('input', {
                                    placeholder: 'Сообщение...',
                                    id: 'chatInput',
                                    onKeyDown: (e) => {
                                        if (e.key === 'Enter') {
                                            sendMessage(e.target.value);
                                            e.target.value = '';
                                        }
                                    }
                                }),
                                React.createElement('button', { onClick: () => {
                                    const input = document.getElementById('chatInput');
                                    sendMessage(input.value);
                                    input.value = '';
                                }}, '➤')
                            )
                        )
                        : React.createElement('div', { className: 'empty-chat' }, 'Выберите друга для чата')
                )
            )
        )
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));