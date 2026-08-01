/**
 * Digital Human Module - Live2D 看板娘 + 游走 + TTS语音 + 表情
 * 用于 MechanicalAI 全站数字人陪伴功能
 */
(function () {
    'use strict';

    // ======================== 配置 ========================
    const CONFIG = {
        // Live2D 模型列表（可爱风格，均含表情动画）
        models: [
            { name: 'Hijiki', path: 'https://cdn.jsdelivr.net/gh/fghrsh/live2d_api/model/Hijiki/Hijiki.model.json', label: '小黑猫' },
            { name: 'Shizuku', path: 'https://cdn.jsdelivr.net/gh/fghrsh/live2d_api/model/Shizuku/Shizuku.model.json', label: '萌少女' },
            { name: 'Pio', path: 'https://cdn.jsdelivr.net/gh/fghrsh/live2d_api/model/Pio/model.json', label: '小白猫' },
        ],
        currentModelIndex: 0,

        // SDK
        cubismSdkUrl: 'https://cdn.jsdelivr.net/gh/stevenjoezhang/live2d-widget/lib/live2d.min.js',
        widgetUrl: 'https://cdn.jsdelivr.net/gh/stevenjoezhang/live2d-widget/lib/L2Dwidget.min.js',

        // 显示
        width: 180,
        height: 260,
        mobileScale: 0.6,

        // 游走
        walkSpeed: 30,          // px/秒
        idleDuration: 5000,     // 闲置多久后开始走
        margin: 10,

        // TTS
        ttsLang: 'zh-CN',
        ttsRate: 1.0,
        ttsPitch: 1.3,          // 偏高音 = 可爱
        ttsEnabled: true,

        // 提示语
        tips: [
            '有问题随时问我哦~',
            '点击开始对话，让我帮你学习！',
            '我懂很多机械工程的知识呢',
            '需要制定学习规划吗？',
            '试试问我"解释PID控制器原理"',
            '可以把好题收藏到题库哦',
            '探索知识，从提问开始~',
        ],
    };

    // ======================== 状态 ========================
    let state = 'loading';       // loading, idle, walking, talking
    let widgetEl = null;         // Live2D canvas 容器
    let position = { x: 10, y: 0 };
    let targetPos = null;
    let lastActionTime = Date.now();
    let isMobile = window.innerWidth < 768;
    let voicesReady = false;
    let mouthTimer = null;
    let tipTimer = null;

    // ======================== 加载 Live2D ========================
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = resolve;
            s.onerror = () => reject(new Error('Failed: ' + url));
            document.head.appendChild(s);
        });
    }

    async function loadLive2D() {
        try {
            // 1. 加载 Cubism SDK
            if (typeof Live2D === 'undefined') {
                await loadScript(CONFIG.cubismSdkUrl);
            }
            // 2. 加载 L2Dwidget
            if (typeof L2Dwidget === 'undefined') {
                await loadScript(CONFIG.widgetUrl);
            }
            // 3. 初始化模型
            initWidget();
        } catch (e) {
            console.error('[DigitalHuman] Live2D 加载失败，启用降级模式:', e);
            initFallback();
        }
    }

    function initWidget() {
        const model = CONFIG.models[CONFIG.currentModelIndex];
        const scale = isMobile ? CONFIG.mobileScale : 1;

        L2Dwidget.init({
            model: { jsonPath: model.path, scale: 1 },
            display: {
                position: 'left',
                width: CONFIG.width * scale,
                height: CONFIG.height * scale,
                hOffset: 0,
                vOffset: 0,
            },
            mobile: { show: true, scale: 0.5 },
            react: { opacity: 1 },
        });

        // 等待渲染后接管控制
        setTimeout(takeControl, 1500);
    }

    // ======================== 接管 DOM 控制权 ========================
    function takeControl() {
        widgetEl = document.getElementById('live2d-widget') ||
            document.querySelector('.live2d-widget') ||
            findWidgetCanvas();

        if (!widgetEl) {
            console.warn('[DigitalHuman] 未找到 widget 元素，重试中...');
            setTimeout(takeControl, 1000);
            return;
        }

        // 覆盖默认样式，改为可自由定位
        const scale = isMobile ? CONFIG.mobileScale : 1;
        widgetEl.style.cssText = `
            position: fixed !important;
            left: ${position.x}px !important;
            top: ${position.y}px !important;
            right: auto !important;
            bottom: auto !important;
            z-index: 9998 !important;
            pointer-events: auto !important;
            transition: transform 0.2s ease !important;
            cursor: pointer !important;
            width: ${CONFIG.width * scale}px !important;
            height: ${CONFIG.height * scale}px !important;
        `;

        // 初始位置：左下角
        position.x = CONFIG.margin;
        position.y = window.innerHeight - CONFIG.height * (isMobile ? CONFIG.mobileScale : 1) - CONFIG.margin;
        updatePosition();

        // 点击交互
        widgetEl.addEventListener('click', onCharacterClick);
        widgetEl.addEventListener('touchstart', onCharacterClick, { passive: true });

        state = 'idle';
        lastActionTime = Date.now();

        // 启动行为循环
        startBehaviorLoop();

        // 启动提示循环
        startTipLoop();

        // 欢迎语
        setTimeout(() => {
            showBubble('你好！我是小智，你的AI学习伙伴~', 4000);
        }, 500);

        console.log('[DigitalHuman] 数字人已就绪');
    }

    function findWidgetCanvas() {
        const canvases = document.querySelectorAll('canvas');
        for (const c of canvases) {
            if (c.parentElement && (c.parentElement.id.includes('live2d') ||
                c.parentElement.className.includes('live2d'))) {
                return c.parentElement;
            }
        }
        // 最后回退：取最后一个 canvas
        if (canvases.length > 0) {
            const parent = canvases[canvases.length - 1].parentElement;
            parent.id = 'live2d-widget';
            return parent;
        }
        return null;
    }

    function updatePosition() {
        if (!widgetEl) return;
        widgetEl.style.left = position.x + 'px';
        widgetEl.style.top = position.y + 'px';
    }

    // ======================== 行为循环（游走 + 闲置） ========================
    function startBehaviorLoop() {
        function loop() {
            const now = Date.now();

            if (state === 'idle') {
                if (now - lastActionTime > CONFIG.idleDuration) {
                    startWalking();
                }
            } else if (state === 'walking' && targetPos) {
                const dx = targetPos.x - position.x;
                const dy = targetPos.y - position.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 5) {
                    state = 'idle';
                    lastActionTime = now;
                    targetPos = null;
                    if (widgetEl) widgetEl.style.transform = 'scaleX(1)';
                } else {
                    const speed = CONFIG.walkSpeed / 60;
                    position.x += (dx / dist) * speed;
                    position.y += (dy / dist) * speed;

                    // 朝向翻转
                    if (widgetEl) {
                        widgetEl.style.transform = dx < 0 ? 'scaleX(-1)' : 'scaleX(1)';
                    }
                    updatePosition();
                }
            }

            requestAnimationFrame(loop);
        }
        loop();
    }

    function startWalking() {
        state = 'walking';
        const scale = isMobile ? CONFIG.mobileScale : 1;
        const charW = CONFIG.width * scale;
        const charH = CONFIG.height * scale;

        // 沿屏幕边缘游走，避免遮挡中心内容
        const edge = Math.floor(Math.random() * 4); // 0=底 1=左 2=右 3=底
        let tx, ty;

        if (edge === 0 || edge === 3) {
            // 底部
            tx = CONFIG.margin + Math.random() * (window.innerWidth - charW - CONFIG.margin * 2);
            ty = window.innerHeight - charH - CONFIG.margin;
        } else if (edge === 1) {
            // 左侧
            tx = CONFIG.margin;
            ty = window.innerHeight * 0.3 + Math.random() * (window.innerHeight * 0.4 - charH);
        } else {
            // 右侧
            tx = window.innerWidth - charW - CONFIG.margin;
            ty = window.innerHeight * 0.3 + Math.random() * (window.innerHeight * 0.4 - charH);
        }

        targetPos = { x: tx, y: ty };
    }

    // ======================== 提示循环 ========================
    function startTipLoop() {
        function showNextTip() {
            if (state === 'idle' || state === 'walking') {
                const tip = CONFIG.tips[Math.floor(Math.random() * CONFIG.tips.length)];
                showBubble(tip, 3500);
            }
            // 随机间隔 20-40 秒
            tipTimer = setTimeout(showNextTip, 20000 + Math.random() * 20000);
        }
        tipTimer = setTimeout(showNextTip, 15000);
    }

    // ======================== 点击交互 ========================
    function onCharacterClick(e) {
        if (e) e.stopPropagation();
        if (state === 'talking') {
            // 说话时点击 = 停止说话
            stopSpeaking();
            return;
        }

        state = 'idle';
        targetPos = null;
        lastActionTime = Date.now();

        // 随机表情/动作
        triggerExpression();

        // 随机问候
        const greetings = [
            '嗨！想聊点什么？',
            '有什么我可以帮你的吗？',
            '点上方导航开始对话吧~',
            '我可是懂很多机械知识的小助手哦！',
            '需要制定学习规划吗？',
        ];
        showBubble(greetings[Math.floor(Math.random() * greetings.length)], 3000);
    }

    // ======================== 表情/动作 ========================
    function triggerExpression(name) {
        try {
            // 尝试通过 L2Dwidget 内部模型触发动作
            const main = L2Dwidget?.main;
            if (main && main.model) {
                const model = main.model;
                if (name && model.startRandomMotion) {
                    model.startRandomMotion(name);
                } else if (model.startRandomMotion) {
                    model.startRandomMotion('tap_body');
                }
            }
        } catch (e) {
            // 静默失败，表情是锦上添花
        }

        // CSS 弹跳效果（作为表情视觉反馈）
        if (widgetEl) {
            widgetEl.style.transform = (widgetEl.style.transform || '') + ' translateY(-8px)';
            setTimeout(() => {
                if (widgetEl) {
                    widgetEl.style.transform = widgetEl.style.transform.replace(' translateY(-8px)', '');
                }
            }, 200);
        }
    }

    // ======================== TTS 语音合成 ========================
    function loadVoices() {
        if (!window.speechSynthesis) return;
        const voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
            voicesReady = true;
        }
    }

    if (window.speechSynthesis) {
        loadVoices();
        speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    function speak(text) {
        if (!CONFIG.ttsEnabled || !window.speechSynthesis) return;

        // 取消正在进行的语音
        speechSynthesis.cancel();
        stopMouthAnimation();

        // 清理 Markdown
        const cleanText = text
            .replace(/```[\s\S]*?```/g, '（代码省略）')
            .replace(/\|[-\s|]+\|/g, '')
            .replace(/[#*`_~>\[\]]/g, '')
            .replace(/!\[.*?\]\(.*?\)/g, '')
            .replace(/\[.*?\]\(.*?\)/g, '')
            .replace(/\n{2,}/g, '。')
            .replace(/\n/g, ' ')
            .trim();

        if (!cleanText || cleanText.length < 2) return;

        // 限制长度（避免太长的语音）
        const speakText = cleanText.length > 200
            ? cleanText.substring(0, 200) + '...'
            : cleanText;

        const utterance = new SpeechSynthesisUtterance(speakText);
        utterance.lang = CONFIG.ttsLang;
        utterance.rate = CONFIG.ttsRate;
        utterance.pitch = CONFIG.ttsPitch;

        // 选择中文语音
        if (voicesReady) {
            const voices = speechSynthesis.getVoices();
            const zhVoice = voices.find(v => v.lang.startsWith('zh') && v.name.includes('Female')) ||
                voices.find(v => v.lang.startsWith('zh')) ||
                voices.find(v => v.lang.startsWith('cmn'));
            if (zhVoice) utterance.voice = zhVoice;
        }

        utterance.onstart = function () {
            state = 'talking';
            targetPos = null;
            if (widgetEl) widgetEl.style.transform = 'scaleX(1)';
            showBubble(speakText.length > 80 ? speakText.substring(0, 80) + '...' : speakText, speakText.length * 120);
            startMouthAnimation();
        };

        utterance.onend = function () {
            state = 'idle';
            lastActionTime = Date.now();
            stopMouthAnimation();
        };

        utterance.onerror = function () {
            state = 'idle';
            lastActionTime = Date.now();
            stopMouthAnimation();
        };

        speechSynthesis.speak(utterance);
    }

    function stopSpeaking() {
        if (window.speechSynthesis) speechSynthesis.cancel();
        stopMouthAnimation();
        state = 'idle';
        lastActionTime = Date.now();
    }

    // ======================== 嘴部动画（模拟说话） ========================
    function startMouthAnimation() {
        if (mouthTimer) clearInterval(mouthTimer);

        mouthTimer = setInterval(() => {
            try {
                // 尝试驱动 Live2D 模型嘴部参数
                const main = L2Dwidget?.main;
                if (main && main.model) {
                    const model = main.model;
                    const openAmount = Math.random() * 0.8 + 0.1;
                    // Cubism 2 参数名
                    if (model.setParameterValueById) {
                        model.setParameterValueById('PARAM_MOUTH_OPEN_Y', openAmount);
                    }
                }
            } catch (e) { /* 静默 */ }

            // CSS 弹跳效果（视觉说话反馈）
            if (widgetEl) {
                const bounce = Math.random() * 4 - 2;
                widgetEl.style.filter = `brightness(${1 + bounce * 0.05})`;
            }
        }, 80);
    }

    function stopMouthAnimation() {
        if (mouthTimer) {
            clearInterval(mouthTimer);
            mouthTimer = null;
        }
        try {
            const main = L2Dwidget?.main;
            if (main && main.model && main.model.setParameterValueById) {
                main.model.setParameterValueById('PARAM_MOUTH_OPEN_Y', 0);
            }
        } catch (e) { /* 静默 */ }
        if (widgetEl) widgetEl.style.filter = '';
    }

    // ======================== 对话气泡 ========================
    function showBubble(text, duration) {
        // 移除旧气泡
        const old = document.querySelector('.dh-bubble');
        if (old) old.remove();

        const bubble = document.createElement('div');
        bubble.className = 'dh-bubble';
        bubble.textContent = text;
        document.body.appendChild(bubble);

        // 定位（在角色上方）
        const scale = isMobile ? CONFIG.mobileScale : 1;
        requestAnimationFrame(() => {
            bubble.style.left = (position.x + 10) + 'px';
            bubble.style.top = (position.y - 50) + 'px';
            bubble.classList.add('dh-bubble-show');
        });

        // 自动消失
        const dur = duration || 3000;
        setTimeout(() => {
            bubble.classList.remove('dh-bubble-show');
            setTimeout(() => bubble.remove(), 300);
        }, dur);
    }

    // ======================== 切换模型 ========================
    function switchModel() {
        CONFIG.currentModelIndex = (CONFIG.currentModelIndex + 1) % CONFIG.models.length;
        const model = CONFIG.models[CONFIG.currentModelIndex];
        showBubble('切换为 ' + model.label + ' ~', 2000);

        // 重新初始化
        if (typeof L2Dwidget !== 'undefined') {
            try {
                L2Dwidget.init({
                    model: { jsonPath: model.path, scale: 1 },
                    display: {
                        position: 'left',
                        width: CONFIG.width * (isMobile ? CONFIG.mobileScale : 1),
                        height: CONFIG.height * (isMobile ? CONFIG.mobileScale : 1),
                    },
                    mobile: { show: true, scale: 0.5 },
                    react: { opacity: 1 },
                });
            } catch (e) {
                console.error('[DigitalHuman] 切换模型失败:', e);
            }
        }
    }

    // ======================== 聊天集成 ========================
    function setupChatIntegration() {
        // 监听聊天消息容器
        const chatContainer = document.getElementById('chat-container') ||
            document.getElementById('chat-messages') ||
            document.getElementById('messages') ||
            document.querySelector('.chat-messages');

        if (!chatContainer) return;

        let lastSpokenText = ''; // 避免重复朗读

        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;

                    // 检测 AI 回复消息（匹配 chat.html 的 .bot-msg 类）
                    const aiMsg = node.matches?.('.bot-msg, .ai-message, .assistant, .bot-message')
                        ? node
                        : node.querySelector?.('.bot-msg, .ai-message, .assistant, .bot-message');

                    if (aiMsg) {
                        // 延迟提取文本（等待 markdown 渲染完成）
                        setTimeout(() => {
                            const text = aiMsg.textContent?.trim();
                            if (text && text.length > 2 && text !== lastSpokenText) {
                                lastSpokenText = text;
                                speak(text);
                            }
                        }, 800);
                    }
                });
            });
        });

        observer.observe(chatContainer, { childList: true, subtree: true });
        console.log('[DigitalHuman] 聊天集成已启动');
    }

    // ======================== 降级模式（Live2D 加载失败时） ========================
    function initFallback() {
        widgetEl = document.createElement('div');
        widgetEl.id = 'dh-fallback';
        widgetEl.style.cssText = `
            position: fixed;
            width: 60px; height: 60px;
            font-size: 48px;
            display: flex; align-items: center; justify-content: center;
            z-index: 9998;
            cursor: pointer;
            user-select: none;
            transition: transform 0.2s;
        `;
        widgetEl.textContent = '🐱';
        document.body.appendChild(widgetEl);

        position.x = CONFIG.margin;
        position.y = window.innerHeight - 80 - CONFIG.margin;
        updatePosition();
        widgetEl.style.left = position.x + 'px';
        widgetEl.style.top = position.y + 'px';

        widgetEl.addEventListener('click', onCharacterClick);

        state = 'idle';
        lastActionTime = Date.now();
        startBehaviorLoop();
        startTipLoop();

        setTimeout(() => showBubble('你好！我是小智~', 3000), 500);
    }

    // ======================== 窗口大小变化 ========================
    window.addEventListener('resize', function () {
        isMobile = window.innerWidth < 768;
        const scale = isMobile ? CONFIG.mobileScale : 1;
        const charH = CONFIG.height * scale;

        // 确保角色不会超出屏幕
        if (position.y + charH > window.innerHeight) {
            position.y = window.innerHeight - charH - CONFIG.margin;
            updatePosition();
            if (widgetEl && widgetEl.id === 'dh-fallback') {
                widgetEl.style.top = position.y + 'px';
            }
        }
        if (position.x + CONFIG.width * scale > window.innerWidth) {
            position.x = window.innerWidth - CONFIG.width * scale - CONFIG.margin;
            updatePosition();
            if (widgetEl && widgetEl.id === 'dh-fallback') {
                widgetEl.style.left = position.x + 'px';
            }
        }
    });

    // ======================== 页面可见性（节省性能） ========================
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            if (window.speechSynthesis) speechSynthesis.cancel();
            stopMouthAnimation();
            state = 'idle';
            targetPos = null;
        }
    });

    // ======================== 公共 API ========================
    window.DigitalHuman = {
        speak: speak,
        showBubble: showBubble,
        stopSpeaking: stopSpeaking,
        switchModel: switchModel,
        triggerExpression: triggerExpression,
        setTtsEnabled: function (enabled) { CONFIG.ttsEnabled = enabled; },
        getState: function () { return state; },
        getPosition: function () { return { ...position }; },
    };

    // ======================== 初始化 ========================
    function init() {
        console.log('[DigitalHuman] 初始化中...');
        loadLive2D();

        // 延迟集成聊天（等待页面加载完成）
        setTimeout(setupChatIntegration, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
