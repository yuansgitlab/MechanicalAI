// 1. 初始化粒子和图标
particlesJS.load('particles-js', 'https://cdn.jsdelivr.net/gh/VincentGarreau/particles.js@master/demo/js/config.json');
lucide.createIcons();

// 2. 配置 Marked.js 选项
marked.setOptions({
    gfm: true,
    breaks: true
});

async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if (!text) return;

    appendMessage('user', text);
    input.value = '';
    
    const loadingId = appendMessage('bot', `<div class="flex gap-2 items-center"><div class="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>解析中...</div>`);

    try {
        // 等待部署后端后，将此处替换为 HuggingFace 地址
        const response = await fetch('https://yuangitlab-mechanical-ai-api.hf.space/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        
        const data = await response.json();

        // 更新左侧聊天 (Markdown 处理)
        updateMessage(loadingId, data.chat_response);

        // 更新右侧诊断内容 (Markdown + KaTeX)
        const diagEl = document.getElementById('diagnosis-content');
        diagEl.innerHTML = marked.parse(data.diagnosis || "暂无深度诊断数据");
        
        // 核心：强制触发 LaTeX 渲染
        renderMathInElement(diagEl, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            throwOnError: false
        });

        // 更新题库
        if(data.quiz) renderQuiz(data.quiz);
        
        // 更新计划
        if(data.study_plan) {
            document.getElementById('plan-container').innerHTML = marked.parse(data.study_plan);
        }

    } catch (error) {
        console.error(error);
        updateMessage(loadingId, '连接超时。教授可能在实验室做实验，请稍后再试。');
    }
}

function renderQuiz(quizzes) {
    const container = document.getElementById('quiz-container');
    container.innerHTML = quizzes.map((q, idx) => `
        <div class="bg-white/5 p-4 rounded-2xl border border-white/5 hover:border-orange-500/30 transition-all">
            <p class="font-bold text-orange-200 mb-3 text-sm">Q${idx+1}: ${q.question}</p>
            <div class="grid grid-cols-1 gap-2">
                ${q.options.map(opt => `
                    <button onclick="checkAnswer(this, '${q.answer}', '${q.analysis.replace(/'/g, "\\'")}')" 
                            class="text-left px-4 py-2 bg-black/30 hover:bg-blue-600/20 rounded-xl transition text-xs border border-white/5">
                        ${opt}
                    </button>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function checkAnswer(btn, correct, analysis) {
    const isCorrect = btn.innerText.startsWith(correct);
    btn.classList.add(isCorrect ? '!bg-green-600/40' : '!bg-red-600/40');
    btn.parentElement.innerHTML += `<div class="mt-3 text-[10px] text-slate-400 border-t border-white/5 pt-2 animate-in">${analysis}</div>`;
}

function appendMessage(role, text) {
    const id = 'msg-' + Date.now();
    const chatContainer = document.getElementById('chat-container');
    const msgClass = role === 'user' ? 'user-msg' : 'bot-msg';
    chatContainer.innerHTML += `<div id="${id}" class="${msgClass} animate-in">${text}</div>`;
    chatContainer.scrollTop = chatContainer.scrollHeight;
    lucide.createIcons();
    return id;
}

function updateMessage(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerHTML = text;
}