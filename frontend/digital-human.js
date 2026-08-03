/**
 * Digital Human Module
 * TTS 双引擎: Web Speech API + QwenTTS（自定义音色/克隆）
 * 加载优化: 首屏emoji占位 + preconnect + 进度气泡 + 平滑淡入
 * 聊天集成: clone节点去控件 + 文本稳定debounce + characterData观察
 */
(function () {
    'use strict';

    // ========== 配置 ==========
    const CONFIG = {
        models: [{
            name: 'Shizuku',
            label: '萌少女',
            paths: [
                'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/shizuku/shizuku.model.json',
            ],
        }],
        currentModelIndex: 0,

        deps: {
            pixi: 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
            cubism2Core: 'https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js',
            pixiLive2D: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display/dist/cubism2.min.js',
        },

        width: 200,
        height: 280,
        mobileScale: 0.65,

        walkSpeed: 35,
        idleDuration: 6000,
        margin: 10,

        ttsLang: 'zh-CN',
        ttsRate: 1.0,
        ttsPitch: 1.3,
        ttsEnabled: true,

        qwenTts: {
            configUrl: 'assets/tts-config.json',
            fallbackUrl: 'http://127.0.0.1:8766',
            defaultSpeaker: '默认女声',
            enabled: false,
            serverUrl: null,
            speaker: null,
            lastAbort: null,
        },

        // 用户手动设置的公网 TTS 地址（从 localStorage 读取，内网穿透用）
        manualTtsUrl: (function () {
            try { return localStorage.getItem('dh_manual_tts_url') || ''; } catch (e) { return ''; }
        })(),

        tips: [
            '有问题随时问我哦~',
            '点击导航栏开始对话！',
            '需要制定学习规划吗？',
            '试试问我"解释PID控制器原理"',
            '可以把好题收藏到题库哦',
            '探索知识，从提问开始~',
        ],

        // ============ 引导巡航：目标元素 + 话术 + 到达后动作 ============
        cruiseStops: [
            {
                name: '开始对话',
                // CSS 选择器顺序（优先找 chat 页面的，再找首页的）
                selectors: [
                    '#start-chat-btn',
                    'a[href="chat.html"]',
                    'button:has-text("开始对话")',
                ],
                // 停靠位置 offset（相对元素）：'bottom-left' | 'bottom-right' | 'top-right' | 'top-left'
                dock: 'bottom-left',
                lines: [
                    '嗨嗨～点点这里，开始使用吧！',
                    '点这个按钮，就可以和我说话啦～',
                ],
                // 到达后的动作：wave(挥手) | point(指) | jump(跳) | bow(鞠躬)
                gesture: 'point',
                // 停留后是否自动点下一个
                autoNext: true,
            },
            {
                name: '学习规划',
                selectors: [
                    'a[href="study-plans.html"]',
                    'a:has-text("学习规划")',
                ],
                dock: 'top-right',
                lines: [
                    '我还会帮你制定专属学习计划哦～',
                    '不知道怎么学？点这里看看吧！',
                ],
                gesture: 'wave',
                autoNext: true,
            },
            {
                name: '个人题库',
                selectors: [
                    'a[href="question-bank.html"]',
                    'a:has-text("个人题库")',
                ],
                dock: 'top-right',
                lines: [
                    '做错的、经典的题目都可以存到这里～',
                    '随时拿出来复习，期末不慌！',
                ],
                gesture: 'point',
                autoNext: true,
            },
            {
                name: '讨论区',
                selectors: [
                    'a[href="discuss.html"]',
                    'a:has-text("讨论")',
                ],
                dock: 'top-right',
                lines: [
                    '有问题也可以发到讨论区和大家交流～',
                    '点这里看大家都在讨论什么！',
                ],
                gesture: 'wave',
                autoNext: false,   // 最后一站不自动下一个
            },
        ],

        ttsBlacklist: [
            /AI正在思考/,
            /AI思考中/,
            /思考中/,
            /正在加载/,
            /加载中/,
            /^.*loading\.\.\..*$/i,
            /正在生成/,
            /连接中/,
        ],
    };

    // ========== 状态 ==========
    let state = 'loading';
    let pixiApp = null;
    let live2dModel = null;
    let canvasEl = null;
    let fallbackEl = null;
    let position = { x: 10, y: 0 };
    let targetPos = null;
    let lastActionTime = Date.now();
    let isMobile = window.innerWidth < 768;
    let voicesReady = false;
    let mouthTimer = null;
    let tipTimer = null;
    let panelEl = null;

    const textStableTimers = new Map();
    const spokenSignatures = new Set();

    // ========== CDN 预连接 ==========
    (function preconnectCDNs() {
        const hosts = ['https://cdn.jsdelivr.net'];
        hosts.forEach(function (h) {
            if (!document.querySelector('link[rel="preconnect"][href="' + h + '"]')) {
                const l = document.createElement('link');
                l.rel = 'preconnect';
                l.href = h;
                l.crossOrigin = 'anonymous';
                document.head.appendChild(l);
            }
        });
        const pf = document.createElement('link');
        pf.rel = 'dns-prefetch';
        pf.href = '//cdn.jsdelivr.net';
        document.head.appendChild(pf);
    })();

    // ========== 工具 ==========
    function loadScript(url) {
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('加载失败: ' + url)); };
            document.head.appendChild(s);
        });
    }

    async function loadModelFromSources(paths) {
        for (let i = 0; i < paths.length; i++) {
            try {
                const m = await PIXI.live2d.Live2DModel.from(paths[i]);
                return m;
            } catch (e) {
                console.warn('[DigitalHuman] 模型源失败:', paths[i], e && e.message);
            }
        }
        throw new Error('所有模型源均失败');
    }

    function textSignature(text) {
        if (!text) return 'x';
        return text.length + '|' + text.slice(0, 20) + '|' + text.slice(-20);
    }

    // ========== 首屏：emoji 占位 ==========
    function showEmojiPlaceholder() {
        fallbackEl = document.createElement('div');
        fallbackEl.id = 'dh-fallback';
        const sc = isMobile ? CONFIG.mobileScale : 1;
        fallbackEl.style.cssText =
            'position:fixed;' +
            'width:' + Math.round(64 * sc) + 'px;' +
            'height:' + Math.round(64 * sc) + 'px;' +
            'font-size:' + Math.round(52 * sc) + 'px;' +
            'display:flex;align-items:center;justify-content:center;' +
            'z-index:9998;cursor:pointer;user-select:none;' +
            'transition:transform .2s,opacity .3s;';
        fallbackEl.textContent = '🐱';
        document.body.appendChild(fallbackEl);

        position.x = CONFIG.margin;
        position.y = window.innerHeight - Math.round(64 * sc) - CONFIG.margin - 20;
        fallbackEl.style.left = position.x + 'px';
        fallbackEl.style.top = position.y + 'px';

        fallbackEl.addEventListener('click', onCharacterClick);

        setTimeout(function () {
            showBubbleOnEl(fallbackEl, '角色加载中...稍等一下下~', 4500);
        }, 200);
    }

    function swapFallbackToLive2D() {
        if (fallbackEl) {
            fallbackEl.style.opacity = '0';
            setTimeout(function () { if (fallbackEl) { fallbackEl.remove(); fallbackEl = null; } }, 300);
        }
    }

    // ========== 依赖加载 ==========
    async function loadDependencies() {
        const t0 = performance.now();
        if (typeof PIXI === 'undefined') await loadScript(CONFIG.deps.pixi);
        if (typeof Live2D === 'undefined') await loadScript(CONFIG.deps.cubism2Core);
        if (typeof PIXI === 'undefined' || typeof PIXI.live2d === 'undefined') await loadScript(CONFIG.deps.pixiLive2D);
        console.log('[DigitalHuman] 依赖加载完成，耗时', Math.round(performance.now() - t0), 'ms');
    }

    // ========== Live2D 初始化 ==========
    async function initLive2D() {
        try {
            const t0 = performance.now();
            await loadDependencies();
            showBubbleOnEl(fallbackEl || canvasEl, '形象加载中... 90%', 2500);

            const sc = isMobile ? CONFIG.mobileScale : 1;
            const w = CONFIG.width * sc;
            const h = CONFIG.height * sc;

            canvasEl = document.createElement('canvas');
            canvasEl.id = 'dh-canvas';
            canvasEl.width = w * 2;
            canvasEl.height = h * 2;
            canvasEl.style.cssText =
                'position:fixed;' +
                'left:' + position.x + 'px;' +
                'top:' + (window.innerHeight - h - CONFIG.margin) + 'px;' +
                'width:' + w + 'px;height:' + h + 'px;' +
                'z-index:9998;pointer-events:auto;cursor:pointer;' +
                'opacity:0;transition:opacity .5s ease;';
            document.body.appendChild(canvasEl);

            pixiApp = new PIXI.Application({
                view: canvasEl,
                transparent: true,
                width: w * 2,
                height: h * 2,
                autoStart: true,
            });

            position.x = CONFIG.margin;
            position.y = window.innerHeight - h - CONFIG.margin;
            updatePosition();

            const mc = CONFIG.models[CONFIG.currentModelIndex];
            console.log('[DigitalHuman] 正在加载模型:', mc.label);
            live2dModel = await loadModelFromSources(mc.paths);

            const ms = (h * 2 * 0.9) / live2dModel.internalModel.height;
            live2dModel.scale.set(ms);
            live2dModel.anchor.set(0.5, 0.9);
            live2dModel.x = w;
            live2dModel.y = h * 2;
            pixiApp.stage.addChild(live2dModel);

            live2dModel.on('hit', function () { onCharacterClick(); });
            canvasEl.addEventListener('click', onCharacterClick);
            canvasEl.addEventListener('touchstart', onCharacterClick, { passive: true });

            requestAnimationFrame(function () {
                if (canvasEl) canvasEl.style.opacity = '1';
                swapFallbackToLive2D();
            });

            state = 'idle';
            lastActionTime = Date.now();
            startBehaviorLoop();
            startTipLoop();

            setTimeout(function () {
                showBubble('你好！我是小智，你的AI学习伙伴~', 4000);
                triggerExpression();
            }, 600);

            // 模型就绪 3.5s 后开始引导巡航
            startCruise(3500);

            console.log('[DigitalHuman] 数字人已就绪，总耗时', Math.round(performance.now() - t0), 'ms');
        } catch (e) {
            console.error('[DigitalHuman] Live2D 初始化失败:', e);
            if (fallbackEl) showBubbleOnEl(fallbackEl, 'Live2D加载失败啦，emoji模式也能陪你~', 4000);
            initFallbackBehavior();
        }
    }

    function updatePosition() {
        const el = canvasEl || fallbackEl;
        if (!el) return;
        el.style.left = position.x + 'px';
        el.style.top = position.y + 'px';
    }

    // ========== 行为循环 ==========
    function startBehaviorLoop() {
        (function loop() {
            const now = Date.now();
            if (state === 'idle') {
                if (now - lastActionTime > CONFIG.idleDuration) startWalking();
                if (live2dModel && Math.random() < 0.01) {
                    try {
                        const cm = live2dModel.internalModel.coreModel;
                        cm.setParameterValueById('PARAM_BODY_ANGLE_X', (Math.random() - 0.5) * 5);
                        cm.setParameterValueById('PARAM_BODY_ANGLE_Y', (Math.random() - 0.5) * 3);
                    } catch (e) { /* */ }
                }
            } else if ((state === 'walking' || state === 'cruise_walk') && targetPos) {
                // cruise_walk 和 walking 用同一套移动逻辑
                const dx = targetPos.x - position.x;
                const dy = targetPos.y - position.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 5) {
                    if (state === 'walking') {
                        state = 'idle';
                        lastActionTime = now;
                        targetPos = null;
                        if (canvasEl) canvasEl.style.transform = 'scaleX(1)';
                    }
                    // cruise_walk 不在这里改 state，由 runCruiseStop 的 setInterval 负责后续
                } else {
                    const sp = CONFIG.walkSpeed / 60;
                    position.x += (dx / dist) * sp;
                    position.y += (dy / dist) * sp;
                    const el = canvasEl || fallbackEl;
                    if (el && state === 'walking') {
                        el.style.transform = dx < 0 ? 'scaleX(-1)' : 'scaleX(1)';
                    }
                    // cruise_walk 的朝向由 runCruiseStop 单独控制，这里不动 transform
                    updatePosition();
                    if (live2dModel) {
                        try {
                            const sway = Math.sin(now / 150) * 8;
                            const cm = live2dModel.internalModel.coreModel;
                            cm.setParameterValueById('PARAM_BODY_ANGLE_X', sway);
                            cm.setParameterValueById('PARAM_BREATH', 1);
                        } catch (e) { /* */ }
                    }
                }
            }
            // cruise_talk 状态：原地等待，不做移动，由 runCruiseStop 的 setTimeout 控制后续
            requestAnimationFrame(loop);
        })();
    }

    function startWalking() {
        state = 'walking';
        const sc = isMobile ? CONFIG.mobileScale : 1;
        const cw = CONFIG.width * sc;
        const ch = CONFIG.height * sc;
        const edge = Math.floor(Math.random() * 4);
        let tx, ty;
        if (edge === 0 || edge === 3) {
            tx = CONFIG.margin + Math.random() * Math.max(0, window.innerWidth - cw - CONFIG.margin * 2);
            ty = window.innerHeight - ch - CONFIG.margin;
        } else if (edge === 1) {
            tx = CONFIG.margin;
            ty = window.innerHeight * 0.3 + Math.random() * Math.max(0, window.innerHeight * 0.4 - ch);
        } else {
            tx = window.innerWidth - cw - CONFIG.margin;
            ty = window.innerHeight * 0.3 + Math.random() * Math.max(0, window.innerHeight * 0.4 - ch);
        }
        targetPos = { x: tx, y: ty };
    }

    // ============ 引导巡航逻辑 ============
    let cruiseState = {
        active: false,
        currentStopIdx: -1,
        targetEl: null,
        highlightedEl: null,
        waitingForIdle: false,
    };

    // 找元素：支持 :has-text(xxx) 伪类的简易实现
    function findCruiseEl(selectors) {
        for (let i = 0; i < selectors.length; i++) {
            let sel = selectors[i];
            // 支持 :has-text("xxx") 简写
            const m = sel.match(/^([\s\S]*?):has-text\("?([^"]+)"?\)$/);
            try {
                if (m) {
                    const baseSel = m[1] || '*';
                    const txt = m[2].trim();
                    const nodes = document.querySelectorAll(baseSel);
                    for (let j = 0; j < nodes.length; j++) {
                        if ((nodes[j].textContent || '').indexOf(txt) >= 0) {
                            const r = nodes[j].getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) return nodes[j];
                        }
                    }
                } else {
                    const el = document.querySelector(sel);
                    if (el) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) return el;
                    }
                }
            } catch (e) { /* bad selector, skip */ }
        }
        return null;
    }

    // 根据 dock 位置 + 元素 rect，计算角色应该站的 (x, y)
    function calcDockPosition(el, dock) {
        const sc = isMobile ? CONFIG.mobileScale : 1;
        const cw = CONFIG.width * sc;
        const ch = CONFIG.height * sc;
        const r = el.getBoundingClientRect();
        // 元素在视口中的绝对坐标
        const ex = r.left + window.scrollX;
        const ey = r.top + window.scrollY;
        const ew = r.width;
        const eh = r.height;
        const pad = 12;
        let tx, ty;
        switch (dock) {
            case 'bottom-left':
                tx = ex - cw - pad;
                ty = ey + eh - ch;
                break;
            case 'bottom-right':
                tx = ex + ew + pad;
                ty = ey + eh - ch;
                break;
            case 'top-right':
                tx = ex + ew + pad;
                ty = ey - ch - pad;
                break;
            case 'top-left':
            default:
                tx = ex - cw - pad;
                ty = ey - ch - pad;
                break;
        }
        // 夹在可视区域内
        tx = Math.max(CONFIG.margin, Math.min(tx, window.innerWidth - cw - CONFIG.margin));
        ty = Math.max(CONFIG.margin, Math.min(ty, window.innerHeight - ch - CONFIG.margin));
        return { x: tx, y: ty };
    }

    // 高亮目标元素（阴影 + 脉冲动画，不侵入页面）
    function highlightTarget(el, on) {
        if (!el) return;
        const key = '__dh_hl_orig';
        if (on) {
            if (cruiseState.highlightedEl && cruiseState.highlightedEl !== el) {
                highlightTarget(cruiseState.highlightedEl, false);
            }
            if (!el[key]) {
                el[key] = el.style.cssText;
            }
            el.style.cssText = (el[key] || '') +
                'box-shadow:0 0 0 3px #f472b6,0 0 20px 4px rgba(244,114,182,0.5)!important;' +
                'border-radius:inherit!important;transition:box-shadow .3s!important;';
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            } catch (e) { /* */ }
            cruiseState.highlightedEl = el;
        } else {
            if (el[key]) {
                el.style.cssText = el[key];
                delete el[key];
            }
            if (cruiseState.highlightedEl === el) {
                cruiseState.highlightedEl = null;
            }
        }
    }

    // 角色 gesture：用 Live2D 参数做一个"指向"或"挥手"的动作
    function doGesture(gestureName) {
        if (!live2dModel) return;
        try {
            const cm = live2dModel.internalModel.coreModel;
            const t0 = performance.now();
            const duration = 1800;
            let raf;
            const tick = function () {
                const t = performance.now() - t0;
                if (t > duration) {
                    // 复位
                    try {
                        cm.setParameterValueById('PARAM_ANGLE_X', 0);
                        cm.setParameterValueById('PARAM_ANGLE_Y', 0);
                        cm.setParameterValueById('PARAM_BODY_ANGLE_X', 0);
                        cm.setParameterValueById('PARAM_ARM_L_ANGLE', 0);
                        cm.setParameterValueById('PARAM_ARM_R_ANGLE', 0);
                        cm.setParameterValueById('PARAM_HAND_OPEN_L', 1);
                        cm.setParameterValueById('PARAM_HAND_OPEN_R', 1);
                    } catch (e) { /* */ }
                    return;
                }
                const p = Math.min(1, t / duration);
                try {
                    if (gestureName === 'point') {
                        // 指向：右胳膊抬起，身体稍微前倾
                        const swing = Math.sin(t / 120) * 5;
                        cm.setParameterValueById('PARAM_ARM_R_ANGLE', -80 + swing);   // 抬右臂
                        cm.setParameterValueById('PARAM_ANGLE_Y', -12);               // 抬头
                        cm.setParameterValueById('PARAM_BODY_ANGLE_X', 4);            // 身体前倾
                        cm.setParameterValueById('PARAM_HAND_OPEN_R', 0.3);           // 手指(合拢=指)
                    } else if (gestureName === 'wave') {
                        // 挥手：胳膊大幅摆动
                        const swing = Math.sin(t / 160) * 30;
                        cm.setParameterValueById('PARAM_ARM_R_ANGLE', -60 + swing);
                        cm.setParameterValueById('PARAM_BODY_ANGLE_X', swing * 0.2);
                        cm.setParameterValueById('PARAM_ANGLE_X', swing * 0.15);
                        cm.setParameterValueById('PARAM_HAND_OPEN_R', 1);
                    } else if (gestureName === 'jump') {
                        // 跳动：用 canvas 容器 translateY（Live2D 参数里没有 jump）
                        const el = canvasEl || fallbackEl;
                        if (el) {
                            const up = Math.sin(p * Math.PI) * 16;
                            el.style.transform = (el.__dh_flip || '') +
                                ' translateY(-' + up + 'px)';
                        }
                    } else if (gestureName === 'bow') {
                        // 鞠躬：身体大幅前倾 + 低头
                        const bend = Math.sin(p * Math.PI) * 18;
                        cm.setParameterValueById('PARAM_BODY_ANGLE_X', bend);
                        cm.setParameterValueById('PARAM_ANGLE_Y', bend * 0.7);
                    }
                } catch (e) { /* 有些模型没这些参数，忽略 */ }
                raf = requestAnimationFrame(tick);
            };
            tick();
        } catch (e) { /* */ }
    }

    // 开始某一站的巡航
    function runCruiseStop(idx) {
        const stops = CONFIG.cruiseStops;
        if (idx < 0 || idx >= stops.length) {
            endCruise();
            return;
        }
        cruiseState.currentStopIdx = idx;
        const stop = stops[idx];
        const el = findCruiseEl(stop.selectors);
        if (!el) {
            // 当前页面没这个元素（比如在 about.html 找不到"开始对话"按钮）→ 跳过
            console.log('[Cruise] 跳过站点(元素不存在):', stop.name);
            if (stop.autoNext) {
                setTimeout(function () { runCruiseStop(idx + 1); }, 200);
            } else {
                endCruise();
            }
            return;
        }
        cruiseState.targetEl = el;
        highlightTarget(el, true);
        // 计算停靠位置
        const pos = calcDockPosition(el, stop.dock);
        // 先记录朝向
        const startX = position.x;
        state = 'cruise_walk';
        targetPos = pos;
        // 等走到位置，再说话 + 做动作
        const waitArrive = setInterval(function () {
            if (!cruiseState.active) { clearInterval(waitArrive); return; }
            const dx = targetPos.x - position.x;
            const dy = targetPos.y - position.y;
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
                clearInterval(waitArrive);
                state = 'cruise_talk';
                targetPos = null;
                // 朝向目标元素
                const flipStr = (pos.x + (CONFIG.width * (isMobile ? CONFIG.mobileScale : 1)) / 2) <
                    (el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2)
                    ? 'scaleX(1)' : 'scaleX(-1)';
                const el2 = canvasEl || fallbackEl;
                if (el2) {
                    el2.__dh_flip = flipStr;
                    el2.style.transform = flipStr;
                }
                // 说话（说 stop.lines 中随机一句）
                const line = stop.lines[Math.floor(Math.random() * stop.lines.length)];
                doGesture(stop.gesture);
                showBubble(line, 5000);
                setTimeout(function () { speak(line); }, 300);
                // 等说完/看完 → 下一站
                const holdMs = 4500;
                setTimeout(function () {
                    if (cruiseState.highlightedEl === el) highlightTarget(el, false);
                    if (stop.autoNext) {
                        runCruiseStop(idx + 1);
                    } else {
                        endCruise();
                    }
                }, holdMs);
            }
        }, 60);
    }

    function endCruise() {
        cruiseState.active = false;
        cruiseState.currentStopIdx = -1;
        if (cruiseState.highlightedEl) {
            highlightTarget(cruiseState.highlightedEl, false);
        }
        cruiseState.targetEl = null;
        state = 'idle';
        lastActionTime = Date.now();
        console.log('[Cruise] 引导巡航结束');
    }

    // 启动引导巡航（页面加载完成、模型就绪后调）
    function startCruise(delayMs) {
        delayMs = delayMs || 3500;
        const key = 'dh_last_cruise_time';
        try {
            const last = parseInt(localStorage.getItem(key) || '0', 10);
            // 15 分钟内不重复引导（同一会话友好）
            if (last && Date.now() - last < 15 * 60 * 1000) {
                console.log('[Cruise] 距上次引导<15分钟，跳过');
                return;
            }
        } catch (e) { /* */ }
        setTimeout(function () {
            if (cruiseState.active) return;
            cruiseState.active = true;
            try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* */ }
            console.log('[Cruise] 开始引导巡航');
            runCruiseStop(0);
        }, delayMs);
    }

    // 手动触发引导（用户面板里的"带我逛一圈"按钮）
    function triggerCruiseNow() {
        if (cruiseState.active) {
            endCruise();
            return;
        }
        cruiseState.active = true;
        runCruiseStop(0);
    }

    function initFallbackBehavior() {
        state = 'idle';
        lastActionTime = Date.now();
        startBehaviorLoop();
        startTipLoop();
    }

    // ========== 提示循环 ==========
    function startTipLoop() {
        (function showNextTip() {
            if (state === 'idle' || state === 'walking') {
                const tip = CONFIG.tips[Math.floor(Math.random() * CONFIG.tips.length)];
                showBubble(tip, 3500);
            }
            tipTimer = setTimeout(showNextTip, 25000 + Math.random() * 25000);
        })();
    }

    // ========== 点击交互 ==========
    function onCharacterClick(e) {
        if (e) e.stopPropagation();
        if (state === 'talking') { stopSpeaking(); return; }
        state = 'idle';
        targetPos = null;
        lastActionTime = Date.now();
        triggerExpression();
        const g = [
            '嗨！想聊点什么？',
            '有什么我可以帮你的吗？',
            '点上方导航开始对话吧~',
            '我可是懂很多机械知识的小助手哦！',
            '需要制定学习规划吗？',
        ];
        showBubble(g[Math.floor(Math.random() * g.length)], 3000);
    }

    // ========== 表情 ==========
    function triggerExpression() {
        if (!live2dModel) {
            const el = fallbackEl;
            if (el) {
                el.style.transition = 'transform .2s';
                el.style.transform = (el.style.transform || 'scaleX(1)').replace(/scaleX\([^)]*\)/, '') + ' translateY(-12px)';
                setTimeout(function () {
                    if (el) el.style.transform = el.style.transform.replace(' translateY(-12px)', '');
                }, 200);
            }
            return;
        }
        try {
            if (live2dModel.expression) {
                const exprs = live2dModel.internalModel.settings.expressions;
                if (exprs && exprs.length > 0) {
                    live2dModel.expression(Math.floor(Math.random() * exprs.length));
                }
            }
            if (live2dModel.motion) live2dModel.motion('tap_body');
        } catch (e) { /* */ }

        if (canvasEl) {
            const ct = canvasEl.style.transform.replace(/ translateY\(-\d+px\)/, '');
            canvasEl.style.transform = ct + ' translateY(-10px)';
            setTimeout(function () {
                if (canvasEl) canvasEl.style.transform = canvasEl.style.transform.replace(' translateY(-10px)', '');
            }, 200);
        }
    }

    // ========== 文本清洗 ==========
    function cleanAIMessageText(t) {
        if (!t) return '';
        t = t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
        t = t.replace(/```[\s\S]*?```/g, '（代码示例省略）')
            .replace(/`[^`]*`/g, '')
            .replace(/\|[-\s|]+\|(\n?)+/g, '')
            .replace(/[#*_~>\[\]]/g, '')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/\n{2,}/g, '。')
            .replace(/\n/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .trim();
        return t;
    }

    function isBlacklisted(text) {
        if (!text) return true;
        if (text.length < 2) return true;
        for (let i = 0; i < CONFIG.ttsBlacklist.length; i++) {
            if (CONFIG.ttsBlacklist[i].test(text)) return true;
        }
        return false;
    }

    function extractTextFromBotMsg(el) {
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.animate-bounce, .animate-pulse, button, [aria-label]').forEach(function (n) { if (n && n.remove) n.remove(); });
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        let nd;
        const toRemove = [];
        while ((nd = walker.nextNode())) {
            const txt = nd.textContent || '';
            if (/思考|加载|连接中|生成中/.test(txt)) toRemove.push(nd.parentNode);
        }
        toRemove.forEach(function (n) { if (n && n.remove) n.remove(); });
        const text = ((clone.innerText || clone.textContent || '')).trim();
        return cleanAIMessageText(text);
    }

    // ========== TTS ==========
    function loadVoices() {
        if (!window.speechSynthesis) return;
        const vs = speechSynthesis.getVoices();
        if (vs.length > 0) voicesReady = true;
    }
    if (window.speechSynthesis) {
        loadVoices();
        speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    async function loadTtsConfig() {
        // 1. 最高优先：用户手动设置的公网地址（内网穿透）
        if (CONFIG.manualTtsUrl) {
            try {
                const r = await fetch(CONFIG.manualTtsUrl + '/health', { cache: 'no-store' });
                if (r.ok) {
                    CONFIG.qwenTts.serverUrl = CONFIG.manualTtsUrl;
                    try { CONFIG.qwenTts.speaker = localStorage.getItem('dh_qwen_speaker') || CONFIG.qwenTts.defaultSpeaker; }
                    catch (e) { CONFIG.qwenTts.speaker = CONFIG.qwenTts.defaultSpeaker; }
                    CONFIG.qwenTts.enabled = true;
                    console.log('[DigitalHuman] QwenTTS手动地址可用:', CONFIG.manualTtsUrl);
                    return true;
                }
            } catch (e) {
                console.warn('[DigitalHuman] 手动TTS地址连接失败:', CONFIG.manualTtsUrl, e && e.message);
            }
        }
        // 2. 本地配置文件（仅本地开发时可用）
        try {
            const r = await fetch(CONFIG.qwenTts.configUrl + '?_=' + Date.now());
            if (r.ok) {
                const c = await r.json();
                if (c && c.serverUrl) {
                    CONFIG.qwenTts.serverUrl = c.serverUrl;
                    try { CONFIG.qwenTts.speaker = localStorage.getItem('dh_qwen_speaker') || c.speaker || CONFIG.qwenTts.defaultSpeaker; }
                    catch (e) { CONFIG.qwenTts.speaker = c.speaker || CONFIG.qwenTts.defaultSpeaker; }
                    CONFIG.qwenTts.enabled = true;
                    console.log('[DigitalHuman] QwenTTS后端已发现:', c.serverUrl, '音色=', CONFIG.qwenTts.speaker);
                    return true;
                }
            }
        } catch (e) { /* */ }
        // 3. 兜底：探测本地 127.0.0.1:8766（仅本地可用）
        try {
            const r = await fetch(CONFIG.qwenTts.fallbackUrl + '/health', { cache: 'no-store' });
            if (r.ok) {
                CONFIG.qwenTts.serverUrl = CONFIG.qwenTts.fallbackUrl;
                try { CONFIG.qwenTts.speaker = localStorage.getItem('dh_qwen_speaker') || CONFIG.qwenTts.defaultSpeaker; }
                catch (e) { CONFIG.qwenTts.speaker = CONFIG.qwenTts.defaultSpeaker; }
                CONFIG.qwenTts.enabled = true;
                console.log('[DigitalHuman] QwenTTS兜底端口可用:', CONFIG.qwenTts.fallbackUrl);
                return true;
            }
        } catch (e) { /* */ }
        CONFIG.qwenTts.enabled = false;
        return false;
    }

    // 分句工具：按中英文标点切分
    function splitSentences(text) {
        const parts = text.match(/[^。！？\.\!\?\n；;]+[。！？\.\!\?\n；;]*/g) || [text];
        return parts.map(function (s) { return s.trim(); }).filter(function (s) { return s.length >= 2; });
    }

    async function speakWithQwenTTS(text) {
        if (!CONFIG.qwenTts.enabled || !CONFIG.qwenTts.serverUrl) return false;
        try { if (CONFIG.qwenTts.lastAbort) CONFIG.qwenTts.lastAbort.abort(); } catch (e) { /* */ }
        const ctrl = new AbortController();
        CONFIG.qwenTts.lastAbort = ctrl;

        var speaker = CONFIG.qwenTts.speaker || CONFIG.qwenTts.defaultSpeaker;

        // ===== 分句流式播放：第一句合成完立刻播，后续边合成边播 =====
        var sentences = splitSentences(text);
        if (!sentences.length) sentences = [text];

        // 请求单句 WAV
        function fetchSentence(sent) {
            return fetch(CONFIG.qwenTts.serverUrl + '/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: sent, speaker: speaker }),
                signal: ctrl.signal,
            }).then(function (resp) {
                if (!resp.ok) throw new Error('tts http ' + resp.status);
                return resp.blob();
            });
        }

        // 播放一个 blob
        function playBlob(blob) {
            return new Promise(function (resolve, reject) {
                if (!blob || blob.size < 100) { resolve(); return; }
                var url = URL.createObjectURL(blob);
                var audio = new Audio(url);
                audio.onended = function () { URL.revokeObjectURL(url); resolve(); };
                audio.onerror = function () { URL.revokeObjectURL(url); reject(new Error('audio play error')); };
                audio.play().catch(function (e) { URL.revokeObjectURL(url); reject(e); });
            });
        }

        state = 'talking';
        targetPos = null;
        if (canvasEl) canvasEl.style.transform = (canvasEl.style.transform || '').replace('scaleX(-1)', 'scaleX(1)');
        showBubble(text.length > 80 ? text.slice(0, 80) + '...' : text, text.length * 120);
        startMouthAnimation();

        // 第一句立刻请求
        var currentPromise = fetchSentence(sentences[0]);
        var nextPromise = null;

        for (var i = 0; i < sentences.length; i++) {
            // 预取下一句（和当前句播放并行）
            if (i + 1 < sentences.length) {
                nextPromise = fetchSentence(sentences[i + 1]);
            }
            try {
                var blob = await currentPromise;
                if (blob && blob.size >= 100) {
                    await playBlob(blob);
                }
            } catch (e) {
                if (ctrl.signal.aborted) { state = 'idle'; lastActionTime = Date.now(); stopMouthAnimation(); throw e; }
                console.warn('[DigitalHuman] 第' + i + '句播放失败，跳过:', e);
            }
            currentPromise = nextPromise;
            nextPromise = null;
        }

        state = 'idle'; lastActionTime = Date.now(); stopMouthAnimation();
        return true;
    }

    function speakWithWebSpeech(text) {
        if (!window.speechSynthesis) return false;
        speechSynthesis.cancel();
        stopMouthAnimation();

        const u = new SpeechSynthesisUtterance(text);
        u.lang = CONFIG.ttsLang;
        u.rate = CONFIG.ttsRate;
        u.pitch = CONFIG.ttsPitch;
        if (voicesReady) {
            const vs = speechSynthesis.getVoices();
            const zv = vs.find(function (v) { return v.lang.startsWith('zh') && /(female|女|yunxiaoyi|xiaoyun)/i.test(v.name); })
                || vs.find(function (v) { return v.lang.startsWith('zh'); })
                || vs.find(function (v) { return v.lang.startsWith('cmn'); });
            if (zv) u.voice = zv;
        }
        u.onstart = function () {
            state = 'talking'; targetPos = null;
            const el = canvasEl;
            if (el) el.style.transform = (el.style.transform || '').replace('scaleX(-1)', 'scaleX(1)');
            showBubble(text.length > 80 ? text.slice(0, 80) + '...' : text, text.length * 120);
            startMouthAnimation();
        };
        u.onend = u.onerror = function () {
            state = 'idle'; lastActionTime = Date.now(); stopMouthAnimation();
        };
        speechSynthesis.speak(u);
        return true;
    }

    async function speak(text, options) {
        options = options || {};
        if (!CONFIG.ttsEnabled) return;
        stopSpeaking();
        const clean = cleanAIMessageText(text);
        if (isBlacklisted(clean)) return;
        const final = clean.length > 300 ? clean.slice(0, 300) + '\u2026\u2026' : clean;
        if (!options.force) {
            const sig = textSignature(final);
            if (spokenSignatures.has(sig)) return;
            spokenSignatures.add(sig);
            if (spokenSignatures.size > 200) spokenSignatures.clear();
        }

        try {
            if (CONFIG.qwenTts.enabled) {
                const ok = await speakWithQwenTTS(final);
                if (ok) return;
            }
        } catch (e) {
            console.warn('[DigitalHuman] QwenTTS失败，回退WebSpeech:', (e && e.message) || e);
        }
        speakWithWebSpeech(final);
    }

    function stopSpeaking() {
        try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* */ }
        try { if (CONFIG.qwenTts.lastAbort) CONFIG.qwenTts.lastAbort.abort(); } catch (e) { /* */ }
        stopMouthAnimation();
        state = 'idle';
        lastActionTime = Date.now();
    }

    // ========== 嘴部动画 ==========
    function startMouthAnimation() {
        if (mouthTimer) clearInterval(mouthTimer);
        mouthTimer = setInterval(function () {
            if (!live2dModel) return;
            try {
                const cm = live2dModel.internalModel.coreModel;
                cm.setParameterValueById('PARAM_MOUTH_OPEN_Y', Math.random() * 0.7 + 0.2);
                if (Math.random() < 0.08) {
                    cm.setParameterValueById('PARAM_EYE_L_OPEN', 0.1);
                    cm.setParameterValueById('PARAM_EYE_R_OPEN', 0.1);
                    setTimeout(function () {
                        try {
                            cm.setParameterValueById('PARAM_EYE_L_OPEN', 1);
                            cm.setParameterValueById('PARAM_EYE_R_OPEN', 1);
                        } catch (e) { /* */ }
                    }, 100);
                }
            } catch (e) { /* */ }
        }, 90);
    }

    function stopMouthAnimation() {
        if (mouthTimer) { clearInterval(mouthTimer); mouthTimer = null; }
        if (live2dModel) {
            try { live2dModel.internalModel.coreModel.setParameterValueById('PARAM_MOUTH_OPEN_Y', 0); } catch (e) { /* */ }
        }
    }

    // ========== 对话气泡 ==========
    function showBubbleOnEl(anchorEl, text, duration) {
        const old = document.querySelector('.dh-bubble');
        if (old) old.remove();
        const b = document.createElement('div');
        b.className = 'dh-bubble';
        b.textContent = text;
        document.body.appendChild(b);
        requestAnimationFrame(function () {
            let ax = position.x + 10;
            let ay = position.y - 50;
            if (anchorEl) {
                try {
                    const r = anchorEl.getBoundingClientRect();
                    ax = r.left + 10;
                    ay = r.top - 50;
                } catch (e) { /* */ }
            }
            b.style.left = ax + 'px';
            b.style.top = ay + 'px';
            b.classList.add('dh-bubble-show');
        });
        const d = duration || 3000;
        setTimeout(function () {
            b.classList.remove('dh-bubble-show');
            setTimeout(function () { b.remove(); }, 300);
        }, d);
    }

    function showBubble(text, duration) {
        showBubbleOnEl(canvasEl || fallbackEl, text, duration);
    }

    // ========== 控制面板 ==========
    function createControlPanel() {
        panelEl = document.createElement('div');
        panelEl.id = 'dh-panel';
        panelEl.innerHTML = '' +
            '<button id="dh-panel-toggle" class="dh-panel-btn" title="数字人设置">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
                '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>' +
                '<line x1="12" y1="19" x2="12" y2="23"/>' +
                '<line x1="8" y1="23" x2="16" y2="23"/>' +
              '</svg>' +
            '</button>' +
            '<div id="dh-panel-menu" class="dh-panel-menu hidden">' +
                '<div class="dh-panel-header">数字人设置</div>' +
                '<button class="dh-panel-item" id="dh-tts-toggle">' +
                    '<span class="dh-item-icon">\uD83D\uDD0A</span>' +
                    '<span class="dh-item-label">语音朗读</span>' +
                    '<span class="dh-item-status" id="dh-tts-status">已开启</span>' +
                '</button>' +
                '<div class="dh-panel-divider"></div>' +
                '<div class="dh-panel-subheader">TTS 引擎</div>' +
                '<button class="dh-panel-item" id="dh-tts-engine">' +
                    '<span class="dh-item-icon">\u2699\uFE0F</span>' +
                    '<span class="dh-item-label">当前引擎</span>' +
                    '<span class="dh-item-status" id="dh-engine-status">检测中...</span>' +
                '</button>' +
                '<button class="dh-panel-item" id="dh-voice-select">' +
                    '<span class="dh-item-icon">\uD83C\uDF99\uFE0F</span>' +
                    '<span class="dh-item-label">AI 音色</span>' +
                    '<span class="dh-item-status" id="dh-voice-status">默认女声</span>' +
                '</button>' +
                '<button class="dh-panel-item" id="dh-ref-voice">' +
                    '<span class="dh-item-icon">\uD83C\uDFB5</span>' +
                    '<span class="dh-item-label">上传参考音频(克隆音色)</span>' +
                    '<input id="dh-ref-input" type="file" accept="audio/*" style="display:none">' +
                '</button>' +
                '<button class="dh-panel-item" id="dh-set-tts-url">' +
                    '<span class="dh-item-icon">\uD83D\uDD17</span>' +
                    '<span class="dh-item-label">设置TTS服务地址</span>' +
                    '<span class="dh-item-status" id="dh-tts-url-status">未设置</span>' +
                '</button>' +
                '<div class="dh-panel-divider"></div>' +
                '<button class="dh-panel-item" id="dh-test-voice">' +
                    '<span class="dh-item-icon">\uD83C\uDFA4</span>' +
                    '<span class="dh-item-label">测试语音</span>' +
                '</button>' +
                '<button class="dh-panel-item" id="dh-cruise">' +
                    '<span class="dh-item-icon">\uD83E\uDDED</span>' +
                    '<span class="dh-item-label">带我逛一圈</span>' +
                    '<span class="dh-item-status" id="dh-cruise-status">引导模式</span>' +
                '</button>' +
                '<button class="dh-panel-item" id="dh-switch-model">' +
                    '<span class="dh-item-icon">\uD83D\uDC4B</span>' +
                    '<span class="dh-item-label">打招呼</span>' +
                '</button>' +
                '<button class="dh-panel-item" id="dh-stop-voice">' +
                    '<span class="dh-item-icon">\u23F9</span>' +
                    '<span class="dh-item-label">停止说话</span>' +
                '</button>' +
            '</div>';
        document.body.appendChild(panelEl);

        const style = document.createElement('style');
        style.textContent =
            '#dh-panel{position:fixed;right:16px;bottom:16px;z-index:10000}' +
            '.dh-panel-btn{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#9333ea,#ec4899);border:none;color:#fff;cursor:pointer;' +
            'display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(147,51,234,.4);transition:transform .2s}' +
            '.dh-panel-btn:hover{transform:scale(1.1)}' +
            '.dh-panel-menu{position:absolute;bottom:52px;right:0;background:rgba(20,18,35,.97);border:1px solid rgba(147,51,234,.3);' +
            'border-radius:12px;padding:8px;min-width:230px;backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,.5);' +
            'transition:opacity .2s,transform .2s;max-height:80vh;overflow-y:auto}' +
            '.dh-panel-menu.hidden{opacity:0;transform:translateY(10px);pointer-events:none}' +
            '.dh-panel-header{font-size:12px;color:#9ca3af;padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:4px}' +
            '.dh-panel-subheader{font-size:11px;color:#6b7280;padding:4px 12px;margin-top:2px}' +
            '.dh-panel-divider{height:1px;background:rgba(255,255,255,.06);margin:6px 4px}' +
            '.dh-panel-item{display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;background:transparent;border:none;color:#e5e7eb;' +
            'font-size:13px;cursor:pointer;border-radius:8px;transition:background .15s}' +
            '.dh-panel-item:hover{background:rgba(147,51,234,.15)}' +
            '.dh-item-icon{font-size:16px}' +
            '.dh-item-label{flex:1;text-align:left}' +
            '.dh-item-status{font-size:11px;color:#a78bfa}' +
            '@media (max-width:480px){.dh-panel-menu{min-width:190px}}';
        document.head.appendChild(style);

        const toggle = document.getElementById('dh-panel-toggle');
        const menu = document.getElementById('dh-panel-menu');
        toggle.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('hidden'); });
        document.addEventListener('click', function (e) { if (panelEl && !panelEl.contains(e.target)) menu.classList.add('hidden'); });

        document.getElementById('dh-tts-toggle').addEventListener('click', function () {
            CONFIG.ttsEnabled = !CONFIG.ttsEnabled;
            const s = document.getElementById('dh-tts-status');
            s.textContent = CONFIG.ttsEnabled ? '已开启' : '已关闭';
            s.style.color = CONFIG.ttsEnabled ? '#a78bfa' : '#6b7280';
            if (!CONFIG.ttsEnabled) stopSpeaking();
            showBubble(CONFIG.ttsEnabled ? '语音已开启~' : '语音已关闭', 1500);
        });

        document.getElementById('dh-test-voice').addEventListener('click', function () {
            speak('你好！我是小智，很高兴认识你！有什么可以帮你的吗？');
        });

        document.getElementById('dh-switch-model').addEventListener('click', function () {
            triggerExpression();
            const g = ['嗨！你好呀~', '今天也要加油学习哦！', '有什么想聊的吗？'];
            showBubble(g[Math.floor(Math.random() * g.length)], 2500);
        });

        document.getElementById('dh-stop-voice').addEventListener('click', function () {
            stopSpeaking();
            showBubble('已停止说话', 1500);
        });

        document.getElementById('dh-tts-engine').addEventListener('click', async function () {
            CONFIG.qwenTts.enabled = !CONFIG.qwenTts.enabled;
            if (CONFIG.qwenTts.enabled) {
                const ok = await loadTtsConfig();
                if (!ok && !CONFIG.qwenTts.serverUrl) {
                    showBubble('未发现QwenTTS后端，请先启动 tts_server.py', 3500);
                    CONFIG.qwenTts.enabled = false;
                } else {
                    showBubble('已切换为 QwenTTS 自定义音色~', 2500);
                }
            } else {
                showBubble('已切换为系统语音（WebSpeech）', 2500);
            }
            updateEngineStatusUI();
        });

        document.getElementById('dh-voice-select').addEventListener('click', async function () {
            if (!CONFIG.qwenTts.enabled || !CONFIG.qwenTts.serverUrl) {
                showBubble('请先启用QwenTTS引擎哦', 2500);
                return;
            }
            try {
                const r = await fetch(CONFIG.qwenTts.serverUrl + '/speakers');
                if (!r.ok) throw new Error('http ' + r.status);
                const d = await r.json();
                const list = d.speakers || [];
                if (!list.length) { showBubble('暂无可用音色，请上传参考音频', 2500); return; }
                const idx = prompt('选择音色（输入序号 0-' + (list.length - 1) + '）\n' + list.map(function (s, i) { return i + '. ' + s; }).join('\n'));
                if (idx === null) return;
                const n = parseInt(idx, 10);
                if (isNaN(n) || n < 0 || n >= list.length) return;
                CONFIG.qwenTts.speaker = list[n];
                try { localStorage.setItem('dh_qwen_speaker', list[n]); } catch (e) { /* */ }
                document.getElementById('dh-voice-status').textContent = list[n];
                showBubble('已切换音色：' + list[n] + '，试听中...', 2500);
                // 自动试听（force 绕过防重复签名）
                setTimeout(function () {
                    speak('你好呀，我是小智，满意我的音色嘛？', { force: true });
                }, 400);
            } catch (e) {
                showBubble('获取音色失败：' + (e && e.message || e), 3000);
            }
        });

        document.getElementById('dh-ref-voice').addEventListener('click', function () {
            if (!CONFIG.qwenTts.enabled || !CONFIG.qwenTts.serverUrl) {
                showBubble('请先启用QwenTTS引擎哦', 2500);
                return;
            }
            document.getElementById('dh-ref-input').click();
        });
        document.getElementById('dh-ref-input').addEventListener('change', async function (e) {
            const file = e.target && e.target.files && e.target.files[0];
            if (!file) return;
            showBubble('正在克隆音色，请稍候...', 4000);
            try {
                const fd = new FormData();
                fd.append('audio', file);
                const name = (file.name || '我的音色').replace(/\.[^.]+$/, '').slice(0, 20) || '我的音色';
                fd.append('speaker_name', name);
                const r = await fetch(CONFIG.qwenTts.serverUrl + '/clone', { method: 'POST', body: fd });
                if (!r.ok) throw new Error('http ' + r.status);
                const d = await r.json();
                if (d.ok) {
                    CONFIG.qwenTts.speaker = d.speaker || name;
                    document.getElementById('dh-voice-status').textContent = CONFIG.qwenTts.speaker;
                    showBubble('音色克隆成功！' + CONFIG.qwenTts.speaker, 3500);
                } else {
                    throw new Error(d.error || '未知错误');
                }
            } catch (err) {
                showBubble('克隆失败：' + (err && err.message || err), 4000);
            } finally {
                e.target.value = '';
            }
        });

        // 设置 TTS 服务地址（内网穿透公网地址）
        const urlStatusEl = document.getElementById('dh-tts-url-status');
        if (CONFIG.manualTtsUrl) {
            urlStatusEl.textContent = '已设置';
            urlStatusEl.style.color = '#34d399';
        }
        document.getElementById('dh-set-tts-url').addEventListener('click', async function () {
            const current = CONFIG.manualTtsUrl || '';
            const hint = current
                ? '当前地址：' + current + '\n输入新地址（留空则清除）。\n格式：https://xxxx.cpolar.io 或 https://xxxx.ngrok-free.app'
                : '请输入内网穿透后的公网地址\n格式：https://xxxx.cpolar.io 或 https://xxxx.ngrok-free.app';
            const input = prompt(hint, current);
            if (input === null) return;  // 用户取消
            const url = input.trim().replace(/\/+$/, '');  // 去掉末尾斜杠
            try { localStorage.setItem('dh_manual_tts_url', url); } catch (e) { /* */ }
            CONFIG.manualTtsUrl = url;
            if (url) {
                urlStatusEl.textContent = '连接中...';
                urlStatusEl.style.color = '#fbbf24';
                showBubble('正在连接 ' + url + ' ...', 3000);
                const ok = await loadTtsConfig();
                if (ok && CONFIG.qwenTts.serverUrl === url) {
                    urlStatusEl.textContent = '已连接';
                    urlStatusEl.style.color = '#34d399';
                    showBubble('TTS 服务连接成功！音色：' + (CONFIG.qwenTts.speaker || '默认'), 3000);
                } else {
                    urlStatusEl.textContent = '连接失败';
                    urlStatusEl.style.color = '#ef4444';
                    showBubble('连接失败，请检查地址是否正确、服务是否在运行', 4000);
                }
            } else {
                urlStatusEl.textContent = '未设置';
                urlStatusEl.style.color = '#a78bfa';
                CONFIG.qwenTts.enabled = false;
                showBubble('已清除自定义TTS地址，回退系统语音', 2500);
            }
            updateEngineStatusUI();
        });

        // 带我逛一圈：手动触发引导巡航（再点一次取消）
        document.getElementById('dh-cruise').addEventListener('click', function () {
            const st = document.getElementById('dh-cruise-status');
            if (cruiseState.active) {
                endCruise();
                if (st) { st.textContent = '引导模式'; st.style.color = '#a78bfa'; }
                showBubble('好的，结束啦～有需要随时点我哦', 2500);
            } else {
                cruiseState.active = true;
                if (st) { st.textContent = '巡航中...'; st.style.color = '#34d399'; }
                runCruiseStop(0);
            }
        });

        // 监听 cruise 状态变化（用于更新UI文字）
        setInterval(function () {
            const st = document.getElementById('dh-cruise-status');
            if (!st) return;
            if (cruiseState.active) {
                if (st.textContent !== '巡航中...') {
                    st.textContent = '巡航中...';
                    st.style.color = '#34d399';
                }
            } else {
                if (st.textContent !== '引导模式') {
                    st.textContent = '引导模式';
                    st.style.color = '#a78bfa';
                }
            }
        }, 500);

        updateEngineStatusUI();
    }

    function updateEngineStatusUI() {
        const el = document.getElementById('dh-engine-status');
        if (!el) return;
        if (CONFIG.qwenTts.enabled && CONFIG.qwenTts.serverUrl) {
            el.textContent = 'QwenTTS';
            el.style.color = '#34d399';
        } else {
            el.textContent = '系统语音';
            el.style.color = '#a78bfa';
        }
    }

    // ========== 聊天集成 ==========
    function scheduleSpeakForElement(el) {
        const key = el;
        const prev = textStableTimers.get(key);
        if (prev) clearTimeout(prev);

        function run() {
            const text = extractTextFromBotMsg(el);
            if (isBlacklisted(text)) { textStableTimers.delete(key); return; }
            const sig = textSignature(text);
            const lastSig = el.__lastSig;
            el.__lastSig = sig;
            if (lastSig === sig && sig && text && text.length > 2) {
                textStableTimers.delete(key);
                speak(text);
            } else {
                const t = setTimeout(run, 1500);
                textStableTimers.set(key, t);
            }
        }
        const t = setTimeout(run, 1500);
        textStableTimers.set(key, t);
    }

    function setupChatIntegration() {
        const chatContainer = document.getElementById('chat-container')
            || document.getElementById('chat-messages')
            || document.getElementById('messages')
            || document.querySelector('.chat-messages');
        if (!chatContainer) return;

        chatContainer.querySelectorAll('.bot-msg, .ai-message, .assistant, .bot-message').forEach(function (el) { scheduleSpeakForElement(el); });

        const SEL = '.bot-msg, .ai-message, .assistant, .bot-message';
        const observer = new MutationObserver(function (mutations) {
            for (let mi = 0; mi < mutations.length; mi++) {
                const m = mutations[mi];
                if (m.addedNodes && m.addedNodes.length) {
                    for (let ni = 0; ni < m.addedNodes.length; ni++) {
                        const nd = m.addedNodes[ni];
                        if (nd.nodeType !== 1) continue;
                        const aiMsg = (nd.matches && nd.matches(SEL)) ? nd : (nd.querySelector && nd.querySelector(SEL));
                        if (aiMsg) scheduleSpeakForElement(aiMsg);
                    }
                }
                if (m.type === 'characterData' || (m.type === 'childList' && m.target && m.target.nodeType === 1)) {
                    let tgt = m.target;
                    while (tgt && tgt !== chatContainer) {
                        if (tgt.nodeType === 1 && tgt.matches && tgt.matches(SEL)) {
                            scheduleSpeakForElement(tgt);
                            break;
                        }
                        tgt = tgt.parentNode;
                    }
                }
            }
        });

        observer.observe(chatContainer, {
            childList: true, subtree: true, characterData: true, characterDataOldValue: false,
        });
        console.log('[DigitalHuman] 聊天集成已启动（文本稳定检测）');
    }

    // ========== 初始化 ==========
    function initFallback() {
        if (!fallbackEl) showEmojiPlaceholder();
        initFallbackBehavior();
    }

    window.addEventListener('resize', function () {
        isMobile = window.innerWidth < 768;
        const sc = isMobile ? CONFIG.mobileScale : 1;
        const ch = CONFIG.height * sc;
        if (position.y + ch > window.innerHeight) {
            position.y = window.innerHeight - ch - CONFIG.margin;
            updatePosition();
        }
        const cw = CONFIG.width * sc;
        if (position.x + cw > window.innerWidth) {
            position.x = window.innerWidth - cw - CONFIG.margin;
            updatePosition();
        }
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            stopSpeaking();
            state = 'idle';
            targetPos = null;
        }
    });

    window.DigitalHuman = {
        speak: speak,
        showBubble: showBubble,
        stopSpeaking: stopSpeaking,
        triggerExpression: triggerExpression,
        triggerCruise: triggerCruiseNow,
        startCruise: startCruise,
        endCruise: endCruise,
        setTtsEnabled: function (enabled) {
            CONFIG.ttsEnabled = enabled;
            const s = document.getElementById('dh-tts-status');
            if (s) { s.textContent = enabled ? '已开启' : '已关闭'; s.style.color = enabled ? '#a78bfa' : '#6b7280'; }
        },
        setQwenTtsUrl: function (url, speaker) {
            CONFIG.qwenTts.enabled = !!url;
            CONFIG.qwenTts.serverUrl = url;
            if (speaker) CONFIG.qwenTts.speaker = speaker;
            updateEngineStatusUI();
        },
        getState: function () { return state; },
        getPosition: function () { return { x: position.x, y: position.y }; },
    };

    function init() {
        console.log('[DigitalHuman] 初始化...');
        showEmojiPlaceholder();
        createControlPanel();
        loadTtsConfig().then(updateEngineStatusUI);
        initLive2D();
        setTimeout(setupChatIntegration, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
