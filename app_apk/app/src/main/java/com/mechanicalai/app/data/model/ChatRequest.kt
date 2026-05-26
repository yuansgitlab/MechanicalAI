package com.mechanicalai.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ChatRequest(
    val message: String
)
