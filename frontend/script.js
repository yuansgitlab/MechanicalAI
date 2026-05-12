// 初始化粒子背景
particlesJS("particles-js", {
    "particles": {
        "number": { "value": 80, "density": { "enable": true, "value_area": 800 } },
        "color": { "value": "#3b82f6" }, // 蓝色粒子
        "shape": { "type": "circle" },
        "opacity": { "value": 0.5, "random": false },
        "size": { "value": 2, "random": true },
        "line_linked": { "enable": true, "distance": 150, "color": "#1e3a8a", "opacity": 0.4, "width": 1 },
        "move": { "enable": true, "speed": 2, "direction": "none", "random": false, "straight": false, "out_mode": "out", "bounce": false }
    },
    "interactivity": {
        "detect_on": "canvas",
        "events": { "onhover": { "enable": true, "mode": "grab" }, "onclick": { "enable": true, "mode": "push" } }
    },
    "retina_detect": true
});

// 发送消息的基础逻辑
async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    if (!text) return;

    // 1. 显示用户消息
    appendMessage('user', text);
    input.value = '';

    // 2. 显示“正在思考”状态
    const loadingId = appendMessage('bot', '教授正在查阅教案...');

    try {
        const response = await fetch('你的后端API地址/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        
        const data = await response.json();

        // 3. 更新左侧对话
        updateMessage(loadingId, data.chat_response);

        // 4. 更新右侧卡片 - 知识诊断
        if(data.diagnosis) {
            document.getElementById('diagnosis-content').innerHTML = data.diagnosis;
            document.getElementById('diagnosis-content').parentElement.classList.add('fade-in');
        }

        // 5. 更新右侧卡片 - 题库
        if(data.quiz && data.quiz.length > 0) {
            renderQuiz(data.quiz);
        }
        
    } catch (error) {
        updateMessage(loadingId, '网络连接异常，教授去开会了。');
    }
}

function renderQuiz(quizzes) {
    const container = document.getElementById('quiz-container');
    container.innerHTML = quizzes.map((q, idx) => `
        <div class="bg-gray-800 p-4 rounded-lg border border-gray-700">
            <p class="font-bold text-blue-300">Q${idx+1}: ${q.question}</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                ${q.options.map(opt => `<button class="text-left p-2 bg-black/40 hover:bg-blue-900/40 rounded transition text-xs">${opt}</button>`).join('')}
            </div>
        </div>
    `).join('');
}

function appendMessage(role, text) {
    const id = 'msg-' + Date.now();
    const chatContainer = document.getElementById('chat-container');
    const align = role === 'user' ? 'ml-auto text-right bg-blue-600/20 border-blue-500/30' : 'mr-auto bg-gray-800/80 border-gray-700';
    chatContainer.innerHTML += `<div id="${id}" class="${align} p-3 rounded-lg max-w-[90%] border fade-in">${text}</div>`;
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return id;
}

function updateMessage(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerText = text;
}