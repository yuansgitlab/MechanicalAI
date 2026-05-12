from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import json
import os

app = FastAPI()

# 允许跨域请求，方便前端部署在不同域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DEEPSEEK_API_KEY = "你的DEEPSEEK_API_KEY" # 建议通过环境变量读取
API_URL = "https://api.deepseek.com/v1/chat/completions"

class ChatRequest(BaseModel):
    message: str

@app.post("/api/chat")
async def chat(request: ChatRequest):
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                API_URL,
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": os.getenv("SYSTEM_PROMPT")}, # 引用刚才定义的Prompt
                        {"role": "user", "content": request.message}
                    ],
                    "response_format": {"type": "json_object"} # 强制要求返回JSON
                },
                timeout=60.0
            )
            
            result = response.json()
            # 解析模型生成的字符串为JSON对象
            content = json.loads(result['choices'][0]['message']['content'])
            return content
            
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)