// 1. 初始化粒子背景
particlesJS("particles-js", {
    "particles": {
        "number": { "value": 80, "density": { "enable": true, "value_area": 800 } },
        "color": { "value": "#3b82f6" },
        "shape": { "type": "circle" },
        "opacity": { "value": 0.4, "random": true },
        "size": { "value": 2, "random": true },
        "line_linked": { "enable": true, "distance": 150, "color": "#2563eb", "opacity": 0.2, "width": 1 },
        "move": { "enable": true, "speed": 1.5, "direction": "none", "random": true, "out_mode": "out" }
    },
    "interactivity": {
        "detect_on": "canvas",
        "events": { "onhover": { "enable": true, "mode": "grab" }, "onclick": { "enable": true, "mode": "push" } }
    },
    "retina_detect": true
});

lucide.createIcons();
marked.setOptions({ gfm: true, breaks: true });

// --- 核心配置：请替换为你自己的 Hugging Face 地址 ---
const API_URL = 'https://yuangitlab-mechanical-ai-api.hf.space/api/chat';

// 渲染数学公式的公共函数
function renderMath(element) {
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(element, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false},
                {left: '\\(', right: '\\)', display: false},
                {left: '\\[', right: '\\]', display: true}
            ],
            throwOnError: false
        });
    }
}

async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if (!text) return;

    appendMessage('user', text);
    input.value = '';
    
    const loadingId = appendMessage('bot', `<div class="flex gap-2 items-center"><div class="w-2 h-2 bg-blue-600 rounded-full animate-bounce"></div>教授正在逻辑推演...</div>`);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        
        const data = await response.json();

        // 1. 更新左侧聊天 (支持公式渲染)
        const botMsgEl = document.getElementById(loadingId);
        botMsgEl.innerHTML = marked.parse(data.chat_response || "");
        renderMath(botMsgEl);

        // 2. 更新右侧诊断 (Markdown + LaTeX)
        const diagEl = document.getElementById('diagnosis-content');
        diagEl.innerHTML = marked.parse(data.diagnosis || "未生成诊断数据");
        renderMath(diagEl);
        
        // 自动回到诊断顶部
        document.getElementById('diag-scroll-container').scrollTop = 0;

        // 3. 渲染题库
        if(data.quiz) renderQuiz(data.quiz);
        
        // 4. 渲染计划
        const planEl = document.getElementById('plan-container');
        if(data.study_plan) {
            planEl.innerHTML = marked.parse(data.study_plan);
            renderMath(planEl);
        }

    } catch (error) {
        updateMessage(loadingId, '连接导师失败，请确认后端已正常运行。');
        console.error(error);
    }
}

function renderQuiz(quizzes) {
    const container = document.getElementById('quiz-container');
    container.innerHTML = quizzes.map((q, idx) => `
        <div class="bg-white/5 p-4 rounded-2xl border border-white/5 animate-in">
            <p class="font-bold text-orange-200 mb-3 text-sm">Q${idx+1}: ${q.question}</p>
            <div class="grid grid-cols-1 gap-2">
                ${q.options.map(opt => `
                    <button onclick="checkAnswer(this, '${q.answer}', '${q.analysis.replace(/'/g, "\\'")}')" 
                            class="text-left px-4 py-2 bg-black/30 hover:bg-blue-600/20 rounded-xl transition text-xs border border-white/5 text-slate-300">
                        ${opt}
                    </button>
                `).join('')}
            </div>
        </div>
    `).join('');
    // 题库里的数学公式也要渲染
    renderMath(container);
}

function checkAnswer(btn, correct, analysis) {
    const isCorrect = btn.innerText.trim().startsWith(correct);
    btn.classList.add(isCorrect ? '!bg-green-600/40' : '!bg-red-600/40');
    
    // 如果已经有解析了就不重复添加
    if (btn.parentElement.querySelector('.quiz-feedback')) return;

    const feedback = document.createElement('div');
    feedback.className = 'quiz-feedback mt-3 text-[10px] text-slate-400 border-t border-white/5 pt-2 animate-in';
    feedback.innerHTML = marked.parse(analysis);
    btn.parentElement.appendChild(feedback);
    renderMath(feedback);
}

function appendMessage(role, text) {
    const id = 'msg-' + Date.now();
    const chatContainer = document.getElementById('chat-container');
    const msgClass = role === 'user' ? 'user-msg' : 'bot-msg';
    
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.className = `${msgClass} animate-in`;
    msgDiv.innerText = text; // 用户输入先存纯文本
    
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    lucide.createIcons();
    return id;
}

function updateMessage(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerHTML = text;
}

// 绑定回车键
document.getElementById('user-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});