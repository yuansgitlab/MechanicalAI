/**
 * 强大的AI记忆系统 - Long-Term Memory (LTM)
 * 包含：长期记忆库、知识提取、对话摘要、用户画像学习
 */

class LongTermMemory {
    constructor() {
        this.dbName = 'MechanicalAI_LTM';
        this.dbVersion = 2;
        this.db = null;
        
        // 存储分区
        this.stores = {
            knowledge: 'knowledge_items',       // 知识条目
            memories: 'memory_snippets',         // 记忆片段
            summaries: 'dialog_summaries',       // 对话摘要
            profiles: 'user_profile',            // 用户画像
            preferences: 'user_preferences',     // 用户偏好
            bookmarks: 'bookmarked_messages'    // 标记的重要消息
        };
    }

    // 初始化数据库
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this.createStores(db);
            };
        });
    }

    createStores(db) {
        if (!db.objectStoreNames.contains(this.stores.knowledge)) {
            const store = db.createObjectStore(this.stores.knowledge, { keyPath: 'id' });
            store.createIndex('topic', 'topic', { unique: false });
            store.createIndex('category', 'category', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('relevance', 'relevance', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.stores.memories)) {
            const store = db.createObjectStore(this.stores.memories, { keyPath: 'id' });
            store.createIndex('sessionId', 'sessionId', { unique: false });
            store.createIndex('type', 'type', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('importance', 'importance', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.stores.summaries)) {
            const store = db.createObjectStore(this.stores.summaries, { keyPath: 'id' });
            store.createIndex('sessionId', 'sessionId', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.stores.profiles)) {
            db.createObjectStore(this.stores.profiles, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(this.stores.preferences)) {
            db.createObjectStore(this.stores.preferences, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(this.stores.bookmarks)) {
            const store = db.createObjectStore(this.stores.bookmarks, { keyPath: 'id' });
            store.createIndex('sessionId', 'sessionId', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
        }
    }

    // === 知识管理 ===
    
    // 提取并存储知识
    async extractAndStoreKnowledge(message, metadata = {}) {
        const knowledgeItems = this.extractKnowledgeFromText(message);
        
        for (const item of knowledgeItems) {
            await this.storeKnowledge({
                ...item,
                sessionId: metadata.sessionId,
                timestamp: new Date().toISOString(),
                relevance: 1.0,
                accessCount: 0,
                lastAccess: null
            });
        }
        
        return knowledgeItems;
    }

    // 从文本中提取知识
    extractKnowledgeFromText(text) {
        const items = [];
        const patterns = {
            formula: /([A-Za-z]+\([^)]*\)\s*=?[^.\n]+)/g,
            definition: /([^.\n]+是[^.\n]+)/g,
            concept: /([A-Za-z\u4e00-\u9fa5_]+[：:]\s*[^.\n]+)/g
        };

        for (const [type, pattern] of Object.entries(patterns)) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                if (match[1].length > 10) {
                    items.push({
                        id: 'knowledge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                        content: match[1].trim(),
                        type: type,
                        category: this.categorizeContent(match[1]),
                        topic: this.extractTopic(match[1])
                    });
                }
            }
        }

        return items;
    }

    categorizeContent(text) {
        const keywords = {
            '数学': ['方程', '公式', '定理', '函数', '微分', '积分'],
            '物理': ['力', '能量', '动量', '定律', '定理'],
            '控制工程': ['系统', '传递函数', 'PID', '反馈', '拉普拉斯'],
            '机械设计': ['结构', '应力', '材料', '零件'],
            '电子电路': ['电路', '电阻', '电容', '二极管', '晶体管']
        };

        for (const [cat, words] of Object.entries(keywords)) {
            if (words.some(w => text.includes(w))) {
                return cat;
            }
        }
        return '其他';
    }

    extractTopic(text) {
        const words = text.split(/\s+/).slice(0, 5);
        return words.join(' ');
    }

    async storeKnowledge(item) {
        return this.addToStore(this.stores.knowledge, item);
    }

    // 检索相关知识
    async retrieveKnowledge(query, limit = 5) {
        const allKnowledge = await this.getAllFromStore(this.stores.knowledge);
        const scored = allKnowledge.map(k => ({
            ...k,
            score: this.calculateRelevance(k, query)
        })).sort((a, b) => b.score - a.score).slice(0, limit);

        return scored;
    }

    calculateRelevance(knowledgeItem, query) {
        let score = knowledgeItem.relevance || 0.5;
        const content = knowledgeItem.content.toLowerCase();
        const q = query.toLowerCase();
        
        const words = q.split(/\s+/);
        for (const word of words) {
            if (content.includes(word)) score += 0.2;
        }
        
        return Math.min(score, 2.0);
    }

    // === 对话摘要 ===

    async generateSummary(sessionId, messages) {
        if (messages.length < 3) return null;

        const summary = {
            id: 'summary_' + Date.now(),
            sessionId,
            timestamp: new Date().toISOString(),
            topics: this.extractTopics(messages),
            keyInsights: this.extractKeyInsights(messages),
            actionItems: this.extractActionItems(messages),
            questionCount: messages.filter(m => m.role === 'user').length,
            messageCount: messages.length
        };

        await this.addToStore(this.stores.summaries, summary);
        return summary;
    }

    extractTopics(messages) {
        const text = messages.map(m => m.content).join('\n');
        const topicPattern = /(拉普拉斯|傅里叶|PID|控制|系统|微分|积分|方程|定理|公式)/g;
        const matches = text.match(topicPattern);
        return matches ? [...new Set(matches)] : [];
    }

    extractKeyInsights(messages) {
        const insights = [];
        messages.filter(m => m.role === 'assistant').forEach(m => {
            const sentences = m.content.split(/[。！？\n]/).filter(s => s.trim());
            sentences.slice(0, 3).forEach(s => {
                if (s.length > 20) insights.push(s.trim());
            });
        });
        return insights.slice(0, 5);
    }

    extractActionItems(messages) {
        const actions = [];
        const keywords = ['应该', '需要', '建议', '记得', '不要', '最好'];
        messages.filter(m => m.role === 'assistant').forEach(m => {
            const sentences = m.content.split(/[。！？\n]/);
            sentences.forEach(s => {
                if (keywords.some(k => s.includes(k))) {
                    actions.push(s.trim());
                }
            });
        });
        return actions.slice(0, 5);
    }

    // === 用户画像学习 ===

    async updateProfile(key, value) {
        const item = await this.getFromStore(this.stores.profiles, key);
        if (item) {
            await this.updateInStore(this.stores.profiles, { ...item, value, updatedAt: new Date().toISOString() });
        } else {
            await this.addToStore(this.stores.profiles, {
                key, value, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            });
        }
    }

    async learnFromMessages(messages) {
        const learningData = {
            topics: this.extractTopics(messages),
            style: this.analyzeConversationStyle(messages),
            difficulties: this.identifyDifficulties(messages),
            progress: this.trackProgress(messages)
        };

        await this.updateProfile('learningHistory', {
            timestamp: new Date().toISOString(),
            ...learningData
        });

        return learningData;
    }

    analyzeConversationStyle(messages) {
        const userMessages = messages.filter(m => m.role === 'user');
        const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length;
        
        return {
            messageLength: avgLength < 30 ? '简洁' : avgLength < 100 ? '适中' : '详细',
            questionFrequency: userMessages.length / messages.length,
            technicalLevel: this.estimateTechnicalLevel(messages)
        };
    }

    identifyDifficulties(messages) {
        const text = messages.map(m => m.content).join('\n');
        const difficultyKeywords = ['不懂', '不理解', '难', '不会', '出错', '卡住', '问题', '错误', '困难'];
        return difficultyKeywords.filter(k => text.includes(k));
    }

    trackProgress(messages) {
        return {
            questionsAnswered: messages.filter(m => m.role === 'assistant').length,
            topicsExplored: this.extractTopics(messages).length,
            lastActive: new Date().toISOString()
        };
    }

    estimateTechnicalLevel(messages) {
        const text = messages.map(m => m.content).join('\n');
        const advancedWords = ['拉普拉斯', '傅里叶', '传递函数', '微分方程', 'PID控制器', '状态空间'];
        const basicWords = ['简单', '基础', '入门', '介绍'];
        
        let level = '初级';
        if (advancedWords.filter(w => text.includes(w)).length >= 3) {
            level = '高级';
        } else if (basicWords.some(w => text.includes(w))) {
            level = '初级';
        } else {
            level = '中级';
        }
        return level;
    }

    async getProfile() {
        const items = await this.getAllFromStore(this.stores.profiles);
        return items.reduce((obj, item) => ({ ...obj, [item.key]: item.value }), {});
    }

    // === 用户偏好 ===

    async setPreference(key, value) {
        await this.updateInStore(this.stores.preferences, { key, value, updatedAt: new Date().toISOString() }, key);
    }

    async getPreference(key, defaultValue = null) {
        const item = await this.getFromStore(this.stores.preferences, key);
        return item ? item.value : defaultValue;
    }

    // === 重要消息标记 ===

    async bookmarkMessage(messageId, messageData) {
        const bookmark = {
            id: 'bookmark_' + Date.now(),
            messageId,
            ...messageData,
            timestamp: new Date().toISOString(),
            notes: ''
        };
        return this.addToStore(this.stores.bookmarks, bookmark);
    }

    async getBookmarkedMessages() {
        return this.getAllFromStore(this.stores.bookmarks);
    }

    // === 上下文构建 ===

    async buildContextForConversation(currentMessages, sessionId) {
        const contextParts = [];
        
        // 1. 添加上下文提示
        contextParts.push('---用户历史背景---');
        
        // 2. 添加相关知识
        const relevantKnowledge = await this.retrieveKnowledge(
            currentMessages.map(m => m.content).join(' '),
            3
        );
        if (relevantKnowledge.length > 0) {
            contextParts.push('相关知识:');
            relevantKnowledge.forEach(k => contextParts.push(`- ${k.content}`));
        }
        
        // 3. 添加用户画像
        const profile = await this.getProfile();
        if (profile.learningHistory) {
            contextParts.push(`学习进度: ${JSON.stringify(profile.learningHistory, null, 2)}`);
        }
        
        // 4. 添加相关摘要
        const relevantSummaries = await this.getRelevantSummaries(sessionId);
        if (relevantSummaries.length > 0) {
            contextParts.push('之前对话要点:');
            relevantSummaries.forEach(s => {
                contextParts.push(`主题: ${s.topics.join(', ')}`);
                contextParts.push(`要点: ${s.keyInsights.slice(0, 2).join('; ')}`);
            });
        }
        
        contextParts.push('---开始对话---');
        
        return contextParts.join('\n');
    }

    async getRelevantSummaries(sessionId) {
        const allSummaries = await this.getAllFromStore(this.stores.summaries);
        return allSummaries.filter(s => s.sessionId === sessionId).slice(0, 3);
    }

    // === 通用存储操作 ===

    async addToStore(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.add(data);
            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    async updateInStore(storeName, data, key = data.key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                const putReq = store.put({ ...existing, ...data });
                putReq.onsuccess = () => resolve(data);
                putReq.onerror = () => reject(putReq.error);
            };
        });
    }

    async getFromStore(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllFromStore(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteFromStore(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // === 统计和导出 ===

    async getStats() {
        const knowledge = await this.getAllFromStore(this.stores.knowledge);
        const bookmarks = await this.getAllFromStore(this.stores.bookmarks);
        const summaries = await this.getAllFromStore(this.stores.summaries);
        const profile = await this.getProfile();

        return {
            knowledgeCount: knowledge.length,
            bookmarkCount: bookmarks.length,
            summaryCount: summaries.length,
            categories: this.countByCategory(knowledge),
            profile
        };
    }

    countByCategory(items) {
        const counts = {};
        items.forEach(item => {
            const cat = item.category || '未分类';
            counts[cat] = (counts[cat] || 0) + 1;
        });
        return counts;
    }

    async exportMemory() {
        const data = {
            exportedAt: new Date().toISOString(),
            version: '2.0',
            knowledge: await this.getAllFromStore(this.stores.knowledge),
            summaries: await this.getAllFromStore(this.stores.summaries),
            bookmarks: await this.getAllFromStore(this.stores.bookmarks),
            profile: await this.getProfile()
        };
        return JSON.stringify(data, null, 2);
    }

    async clearAllMemory() {
        for (const storeName of Object.values(this.stores)) {
            const tx = this.db.transaction([storeName], 'readwrite');
            tx.objectStore(storeName).clear();
        }
    }
}

const ltm = new LongTermMemory();
