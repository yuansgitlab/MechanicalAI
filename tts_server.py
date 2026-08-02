"""
Qwen3-TTS 本地服务 (FastAPI)
=========================================
= 修复 2026-08-02 =
1. 模型 ID 必须带 12Hz 前缀：Qwen3-TTS-12Hz-0.6B-CustomVoice
   (之前的  Qwen/Qwen3-TTS-0.6B-CustomVoice 根本不存在)
2. 国内用户默认从 ModelScope(魔搭) 下载，不走 HuggingFace
3. 4 个内置音色映射到官方 9 种预置 speaker：
     默认女声 -> Vivian  温柔女声 -> Serena
     活力女声 -> Summer  沉稳男声 -> Dylan
4. generate_custom_voice 走 qwen_tts 官方 API
= 功能 =
- POST /tts      : 文本转语音 WAV
- GET  /speakers : 内置 + 克隆音色列表
- POST /clone    : 上传参考音频克隆音色
- GET  /health   : 健康检查
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
from typing import Optional, Tuple

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response

app = FastAPI(title="QwenTTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== 全局状态 =====
MODEL = None          # 类型: qwen_tts 官方 model 对象
PROCESSOR = None
MODEL_SIZE = "0.6B"
MODEL_ID_CANDIDATES = []        # 运行时填充候选 model_id
MODEL_LOADED = False
LOAD_ERROR: Optional[str] = None
SPEAKERS_DIR: Optional[Path] = None
REF_DIR: Optional[Path] = None
FRONTEND_ASSETS: Optional[Path] = None

# 4 个内置音色 -> Qwen3-TTS 官方预置 speaker name
# 官方 CustomVoice 9 种： Vivian, Serena, Summer, Eric, Dylan, Ryan, Lily, Tina, Kevin
# Vivian = 默认女声   Serena = 温柔女声   Summer = 活力女声   Dylan = 沉稳男声
BUILTIN_MAP: dict[str, str] = {
    "默认女声": "Vivian",
    "温柔女声": "Serena",
    "活力女声": "Summer",
    "沉稳男声": "Dylan",
}
BUILTIN_SPEAKERS = list(BUILTIN_MAP.keys())
cloned_speakers: dict[str, Path] = {}   # name -> wav 路径


# ==================== 模型加载 ====================
def _build_candidate_ids(model_size: str, prefer_modelscope: bool) -> list[str]:
    """按优先级构造候选 model_id 列表"""
    tag = "12Hz"          # 必须带这个前缀，否则仓库不存在
    base = f"Qwen3-TTS-{tag}-{model_size}-CustomVoice"
    cand = []
    if prefer_modelscope:
        # ModelScope 写法：  qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
        cand.append(f"qwen/{base}")
        cand.append(f"qwen/{base.lower()}")
    # HuggingFace 写法：  Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
    cand.append(f"Qwen/{base}")
    cand.append(f"Qwen/{base.lower()}")
    # 最后兜底：不带 tag 的旧版（大概率不存在，但保留作兼容）
    cand.append(f"Qwen/Qwen3-TTS-{model_size}-CustomVoice")
    return cand


def load_model(model_size: str, prefer_modelscope: bool = True):
    global MODEL, PROCESSOR, MODEL_LOADED, LOAD_ERROR
    if MODEL_LOADED:
        return

    # ========= 中国用户：把 HF_ENDPOINT 设为魔搭镜像 =========
    if prefer_modelscope and not os.environ.get("HF_ENDPOINT"):
        os.environ["HF_ENDPOINT"] = "https://www.modelscope.cn"
        print("[TTS] HF_ENDPOINT -> https://www.modelscope.cn (国内镜像更快)", flush=True)

    candidates = _build_candidate_ids(model_size, prefer_modelscope)
    MODEL_ID_CANDIDATES.extend(candidates)

    print(f"[TTS] 开始加载 Qwen3-TTS-{model_size}，候选 model_id:", flush=True)
    for c in candidates:
        print(f"       - {c}", flush=True)

    last_err: Optional[Exception] = None
    t0 = time.time()

    for mid in candidates:
        try:
            print(f"\n[TTS] 尝试加载: {mid} ...", flush=True)

            # ---- 方法 1: qwen_tts 官方 SDK ----
            try:
                from qwen_tts import Qwen3TTSModel
                # 官方推荐加载方式
                model_obj = Qwen3TTSModel.from_pretrained(mid, trust_remote_code=True)
                MODEL = model_obj
                MODEL_LOADED = True
                print(f"[TTS] √ Qwen3TTSModel.from_pretrained('{mid}') 成功", flush=True)
                break
            except Exception as e1:
                print(f"      Qwen3TTSModel 失败: {type(e1).__name__}: {e1}", flush=True)
                # 继续尝试 AutoProcessor / AutoModelForTextToWaveform

            # ---- 方法 2: transformers 通用 API ----
            from transformers import AutoModelForTextToWaveform, AutoProcessor
            proc = AutoProcessor.from_pretrained(mid, trust_remote_code=True)
            mdl = AutoModelForTextToWaveform.from_pretrained(
                mid,
                trust_remote_code=True,
                torch_dtype="auto",
            )
            try:
                import torch
                if torch.cuda.is_available():
                    mdl = mdl.cuda()
                    print("[TTS] 使用 GPU (CUDA)", flush=True)
                elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    mdl = mdl.to("mps")
                    print("[TTS] 使用 MPS (Apple Silicon)", flush=True)
                else:
                    print("[TTS] 使用 CPU 推理", flush=True)
            except Exception:
                pass
            mdl.eval()
            PROCESSOR = proc
            MODEL = mdl
            MODEL_LOADED = True
            print(f"[TTS] √ transformers AutoModel 加载成功: {mid}", flush=True)
            break

        except Exception as ex:
            last_err = ex
            msg = f"{type(ex).__name__}: {ex}"
            print(f"      × 失败: {msg[:200]}", flush=True)
            continue

    if not MODEL_LOADED:
        if last_err:
            LOAD_ERROR = f"{type(last_err).__name__}: {last_err}"
        else:
            LOAD_ERROR = "所有候选 model_id 加载都失败"
        print(f"\n[TTS] 模型加载彻底失败: {LOAD_ERROR}", flush=True)
        print("[TTS] 建议操作:", flush=True)
        print("      1. 手动从 https://www.modelscope.cn/models/qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice 下载", flush=True)
        print("      2. 解压到本地目录，启动时加 --model-dir D:/path/to/model", flush=True)
        return

    print(f"[TTS] 总耗时 {time.time()-t0:.1f}s\n", flush=True)


def load_model_from_local(local_dir: str):
    """从本地文件夹直接加载（手动下载后使用）"""
    global MODEL, PROCESSOR, MODEL_LOADED, LOAD_ERROR
    if MODEL_LOADED:
        return
    t0 = time.time()
    print(f"[TTS] 从本地目录加载: {local_dir}", flush=True)
    try:
        from qwen_tts import Qwen3TTSModel
        MODEL = Qwen3TTSModel.from_pretrained(local_dir, trust_remote_code=True)
        MODEL_LOADED = True
    except Exception as e1:
        try:
            from transformers import AutoModelForTextToWaveform, AutoProcessor
            PROCESSOR = AutoProcessor.from_pretrained(local_dir, trust_remote_code=True)
            mdl = AutoModelForTextToWaveform.from_pretrained(
                local_dir, trust_remote_code=True, torch_dtype="auto"
            )
            try:
                import torch
                if torch.cuda.is_available():
                    mdl = mdl.cuda()
                elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    mdl = mdl.to("mps")
            except Exception:
                pass
            mdl.eval()
            MODEL = mdl
            MODEL_LOADED = True
        except Exception as e2:
            LOAD_ERROR = f"本地加载失败(官方): {e1}; (transformers): {e2}"
            print(f"[TTS] {LOAD_ERROR}", flush=True)
            return
    print(f"[TTS] 本地目录加载成功，耗时 {time.time()-t0:.1f}s", flush=True)


def ensure_loaded():
    if not MODEL_LOADED:
        load_model(MODEL_SIZE)
    if not MODEL_LOADED:
        raise HTTPException(status_code=500, detail=f"TTS 模型未加载: {LOAD_ERROR}")
    return MODEL, PROCESSOR


# ==================== 工具函数 ====================
def save_wav_bytes(audio: np.ndarray, sr: int) -> bytes:
    import soundfile as sf
    buf = io.BytesIO()
    audio = np.clip(audio, -1.0, 1.0)
    audio_i16 = (audio * 32767.0).astype(np.int16)
    sf.write(buf, audio_i16, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def text_preprocess(text: str) -> str:
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


def detect_language(text: str) -> str:
    """简单语言检测 -> 'chinese'/'english'/'japanese'... 给 generate_custom_voice 用"""
    import re
    if re.search(r"[\u4e00-\u9fff]", text):
        return "chinese"
    if re.search(r"[\u3040-\u30ff]", text):
        return "japanese"
    if re.search(r"[\uac00-\ud7af]", text):
        return "korean"
    return "english"


# ==================== API ====================
@app.get("/health")
def health():
    return {
        "ok": True,
        "model_loaded": MODEL_LOADED,
        "model_size": MODEL_SIZE,
        "load_error": LOAD_ERROR,
        "candidate_model_ids": MODEL_ID_CANDIDATES,
        "speakers": list_speakers(),
    }


def list_speakers() -> list[str]:
    return BUILTIN_SPEAKERS + list(cloned_speakers.keys())


@app.get("/speakers")
def speakers():
    return {"speakers": list_speakers()}


@app.post("/clone")
async def clone_voice(
    audio: UploadFile = File(...),
    speaker_name: str = Form(default=""),
):
    if not REF_DIR:
        raise HTTPException(status_code=500, detail="REF_DIR not set")
    try:
        content = await audio.read()
        if len(content) < 10_000:
            raise HTTPException(status_code=400, detail="音频太短")
        ext = os.path.splitext(audio.filename or "audio.wav")[1].lower() or ".wav"
        name = speaker_name.strip() or (audio.filename or "我的音色").rsplit(".", 1)[0]
        name = "".join(ch for ch in name if ch.isalnum() or ch in "_- \u4e00-\u9fff").strip()
        if not name:
            name = f"clone_{uuid.uuid4().hex[:6]}"
        base, i = name, 0
        while name in cloned_speakers:
            i += 1
            name = f"{base}_{i}"
        save_path = REF_DIR / f"{name}_{uuid.uuid4().hex[:6]}{ext}"
        save_path.write_bytes(content)
        cloned_speakers[name] = save_path
        print(f"[TTS] 音色克隆: {name} -> {save_path.name}", flush=True)
        return {"ok": True, "speaker": name, "saved_path": str(save_path)}
    except HTTPException:
        raise
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"{type(ex).__name__}: {ex}")


def _synthesize(text: str, speaker_label: Optional[str]) -> Tuple[np.ndarray, int]:
    """核心合成函数：
    - 如果 speaker_label 是克隆音色 -> few-shot 参考音频 (voice 参数)
    - 否则 -> 官方预置 speaker (Vivian/Serena/Summer/Dylan 等)
    """
    ensure_loaded()

    # 1) 判断是否是克隆音色
    is_cloned = bool(speaker_label and speaker_label in cloned_speakers)
    ref_audio: Optional[str] = str(cloned_speakers[speaker_label]) if is_cloned else None

    # 2) 若是内置音色 -> 映射到官方 speaker 英文名
    builtin_speaker: Optional[str] = None
    if not is_cloned and speaker_label:
        builtin_speaker = BUILTIN_MAP.get(speaker_label, BUILTIN_MAP["默认女声"])

    lang = detect_language(text)

    # ========== 方法 A：直接调用官方 model.generate_custom_voice ==========
    if hasattr(MODEL, "generate_custom_voice"):
        try:
            import torch
            with torch.no_grad():
                if is_cloned:
                    # few-shot 克隆音色
                    out = MODEL.generate_custom_voice(
                        text=text,
                        language=lang,
                        voice=ref_audio,   # 官方用 voice 传参考音频路径
                    )
                else:
                    # 官方预置 speaker
                    out = MODEL.generate_custom_voice(
                        text=text,
                        language=lang,
                        speaker=builtin_speaker or "Vivian",
                    )
            if isinstance(out, tuple):
                audio = out[0]
                sr = out[1] if len(out) > 1 else 24000
            else:
                audio = out
                sr = 24000
            # 取第一个样本
            try:
                audio_np = audio[0].float().cpu().numpy()
            except Exception:
                audio_np = np.array(audio, dtype=np.float32)
            if audio_np.ndim > 1:
                audio_np = audio_np[0]
            return audio_np, int(sr)
        except Exception as ea:
            print(f"[TTS] generate_custom_voice 异常: {ea}", flush=True)
            # 继续尝试方法 B

    # ========== 方法 B：processor + model.generate ==========
    if PROCESSOR is not None:
        try:
            import torch
            kwargs = dict(
                text=[text],
                return_tensors="pt",
                sampling_rate=24000,
            )
            if is_cloned:
                kwargs["voice"] = ref_audio
            elif builtin_speaker:
                kwargs["speaker"] = builtin_speaker
            inputs = PROCESSOR(**kwargs)
            try:
                dev = next(MODEL.parameters()).device
                for k in list(inputs.keys()):
                    if hasattr(inputs[k], "to"):
                        inputs[k] = inputs[k].to(dev)
            except Exception:
                pass
            with torch.no_grad():
                out = MODEL.generate(**inputs)
            if isinstance(out, tuple):
                audio = out[0]
                sr = out[1] if len(out) > 1 else 24000
            else:
                audio = out
                sr = 24000
            try:
                audio_np = audio[0].float().cpu().numpy()
            except Exception:
                audio_np = np.array(audio, dtype=np.float32)
            if audio_np.ndim > 1:
                audio_np = audio_np[0]
            return audio_np, int(sr)
        except Exception as eb:
            raise RuntimeError(f"Both methods failed. A: {ea}; B: {eb}") from eb

    raise RuntimeError(f"没有可用的合成方法，model={type(MODEL).__name__}")


@app.post("/tts")
async def tts_endpoint(body: dict):
    text_raw = (body or {}).get("text") or ""
    speaker = (body or {}).get("speaker") or BUILTIN_SPEAKERS[0]
    text = text_preprocess(text_raw)
    if not text:
        raise HTTPException(status_code=400, detail="文本为空")
    if len(text) > 500:
        text = text[:500] + "……"

    t0 = time.time()
    audio, sr = _synthesize(text, speaker)
    wav_bytes = save_wav_bytes(audio, sr)
    ms = int((time.time() - t0) * 1000)
    print(
        f"[TTS] speaker={speaker} text_len={len(text)} "
        f"size_kb={len(wav_bytes)//1024} latency={ms}ms",
        flush=True,
    )
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
    import re
    text_raw = (body or {}).get("text") or ""
    speaker = (body or {}).get("speaker") or BUILTIN_SPEAKERS[0]
    text = text_preprocess(text_raw)
    if not text:
        raise HTTPException(status_code=400, detail="文本为空")

    parts = re.split(r"(?<=[。！？\.!?\n])", text)
    parts = [p.strip() for p in parts if p.strip()] or [text]

    def gen():
        first = True
        for part in parts:
            audio, sr = _synthesize(part, speaker)
            data = save_wav_bytes(audio, sr)
            if first:
                yield data
                first = False
            else:
                yield data[44:]

    return StreamingResponse(gen(), media_type="audio/wav")


# ==================== 启动 ====================
def write_frontend_config(port: int, host: str, speaker: str):
    if not FRONTEND_ASSETS or not FRONTEND_ASSETS.exists():
        return
    cfg = {
        "serverUrl": f"http://{host}:{port}",
        "speaker": speaker,
        "model_size": MODEL_SIZE,
        "builtin_speaker_map": BUILTIN_MAP,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    out = FRONTEND_ASSETS / "tts-config.json"
    try:
        out.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[TTS] 前端配置 -> {out}", flush=True)
    except Exception as ex:
        print(f"[TTS] 写入前端配置失败: {ex}", flush=True)


def main():
    global MODEL_SIZE, SPEAKERS_DIR, REF_DIR, FRONTEND_ASSETS
    parser = argparse.ArgumentParser(description="Qwen3-TTS FastAPI Server (修复版)")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--model-size", type=str, default="0.6B", choices=["0.6B", "1.8B"])
    parser.add_argument("--lazy", action="store_true", help="首次 TTS 请求才加载模型")
    parser.add_argument("--no-modelscope", action="store_true", help="禁用 ModelScope 镜像（纯 HF）")
    parser.add_argument("--model-dir", type=str, default="", help="本地已下载的模型目录（手动下好后用）")
    args = parser.parse_args()

    MODEL_SIZE = args.model_size
    port = args.port if args.port else get_free_port(8766)

    base = Path(__file__).resolve().parent
    data_dir = base / "tts_data"
    data_dir.mkdir(exist_ok=True)
    REF_DIR = data_dir / "ref_audios"
    REF_DIR.mkdir(exist_ok=True)
    SPEAKERS_DIR = data_dir / "speakers"
    SPEAKERS_DIR.mkdir(exist_ok=True)
    FRONTEND_ASSETS = base / "frontend" / "assets"
    FRONTEND_ASSETS.mkdir(parents=True, exist_ok=True)

    # 有本地目录就直接加载本地
    if args.model_dir:
        load_model_from_local(args.model_dir)
    elif not args.lazy:
        load_model(MODEL_SIZE, prefer_modelscope=not args.no_modelscope)

    write_frontend_config(port, args.host, BUILTIN_SPEAKERS[0])

    if args.lazy:
        print("[TTS] --lazy 模式：首次 /tts 请求才加载模型", flush=True)

    print(f"[TTS] 服务: http://{args.host}:{port}", flush=True)
    print(f"[TTS] 健康: http://127.0.0.1:{port}/health", flush=True)

    import uvicorn
    uvicorn.run(app, host=args.host, port=port, log_level="info")


if __name__ == "__main__":
    main()
