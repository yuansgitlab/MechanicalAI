package com.mechanicalai.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.mechanicalai.app.data.settings.AppSettings
import com.mechanicalai.app.data.settings.SettingsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class SettingsViewModel(application: Application) : AndroidViewModel(application) {
    private val settingsRepository = SettingsRepository.getInstance(application)
    val settingsState: StateFlow<AppSettings> = settingsRepository.settingsState
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    fun saveApiKey(apiKey: String) {
        if (apiKey.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "API Key 不能为空")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                settingsRepository.saveDeepSeekApiKey(apiKey)
                _uiState.value = _uiState.value.copy(isLoading = false, isSaved = true, error = null)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "保存失败: ${e.message}")
            }
        }
    }

    fun saveApiUrl(url: String) {
        if (url.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "API URL 不能为空")
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            try {
                settingsRepository.saveApiBaseUrl(url)
                _uiState.value = _uiState.value.copy(isLoading = false, isSaved = true, error = null)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "保存失败: ${e.message}")
            }
        }
    }

    fun clearSettings() {
        viewModelScope.launch {
            settingsRepository.clearSettings()
            _uiState.value = SettingsUiState()
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun resetSavedState() {
        _uiState.value = _uiState.value.copy(isSaved = false)
    }

    fun isConfigured(): Boolean = settingsRepository.isConfigured()
}

data class SettingsUiState(val isLoading: Boolean = false, val isSaved: Boolean = false, val error: String? = null)
