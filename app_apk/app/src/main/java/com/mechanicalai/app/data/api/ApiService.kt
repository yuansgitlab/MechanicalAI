package com.mechanicalai.app.data.api

import com.mechanicalai.app.data.model.ChatRequest
import com.mechanicalai.app.data.model.ChatResponse
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.POST

interface ApiService {
    @POST("api/chat")
    suspend fun sendMessage(@Body request: ChatRequest): ChatResponse
}
