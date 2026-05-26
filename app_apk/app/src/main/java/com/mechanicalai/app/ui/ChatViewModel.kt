package com.mechanicalai.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.mechanicalai.app.data.local.AppDatabase
import com.mechanicalai.app.data.local.MessageEntity
import com.mechanicalai.app.data.local.QuizEntity
import com.mechanicalai.app.data.local.SessionEntity
import com.mechanicalai.app.data.repository.ChatRepository
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class ChatViewModel(application: Application) : AndroidViewModel(application) {
    private val database = AppDatabase.getDatabase(application)
    private val repository = ChatRepository(
        database.sessionDao(),
        database.messageDao(),
        database.quizDao()
    )

    // UI State
    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    // 数据观察
    val allSessions: Flow<List<SessionEntity>> = repository.getAllSessions()
    val currentSessionMessages: Flow<List<MessageEntity>> = _uiState.flatMapLatest { state ->
        if (state.currentSessionId != null) {
            repository.getMessagesForSession(state.currentSessionId)
        } else {
            flowOf(emptyList())
        }
    }
    val currentSessionQuiz: Flow<List<QuizEntity>> = _uiState.flatMapLatest { state ->
        if (state.currentSessionId != null) {
            repository.getQuizForSession(state.currentSessionId)
        } else {
            flowOf(emptyList())
        }
    }

    init {
        // 初始化时创建新会话
        viewModelScope.launch {
            createNewSession()
        }
    }

    fun createNewSession() {
        viewModelScope.launch {
            val sessionId = repository.createSession()
            val session = repository.getSessionById(sessionId)
            _uiState.update {
                it.copy(
                    currentSessionId = sessionId,
                    currentSessionTitle = session?.title ?: "新对话",
                    diagnosis = null,
                    studyPlan = null
                )
            }
        }
    }

    fun selectSession(sessionId: Long) {
        viewModelScope.launch {
            val session = repository.getSessionById(sessionId)
            _uiState.update {
                it.copy(
                    currentSessionId = sessionId,
                    currentSessionTitle = session?.title ?: "新对话",
                    diagnosis = session?.diagnosis,
                    studyPlan = session?.studyPlan
                )
            }
        }
    }

    fun deleteSession(sessionId: Long) {
        viewModelScope.launch {
            repository.deleteSession(sessionId)
            // 如果删除的是当前会话，创建新会话
            if (sessionId == _uiState.value.currentSessionId) {
                createNewSession()
            }
        }
    }

    fun sendMessage(message: String) {
        if (message.isBlank()) return

        val sessionId = _uiState.value.currentSessionId ?: return

        viewModelScope.launch {
            // 添加用户消息
            repository.addMessage(sessionId, "user", message)
            _uiState.update { it.copy(isLoading = true, error = null) }

            // 调用API
            val result = repository.sendMessageToApi(message)
            result.fold(
                onSuccess = { response ->
                    // 添加助手消息
                    repository.addMessage(sessionId, "bot", response.chat_response)

                    // 保存诊断和学习计划
                    repository.getSessionById(sessionId)?.let { session ->
                        repository.updateSession(
                            session.copy(
                                diagnosis = response.diagnosis,
                                studyPlan = response.study_plan,
                                title = if (session.title == "新对话") {
                                    message.take(30) + if (message.length > 30) "…" else ""
                                } else session.title
                            )
                        )
                    }

                    // 保存测试题
                    repository.saveQuizForSession(sessionId, response.quiz)

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            diagnosis = response.diagnosis,
                            studyPlan = response.study_plan
                        )
                    }
                },
                onFailure = { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = error.message ?: "发生未知错误"
                        )
                    }
                }
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun parseQuizOptions(optionsJson: String): List<String> {
        return repository.parseQuizOptions(optionsJson)
    }
}

data class ChatUiState(
    val currentSessionId: Long? = null,
    val currentSessionTitle: String = "新对话",
    val isLoading: Boolean = false,
    val error: String? = null,
    val diagnosis: String? = null,
    val studyPlan: String? = null
)
