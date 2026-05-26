package com.mechanicalai.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.ForeignKey
import androidx.room.Index
import kotlinx.serialization.Serializable

@Entity(
    tableName = "quiz_items",
    foreignKeys = [
        ForeignKey(
            entity = SessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["sessionId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("sessionId")]
)
@Serializable
data class QuizEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val sessionId: Long,
    val question: String,
    val optionsJson: String, // JSON格式存储选项列表
    val answer: String,
    val analysis: String,
    val difficulty: String? = null,
    val isAnswered: Boolean = false,
    val isCorrect: Boolean? = null,
    val orderIndex: Int = 0
)
