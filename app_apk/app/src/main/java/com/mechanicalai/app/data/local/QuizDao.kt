package com.mechanicalai.app.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface QuizDao {
    @Query("SELECT * FROM quiz_items WHERE sessionId = :sessionId ORDER BY orderIndex ASC")
    fun getQuizForSession(sessionId: Long): Flow<List<QuizEntity>>

    @Query("SELECT * FROM quiz_items WHERE sessionId = :sessionId ORDER BY orderIndex ASC")
    suspend fun getQuizForSessionSync(sessionId: Long): List<QuizEntity>

    @Insert
    suspend fun insertQuizItem(quiz: QuizEntity): Long

    @Insert
    suspend fun insertQuizItems(quizzes: List<QuizEntity>)

    @Update
    suspend fun updateQuizItem(quiz: QuizEntity)

    @Query("DELETE FROM quiz_items WHERE sessionId = :sessionId")
    suspend fun deleteQuizForSession(sessionId: Long)
}
