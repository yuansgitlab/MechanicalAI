package com.mechanicalai.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ChatResponse(
    val chat_response: String,
    val diagnosis: String,
    val quiz: List<QuizItem>,
    val study_plan: String
)

@Serializable
data class QuizItem(
    val question: String,
    val options: List<String>,
    val answer: String,
    val analysis: String,
    val difficulty: String? = null
)
