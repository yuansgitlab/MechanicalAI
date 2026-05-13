FROM python:3.9-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制源码
COPY . .

# Hugging Face Spaces 默认监听 7860 端口
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]