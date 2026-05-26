/**
 * IndexedDB Storage Manager for Chat History
 * 对话历史记录本地存储管理器
 */

class ChatHistoryManager {
    constructor() {
        this.dbName = 'MechanicalAI_ChatDB';
        this.dbVersion = 1;
        this.db = null;
        this.storeName = 'conversations';
    }

    /**
     * 初始化数据库
     */
    async init() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                console.error('IndexedDB not supported');
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('Database opened successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // 检查对象存储是否已存在
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { 
                        keyPath: 'id', 
                        autoIncrement: false 
                    });
                    
                    // 创建索引
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                    store.createIndex('title', 'title', { unique: false });
                    
                    console.log('Object store created');
                }
            };
        });
    }

    /**
     * 创建新会话
     */
    async createSession(title = null) {
        const session = {
            id: this.generateId(),
            title: title || `新对话 ${new Date().toLocaleString('zh-CN')}`,
            messages: [],
            diagnosis: '',
            quiz: [],
            studyPlan: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.add(session);

            request.onsuccess = () => {
                console.log('Session created:', session.id);
                resolve(session);
            };

            request.onerror = () => {
                console.error('Failed to create session:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 保存会话（更新）
     */
    async saveSession(session) {
        session.updatedAt = new Date().toISOString();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(session);

            request.onsuccess = () => {
                console.log('Session saved:', session.id);
                resolve(session);
            };

            request.onerror = () => {
                console.error('Failed to save session:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 获取会话
     */
    async getSession(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Failed to get session:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 获取所有会话列表（按更新时间排序）
     */
    async getAllSessions() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('updatedAt');
            const request = index.openCursor(null, 'prev');

            const sessions = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    sessions.push({
                        id: cursor.value.id,
                        title: cursor.value.title,
                        createdAt: cursor.value.createdAt,
                        updatedAt: cursor.value.updatedAt,
                        messageCount: cursor.value.messages ? cursor.value.messages.length : 0,
                        preview: this.getPreview(cursor.value.messages)
                    });
                    cursor.continue();
                } else {
                    resolve(sessions);
                }
            };

            request.onerror = () => {
                console.error('Failed to get sessions:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 获取预览文本
     */
    getPreview(messages) {
        if (!messages || messages.length === 0) return '';
        
        const userMessages = messages.filter(m => m.role === 'user');
        if (userMessages.length === 0) return '';
        
        const lastUserMessage = userMessages[userMessages.length - 1];
        const preview = lastUserMessage.content.substring(0, 50);
        return preview.length < lastUserMessage.content.length ? preview + '...' : preview;
    }

    /**
     * 删除会话
     */
    async deleteSession(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => {
                console.log('Session deleted:', id);
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to delete session:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 清空所有会话
     */
    async clearAllSessions() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear();

            request.onsuccess = () => {
                console.log('All sessions cleared');
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to clear sessions:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * 获取存储统计信息
     */
    async getStorageStats() {
        const sessions = await this.getAllSessions();
        const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0);
        
        // 估算存储大小
        let estimatedSize = 0;
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                estimatedSize = estimate.usage || 0;
            }
        } catch (e) {
            console.warn('Could not get storage estimate:', e);
        }

        return {
            sessionCount: sessions.length,
            totalMessages,
            estimatedSize,
            estimatedSizeFormatted: this.formatBytes(estimatedSize)
        };
    }

    /**
     * 导出所有会话为 JSON
     */
    async exportSessions() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const data = {
                    exportedAt: new Date().toISOString(),
                    version: '1.0',
                    sessions: request.result
                };
                
                const blob = new Blob([JSON.stringify(data, null, 2)], { 
                    type: 'application/json' 
                });
                resolve(blob);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * 下载导出文件
     */
    async downloadExport() {
        try {
            const blob = await this.exportSessions();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `MechanicalAI_Export_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export failed:', e);
            throw e;
        }
    }

    /**
     * 生成唯一ID
     */
    generateId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 格式化字节大小
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// 创建全局实例
const chatHistory = new ChatHistoryManager();
