package com.mechanicalai.app.data.api

import android.content.Context
import com.mechanicalai.app.BuildConfig
import com.mechanicalai.app.data.settings.SettingsRepository
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    private val loggingInterceptor = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BODY
        } else {
            HttpLoggingInterceptor.Level.NONE
        }
    }

    private val okHttpClient = OkHttpClient.Builder()
        .addInterceptor(loggingInterceptor)
        .connectTimeout(60, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    fun createApiService(context: Context): ApiService {
        val settingsRepository = SettingsRepository.getInstance(context)
        val baseUrl = settingsRepository.getApiBaseUrl()
        
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory(
                kotlinx.serialization.json.Json(contentType = okhttp3.MediaType.Companion.parse("application/json")!!
            ))
            .build()
            .create(ApiService::class.java)
    }
    
    val api: ApiService by lazy {
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory(
                kotlinx.serialization.json.Json(contentType = okhttp3.MediaType.Companion.parse("application/json")!!
            ))
            .build()
            .create(ApiService::class.java)
    }
}
