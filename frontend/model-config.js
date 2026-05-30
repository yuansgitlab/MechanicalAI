/**
 * Model Configuration System
 * 多模型配置管理系统 - 支持 DeepSeek, Kimi, 豆包, Qwen, OpenAI 等
 */

// 预定义的模型配置
const MODEL_PROVIDERS = {
    deepseek: {
        name: 'DeepSeek',
        icon: 'zap',
        color: 'purple',
        apiUrl: 'https://api.deepseek.com/chat/completions',
        models: [
            { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (快速)' },
            { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (强大)' }
        ],
        defaultModel: 'deepseek-v4-flash',
        description: '专注于代码和推理的强大模型'
    },
    kimi: {
        name: 'Kimi',
        icon: 'sparkles',
        color: 'blue',
        apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
        models: [
            { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K' },
            { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K' },
            { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K' }
        ],
        defaultModel: 'moonshot-v1-8k',
        description: '长文本处理能力强大'
    },
    doubao: {
        name: '豆包',
        icon: 'cloud-lightning',
        color: 'green',
        apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        models: [
            { id: 'ep-20241205183355-7q7x8', name: 'Doubao Pro' },
            { id: 'ep-20241205183355-abcde', name: 'Doubao Lite' }
        ],
        defaultModel: 'ep-20241205183355-7q7x8',
        description: '字节跳动推出的智能助手'
    },
    qwen: {
        name: 'Qwen',
        icon: 'brain',
        color: 'orange',
        apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        models: [
            { id: 'qwen-turbo', name: 'Qwen Turbo' },
            { id: 'qwen-plus', name: 'Qwen Plus' },
            { id: 'qwen-max', name: 'Qwen Max' }
        ],
        defaultModel: 'qwen-plus',
        description: '阿里云通义千问系列模型'
    },
    openai: {
        name: 'OpenAI',
        icon: 'circle',
        color: 'cyan',
        apiUrl: 'https://api.openai.com/v1/chat/completions',
        models: [
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
            { id: 'gpt-4', name: 'GPT-4' },
            { id: 'gpt-4o', name: 'GPT-4o' }
        ],
        defaultModel: 'gpt-4o',
        description: 'OpenAI 官方模型系列'
    },
    custom: {
        name: '自定义',
        icon: 'settings',
        color: 'gray',
        apiUrl: '',
        models: [
            { id: 'custom-model', name: '自定义模型' }
        ],
        defaultModel: 'custom-model',
        description: '配置自己的 API 服务'
    }
};

class ModelConfigManager {
    constructor() {
        this.STORAGE_KEY = 'mechanicalai_model_configs';
        this.SESSION_CONFIG_KEY = 'mechanicalai_session_config_';
        this.configs = this.loadConfigs();
        this.currentProvider = 'deepseek';
    }

    // 加载所有配置
    loadConfigs() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error('Failed to load configs:', e);
        }
        return {};
    }

    // 保存配置
    saveConfigs() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.configs));
        } catch (e) {
            console.error('Failed to save configs:', e);
        }
    }

    // 获取某个 provider 的配置
    getProviderConfig(providerId) {
        return this.configs[providerId] || {
            apiKey: '',
            model: MODEL_PROVIDERS[providerId]?.defaultModel || '',
            apiUrl: MODEL_PROVIDERS[providerId]?.apiUrl || ''
        };
    }

    // 设置某个 provider 的配置
    setProviderConfig(providerId, config) {
        this.configs[providerId] = {
            apiKey: config.apiKey || '',
            model: config.model || MODEL_PROVIDERS[providerId]?.defaultModel || '',
            apiUrl: config.apiUrl || MODEL_PROVIDERS[providerId]?.apiUrl || ''
        };
        this.saveConfigs();
    }

    // 获取会话级配置
    getSessionConfig(sessionId) {
        try {
            const saved = localStorage.getItem(this.SESSION_CONFIG_KEY + sessionId);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error('Failed to load session config:', e);
        }
        return null;
    }

    // 保存会话级配置
    setSessionConfig(sessionId, config) {
        try {
            localStorage.setItem(this.SESSION_CONFIG_KEY + sessionId, JSON.stringify(config));
        } catch (e) {
            console.error('Failed to save session config:', e);
        }
    }

    // 获取当前使用的配置（优先使用会话配置）
    getEffectiveConfig(sessionId = null) {
        if (sessionId) {
            const sessionConfig = this.getSessionConfig(sessionId);
            if (sessionConfig && sessionConfig.provider) {
                const providerConfig = this.getProviderConfig(sessionConfig.provider);
                return {
                    provider: sessionConfig.provider,
                    providerInfo: MODEL_PROVIDERS[sessionConfig.provider],
                    apiKey: sessionConfig.apiKey || providerConfig.apiKey,
                    model: sessionConfig.model || providerConfig.model,
                    apiUrl: sessionConfig.apiUrl || providerConfig.apiUrl
                };
            }
        }
        const providerConfig = this.getProviderConfig(this.currentProvider);
        return {
            provider: this.currentProvider,
            providerInfo: MODEL_PROVIDERS[this.currentProvider],
            apiKey: providerConfig.apiKey,
            model: providerConfig.model,
            apiUrl: providerConfig.apiUrl
        };
    }

    // 设置当前默认 provider
    setCurrentProvider(providerId) {
        if (MODEL_PROVIDERS[providerId]) {
            this.currentProvider = providerId;
        }
    }

    // 获取所有 providers 列表
    getAllProviders() {
        return Object.entries(MODEL_PROVIDERS).map(([id, info]) => ({
            id,
            ...info,
            hasApiKey: !!this.configs[id]?.apiKey
        }));
    }
}

// 创建全局实例
const modelConfigManager = new ModelConfigManager();
