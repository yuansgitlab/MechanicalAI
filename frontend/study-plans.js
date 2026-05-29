/**
 * 学习规划存储管理器 - Study Plans Manager
 * 使用 IndexedDB 存储用户的学习规划表历史
 */

class StudyPlansManager {
    constructor() {
        this.dbName = 'MechanicalAI_StudyPlans';
        this.dbVersion = 1;
        this.db = null;
        this.storeName = 'plans';
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Failed to open study plans database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('Study plans database opened successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, { 
                        keyPath: 'id',
                        autoIncrement: false
                    });
                    
                    objectStore.createIndex('title', 'title', { unique: false });
                    objectStore.createIndex('createdAt', 'createdAt', { unique: false });
                    objectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    objectStore.createIndex('subject', 'subject', { unique: false });
                    
                    console.log('Study plans object store created');
                }
            };
        });
    }

    async savePlan(planData) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const plan = {
                id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
                title: planData.title || '学习规划表',
                subject: planData.subject || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                phases: this.processPhases(planData.phases),
                totalTasks: this.countTasks(planData.phases),
                completedTasks: 0,
                progress: 0
            };

            const request = objectStore.add(plan);

            request.onsuccess = () => {
                console.log('Study plan saved:', plan.id);
                resolve(plan);
            };

            request.onerror = () => {
                console.error('Failed to save plan:', request.error);
                reject(request.error);
            };
        });
    }

    processPhases(phases) {
        if (!phases) return [];
        
        return phases.map((phase, phaseIndex) => ({
            id: phase.id || `phase-${phaseIndex}`,
            name: phase.name || phase.阶段 || phase.title || `阶段 ${phaseIndex + 1}`,
            tasks: (phase.tasks || phase.任务 || []).map((task, taskIndex) => ({
                id: task.id || `task-${phaseIndex}-${taskIndex}`,
                text: task.text || task.内容 || task.task || task.description || '',
                completed: false,
                completedAt: null,
                notes: task.notes || '',
                duration: task.duration || task.时长 || task.time || '',
                priority: task.priority || 'medium'
            }))
        }));
    }

    countTasks(phases) {
        if (!phases) return 0;
        return phases.reduce((total, phase) => {
            const tasks = phase.tasks || phase.任务 || [];
            return total + tasks.length;
        }, 0);
    }

    async updatePlan(planId, updates) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const getRequest = objectStore.get(planId);

            getRequest.onsuccess = () => {
                const plan = getRequest.result;
                if (!plan) {
                    reject(new Error('Plan not found'));
                    return;
                }

                const updatedPlan = { 
                    ...plan, 
                    ...updates, 
                    updatedAt: new Date().toISOString() 
                };
                
                const putRequest = objectStore.put(updatedPlan);

                putRequest.onsuccess = () => {
                    console.log('Plan updated:', planId);
                    resolve(updatedPlan);
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

    async getAllPlans() {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = () => {
                const plans = request.result.sort((a, b) => 
                    new Date(b.createdAt) - new Date(a.createdAt)
                );
                resolve(plans);
            };

            request.onerror = () => {
                console.error('Failed to get plans:', request.error);
                reject(request.error);
            };
        });
    }

    async getPlan(planId) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.get(planId);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async deletePlan(planId) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database not initialized'));
                return;
            }

            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.delete(planId);

            request.onsuccess = () => {
                console.log('Plan deleted:', planId);
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async toggleTaskCompletion(planId, phaseId, taskId) {
        const plan = await this.getPlan(planId);
        if (!plan) {
            throw new Error('Plan not found');
        }

        const phase = plan.phases.find(p => p.id === phaseId);
        if (!phase) {
            throw new Error('Phase not found');
        }

        const task = phase.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }

        task.completed = !task.completed;
        task.completedAt = task.completed ? new Date().toISOString() : null;

        // 重新计算进度
        const completedCount = plan.phases.reduce((total, p) => {
            return total + p.tasks.filter(t => t.completed).length;
        }, 0);

        plan.completedTasks = completedCount;
        plan.progress = plan.totalTasks > 0 
            ? Math.round((completedCount / plan.totalTasks) * 100) 
            : 0;
        plan.updatedAt = new Date().toISOString();

        // 保存所有更新
        return this.updatePlan(planId, plan);
    }

    async updateTask(planId, phaseId, taskId, updates) {
        const plan = await this.getPlan(planId);
        if (!plan) {
            throw new Error('Plan not found');
        }

        const phase = plan.phases.find(p => p.id === phaseId);
        if (!phase) {
            throw new Error('Phase not found');
        }

        const task = phase.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }

        Object.assign(task, updates);
        plan.updatedAt = new Date().toISOString();

        return this.updatePlan(planId, plan);
    }

    async addTask(planId, phaseId, taskText) {
        const plan = await this.getPlan(planId);
        if (!plan) {
            throw new Error('Plan not found');
        }

        const phase = plan.phases.find(p => p.id === phaseId);
        if (!phase) {
            throw new Error('Phase not found');
        }

        const newTask = {
            id: `task-${Date.now()}`,
            text: taskText,
            completed: false,
            completedAt: null,
            notes: '',
            duration: '',
            priority: 'medium'
        };

        phase.tasks.push(newTask);
        plan.totalTasks += 1;
        plan.updatedAt = new Date().toISOString();

        return this.updatePlan(planId, plan);
    }

    async removeTask(planId, phaseId, taskId) {
        const plan = await this.getPlan(planId);
        if (!plan) {
            throw new Error('Plan not found');
        }

        const phase = plan.phases.find(p => p.id === phaseId);
        if (!phase) {
            throw new Error('Phase not found');
        }

        const taskIndex = phase.tasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) {
            throw new Error('Task not found');
        }

        const wasCompleted = phase.tasks[taskIndex].completed;
        phase.tasks.splice(taskIndex, 1);
        
        plan.totalTasks = Math.max(0, plan.totalTasks - 1);
        if (wasCompleted) {
            plan.completedTasks = Math.max(0, plan.completedTasks - 1);
        }
        plan.progress = plan.totalTasks > 0 
            ? Math.round((plan.completedTasks / plan.totalTasks) * 100) 
            : 0;
        plan.updatedAt = new Date().toISOString();

        return this.updatePlan(planId, plan);
    }

    async addPhase(planId, phaseName) {
        const plan = await this.getPlan(planId);
        if (!plan) {
            throw new Error('Plan not found');
        }

        const newPhase = {
            id: `phase-${Date.now()}`,
            name: phaseName,
            tasks: []
        };

        plan.phases.push(newPhase);
        plan.updatedAt = new Date().toISOString();

        return this.updatePlan(planId, plan);
    }

    async getStatistics() {
        const plans = await this.getAllPlans();
        
        const totalTasks = plans.reduce((sum, p) => sum + p.totalTasks, 0);
        const completedTasks = plans.reduce((sum, p) => sum + p.completedTasks, 0);
        const totalProgress = totalTasks > 0 
            ? Math.round((completedTasks / totalTasks) * 100) 
            : 0;

        return {
            totalPlans: plans.length,
            totalTasks,
            completedTasks,
            remainingTasks: totalTasks - completedTasks,
            overallProgress: totalProgress,
            recentPlans: plans.slice(0, 5)
        };
    }

    async exportToJSON() {
        const plans = await this.getAllPlans();
        return JSON.stringify(plans, null, 2);
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
                console.log('All plans cleared');
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }
}

const studyPlans = new StudyPlansManager();
