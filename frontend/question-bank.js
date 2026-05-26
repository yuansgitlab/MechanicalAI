/**
 * 题库存储管理器 - Question Bank Manager
 * 使用 IndexedDB 存储用户收藏的题目
 */

class QuestionBankManager {
    constructor() {
        this.dbName = 'MechanicalAI_QuestionBank';
        this.dbVersion = 1;
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
                    
                    console.log('Question bank object store created');
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
                options: question.options,
                answer: question.answer,
                analysis: question.analysis,
                difficulty: question.difficulty || '基础',
                subject: question.subject || '',
                category: question.category || '',
                collectedAt: new Date().toISOString(),
                isMastered: false,
                masteredAt: null,
                notes: '',
                reviewCount: 0,
                lastReviewedAt: null
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
            if (filter.isMastered === true && q.isMastered !== true) return false;
            if (filter.isMastered === false && q.isMastered === true) return false;
            return true;
        });
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
        
        return {
            total: allQuestions.length,
            mastered: allQuestions.filter(q => q.isMastered).length,
            notMastered: allQuestions.filter(q => !q.isMastered).length,
            byDifficulty: {
                '基础': allQuestions.filter(q => q.difficulty === '基础').length,
                '进阶': allQuestions.filter(q => q.difficulty === '进阶').length,
                '挑战': allQuestions.filter(q => q.difficulty === '挑战').length
            },
            byCategory: {}
        };
    }

    async exportToJSON() {
        const questions = await this.getAllQuestions();
        return JSON.stringify(questions, null, 2);
    }

    async importFromJSON(jsonString) {
        try {
            const questions = JSON.parse(jsonString);
            let imported = 0;
            
            for (const q of questions) {
                if (!await this.isQuestionExists(q.question)) {
                    await this.addQuestion(q);
                    imported++;
                }
            }
            
            return { total: questions.length, imported };
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
}

const questionBank = new QuestionBankManager();
