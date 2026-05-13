// 1. 初始化高级粒子效果
particlesJS("particles-js", {
    "particles": {
        "number": { "value": 100, "density": { "enable": true, "value_area": 800 } },
        "color": { "value": "#3b82f6" },
        "shape": { "type": "circle" },
        "opacity": { "value": 0.5, "random": true, "anim": { "enable": true, "speed": 1, "opacity_min": 0.1, "sync": false } },
        "size": { "value": 2, "random": true },
        "line_linked": { "enable": true, "distance": 150, "color": "#2563eb", "opacity": 0.3, "width": 1 },
        "move": { "enable": true, "speed": 1.2, "direction": "none", "random": true, "out_mode": "out" }
    },
    "interactivity": {
        "detect_on": "canvas",
        "events": { "onhover": { "enable": true, "mode": "grab" }, "onclick": { "enable": true, "mode": "push" } }
    },
    "retina_detect": true
});

// 初始化图标
lucide.createIcons();

// 配置 Markdown 解析器
marked.setOptions({ gfm: true, breaks: true });

// ！！！请替换为你的 Hugging Face 后端地址 ！！！
const API_URL = 'https://yuangitlab-mechanical-ai-api.hf.space/api/chat';

async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if (!text) return;

    appendMessage('user', text);
    input.value = '';
    
    const loadingId = appendMessage('bot', `<div class="flex gap-2 items-center"><div class="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>教授正在思考...</div>`);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        
        const data = await response.json();

        // 1. 左侧回复
        updateMessage(loadingId, data.chat_response);

        // 2. 右侧诊断渲染 (Markdown + LaTeX)
        const diagEl = document.getElementById('diagnosis-content');
        diagEl.innerHTML = marked.parse(data.diagnosis || "未生成诊断数据");
        
        renderMathInElement(diagEl, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            throwOnError: false
        });
        
        // 自动回到诊断卡片顶部
        document.getElementById('diag-scroll-container').scrollTop = 0;

        // 3. 渲染题库
        if(data.quiz) renderQuiz(data.quiz);
        
        // 4. 渲染计划
        if(data.study_plan) {
            document.getElementById('plan-container').innerHTML = marked.parse(data.study_plan);
        }

    } catch (error) {
        updateMessage(loadingId, '网络异常，请检查后端是否开启。');
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
}

function checkAnswer(btn, correct, analysis) {
    const isCorrect = btn.innerText.trim().startsWith(correct);
    btn.classList.add(isCorrect ? '!bg-green-600/40' : '!bg-red-600/40');
    const feedback = document.createElement('div');
    feedback.className = 'mt-3 text-[10px] text-slate-400 border-t border-white/5 pt-2 animate-in';
    feedback.innerText = analysis;
    btn.parentElement.appendChild(feedback);
}

function appendMessage(role, text) {
    const id = 'msg-' + Date.now();
    const chatContainer = document.getElementById('chat-container');
    const msgClass = role === 'user' ? 'user-msg' : 'bot-msg';
    chatContainer.innerHTML += `<div id="${id}" class="${msgClass} animate-in text-sm text-slate-200">${text}</div>`;
    chatContainer.scrollTop = chatContainer.scrollHeight;
    lucide.createIcons();
    return id;
}

function updateMessage(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerHTML = text;
}