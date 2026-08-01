"""
Qwen3-TTS 本地服务 (FastAPI)
= 功能 =
- POST /tts  : 文本转语音，返回 WAV 音频 blob
- GET  /speakers : 列出所有内置 + 已克隆的音色
- POST /clone : 上传参考音频（5-15秒人声），克隆为自定义音色，返回音色名
- GET  /health : 健康检查（前端自动探测后端地址）

= 使用方法 =
1. 安装依赖:
   pip install -r requirements.txt      # 已有 fastapi/uvicorn
   pip install qwen-tts soundfile numpy transformers accelerate

2. 启动服务（默认端口 8766，与前端 digital-human.js 一致）:
   python tts_server.py

   # 自定义端口 / 模型大小（0.6B 推荐，1.8B音质更好更慢）
   python tts_server.py --port 8766 --model-size 0.6B --host 127.0.0.1

3. 部署到 Netlify 时注意：
   - 本地启动后会自动写 frontend/assets/tts-config.json，前端读取
   - 若在远程 GPU 服务器运行，则在前端面板点击"当前引擎"手动打开
   - 把 serverUrl 改成 http://你的服务器IP:端口
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import uuid
import socket
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response

app = FastAPI(title="QwenTTS Server")

# CORS：允许前端（任意端口/域）访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================== 全局状态 ==============================
MODEL = None
MODEL_SIZE = "0.6B"          # 0.6B | 1.8B
MODEL_LOADED = False
LOAD_ERROR: Optional[str] = None
SPEAKERS_DIR: Optional[Path] = None
REF_DIR: Optional[Path] = None
FRONTEND_ASSETS: Optional[Path] = None

# 预置音色：speaker_name -> (description, reference_audio_path|None)
# 如果 qwen-tts 自带 default / female / male 等预设，则直接使用名称
BUILTIN_SPEAKERS = ["默认女声", "温柔女声", "活力女声", "沉稳男声"]
cloned_speakers: dict[str, Path] = {}  # name -> 参考音频 wav 路径


# ============================== 模型懒加载 ==============================
def load_model(model_size: str):
    global MODEL, MODEL_LOADED, LOAD_ERROR
    if MODEL_LOADED:
        return
    try:
        print(f"[TTS] 正在加载 Qwen3-TTS-{model_size} (首次需要下载权重到本地 ~/.cache)...", flush=True)
        t0 = time.time()
        from qwen_tts import Qwen3TTSModel
        from transformers import AutoModelForTextToWaveform, AutoProcessor

        # qwen-tts 0.4+ 官方推荐加载方式：Model + Processor
        model_id = f"Qwen/Qwen3-TTS-{model_size}-CustomVoice"
        processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        model = AutoModelForTextToWaveform.from_pretrained(
            model_id,
            trust_remote_code=True,
            torch_dtype="auto",
            # 若 GPU 可用则自动用 GPU
            attn_implementation="sdpa",
        )
        # 尝试移动到 GPU
        try:
            import torch
            if torch.cuda.is_available():
                model = model.cuda()
                print("[TTS] 使用 GPU (CUDA) 推理", flush=True)
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                model = model.to("mps")
                print("[TTS] 使用 MPS (Apple Silicon) 推理", flush=True)
            else:
                print("[TTS] 使用 CPU 推理（较慢，建议有 GPU 的机器运行）", flush=True)
        except Exception as ex:
            print(f"[TTS] 设备检测失败，保持默认: {ex}", flush=True)

        model.eval()
        MODEL = (processor, model)
        MODEL_LOADED = True
        print(f"[TTS] 模型加载完成，耗时 {time.time() - t0:.1f}s", flush=True)
    except Exception as ex:
        LOAD_ERROR = f"{type(ex).__name__}: {ex}"
        print(f"[TTS] 模型加载失败: {LOAD_ERROR}", flush=True)
        # 不要直接退出——保留 /health 和 /clone 的基础能力，方便用户排错


def ensure_loaded():
    if not MODEL_LOADED:
        load_model(MODEL_SIZE)
    if not MODEL_LOADED:
        raise HTTPException(status_code=500, detail=f"TTS 模型未加载: {LOAD_ERROR}")
    return MODEL


# ============================== 工具函数 ==============================
def save_wav_bytes(audio: np.ndarray, sr: int) -> bytes:
    import soundfile as sf
    buf = io.BytesIO()
    # 归一化到 int16
    audio = np.clip(audio, -1.0, 1.0)
    audio_i16 = (audio * 32767.0).astype(np.int16)
    sf.write(buf, audio_i16, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def text_preprocess(text: str) -> str:
    """轻量文本预处理：只移除控制字符，不过滤任何可打印字符（避免破坏tokenizer）"""
    import unicodedata
    t = unicodedata.normalize("NFKC", text or "")
    t = "".join(ch for ch in t if ord(ch) >= 32 or ch in "\n\r\t")
    t = t.strip()
    return t if len(t) >= 2 else "嗯，我还没想好说什么。"


def get_free_port(prefer: int = 8766) -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", prefer))
        s.close()
        return prefer
    except OSError:
        s.close()
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        free = s.getsockname()[1]
        s.close()
        return free


# ============================== API 路由 ==============================
@app.get("/health")
def health():
    return {
        "ok": True,
        "model_loaded": MODEL_LOADED,
        "model_size": MODEL_SIZE,
        "load_error": LOAD_ERROR,
        "speakers": list_speakers(),
    }


def list_speakers() -> list[str]:
    return list(BUILTIN_SPEAKERS) + list(cloned_speakers.keys())


@app.get("/speakers")
def speakers():
    return {"speakers": list_speakers()}


@app.post("/clone")
async def clone_voice(
    audio: UploadFile = File(...),
    speaker_name: str = Form(default=""),
):
    """
    上传一段 5-15 秒的人声 wav/mp3/flac，克隆音色。
    返回 speaker_name （已注册到 speakers 列表）。
    """
    if not REF_DIR:
        raise HTTPException(status_code=500, detail="REF_DIR not set (init failed)")
    try:
        content = await audio.read()
        if len(content) < 10_000:
            raise HTTPException(status_code=400, detail="音频太短，至少需要几百毫秒的音频")
        ext = os.path.splitext(audio.filename or "audio.wav")[1].lower() or ".wav"
        # 解析名称
        name = speaker_name.strip() or audio.filename or "我的音色"
        name = "".join(ch for ch in name if ch.isalnum() or ch in "_- \u4e00-\u9fff").strip()
        if not name:
            name = f"clone_{uuid.uuid4().hex[:6]}"
        # 去重：同名自动加后缀
        base, i = name, 0
        while name in cloned_speakers:
            i += 1
            name = f"{base}_{i}"
        # 保存原始文件
        save_path = REF_DIR / f"{name}_{uuid.uuid4().hex[:6]}{ext}"
        save_path.write_bytes(content)
        cloned_speakers[name] = save_path
        print(f"[TTS] 已克隆音色: {name} -> {save_path}", flush=True)
        return {"ok": True, "speaker": name, "saved_path": str(save_path)}
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"{type(ex).__name__}: {ex}")


def _synthesize(text: str, speaker: Optional[str]) -> tuple[np.ndarray, int]:
    """内部调用 qwen-tts 生成音频"""
    processor, model = ensure_loaded()
    import torch

    # 确定参考音频：若 speaker 是克隆音色 -> 用它的 ref audio；否则用 qwen-tts 内置的默认"女声音色"音频
    ref_audio_path: Optional[str] = None
    if speaker and speaker in cloned_speakers:
        ref_audio_path = str(cloned_speakers[speaker])

    try:
        # 新版 qwen-tts (0.4+) 用法：processor + model.generate
        inputs = processor(
            text=[text],
            voice=ref_audio_path,  # 传 ref audio 路径即可做 few-shot 音色克隆
            return_tensors="pt",
            sampling_rate=24000,
        )
        # 移到模型所在设备
        try:
            dev = next(model.parameters()).device
            for k in list(inputs.keys()):
                if hasattr(inputs[k], "to"):
                    inputs[k] = inputs[k].to(dev)
        except Exception:
            pass
        with torch.no_grad():
            out = model.generate(**inputs)
        # generate 返回的通常是 [batch, samples]，取值，24kHz
        if isinstance(out, tuple):
            audio = out[0]
        else:
            audio = out
        audio_np = audio[0].float().cpu().numpy()
        # 若形状是 [channels, samples] 取第一声道
        if audio_np.ndim > 1:
            audio_np = audio_np[0]
        return audio_np, 24000
    except TypeError as e:
        # 若 processor 参数不匹配，尝试直接调 model 自定义接口
        try:
            # 回退路径：调用 generate_custom_voice 或更简单的 generate
            with torch.no_grad():
                if ref_audio_path and hasattr(model, "generate_custom_voice"):
                    audio = model.generate_custom_voice(text, ref_audio_path)
                else:
                    audio = model.generate(text)
            if isinstance(audio, tuple):
                audio = audio[0]
            audio_np = audio[0].float().cpu().numpy()
            if audio_np.ndim > 1:
                audio_np = audio_np[0]
            return audio_np, 24000
        except Exception as e2:
            raise RuntimeError(f"primary path: {e}; fallback path: {e2}")


@app.post("/tts")
async def tts_endpoint(
    body: dict,
):
    """
    body:
      text: 要合成的文本
      speaker: 可选，音色名（内置或克隆名）
      stream_audio: 可选 bool
    返回 WAV 音频 (audio/wav)
    """
    text_raw = (body or {}).get("text") or ""
    speaker = (body or {}).get("speaker") or BUILTIN_SPEAKERS[0]
    text = text_preprocess(text_raw)
    if not text:
        raise HTTPException(status_code=400, detail="文本为空")

    # 截断到合理长度，防止推理过久
    if len(text) > 500:
        text = text[:500] + "……"

    t0 = time.time()
    audio, sr = _synthesize(text, speaker)
    wav_bytes = save_wav_bytes(audio, sr)
    ms = int((time.time() - t0) * 1000)
    print(f"[TTS] speaker={speaker} text_len={len(text)} size_kb={len(wav_bytes)//1024} latency={ms}ms", flush=True)

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Length": str(len(wav_bytes)),
            "X-TTS-Latency": str(ms),
        },
    )


@app.post("/tts_stream")
async def tts_stream(body: dict):
    """
    流式 TTS：分句 + 边生成边 chunked transfer
    （若模型不支持流式生成，则至少实现 chunked 传输降低首包延迟感知）
    """
    import re
    text_raw = (body or {}).get("text") or ""
    speaker = (body or {}).get("speaker") or BUILTIN_SPEAKERS[0]
    text = text_preprocess(text_raw)
    if not text:
        raise HTTPException(status_code=400, detail="文本为空")

    # 简单分句
    parts = re.split(r"(?<=[。！？\.!?\n])", text)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        parts = [text]

    def gen():
        # 先输出 WAV 头（占位，真实长度不准确但浏览器通常仍可播放）
        first_chunk = True
        total_len = 0
        header_placeholders = b""
        for part in parts:
            audio, sr = _synthesize(part, speaker)
            data = save_wav_bytes(audio, sr)
            if first_chunk:
                header_placeholders = data[:44]  # 标准 WAV header
                yield data
                total_len += len(data)
                first_chunk = False
            else:
                # 去掉后续 chunk 的 wav header，直接拼接 PCM data（这样拼接的 wav 时长只按第一段算）
                # 简化：为保证浏览器都能播，每个 chunk 都是独立 WAV 包在 Multipart 中代价太高
                # 改为每句独立 WAV，由前端排队播放，所以这里直接整段返回
                yield data[44:]
                total_len += len(data) - 44

    return StreamingResponse(gen(), media_type="audio/wav")


# ============================== 启动入口 ==============================
def write_frontend_config(port: int, host: str, speaker: str):
    if not FRONTEND_ASSETS or not FRONTEND_ASSETS.exists():
        return
    cfg = {
        "serverUrl": f"http://{host}:{port}",
        "speaker": speaker,
        "model_size": MODEL_SIZE,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    out = FRONTEND_ASSETS / "tts-config.json"
    try:
        out.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[TTS] 已写入前端配置: {out}", flush=True)
    except Exception as ex:
        print(f"[TTS] 写入前端配置失败: {ex}", flush=True)


def main():
    global MODEL_SIZE, SPEAKERS_DIR, REF_DIR, FRONTEND_ASSETS
    parser = argparse.ArgumentParser(description="Qwen3-TTS FastAPI Server")
    parser.add_argument("--port", type=int, default=0, help="端口，0=自动选择，默认优先 8766")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="绑定地址；局域网访问请写 0.0.0.0")
    parser.add_argument("--model-size", type=str, default="0.6B", choices=["0.6B", "1.8B"], help="模型大小")
    parser.add_argument("--lazy", action="store_true", help="懒加载：第一次 /tts 请求时才载入模型")
    args = parser.parse_args()

    MODEL_SIZE = args.model_size
    port = args.port if args.port else get_free_port(8766)

    # 目录初始化
    base = Path(__file__).resolve().parent
    data_dir = base / "tts_data"
    data_dir.mkdir(exist_ok=True)
    REF_DIR = data_dir / "ref_audios"
    REF_DIR.mkdir(exist_ok=True)
    SPEAKERS_DIR = data_dir / "speakers"
    SPEAKERS_DIR.mkdir(exist_ok=True)
    FRONTEND_ASSETS = base / "frontend" / "assets"
    FRONTEND_ASSETS.mkdir(parents=True, exist_ok=True)

    # 启动时不阻塞预加载（除非 --lazy）
    if not args.lazy:
        load_model(MODEL_SIZE)

    # 提前写配置，前端才能探测到
    write_frontend_config(port, args.host, BUILTIN_SPEAKERS[0])

    # 首次 /tts 才加载模型的情况
    if args.lazy:
        print("[TTS] 已启用 --lazy ：第一次请求 /tts 时才加载模型，节省内存", flush=True)

    print(f"[TTS] 服务启动: http://{args.host}:{port}", flush=True)
    print(f"[TTS] 健康检查: http://127.0.0.1:{port}/health", flush=True)

    import uvicorn
    uvicorn.run(app, host=args.host, port=port, log_level="info")


if __name__ == "__main__":
    main()
