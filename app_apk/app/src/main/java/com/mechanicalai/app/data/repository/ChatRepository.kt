package com.mechanicalai.app.data.repository

import com.mechanicalai.app.data.api.RetrofitClient
import com.mechanicalai.app.data.local.*
import com.mechanicalai.app.data.model.ChatRequest
import com.mechanicalai.app.data.model.ChatResponse
import com.mechanicalai.app.data.model.QuizItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ChatRepository(
    private val sessionDao: SessionDao,
    private val messageDao: MessageDao,
    private val quizDao: QuizDao
) {
    private val api = RetrofitClient.api
    private val json = Json { ignoreUnknownKeys = true }

    // 会话相关
    fun getAllSessions(): Flow<List<SessionEntity>> = sessionDao.getAllSessions()

    suspend fun getSessionById(sessionId: Long): SessionEntity? = sessionDao.getSessionById(sessionId)

    suspend fun createSession(title: String = "新对话"): Long = withContext(Dispatchers.IO) {
        sessionDao.insertSession(SessionEntity(title = title))
    }

    suspend fun updateSession(session: SessionEntity) = withContext(Dispatchers.IO) {
        sessionDao.updateSession(session.copy(updatedAt = System.currentTimeMillis()))
    }

    suspend fun deleteSession(sessionId: Long) = withContext(Dispatchers.IO) {
        sessionDao.deleteSessionById(sessionId)
    }

    // 消息相关
    fun getMessagesForSession(sessionId: Long): Flow<List<MessageEntity>> =
        messageDao.getMessagesForSession(sessionId)

    suspend fun addMessage(sessionId: Long, role: String, content: String) = withContext(Dispatchers.IO) {
        messageDao.insertMessage(
            MessageEntity(
                sessionId = sessionId,
                role = role,
                content = content
            )
        )
    }

    // 测试题相关
    fun getQuizForSession(sessionId: Long): Flow<List<QuizEntity>> =
        quizDao.getQuizForSession(sessionId)

    suspend fun saveQuizForSession(sessionId: Long, quizItems: List<QuizItem>) = withContext(Dispatchers.IO) {
        quizDao.deleteQuizForSession(sessionId)
        val entities = quizItems.mapIndexed { index, item ->
            QuizEntity(
                sessionId = sessionId,
                question = item.question,
                optionsJson = json.encodeToString(item.options),
                answer = item.answer,
                analysis = item.analysis,
                difficulty = item.difficulty,
                orderIndex = index
            )
        }
        quizDao.insertQuizItems(entities)
    }

    suspend fun updateQuizAnswer(quizId: Long, isCorrect: Boolean) = withContext(Dispatchers.IO) {
        // 简单实现 - 这里我们不需要实际更新quiz，先略过
    }

    // API调用
    suspend fun sendMessageToApi(message: String): Result<ChatResponse> = withContext(Dispatchers.IO) {
        try {
            val response = api.sendMessage(ChatRequest(message))
            Result.success(response)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun parseQuizOptions(optionsJson: String): List<String> {
        return try {
            json.decodeFromString<List<String>>(optionsJson)
        } catch (e: Exception) {
            emptyList()
        }
    }
}
