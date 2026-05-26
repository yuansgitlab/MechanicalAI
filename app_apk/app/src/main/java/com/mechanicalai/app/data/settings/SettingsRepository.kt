package com.mechanicalai.app.data.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class SettingsRepository private constructor(context: Context) {
    
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val securePrefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "mechanical_ai_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    private val _settingsState = MutableStateFlow(loadSettings())
    val settingsState: StateFlow<AppSettings> = _settingsState.asStateFlow()

    private fun loadSettings(): AppSettings {
        return AppSettings(
            deepSeekApiKey = securePrefs.getString(KEY_DEEPSEEK_API_KEY, null),
            apiBaseUrl = securePrefs.getString(KEY_API_BASE_URL, DEFAULT_API_URL),
            isConfigured = securePrefs.getString(KEY_DEEPSEEK_API_KEY, null) != null
        )
    }

    fun saveDeepSeekApiKey(apiKey: String) {
        securePrefs.edit().putString(KEY_DEEPSEEK_API_KEY, apiKey).apply()
        _settingsState.value = _settingsState.value.copy(
            deepSeekApiKey = apiKey,
            isConfigured = true
        )
    }

    fun saveApiBaseUrl(url: String) {
        securePrefs.edit().putString(KEY_API_BASE_URL, url).apply()
        _settingsState.value = _settingsState.value.copy(apiBaseUrl = url)
    }

    fun clearSettings() {
        securePrefs.edit().clear().apply()
        _settingsState.value = AppSettings()
    }

    fun getDeepSeekApiKey(): String? {
        return securePrefs.getString(KEY_DEEPSEEK_API_KEY, null)
    }

    fun getApiBaseUrl(): String {
        return securePrefs.getString(KEY_API_BASE_URL, DEFAULT_API_URL) ?: DEFAULT_API_URL
    }

    fun isConfigured(): Boolean {
        return securePrefs.getString(KEY_DEEPSEEK_API_KEY, null) != null
    }

    companion object {
        private const val KEY_DEEPSEEK_API_KEY = "deepseek_api_key"
        private const val KEY_API_BASE_URL = "api_base_url"
        private const val DEFAULT_API_URL = "https://api.deepseek.com"
        
        @Volatile
        private var INSTANCE: SettingsRepository? = null

        fun getInstance(context: Context): SettingsRepository {
            return INSTANCE ?: synchronized(this) {
                val instance = SettingsRepository(context.applicationContext)
                INSTANCE = instance
                instance
            }
        }
    }
}

data class AppSettings(
    val deepSeekApiKey: String? = null,
    val apiBaseUrl: String = "https://api.deepseek.com",
    val isConfigured: Boolean = false
)
