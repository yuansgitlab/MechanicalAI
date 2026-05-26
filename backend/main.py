import os
import json
import httpx
from datetime import datetime
from typing import List, Dict
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from prompts import SYSTEM_PROMPT

app = FastAPI()

# 跨域配置：允许你的 Vercel 前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 从环境变量获取 API Key
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
API_URL = "https://api.deepseek.com/v1/chat/completions"

# ============================================
# 评论系统数据结构
# ============================================
class Comment(BaseModel):
    id: str
    author: str
    topic: str
    category: str
    content: str
    timestamp: str
    likes: int = 0
    replies: List[Dict] = []

# 内存存储评论数据（生产环境建议使用数据库）
comments_db: List[Comment] = []
active_connections: List[WebSocket] = []

# 初始化一些示例评论
def init_sample_comments():
    sample_comments = [
        Comment(
            id="1",
            author="李明轩",
            topic="使用MechanicalAI三个月后的真实感受",
            category="control",
            content="强烈推荐给控制工程专业的同学！特别是它的知识诊断功能，能精准定位我的薄弱环节。我之前对频域分析一直很模糊，用了两个月后明显感觉理解深入了很多。",
            timestamp="2024-05-15T10:30:00Z",
            likes=24,
            replies=[
                {"author": "王同学", "content": "同感！我也在用", "timestamp": "2024-05-15T11:00:00Z"}
            ]
        ),
        Comment(
            id="2",
            author="张雨晨",
            topic="求助：拉普拉斯变换记忆技巧",
            category="control",
            content="拉普拉斯变换的公式太多了，总是记不住。有没有好的记忆方法或者理解技巧？MechanicalAI能给我一些建议吗？",
            timestamp="2024-05-14T15:20:00Z",
            likes=18,
            replies=[]
        ),
        Comment(
            id="3",
            author="王思远",
            topic="智能闯关测试功能太棒了！",
            category="mechanical",
            content="发现一个很棒的功能：智能闯关测试！题目难度递进，解析也很详细，对期末复习帮助很大。强烈建议大家试试！",
            timestamp="2024-05-13T09:45:00Z",
            likes=42,
            replies=[]
        )
    ]
    comments_db.extend(sample_comments)

init_sample_comments()

# ============================================
# 评论系统 API
# ============================================
class CreateCommentRequest(BaseModel):
    author: str
    topic: str
    category: str
    content: str

@app.get("/api/comments")
async def get_comments(category: str = None):
    if category and category != "all":
        return [c for c in comments_db if c.category == category]
    return comments_db

@app.post("/api/comments")
async def create_comment(request: CreateCommentRequest):
    comment = Comment(
        id=str(len(comments_db) + 1),
        author=request.author,
        topic=request.topic,
        category=request.category,
        content=request.content,
        timestamp=datetime.utcnow().isoformat() + "Z",
        likes=0,
        replies=[]
    )
    comments_db.insert(0, comment)
    # 广播新评论到所有连接的客户端
    for connection in active_connections:
        await connection.send_json({
            "type": "new_comment",
            "comment": comment.model_dump()
        })
    return comment

@app.post("/api/comments/{comment_id}/like")
async def like_comment(comment_id: str):
    for comment in comments_db:
        if comment.id == comment_id:
            comment.likes += 1
            # 广播点赞更新
            for connection in active_connections:
                await connection.send_json({
                    "type": "like_update",
                    "comment_id": comment_id,
                    "likes": comment.likes
                })
            return {"success": True, "likes": comment.likes}
    raise HTTPException(status_code=404, detail="Comment not found")

@app.websocket("/ws/comments")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            data = await websocket.receive_json()
    except WebSocketDisconnect:
        active_connections.remove(websocket)

# ============================================
# 原有的聊天 API
# ============================================
class ChatRequest(BaseModel):
    message: str
    history: List[Dict] = []  # 对话历史记录

@app.get("/")
async def root():
    return {"status": "Engineer AI Backend is running"}

@app.post("/api/chat")
async def chat(request: ChatRequest):
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="API Key not configured")

    # 构建包含历史对话的消息列表
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    # 添加历史对话
    if request.history:
        for history_msg in request.history:
            if 'role' in history_msg and 'content' in history_msg:
                messages.append({
                    "role": history_msg['role'],
                    "content": history_msg['content']
                })
    
    # 添加当前用户消息
    messages.append({"role": "user", "content": request.message})

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
                    "messages": messages,
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7
                },
                timeout=60.0
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)
            
            result = response.json()
            # 解析模型生成的 JSON 字符串
            content_str = result['choices'][0]['message']['content']
            return json.loads(content_str)
            
        except Exception as e:
            print(f"Error: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))