/**
 * 题库存储管理器 - Question Bank Manager (优化版)
 * 使用 IndexedDB 存储用户收藏的题目
 * 支持多种题型、错题本、智能练习、统计分析
 */

class QuestionBankManager {
    constructor() {
        this.dbName = 'MechanicalAI_QuestionBank';
        this.dbVersion = 2;
        this.db = null;
        this.storeName = 'questions';
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Failed to open question bank database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('Question bank database opened successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, { 
                        keyPath: 'id',
                        autoIncrement: false
                    });
                    
                    objectStore.createIndex('subject', 'subject', { unique: false });
                    objectStore.createIndex('difficulty', 'difficulty', { unique: false });
                    objectStore.createIndex('category', 'category', { unique: false });
                    objectStore.createIndex('collectedAt', 'collectedAt', { unique: false });
                    objectStore.createIndex('isMastered', 'isMastered', { unique: false });
                    objectStore.createIndex('isWrong', 'isWrong', { unique: false });
                    objectStore.createIndex('type', 'type', { unique: false });
                    objectStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                    
                    console.log('Question bank object store created (v2)');
                } else {
                    // 升级现有数据库
                    const objectStore = event.target.transaction.objectStore(this.storeName);
                    if (!objectStore.indexNames.contains('isWrong')) {
                        objectStore.createIndex('isWrong', 'isWrong', { unique: false });
                    }
                    if (!objectStore.indexNames.contains('type')) {
                        objectStore.createIndex('type', 'type', { unique: false });
                    }
                    if (!objectStore.indexNames.contains('tags')) {
                        objectStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                    }
                }
            };
        });
    }

    async addQuestion(question) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const questionData = {
                id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                question: question.question,
                options: question.options || [],
                answer: question.answer,
                analysis: question.analysis || '',
                type: question.type || 'single', // single, multiple, judge, fill, essay
                difficulty: question.difficulty || '基础',
                subject: question.subject || '',
                category: question.category || '',
                tags: question.tags || [],
                collectedAt: new Date().toISOString(),
                isMastered: false,
                masteredAt: null,
                isWrong: false,
                wrongCount: 0,
                wrongAt: null,
                notes: '',
                reviewCount: 0,
                lastReviewedAt: null,
                correctCount: 0,
                lastCorrectAt: null
            };

            const request = objectStore.add(questionData);

            request.onsuccess = () => {
                console.log('Question added to bank:', questionData.id);
                resolve(questionData);
            };

            request.onerror = () => {
                console.error('Failed to add question:', request.error);
                reject(request.error);
            };
        });
    }

    async removeQuestion(questionId) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.delete(questionId);

            request.onsuccess = () => {
                console.log('Question removed from bank:', questionId);
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to remove question:', request.error);
                reject(request.error);
            };
        });
    }

    async getAllQuestions() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = () => {
                const questions = request.result.sort((a, b) => 
                    new Date(b.collectedAt) - new Date(a.collectedAt)
                );
                resolve(questions);
            };

            request.onerror = () => {
                console.error('Failed to get questions:', request.error);
                reject(request.error);
            };
        });
    }

    async getQuestionsByFilter(filter = {}) {
        const allQuestions = await this.getAllQuestions();
        
        return allQuestions.filter(q => {
            if (filter.subject && q.subject !== filter.subject) return false;
            if (filter.difficulty && q.difficulty !== filter.difficulty) return false;
            if (filter.category && q.category !== filter.category) return false;
            if (filter.type && q.type !== filter.type) return false;
            if (filter.isMastered === true && q.isMastered !== true) return false;
            if (filter.isMastered === false && q.isMastered === true) return false;
            if (filter.isWrong === true && q.isWrong !== true) return false;
            if (filter.tags && filter.tags.length > 0) {
                const hasTag = filter.tags.some(tag => q.tags?.includes(tag));
                if (!hasTag) return false;
            }
            if (filter.search) {
                const searchLower = filter.search.toLowerCase();
                const matchQuestion = q.question.toLowerCase().includes(searchLower);
                const matchAnalysis = (q.analysis || '').toLowerCase().includes(searchLower);
                const matchTags = (q.tags || []).some(t => t.toLowerCase().includes(searchLower));
                if (!matchQuestion && !matchAnalysis && !matchTags) return false;
            }
            return true;
        });
    }

    async searchQuestions(keyword) {
        const allQuestions = await this.getAllQuestions();
        const lowerKeyword = keyword.toLowerCase();
        
        return allQuestions.filter(q => {
            const inQuestion = q.question.toLowerCase().includes(lowerKeyword);
            const inAnalysis = (q.analysis || '').toLowerCase().includes(lowerKeyword);
            const inTags = q.tags?.some(t => t.toLowerCase().includes(lowerKeyword));
            const inAnswer = (q.answer || '').toLowerCase().includes(lowerKeyword);
            return inQuestion || inAnalysis || inTags || inAnswer;
        });
    }

    async getWrongQuestions() {
        return this.getQuestionsByFilter({ isWrong: true });
    }

    async updateQuestion(questionId, updates) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const getRequest = objectStore.get(questionId);

            getRequest.onsuccess = () => {
                const question = getRequest.result;
                if (!question) {
                    reject(new Error('Question not found'));
                    return;
                }

                const updatedQuestion = { ...question, ...updates };
                const putRequest = objectStore.put(updatedQuestion);

                putRequest.onsuccess = () => {
                    console.log('Question updated:', questionId);
                    resolve(updatedQuestion);
                };

                putRequest.onerror = () => {
                    reject(putRequest.error);
                };
            };

            getRequest.onerror = () => {
                reject(getRequest.error);
            };
        });
    }

    async markAsMastered(questionId, mastered = true) {
        const updates = {
            isMastered: mastered,
            masteredAt: mastered ? new Date().toISOString() : null
        };
        return this.updateQuestion(questionId, updates);
    }

    async markAsWrong(questionId, isWrong = true) {
        const question = await this.getQuestionById(questionId);
        const updates = {
            isWrong,
            wrongAt: isWrong ? new Date().toISOString() : null,
            wrongCount: isWrong ? (question.wrongCount || 0) + 1 : question.wrongCount
        };
        return this.updateQuestion(questionId, updates);
    }

    async recordAnswer(questionId, isCorrect) {
        const question = await this.getQuestionById(questionId);
        const now = new Date().toISOString();
        const updates = {
            reviewCount: (question.reviewCount || 0) + 1,
            lastReviewedAt: now
        };
        
        if (isCorrect) {
            updates.correctCount = (question.correctCount || 0) + 1;
            updates.lastCorrectAt = now;
            // 如果连续答对多次，自动标记为已掌握
            if ((question.correctCount || 0) + 1 >= 2) {
                updates.isMastered = true;
                updates.masteredAt = now;
            }
        } else {
            updates.isWrong = true;
            updates.wrongCount = (question.wrongCount || 0) + 1;
            updates.wrongAt = now;
        }
        
        return this.updateQuestion(questionId, updates);
    }

    async getQuestionById(questionId) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.get(questionId);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async updateReviewCount(questionId) {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const getRequest = objectStore.get(questionId);

        return new Promise((resolve, reject) => {
            getRequest.onsuccess = () => {
                const question = getRequest.result;
                if (question) {
                    question.reviewCount += 1;
                    question.lastReviewedAt = new Date().toISOString();
                    objectStore.put(question).onsuccess = () => resolve(question);
                } else {
                    reject(new Error('Question not found'));
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async isQuestionExists(questionText) {
        const allQuestions = await this.getAllQuestions();
        return allQuestions.some(q => q.question === questionText);
    }

    async getStatistics() {
        const allQuestions = await this.getAllQuestions();
        const typeStats = {};
        const tagStats = {};
        const categoryStats = {};
        
        allQuestions.forEach(q => {
            // 按题型统计
            typeStats[q.type] = (typeStats[q.type] || 0) + 1;
            
            // 按标签统计
            (q.tags || []).forEach(tag => {
                tagStats[tag] = (tagStats[tag] || 0) + 1;
            });
            
            // 按分类统计
            if (q.category) {
                categoryStats[q.category] = (categoryStats[q.category] || 0) + 1;
            }
        });
        
        return {
            total: allQuestions.length,
            mastered: allQuestions.filter(q => q.isMastered).length,
            notMastered: allQuestions.filter(q => !q.isMastered).length,
            wrong: allQuestions.filter(q => q.isWrong).length,
            byDifficulty: {
                '基础': allQuestions.filter(q => q.difficulty === '基础').length,
                '进阶': allQuestions.filter(q => q.difficulty === '进阶').length,
                '挑战': allQuestions.filter(q => q.difficulty === '挑战').length
            },
            byType: typeStats,
            byTag: tagStats,
            byCategory: categoryStats,
            totalReviews: allQuestions.reduce((sum, q) => sum + (q.reviewCount || 0), 0),
            totalCorrect: allQuestions.reduce((sum, q) => sum + (q.correctCount || 0), 0)
        };
    }

    async getReviewRecommendations(limit = 10) {
        const allQuestions = await this.getAllQuestions();
        
        // 优先推荐：错题 > 未掌握 > 很久没复习的
        const scoredQuestions = allQuestions.map(q => {
            let score = 0;
            if (q.isWrong) score += 100;
            if (!q.isMastered) score += 50;
            if (q.lastReviewedAt) {
                const daysSinceReview = (new Date() - new Date(q.lastReviewedAt)) / (1000 * 60 * 60 * 24);
                score += Math.min(daysSinceReview, 30);
            } else {
                score += 20; // 从未复习的
            }
            return { ...q, _score: score };
        }).sort((a, b) => b._score - a._score);
        
        return scoredQuestions.slice(0, limit);
    }

    async getRandomQuestions(count = 10, filter = {}) {
        let questions = await this.getQuestionsByFilter(filter);
        // 洗牌算法
        for (let i = questions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [questions[i], questions[j]] = [questions[j], questions[i]];
        }
        return questions.slice(0, count);
    }

    async getAllTags() {
        const allQuestions = await this.getAllQuestions();
        const tags = new Set();
        allQuestions.forEach(q => (q.tags || []).forEach(t => tags.add(t)));
        return Array.from(tags);
    }

    async getAllCategories() {
        const allQuestions = await this.getAllQuestions();
        const categories = new Set();
        allQuestions.forEach(q => q.category && categories.add(q.category));
        return Array.from(categories);
    }

    async exportToJSON() {
        const questions = await this.getAllQuestions();
        return JSON.stringify(questions, null, 2);
    }

    async importFromJSON(jsonString) {
        try {
            const questions = JSON.parse(jsonString);
            let imported = 0;
            let skipped = 0;
            
            for (const q of questions) {
                if (!await this.isQuestionExists(q.question)) {
                    await this.addQuestion(q);
                    imported++;
                } else {
                    skipped++;
                }
            }
            
            return { total: questions.length, imported, skipped };
        } catch (e) {
            throw new Error('Invalid JSON format');
        }
    }

    async clearAll() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.clear();

            request.onsuccess = () => {
                console.log('All questions cleared');
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async batchUpdateQuestions(questionIds, updates) {
        const results = [];
        for (const id of questionIds) {
            try {
                const result = await this.updateQuestion(id, updates);
                results.push(result);
            } catch (e) {
                console.error(`Failed to update question ${id}:`, e);
            }
        }
        return results;
    }

    async batchDeleteQuestions(questionIds) {
        for (const id of questionIds) {
            try {
                await this.removeQuestion(id);
            } catch (e) {
                console.error(`Failed to delete question ${id}:`, e);
            }
        }
    }
}

const questionBank = new QuestionBankManager();
