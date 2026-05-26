/**
 * 聊天界面记忆功能增强 - 集成AI记忆系统
 */

// 保存对聊天历史的增强
class ChatMemoryIntegration {
    constructor() {
        this.currentSessionId = null;
        this.messageCount = 0;
        this.isInitialized = false;
    }

    async init(sessionId) {
        if (this.isInitialized) return;
        
        this.currentSessionId = sessionId;
        
        try {
            await ltm.init();
            this.isInitialized = true;
            console.log('记忆系统初始化成功');
        } catch (e) {
            console.error('记忆系统初始化失败:', e);
        }
    }

    // 处理新消息时进行记忆
    async processNewMessage(message, role, sessionId) {
        this.currentSessionId = sessionId;
        this.messageCount++;
        
        // 提取并存储知识
        if (role === 'assistant') {
            await ltm.extractAndStoreKnowledge(message, { sessionId });
        }

        // 学习用户行为
        await ltm.learnFromMessages([{ role, content: message }]);

        // 定期生成摘要（每5条消息）
        if (this.messageCount % 5 === 0) {
            // 获取会话消息并生成摘要
        }
    }

    // 构建上下文
    async buildContext(currentMessages, sessionId) {
        return await ltm.buildContextForConversation(currentMessages, sessionId);
    }

    // 保存对话摘要
    async saveSummary(messages, sessionId) {
        if (messages.length >= 3) {
            await ltm.generateSummary(sessionId, messages);
        }
    }

    // 添加书签
    async addBookmark(messageId, messageData) {
        await ltm.bookmarkMessage(messageId, messageData);
    }
}

// 全局实例
const chatMemory = new ChatMemoryIntegration();

// 快速工具函数
function showToast(message, type = 'info') {
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-purple-600'
    };
    
    const toast = document.createElement('div');
    toast.className = `fixed top-4 right-4 px-6 py-3 rounded-lg z-50 shadow-lg animate-in ${colors[type]} text-white`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 3000);
}

// 为消息添加书签按钮
function addBookmarkButtons(container) {
    const messages = container.querySelectorAll('.assistant');
    messages.forEach((msg, index) => {
        if (msg.querySelector('.bookmark-btn')) return;
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'bookmark-btn text-xs text-slate-400';
        
        const btn = document.createElement('button');
        btn.className = 'flex items-center gap-1 hover:text-purple-400 transition';
        btn.innerHTML = '<i data-lucide="bookmark-plus" class="w-4 h-4"></i> 保存';
        btn.onclick = () => saveCurrentMessageBookmark(msg, index);
        
        actionsDiv.appendChild(btn);
        
        if (msg.querySelector('.text-slate-400')) {
            msg.querySelector('.text-slate-400').appendChild(actionsDiv);
        } else {
            const contentDiv = msg.querySelector('.flex-1');
            if (contentDiv) contentDiv.appendChild(actionsDiv);
        }
    });
    lucide.createIcons();
}

async function saveCurrentMessageBookmark(msgElement, index) {
    const content = msgElement.textContent;
    const messageData = {
        content,
        role: 'assistant',
        timestamp: new Date().toISOString()
    };
    
    try {
        await ltm.bookmarkMessage(`msg-${Date.now()}`, messageData);
        showToast('已保存到书签!', 'success');
    } catch (e) {
        console.error('保存书签失败:', e);
        showToast('保存失败', 'error');
    }
}

// 修改发送消息的上下文处理
async function enhanceSendMessage(originalSendFn, sessionId) {
    return async function(...args) {
        const result = await originalSendFn.apply(this, args);
        
        try {
            // 处理用户消息后处理
            chatMemory.processNewMessage(args[0], 'user', sessionId);
        } catch (e) {
            console.error('记忆处理失败:', e);
        }
        
        return result;
    };
}

// 增强接收消息
async function enhanceReceiveMessage(message, sessionId) {
    try {
        await chatMemory.processNewMessage(message, 'assistant', sessionId);
        await ltm.extractAndStoreKnowledge(message, { sessionId });
    } catch (e) {
        console.error('知识提取失败:', e);
    }
}

// 保存会话结束时
async function saveSessionEndSummary(messages, sessionId) {
    try {
        await ltm.generateSummary(sessionId, messages);
        showToast('会话摘要已保存', 'success');
    } catch (e) {
        console.error('保存摘要失败:', e);
    }
}
