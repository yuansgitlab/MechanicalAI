/**
 * Digital Human Module - Live2D + 游走 + TTS语音 + 表情 + 唇形同步
 * 使用 pixi-live2d-display 实现完整编程控制
 */
(function () {
    'use strict';

    // ======================== 配置 ========================
    const CONFIG = {
        // Live2D 模型（Cubism 2 格式，可爱风格）
        // 使用 guansss/pixi-live2d-display 仓库中的测试模型（已验证 CDN 可访问）
        models: [
            {
                name: 'Shizuku',
                label: '萌少女',
                paths: [
                    'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/shizuku/shizuku.model.json',
                ]
            },
        ],
        currentModelIndex: 0,

        // 依赖 CDN（均已验证可访问）
        deps: {
            pixi: 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
            cubism2Core: 'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js',
            pixiLive2D: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display/dist/cubism2.min.js',
        },

        // 显示
        width: 200,
        height: 280,
        mobileScale: 0.65,

        // 游走
        walkSpeed: 35,
        idleDuration: 6000,
        margin: 10,

        // TTS
        ttsLang: 'zh-CN',
        ttsRate: 1.0,
        ttsPitch: 1.3,
        ttsEnabled: true,

        // 提示语
        tips: [
            '有问题随时问我哦~',
            '点击导航栏开始对话！',
            '我懂很多机械工程的知识呢',
            '需要制定学习规划吗？',
            '试试问我"解释PID控制器原理"',
            '可以把好题收藏到题库哦',
            '探索知识，从提问开始~',
        ],
    };

    // ======================== 状态 ========================
    let state = 'loading';
    let pixiApp = null;
    let live2dModel = null;
    let canvasEl = null;
    let position = { x: 10, y: 0 };
    let targetPos = null;
    let lastActionTime = Date.now();
    let isMobile = window.innerWidth < 768;
    let voicesReady = false;
    let mouthTimer = null;
    let tipTimer = null;
    let panelEl = null;
    let audioAnalyser = null;
    let audioContext = null;

    // ======================== 工具函数 ========================
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = resolve;
            s.onerror = () => reject(new Error('加载失败: ' + url));
            document.head.appendChild(s);
        });
    }

    async function loadModelFromSources(paths) {
        for (const path of paths) {
            try {
                const model = await PIXI.live2d.Live2DModel.from(path);
                return model;
            } catch (e) {
                console.warn('[DigitalHuman] 模型源失败:', path, e.message);
            }
        }
        throw new Error('所有模型源均失败');
    }

    // ======================== 加载依赖 ========================
    async function loadDependencies() {
        // 1. PixiJS
        if (typeof PIXI === 'undefined') {
            await loadScript(CONFIG.deps.pixi);
        }
        // 2. Cubism 2 Core
        if (typeof Live2D === 'undefined') {
            await loadScript(CONFIG.deps.cubism2Core);
        }
        // 3. pixi-live2d-display
        if (typeof PIXI.live2d === 'undefined') {
            await loadScript(CONFIG.deps.pixiLive2D);
        }
    }

    // ======================== 初始化 Live2D ========================
    async function initLive2D() {
        try {
            await loadDependencies();
            console.log('[DigitalHuman] 依赖加载完成');

            const scale = isMobile ? CONFIG.mobileScale : 1;
            const w = CONFIG.width * scale;
            const h = CONFIG.height * scale;

            // 创建 Canvas 容器
            canvasEl = document.createElement('canvas');
            canvasEl.id = 'dh-canvas';
            canvasEl.width = w * 2;  // 高清
            canvasEl.height = h * 2;
            canvasEl.style.cssText = `
                position: fixed;
                left: ${position.x}px;
                top: ${position.y}px;
                width: ${w}px;
                height: ${h}px;
                z-index: 9998;
                pointer-events: auto;
                cursor: pointer;
                transition: filter 0.2s;
            `;
            document.body.appendChild(canvasEl);

            // 创建 PixiJS 应用
            pixiApp = new PIXI.Application({
                view: canvasEl,
                transparent: true,
                width: w * 2,
                height: h * 2,
                autoStart: true,
            });

            // 加载模型
            const modelConfig = CONFIG.models[CONFIG.currentModelIndex];
            console.log('[DigitalHuman] 正在加载模型:', modelConfig.label);
            live2dModel = await loadModelFromSources(modelConfig.paths);

            // 调整模型大小和位置
            const modelScale = (h * 2 * 0.9) / live2dModel.internalModel.height;
            live2dModel.scale.set(modelScale);
            live2dModel.anchor.set(0.5, 0.9);
            live2dModel.x = w;  // canvas 中心
            live2dModel.y = h * 2;

            pixiApp.stage.addChild(live2dModel);

            // 点击交互
            live2dModel.on('hit', (hitAreas) => {
                onCharacterClick();
            });

            canvasEl.addEventListener('click', onCharacterClick);
            canvasEl.addEventListener('touchstart', onCharacterClick, { passive: true });

            // 初始位置
            position.x = CONFIG.margin;
            position.y = window.innerHeight - h - CONFIG.margin;
            updatePosition();

            state = 'idle';
            lastActionTime = Date.now();

            startBehaviorLoop();
            startTipLoop();

            // 欢迎动画
            setTimeout(() => {
                showBubble('你好！我是小智，你的AI学习伙伴~', 4000);
                triggerExpression();
            }, 800);

            console.log('[DigitalHuman] 数字人已就绪:', modelConfig.label);

        } catch (e) {
            console.error('[DigitalHuman] Live2D 初始化失败:', e);
            initFallback();
        }
    }

    // ======================== 位置更新 ========================
    function updatePosition() {
        if (!canvasEl) return;
        canvasEl.style.left = position.x + 'px';
        canvasEl.style.top = position.y + 'px';
    }

    // ======================== 行为循环 ========================
    function startBehaviorLoop() {
        function loop() {
            const now = Date.now();

            if (state === 'idle') {
                if (now - lastActionTime > CONFIG.idleDuration) {
                    startWalking();
                }
                // 待机微动：头部轻微摇摆
                if (live2dModel && Math.random() < 0.01) {
                    try {
                        live2dModel.internalModel.coreModel.setParameterValueById('PARAM_BODY_ANGLE_X', (Math.random() - 0.5) * 5);
                        live2dModel.internalModel.coreModel.setParameterValueById('PARAM_BODY_ANGLE_Y', (Math.random() - 0.5) * 3);
                    } catch (e) { /* 静默 */ }
                }
            } else if (state === 'walking' && targetPos) {
                const dx = targetPos.x - position.x;
                const dy = targetPos.y - position.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 5) {
                    state = 'idle';
                    lastActionTime = now;
                    targetPos = null;
                    if (canvasEl) canvasEl.style.transform = 'scaleX(1)';
                } else {
                    const speed = CONFIG.walkSpeed / 60;
                    position.x += (dx / dist) * speed;
                    position.y += (dy / dist) * speed;

                    // 朝向翻转
                    if (canvasEl) {
                        canvasEl.style.transform = dx < 0 ? 'scaleX(-1)' : 'scaleX(1)';
                    }
                    updatePosition();

                    // 行走时身体晃动
                    if (live2dModel) {
                        try {
                            const sway = Math.sin(now / 150) * 8;
                            live2dModel.internalModel.coreModel.setParameterValueById('PARAM_BODY_ANGLE_X', sway);
                            live2dModel.internalModel.coreModel.setParameterValueById('PARAM_BREATH', 1);
                        } catch (e) { /* 静默 */ }
                    }
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

        // 沿屏幕边缘游走
        const edge = Math.floor(Math.random() * 4);
        let tx, ty;

        if (edge === 0 || edge === 3) {
            tx = CONFIG.margin + Math.random() * (window.innerWidth - charW - CONFIG.margin * 2);
            ty = window.innerHeight - charH - CONFIG.margin;
        } else if (edge === 1) {
            tx = CONFIG.margin;
            ty = window.innerHeight * 0.3 + Math.random() * (window.innerHeight * 0.4 - charH);
        } else {
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
            tipTimer = setTimeout(showNextTip, 20000 + Math.random() * 20000);
        }
        tipTimer = setTimeout(showNextTip, 15000);
    }

    // ======================== 点击交互 ========================
    function onCharacterClick(e) {
        if (e) e.stopPropagation();
        if (state === 'talking') {
            stopSpeaking();
            return;
        }

        state = 'idle';
        targetPos = null;
        lastActionTime = Date.now();

        triggerExpression();

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
        if (!live2dModel) return;
        try {
            // 尝试触发随机表情
            if (live2dModel.expression) {
                const expressions = live2dModel.internalModel.settings.expressions;
                if (expressions && expressions.length > 0) {
                    const idx = Math.floor(Math.random() * expressions.length);
                    live2dModel.expression(idx);
                }
            }

            // 触发随机动作
            if (live2dModel.motion) {
                live2dModel.motion('tap_body');
            }
        } catch (e) {
            // 静默
        }

        // CSS 弹跳
        if (canvasEl) {
            const currentTransform = canvasEl.style.transform.replace(/ translateY\(-\d+px\)/, '');
            canvasEl.style.transform = currentTransform + ' translateY(-10px)';
            setTimeout(() => {
                if (canvasEl) {
                    canvasEl.style.transform = canvasEl.style.transform.replace(' translateY(-10px)', '');
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

        const speakText = cleanText.length > 200
            ? cleanText.substring(0, 200) + '...'
            : cleanText;

        const utterance = new SpeechSynthesisUtterance(speakText);
        utterance.lang = CONFIG.ttsLang;
        utterance.rate = CONFIG.ttsRate;
        utterance.pitch = CONFIG.ttsPitch;

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
            if (canvasEl) canvasEl.style.transform = canvasEl.style.transform.replace('scaleX(-1)', 'scaleX(1)');
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

    // ======================== 嘴部动画（唇形同步） ========================
    function startMouthAnimation() {
        if (mouthTimer) clearInterval(mouthTimer);

        mouthTimer = setInterval(() => {
            if (!live2dModel) return;
            try {
                const coreModel = live2dModel.internalModel.coreModel;
                // 模拟说话嘴部动作（随机开合，模拟音节节奏）
                const openAmount = Math.random() * 0.7 + 0.2;
                coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', openAmount);

                // 眼睛偶尔眨眼
                if (Math.random() < 0.1) {
                    coreModel.setParameterValueById('PARAM_EYE_L_OPEN', 0.1);
                    coreModel.setParameterValueById('PARAM_EYE_R_OPEN', 0.1);
                    setTimeout(() => {
                        try {
                            coreModel.setParameterValueById('PARAM_EYE_L_OPEN', 1);
                            coreModel.setParameterValueById('PARAM_EYE_R_OPEN', 1);
                        } catch (e) { /* 静默 */ }
                    }, 100);
                }
            } catch (e) { /* 静默 */ }
        }, 90);
    }

    function stopMouthAnimation() {
        if (mouthTimer) {
            clearInterval(mouthTimer);
            mouthTimer = null;
        }
        if (live2dModel) {
            try {
                live2dModel.internalModel.coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', 0);
            } catch (e) { /* 静默 */ }
        }
    }

    // ======================== 对话气泡 ========================
    function showBubble(text, duration) {
        const old = document.querySelector('.dh-bubble');
        if (old) old.remove();

        const bubble = document.createElement('div');
        bubble.className = 'dh-bubble';
        bubble.textContent = text;
        document.body.appendChild(bubble);

        requestAnimationFrame(() => {
            bubble.style.left = (position.x + 10) + 'px';
            bubble.style.top = (position.y - 50) + 'px';
            bubble.classList.add('dh-bubble-show');
        });

        const dur = duration || 3000;
        setTimeout(() => {
            bubble.classList.remove('dh-bubble-show');
            setTimeout(() => bubble.remove(), 300);
        }, dur);
    }

    // ======================== TTS 控制面板 ========================
    function createControlPanel() {
        panelEl = document.createElement('div');
        panelEl.id = 'dh-panel';
        panelEl.innerHTML = `
            <button id="dh-panel-toggle" class="dh-panel-btn" title="数字人设置">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            </button>
            <div id="dh-panel-menu" class="dh-panel-menu hidden">
                <div class="dh-panel-header">数字人设置</div>
                <button class="dh-panel-item" id="dh-tts-toggle">
                    <span class="dh-item-icon">🔊</span>
                    <span class="dh-item-label">语音朗读</span>
                    <span class="dh-item-status" id="dh-tts-status">已开启</span>
                </button>
                <button class="dh-panel-item" id="dh-test-voice">
                    <span class="dh-item-icon">🎤</span>
                    <span class="dh-item-label">测试语音</span>
                </button>
                <button class="dh-panel-item" id="dh-switch-model">
                    <span class="dh-item-icon">�</span>
                    <span class="dh-item-label">打招呼</span>
                    <span class="dh-item-status" id="dh-model-status">萌少女</span>
                </button>
                <button class="dh-panel-item" id="dh-stop-voice">
                    <span class="dh-item-icon">⏹</span>
                    <span class="dh-item-label">停止说话</span>
                </button>
            </div>
        `;
        document.body.appendChild(panelEl);

        // 样式
        const style = document.createElement('style');
        style.textContent = `
            #dh-panel {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 10000;
            }
            .dh-panel-btn {
                width: 44px; height: 44px;
                border-radius: 50%;
                background: linear-gradient(135deg, #9333ea, #ec4899);
                border: none;
                color: white;
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 4px 12px rgba(147, 51, 234, 0.4);
                transition: transform 0.2s;
            }
            .dh-panel-btn:hover { transform: scale(1.1); }
            .dh-panel-menu {
                position: absolute;
                bottom: 52px;
                right: 0;
                background: rgba(20, 18, 35, 0.97);
                border: 1px solid rgba(147, 51, 234, 0.3);
                border-radius: 12px;
                padding: 8px;
                min-width: 200px;
                backdrop-filter: blur(12px);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                transition: opacity 0.2s, transform 0.2s;
            }
            .dh-panel-menu.hidden {
                opacity: 0;
                transform: translateY(10px);
                pointer-events: none;
            }
            .dh-panel-header {
                font-size: 12px;
                color: #9ca3af;
                padding: 6px 12px;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                margin-bottom: 4px;
            }
            .dh-panel-item {
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
                padding: 10px 12px;
                background: transparent;
                border: none;
                color: #e5e7eb;
                font-size: 13px;
                cursor: pointer;
                border-radius: 8px;
                transition: background 0.15s;
            }
            .dh-panel-item:hover { background: rgba(147, 51, 234, 0.15); }
            .dh-item-icon { font-size: 16px; }
            .dh-item-label { flex: 1; text-align: left; }
            .dh-item-status { font-size: 11px; color: #a78bfa; }
            @media (max-width: 480px) {
                .dh-panel-menu { min-width: 180px; }
            }
        `;
        document.head.appendChild(style);

        // 事件
        const toggle = document.getElementById('dh-panel-toggle');
        const menu = document.getElementById('dh-panel-menu');
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!panelEl.contains(e.target)) menu.classList.add('hidden');
        });

        // TTS 开关
        document.getElementById('dh-tts-toggle').addEventListener('click', () => {
            CONFIG.ttsEnabled = !CONFIG.ttsEnabled;
            const status = document.getElementById('dh-tts-status');
            status.textContent = CONFIG.ttsEnabled ? '已开启' : '已关闭';
            status.style.color = CONFIG.ttsEnabled ? '#a78bfa' : '#6b7280';
            if (!CONFIG.ttsEnabled) stopSpeaking();
            showBubble(CONFIG.ttsEnabled ? '语音已开启~' : '语音已关闭', 1500);
        });

        // 测试语音
        document.getElementById('dh-test-voice').addEventListener('click', () => {
            speak('你好！我是小智，很高兴认识你！有什么可以帮你的吗？');
        });

        // 打招呼（触发表情+动作）
        document.getElementById('dh-switch-model').addEventListener('click', () => {
            triggerExpression();
            const greetings = ['嗨！你好呀~', '今天也要加油学习哦！', '有什么想聊的吗？'];
            showBubble(greetings[Math.floor(Math.random() * greetings.length)], 2500);
        });

        // 停止说话
        document.getElementById('dh-stop-voice').addEventListener('click', () => {
            stopSpeaking();
            showBubble('已停止说话', 1500);
        });
    }

    // ======================== 切换模型 ========================
    async function switchModel() {
        CONFIG.currentModelIndex = (CONFIG.currentModelIndex + 1) % CONFIG.models.length;
        const modelConfig = CONFIG.models[CONFIG.currentModelIndex];
        showBubble('切换为 ' + modelConfig.label + ' ~', 2000);

        // 更新面板状态
        const statusEl = document.getElementById('dh-model-status');
        if (statusEl) statusEl.textContent = modelConfig.label;

        if (!pixiApp) return;

        // 移除旧模型
        if (live2dModel) {
            pixiApp.stage.removeChild(live2dModel);
            live2dModel.destroy({ children: true, texture: true, baseTexture: true });
            live2dModel = null;
        }

        // 加载新模型
        try {
            live2dModel = await loadModelFromSources(modelConfig.paths);
            const scale = isMobile ? CONFIG.mobileScale : 1;
            const h = CONFIG.height * scale;
            const w = CONFIG.width * scale;
            const modelScale = (h * 2 * 0.9) / live2dModel.internalModel.height;
            live2dModel.scale.set(modelScale);
            live2dModel.anchor.set(0.5, 0.9);
            live2dModel.x = w;
            live2dModel.y = h * 2;
            pixiApp.stage.addChild(live2dModel);

            live2dModel.on('hit', () => onCharacterClick());
            triggerExpression();
        } catch (e) {
            console.error('[DigitalHuman] 切换模型失败:', e);
            showBubble('切换失败，保持当前形象', 2000);
        }
    }

    // ======================== 聊天集成 ========================
    function setupChatIntegration() {
        const chatContainer = document.getElementById('chat-container') ||
            document.getElementById('chat-messages') ||
            document.getElementById('messages') ||
            document.querySelector('.chat-messages');

        if (!chatContainer) return;

        let lastSpokenText = '';

        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;

                    const aiMsg = node.matches?.('.bot-msg, .ai-message, .assistant, .bot-message')
                        ? node
                        : node.querySelector?.('.bot-msg, .ai-message, .assistant, .bot-message');

                    if (aiMsg) {
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

    // ======================== 降级模式 ========================
    function initFallback() {
        canvasEl = document.createElement('div');
        canvasEl.id = 'dh-fallback';
        canvasEl.style.cssText = `
            position: fixed;
            width: 64px; height: 64px;
            font-size: 52px;
            display: flex; align-items: center; justify-content: center;
            z-index: 9998;
            cursor: pointer;
            user-select: none;
            transition: transform 0.2s;
        `;
        canvasEl.textContent = '🐱';
        document.body.appendChild(canvasEl);

        position.x = CONFIG.margin;
        position.y = window.innerHeight - 80 - CONFIG.margin;
        canvasEl.style.left = position.x + 'px';
        canvasEl.style.top = position.y + 'px';

        canvasEl.addEventListener('click', onCharacterClick);

        state = 'idle';
        lastActionTime = Date.now();
        startBehaviorLoop();
        startTipLoop();

        setTimeout(() => showBubble('你好！我是小智~（Live2D加载失败，使用emoji模式）', 3000), 500);
    }

    // ======================== 窗口大小变化 ========================
    window.addEventListener('resize', function () {
        isMobile = window.innerWidth < 768;
        const scale = isMobile ? CONFIG.mobileScale : 1;
        const charH = CONFIG.height * scale;

        if (position.y + charH > window.innerHeight) {
            position.y = window.innerHeight - charH - CONFIG.margin;
            updatePosition();
        }
        if (position.x + CONFIG.width * scale > window.innerWidth) {
            position.x = window.innerWidth - CONFIG.width * scale - CONFIG.margin;
            updatePosition();
        }
    });

    // ======================== 页面可见性 ========================
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
        setTtsEnabled: function (enabled) {
            CONFIG.ttsEnabled = enabled;
            const status = document.getElementById('dh-tts-status');
            if (status) {
                status.textContent = enabled ? '已开启' : '已关闭';
                status.style.color = enabled ? '#a78bfa' : '#6b7280';
            }
        },
        getState: function () { return state; },
        getPosition: function () { return { ...position }; },
    };

    // ======================== 初始化 ========================
    function init() {
        console.log('[DigitalHuman] 初始化中...');
        createControlPanel();
        initLive2D();
        setTimeout(setupChatIntegration, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
