/**
 * Chat功能扩展 - 添加收藏题目和保存规划表功能
 */

// 保存题目数据供收藏使用
let currentQuizData = [];

// 初始化收藏功能
function initCollectionFeatures() {
    // 添加收藏按钮到每个题目卡片
    setupCollectionButtons();
}

// 设置收藏按钮
function setupCollectionButtons() {
    const quizContainer = document.getElementById('quiz-container');
    if (!quizContainer) return;

    // 使用MutationObserver监听DOM变化
    const observer = new MutationObserver(() => {
        addBookmarkButtons();
    });

    observer.observe(quizContainer, { childList: true, subtree: true });
    addBookmarkButtons();
}

// 添加书签按钮到题目
function addBookmarkButtons() {
    const quizCards = document.querySelectorAll('#quiz-container > div');
    quizCards.forEach((card, index) => {
        if (card.querySelector('.bookmark-btn')) return;

        const header = card.querySelector('.flex.items-center.justify-between');
        if (header) {
            const btn = document.createElement('button');
            btn.className = 'bookmark-btn text-slate-400 hover:text-purple-400 transition p-1';
            btn.innerHTML = '<i data-lucide="bookmark-plus" class="w-4 h-4"></i>';
            btn.title = '收藏到题库';
            btn.onclick = () => collectQuestion(index);
            header.appendChild(btn);
        }
    });
    lucide.createIcons();
}

// 收藏题目
async function collectQuestion(index) {
    if (!currentQuizData || !currentQuizData[index]) {
        showCollectionToast('题目数据不可用', 'error');
        return;
    }

    const q = currentQuizData[index];
    try {
        await questionBank.init();
        const exists = await questionBank.isQuestionExists(q.question);
        if (exists) {
            showCollectionToast('这道题已经在题库中了', 'info');
            return;
        }

        await questionBank.addQuestion(q);
        showCollectionToast('已收藏到个人题库！', 'success');
    } catch (e) {
        console.error('Failed to collect question:', e);
        showCollectionToast('收藏失败', 'error');
    }
}

// 显示toast消息
function showCollectionToast(message, type = 'info') {
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-blue-600'
    };

    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-in`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// 保存规划表
async function saveStudyPlan(planTitle, planContent) {
    try {
        await studyPlans.init();
        
        // 尝试解析规划表内容
        const phases = parseStudyPlan(planContent);
        
        const plan = await studyPlans.savePlan({
            title: planTitle,
            phases: phases
        });

        showCollectionToast('学习规划已保存到个人规划表！', 'success');
        return plan;
    } catch (e) {
        console.error('Failed to save study plan:', e);
        showCollectionToast('保存规划表失败', 'error');
        return null;
    }
}

// 解析学习规划表内容
function parseStudyPlan(content) {
    const phases = [];
    
    const tableRegex = /[|].*?[|]/g;
    const tables = content.match(tableRegex) || [];
    
    let currentPhase = null;
    
    tables.forEach((table, idx) => {
        const rows = table.split('\n').filter(row => row.includes('|'));
        if (rows.length < 2) return;
        
        rows.forEach((row, rowIdx) => {
            if (rowIdx === 0) return;
            
            const trimmedRow = row.trim();
            if (trimmedRow.match(/^\|[-\s]+\|$/)) return;
            
            if (trimmedRow.startsWith('|') && trimmedRow.endsWith('|')) {
                const parts = trimmedRow.slice(1, -1).split('|');
                const cells = parts.map(cell => cell.trim()).filter(cell => cell.length > 0);
                if (cells.length >= 2 && !cells[0].match(/^[-]+$/)) {
                    const phaseName = cells[0] || `阶段 ${phases.length + 1}`;
                    const taskText = cells[1] || '';
                    
                    if (!currentPhase || currentPhase.name !== phaseName) {
                        if (currentPhase) phases.push(currentPhase);
                        currentPhase = {
                            id: `phase-${phases.length}`,
                            name: phaseName,
                            tasks: []
                        };
                    }
                    
                    currentPhase.tasks.push({
                        id: `task-${phases.length}-${currentPhase.tasks.length}`,
                        text: taskText,
                        completed: false,
                        completedAt: null,
                        notes: '',
                        duration: cells[3] || cells[2] || '',
                        priority: 'medium'
                    });
                }
            }
        });
    });
    
    if (currentPhase) phases.push(currentPhase);
    
    if (phases.length === 0) {
        phases.push({
            id: 'phase-0',
            name: '学习规划',
            tasks: [{
                id: 'task-0-0',
                text: content.substring(0, 200),
                completed: false,
                completedAt: null,
                notes: '',
                duration: '',
                priority: 'medium'
            }]
        });
    }
    
    return phases;
}

// 在页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initCollectionFeatures, 1000);
});
