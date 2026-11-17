#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pinyin Magic Box (注音魔法盒) - Flask 後端應用
提供前後端分離架構之題庫 API、比對驗證、注音分類及音效擴充支援。
"""

import os
import sys
import json
import time
import random
import hashlib
import threading
import webbrowser
from typing import Dict, Any, List, Optional
from flask import Flask, render_template, jsonify, request

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["JSON_AS_ASCII"] = False
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


@app.after_request
def add_no_cache_headers(response):
    """禁止瀏覽器快取靜態資源與 API 回應，確保每次載入皆為最新題庫與前端邏輯"""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def shuffle_question_options(q: Dict[str, Any], subject: Optional[str] = None) -> Dict[str, Any]:
    """回傳題目淺拷貝並動態打亂 options 順序，確保正確答案隨機落在不同選項位置"""
    if not q or not isinstance(q, dict):
        return q
    q_copy = dict(q)
    opts = q_copy.get("options")
    if isinstance(opts, list) and len(opts) > 1:
        q_copy["options"] = random.sample(opts, len(opts))
    if subject and "explain" not in q_copy:
        q_copy["explain"] = generate_question_explain(subject, q_copy)
    return q_copy


def generate_question_explain(subject: str, q: Dict[str, Any]) -> str:
    """為題目生成兒童友善的答錯解析 (explain)，幫助小一學生理解原因"""
    if not q or not isinstance(q, dict):
        return "再仔細看一次題目，慢慢想一定可以答對喔！"
    if q.get("explain"):
        return str(q["explain"])

    if subject == "bopomofo":
        py = f"{q.get('initial', '')}{q.get('medial', '')}{q.get('final', '')}{q.get('tone_symbol', '')}"
        tone_map = {"1": "一聲", "2": "二聲(ˊ)", "3": "三聲(ˇ)", "4": "四聲(ˋ)", "5": "輕聲(˙)"}
        tone_str = tone_map.get(str(q.get("tone", "1")), "一聲")
        pin_type = f"三拼（含介母 {q.get('medial')}）" if q.get("type") == "3-pin" else "二拼"
        return f"💡 魔法解析：「{q.get('character', '')}」（{q.get('word', '')}）讀作【{py}】，屬於{pin_type}，聲調是{tone_str}喔！"

    if subject == "english":
        w = q.get("word") or q.get("sample_word") or q.get("target") or q.get("display") or ""
        ans = q.get("answer") or q.get("target") or w
        meaning = q.get("meaning") or ""
        return f"💡 魔法解析：【{w}】的中文意思是「{meaning}」，正確答案選【{ans}】，跟著語音大聲唸一次更容易記住喔！"

    if subject == "math":
        cat = q.get("category", "")
        ans = q.get("answer", "")
        formula = q.get("formula", "")
        if cat == "bonds":
            return f"💡 魔法解析：合十與分解小秘訣 — {formula}，想一想「幾加幾會湊成 10 或總數」，答案是【{ans}】喔！"
        if cat == "clock":
            return f"💡 魔法解析：看時鐘小口訣 — 短針指小時、長針指 12 是整點、指 6 是半點（30分），所以正確時間是【{ans}】！"
        if cat == "money":
            return f"💡 魔法解析：超市小玩家 — 先數大硬幣（50元、10元）再數小硬幣（5元、1元），{formula} 正確答案是【{ans}】！"
        return f"💡 魔法解析：{('算式「' + formula + '」') if formula else ''}{q.get('prompt', '')} 正確答案是【{ans}】，可以用手指或數線算算看喔！"

    if subject == "multiplication":
        a = q.get("base", "")
        b = q.get("multiplier", "")
        chant = q.get("chant", "")
        ans = q.get("answer", "")
        return f"💡 魔法解析：{a} × {b} 代表「{b} 個 {a} 相加」，背誦口訣【{chant}】，就能算出答案是【{ans}】囉！"

    return "💡 魔法解析：看清楚題目提示，再試一次吧！"


def _get_correct_option_index(q: Dict[str, Any]) -> int:
    """找出題目中正確答案在 options 陣列中的索引位置"""
    opts = q.get("options")
    if not isinstance(opts, list) or len(opts) <= 1:
        return -1
    correct_val = q.get("answer") if q.get("answer") is not None else q.get("target")
    if correct_val is None:
        return -1
    for idx, opt in enumerate(opts):
        if isinstance(opt, dict):
            val = opt.get("val") if opt.get("val") is not None else opt.get("en")
        else:
            val = opt
        if str(val) == str(correct_val):
            return idx
    return -1


def shuffle_session_questions_balanced(questions: List[Dict[str, Any]], subject: str) -> List[Dict[str, Any]]:
    """
    對整回題目清單進行平衡洗牌：
    1. 第 1 題 (index 0) 正確答案絕不落在第 1 個選項 (index 0)
    2. 連續兩題正確答案位置絕不重複
    3. 自動補齊 explain 與 subject 欄位
    """
    result = []
    last_correct_idx: Optional[int] = None

    for round_idx, raw_q in enumerate(questions):
        q = shuffle_question_options(raw_q, subject=subject)
        q["subject"] = subject
        opts = q.get("options")
        if isinstance(opts, list) and len(opts) > 1:
            c_idx = _get_correct_option_index(q)
            if c_idx != -1:
                must_avoid_zero = (round_idx == 0 and c_idx == 0)
                is_repeated = (last_correct_idx is not None and c_idx == last_correct_idx)
                if must_avoid_zero or is_repeated:
                    candidates = [
                        i for i in range(len(opts))
                        if i != c_idx
                        and not (round_idx == 0 and i == 0)
                        and not (last_correct_idx is not None and i == last_correct_idx)
                    ]
                    if candidates:
                        target_idx = random.choice(candidates)
                        opts[c_idx], opts[target_idx] = opts[target_idx], opts[c_idx]
                        c_idx = target_idx
                last_correct_idx = c_idx
        result.append(q)
    return result

# 基礎路徑設定
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data", "questions.json")
ENGLISH_DATA_FILE = os.path.join(BASE_DIR, "data", "english_questions.json")
MATH_DATA_FILE = os.path.join(BASE_DIR, "data", "math_questions.json")
MULTIPLICATION_DATA_FILE = os.path.join(BASE_DIR, "data", "multiplication_questions.json")
AUDIO_DIR = os.path.join(BASE_DIR, "static", "audio")

# 確保資料夾存在 (在 Vercel 等雲端唯讀環境下安全跳過)
try:
    os.makedirs(os.path.join(BASE_DIR, "data"), exist_ok=True)
    os.makedirs(AUDIO_DIR, exist_ok=True)
except OSError:
    pass

# 台灣教育部標準注音符號分類表
BOPOMOFO_CATEGORIES = {
    # 聲母 (21個)
    "initials": [
        "ㄅ", "ㄆ", "ㄇ", "ㄈ",
        "ㄉ", "ㄊ", "ㄋ", "ㄌ",
        "ㄍ", "ㄎ", "ㄏ",
        "ㄐ", "ㄑ", "ㄒ",
        "ㄓ", "ㄔ", "ㄕ", "ㄖ",
        "ㄗ", "ㄘ", "ㄙ"
    ],
    # 介母 (3個)
    "medials": ["ㄧ", "ㄨ", "ㄩ"],
    # 韻母 (13個 + 結合韻輔助)
    "finals": [
        "ㄚ", "ㄛ", "ㄜ", "ㄝ",
        "ㄞ", "ㄟ", "ㄠ", "ㄡ",
        "ㄢ", "ㄣ", "ㄤ", "ㄥ",
        "ㄦ"
    ],
    # 聲調 (5種)
    "tones": [
        {"id": "1", "symbol": " ", "name": "一聲 (陰平)", "display": "— (一聲)"},
        {"id": "2", "symbol": "ˊ", "name": "二聲 (陽平)", "display": "ˊ (二聲)"},
        {"id": "3", "symbol": "ˇ", "name": "三聲 (上聲)", "display": "ˇ (三聲)"},
        {"id": "4", "symbol": "ˋ", "name": "四聲 (去聲)", "display": "ˋ (四聲)"},
        {"id": "5", "symbol": "˙", "name": "輕聲 (輕聲)", "display": "˙ (輕聲)"}
    ]
}

# 預設題庫 (若 questions.json 尚未建立或為空時使用)
DEFAULT_QUESTIONS = [
    {
        "id": 1,
        "character": "巴",
        "emoji": "🚌",
        "word": "巴士",
        "type": "2-pin",
        "difficulty": "easy",
        "initial": "ㄅ",
        "medial": "",
        "final": "ㄚ",
        "tone": "1",
        "tone_symbol": "",
        "hint": "二拼：ㄅ + ㄚ (一聲)"
    },
    {
        "id": 2,
        "character": "馬",
        "emoji": "🐎",
        "word": "小馬",
        "type": "2-pin",
        "difficulty": "easy",
        "initial": "ㄇ",
        "medial": "",
        "final": "ㄚ",
        "tone": "3",
        "tone_symbol": "ˇ",
        "hint": "二拼：ㄇ + ㄚ + ˇ (三聲)"
    },
    {
        "id": 3,
        "character": "地",
        "emoji": "🌍",
        "word": "地球",
        "type": "2-pin",
        "difficulty": "easy",
        "initial": "ㄉ",
        "medial": "",
        "final": "ㄧ",
        "tone": "4",
        "tone_symbol": "ˋ",
        "hint": "二拼：ㄉ + ㄧ + ˋ (四聲)"
    },
    {
        "id": 4,
        "character": "兔",
        "emoji": "🐰",
        "word": "白兔",
        "type": "2-pin",
        "difficulty": "easy",
        "initial": "ㄊ",
        "medial": "",
        "final": "ㄨ",
        "tone": "4",
        "tone_symbol": "ˋ",
        "hint": "二拼：ㄊ + ㄨ + ˋ (四聲)"
    },
    {
        "id": 5,
        "character": "歌",
        "emoji": "🎵",
        "word": "唱歌",
        "type": "2-pin",
        "difficulty": "easy",
        "initial": "ㄍ",
        "medial": "",
        "final": "ㄜ",
        "tone": "1",
        "tone_symbol": "",
        "hint": "二拼：ㄍ + ㄜ (一聲)"
    },
    {
        "id": 6,
        "character": "瓜",
        "emoji": "🍉",
        "word": "西瓜",
        "type": "3-pin",
        "difficulty": "medium",
        "initial": "ㄍ",
        "medial": "ㄨ",
        "final": "ㄚ",
        "tone": "1",
        "tone_symbol": "",
        "hint": "三拼：ㄍ + ㄨ + ㄚ (一聲)"
    },
    {
        "id": 7,
        "character": "花",
        "emoji": "🌸",
        "word": "花朵",
        "type": "3-pin",
        "difficulty": "medium",
        "initial": "ㄏ",
        "medial": "ㄨ",
        "final": "ㄚ",
        "tone": "1",
        "tone_symbol": "",
        "hint": "三拼：ㄏ + ㄨ + ㄚ (一聲)"
    },
    {
        "id": 8,
        "character": "鳥",
        "emoji": "🐦",
        "word": "小鳥",
        "type": "3-pin",
        "difficulty": "medium",
        "initial": "ㄋ",
        "medial": "ㄧ",
        "final": "ㄠ",
        "tone": "3",
        "tone_symbol": "ˇ",
        "hint": "三拼：ㄋ + ㄧ + ㄠ + ˇ (三聲)"
    },
    {
        "id": 9,
        "character": "雪",
        "emoji": "❄️",
        "word": "白雪",
        "type": "3-pin",
        "difficulty": "medium",
        "initial": "ㄒ",
        "medial": "ㄩ",
        "final": "ㄝ",
        "tone": "3",
        "tone_symbol": "ˇ",
        "hint": "三拼：ㄒ + ㄩ + ㄝ + ˇ (三聲)"
    },
    {
        "id": 10,
        "character": "電",
        "emoji": "⚡",
        "word": "閃電",
        "type": "3-pin",
        "difficulty": "medium",
        "initial": "ㄉ",
        "medial": "ㄧ",
        "final": "ㄢ",
        "tone": "4",
        "tone_symbol": "ˋ",
        "hint": "三拼：ㄉ + ㄧ + ㄢ + ˋ (四聲)"
    }
]


def load_questions() -> List[Dict[str, Any]]:
    """從 data/questions.json 讀取題庫，若無則回傳預設題庫並儲存"""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                questions = json.load(f)
                if questions and isinstance(questions, list):
                    return questions
        except Exception as e:
            print(f"[Warn] 讀取題庫檔案錯誤: {e}，改用預設題庫")
    # 寫入預設題庫
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_QUESTIONS, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Warn] 寫入預設題庫失敗: {e}")
    return DEFAULT_QUESTIONS


def normalize_tone(tone_val: Any) -> str:
    """統一聲調整數或符號為標準符號或聲調代碼"""
    tone_str = str(tone_val).strip()
    mapping = {
        "": "1", "1": "1", "一": "1", "一聲": "1", " ": "1",
        "ˊ": "2", "2": "2", "二": "2", "二聲": "2",
        "ˇ": "3", "3": "3", "三": "3", "三聲": "3",
        "ˋ": "4", "4": "4", "四": "4", "四聲": "4",
        "˙": "5", "5": "5", "五": "5", "輕聲": "5"
    }
    return mapping.get(tone_str, tone_str)


# ==============================
# 前端主頁面路由
# ==============================
@app.route("/")
def index():
    """渲染前端遊戲主頁面"""
    return render_template("index.html", v=int(time.time()))


# ==============================
# RESTful API 路由 (前後端分離)
# ==============================
@app.route("/api/categories", methods=["GET"])
def get_categories():
    """取得注音各分類清單 (聲母/介母/韻母/聲調)"""
    return jsonify({
        "status": "success",
        "data": BOPOMOFO_CATEGORIES
    })


@app.route("/api/questions", methods=["GET"])
def get_questions():
    """
    取得題目清單，支援難度與類型過濾
    Query string:
      - type: 'all' | '2-pin' | '3-pin'
      - limit: int
    """
    q_type = request.args.get("type", "all").strip().lower()
    limit = request.args.get("limit", type=int)

    all_q = load_questions()
    if q_type in ["2-pin", "3-pin"]:
        filtered = [q for q in all_q if q.get("type") == q_type]
    else:
        filtered = all_q

    if limit and limit > 0:
        filtered = filtered[:limit]

    return jsonify({
        "status": "success",
        "count": len(filtered),
        "data": filtered
    })


@app.route("/api/questions/random", methods=["GET"])
def get_random_question():
    """隨機取得一題"""
    q_type = request.args.get("type", "all").strip().lower()
    all_q = load_questions()

    if q_type in ["2-pin", "3-pin"]:
        pool = [q for q in all_q if q.get("type") == q_type]
    else:
        pool = all_q

    if not pool:
        pool = all_q

    selected = random.choice(pool) if pool else DEFAULT_QUESTIONS[0]
    return jsonify({
        "status": "success",
        "data": selected
    })


@app.route("/api/verify", methods=["POST"])
def verify_answer():
    """
    驗證學生作答答案
    Payload:
    {
        "question_id": 1,
        "user_answer": {
            "initial": "ㄅ",
            "medial": "",
            "final": "ㄚ",
            "tone": "ˇ" (或 "3")
        }
    }
    """
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"status": "error", "message": "無效的請求資料"}), 400

    q_id = payload.get("question_id")
    user_ans = payload.get("user_answer", {})

    all_q = load_questions()
    target_q = next((q for q in all_q if q["id"] == q_id), None)

    if not target_q:
        return jsonify({"status": "error", "message": f"找不到題目 ID: {q_id}"}), 404

    # 提取並修剪作答
    u_initial = str(user_ans.get("initial", "") or "").strip()
    u_medial = str(user_ans.get("medial", "") or "").strip()
    u_final = str(user_ans.get("final", "") or "").strip()
    u_tone_norm = normalize_tone(user_ans.get("tone", "1"))

    # 正確答案
    c_initial = str(target_q.get("initial", "") or "").strip()
    c_medial = str(target_q.get("medial", "") or "").strip()
    c_final = str(target_q.get("final", "") or "").strip()
    c_tone_norm = normalize_tone(target_q.get("tone", "1"))

    # 各項細部比對
    initial_ok = (u_initial == c_initial)
    medial_ok = (u_medial == c_medial)
    final_ok = (u_final == c_final)
    tone_ok = (u_tone_norm == c_tone_norm)

    # 兒童友善容錯：若為二拼單母音（例如 ㄉㄧ、ㄊㄨ），介母與韻母格允許靈活填放
    if not (medial_ok and final_ok) and (target_q.get("type") == "2-pin"):
        user_vowels = set([u_medial, u_final]) - {""}
        correct_vowels = set([c_medial, c_final]) - {""}
        if user_vowels == correct_vowels:
            medial_ok = True
            final_ok = True

    is_all_correct = initial_ok and medial_ok and final_ok and tone_ok

    # 產生溫和且具體的提示語
    guidance = []
    if not initial_ok:
        guidance.append("聲母（最上面的音）要再看一看喔！")
    if not medial_ok and target_q.get("type") == "3-pin":
        guidance.append("介母（中間的音 ㄧ/ㄨ/ㄩ）要記得放進去喔！")
    if not final_ok:
        guidance.append("韻母（底下的音）可以再試試看！")
    if not tone_ok:
        guidance.append("聲調（旁邊的符號）差一點點，唸唸看是第幾聲？")

    friendly_hint = " ".join(guidance) if guidance else "答對了！太厲害了！"

    # 組合完整的注音字串
    full_pinyin = f"{c_initial}{c_medial}{c_final}{target_q.get('tone_symbol', '')}"

    return jsonify({
        "status": "success",
        "correct": is_all_correct,
        "message": "恭喜你！完全答對了！" if is_all_correct else "再加油，差一點點就成功囉！",
        "friendly_hint": friendly_hint,
        "character": target_q["character"],
        "emoji": target_q.get("emoji", ""),
        "word": target_q.get("word", ""),
        "full_pinyin": full_pinyin,
        "breakdown": {
            "initial": {"correct": c_initial, "user": u_initial, "matched": initial_ok},
            "medial": {"correct": c_medial, "user": u_medial, "matched": medial_ok},
            "final": {"correct": c_final, "user": u_final, "matched": final_ok},
            "tone": {"correct": c_tone_norm, "user": u_tone_norm, "matched": tone_ok}
        }
    })


@app.route("/api/audio/status", methods=["GET"])
def audio_status():
    """檢查本地自訂音效檔案清單 (方便外接音效擴充)"""
    available_files = []
    if os.path.exists(AUDIO_DIR):
        available_files = [f for f in os.listdir(AUDIO_DIR) if f.lower().endswith((".mp3", ".wav", ".ogg"))]

    return jsonify({
        "status": "success",
        "audio_dir": "static/audio",
        "files": available_files,
        "supports_web_audio_fallback": True
    })


# ==============================
# 英文練習 API
# ==============================
def load_english_questions() -> List[Dict[str, Any]]:
    if os.path.exists(ENGLISH_DATA_FILE):
        try:
            with open(ENGLISH_DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Warn] 讀取英文題庫錯誤: {e}")
    return []


@app.route("/api/english/questions", methods=["GET"])
def get_english_questions():
    """取得英文題目清單，支援 category 過濾 (alphabet, phonics, sight_words, thematic)"""
    cat = request.args.get("category", "all").strip().lower()
    limit = request.args.get("limit", type=int)
    all_q = load_english_questions()
    if cat != "all":
        filtered = [q for q in all_q if q.get("category") == cat]
    else:
        filtered = all_q
    if limit and limit > 0:
        filtered = filtered[:limit]
    shuffled_data = [shuffle_question_options(q, subject="english") for q in filtered]
    return jsonify({
        "status": "success",
        "count": len(shuffled_data),
        "data": shuffled_data
    })


@app.route("/api/english/questions/random", methods=["GET"])
def get_random_english_question():
    """隨機取得一題英文題目"""
    cat = request.args.get("category", "all").strip().lower()
    all_q = load_english_questions()
    pool = [q for q in all_q if q.get("category") == cat] if cat != "all" else all_q
    if not pool:
        pool = all_q
    selected = shuffle_question_options(random.choice(pool), subject="english") if pool else {}
    return jsonify({
        "status": "success",
        "data": selected
    })


# ==============================
# 數學練習 API
# ==============================
def load_math_questions() -> List[Dict[str, Any]]:
    if os.path.exists(MATH_DATA_FILE):
        try:
            with open(MATH_DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Warn] 讀取數學題庫錯誤: {e}")
    return []


@app.route("/api/math/questions", methods=["GET"])
def get_math_questions():
    """取得數學題目清單，支援 category 過濾 (counting, compare, bonds, addition, subtraction, clock, money)"""
    cat = request.args.get("category", "all").strip().lower()
    limit = request.args.get("limit", type=int)
    all_q = load_math_questions()
    if cat != "all":
        filtered = [q for q in all_q if q.get("category") == cat]
    else:
        filtered = all_q
    if limit and limit > 0:
        filtered = filtered[:limit]
    shuffled_data = [shuffle_question_options(q, subject="math") for q in filtered]
    return jsonify({
        "status": "success",
        "count": len(shuffled_data),
        "data": shuffled_data
    })


@app.route("/api/math/questions/random", methods=["GET"])
def get_random_math_question():
    """隨機取得一題數學題目"""
    cat = request.args.get("category", "all").strip().lower()
    all_q = load_math_questions()
    pool = [q for q in all_q if q.get("category") == cat] if cat != "all" else all_q
    if not pool:
        pool = all_q
    selected = shuffle_question_options(random.choice(pool), subject="math") if pool else {}
    return jsonify({
        "status": "success",
        "data": selected
    })


# ==============================
# 99乘法表練習 API
# ==============================
def load_multiplication_questions() -> List[Dict[str, Any]]:
    if os.path.exists(MULTIPLICATION_DATA_FILE):
        try:
            with open(MULTIPLICATION_DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Warn] 讀取乘法題庫錯誤: {e}")
    return []


@app.route("/api/multiplication/questions", methods=["GET"])
def get_multiplication_questions():
    """取得乘法題目清單，支援 category 過濾 (skip2_5_10, tables_3_4, tables_6_9, visual_array, speed_quiz)"""
    cat = request.args.get("category", "all").strip().lower()
    limit = request.args.get("limit", type=int)
    all_q = load_multiplication_questions()
    if cat != "all":
        filtered = [q for q in all_q if q.get("category") == cat]
    else:
        filtered = all_q
    if limit and limit > 0:
        filtered = filtered[:limit]
    shuffled_data = [shuffle_question_options(q, subject="multiplication") for q in filtered]
    return jsonify({
        "status": "success",
        "count": len(shuffled_data),
        "data": shuffled_data
    })


@app.route("/api/multiplication/questions/random", methods=["GET"])
def get_random_multiplication_question():
    """隨機取得一題乘法題目"""
    cat = request.args.get("category", "all").strip().lower()
    all_q = load_multiplication_questions()
    pool = [q for q in all_q if q.get("category") == cat] if cat != "all" else all_q
    if not pool:
        pool = all_q
    selected = shuffle_question_options(random.choice(pool), subject="multiplication") if pool else {}
    return jsonify({
        "status": "success",
        "data": selected
    })


# ==============================
# v3.0 智慧學習核心：30 題回合組卷 API (/api/session)
# ==============================
def _load_subject_pool(subject: str) -> List[Dict[str, Any]]:
    subject = (subject or "bopomofo").strip().lower()
    if subject == "english":
        return load_english_questions()
    if subject == "math":
        return load_math_questions()
    if subject == "multiplication":
        return load_multiplication_questions()
    return load_questions()


def _filter_pool_by_category(pool: List[Dict[str, Any]], subject: str, category: str) -> List[Dict[str, Any]]:
    cat = (category or "all").strip().lower()
    if not cat or cat in ("all", "review", "wrong_book"):
        return list(pool)

    if subject == "bopomofo":
        if cat in ("2-pin", "3-pin"):
            filtered = [q for q in pool if q.get("type") == cat]
            return filtered if filtered else list(pool)
        return list(pool)

    if subject == "english":
        if cat in ("sight", "sight_words"):
            filtered = [q for q in pool if q.get("category") == "sight_words"]
        else:
            filtered = [q for q in pool if q.get("category") == cat]
        return filtered if filtered else list(pool)

    if subject == "math":
        if cat == "add_sub":
            filtered = [q for q in pool if q.get("category") in ("addition", "subtraction")]
        else:
            filtered = [q for q in pool if q.get("category") == cat]
        return filtered if filtered else list(pool)

    if subject == "multiplication":
        filtered = [q for q in pool if q.get("category") == cat]
        return filtered if filtered else list(pool)

    return list(pool)


@app.route("/api/session", methods=["POST", "GET"])
def create_practice_session():
    """
    v3.0 學習核心：組建一回合（預設 30 題）練習題組
    規則：
    1. 每回合預設 30 題（size=30），回合內絕不重複同一題
    2. 優先納入前端傳入之到期複習 (due_ids) 與錯題 (weak_ids)，佔比預設 <= 40% (12 題)，新題 >= 60% (18 題)
       若 mode='review_only'，則盡可能排入所有 due_ids / weak_ids，不足時再以新題補足
    3. 單元題數若不足 size，自動從同科其他單元補齊至 size 題
    4. 選項經過平衡隨機洗牌（第 1 題正解不在 index 0，連續兩題正解不重複位置），並附帶 explain 解析
    """
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
    else:
        payload = {
            "subject": request.args.get("subject", "bopomofo"),
            "category": request.args.get("category", "all"),
            "size": request.args.get("size", 30, type=int),
            "mode": request.args.get("mode", "standard"),
            "due_ids": [],
            "weak_ids": [],
        }

    subject = str(payload.get("subject") or "bopomofo").strip().lower()
    if subject not in ("bopomofo", "english", "math", "multiplication"):
        subject = "bopomofo"

    category = str(payload.get("category") or "all").strip().lower()
    mode = str(payload.get("mode") or "standard").strip().lower()
    try:
        size = int(payload.get("size") or 30)
    except (ValueError, TypeError):
        size = 30
    size = max(1, min(size, 100))

    raw_due = payload.get("due_ids") or []
    raw_weak = payload.get("weak_ids") or []
    due_set = {str(x) for x in raw_due if x is not None}
    weak_set = {str(x) for x in raw_weak if x is not None}

    full_pool = _load_subject_pool(subject)
    cat_pool = _filter_pool_by_category(full_pool, subject, category)

    max_review_quota = size if mode == "review_only" else int(size * 0.4)

    # 先從單元池（若為 review_only 則從全科池）尋找符合 due_ids 與 weak_ids 的題目
    review_source_pool = full_pool if mode == "review_only" or category in ("review", "wrong_book") else cat_pool
    due_candidates = [q for q in review_source_pool if str(q.get("id")) in due_set]
    weak_candidates = [
        q for q in review_source_pool
        if str(q.get("id")) in weak_set and str(q.get("id")) not in due_set
    ]

    random.shuffle(due_candidates)
    random.shuffle(weak_candidates)

    selected: List[Dict[str, Any]] = []
    used_ids = set()

    for q in due_candidates + weak_candidates:
        if len(selected) >= max_review_quota:
            break
        qid = str(q.get("id"))
        if qid not in used_ids:
            q_copy = dict(q)
            q_copy["is_review"] = True
            selected.append(q_copy)
            used_ids.add(qid)

    review_count = len(selected)

    # 再從該單元池抽取新題補足至 size
    remaining_cat = [q for q in cat_pool if str(q.get("id")) not in used_ids]
    random.shuffle(remaining_cat)
    for q in remaining_cat:
        if len(selected) >= size:
            break
        qid = str(q.get("id"))
        if qid not in used_ids:
            q_copy = dict(q)
            q_copy["is_review"] = False
            selected.append(q_copy)
            used_ids.add(qid)

    # 若該單元題數不足 size，從同科其他單元補齊
    if len(selected) < size:
        remaining_full = [q for q in full_pool if str(q.get("id")) not in used_ids]
        random.shuffle(remaining_full)
        for q in remaining_full:
            if len(selected) >= size:
                break
            qid = str(q.get("id"))
            if qid not in used_ids:
                q_copy = dict(q)
                q_copy["is_review"] = False
                selected.append(q_copy)
                used_ids.add(qid)

    new_count = len(selected) - review_count
    random.shuffle(selected)

    balanced_questions = shuffle_session_questions_balanced(selected, subject=subject)

    return jsonify({
        "status": "success",
        "subject": subject,
        "category": category,
        "size": size,
        "count": len(balanced_questions),
        "review_count": review_count,
        "new_count": new_count,
        "data": balanced_questions
    })


@app.route("/api/weekly-report/html", methods=["POST"])
def generate_online_weekly_report_html():
    """
    線上即時渲染家長週報 HTML（相容本地端與 Vercel 雲端無狀態環境）
    輸入前端 localStorage 的進度 JSON，回傳完整單檔 HTML 供瀏覽器直接開啟預覽或下載。
    """
    from scripts.generate_weekly_report import (
        build_weekly_summary,
        render_weekly_html,
        create_default_sample_progress,
    )
    payload = request.get_json(silent=True)
    if not payload or not isinstance(payload, dict):
        payload = create_default_sample_progress()
    summary = build_weekly_summary(payload)
    html_str = render_weekly_html(summary)
    return jsonify({
        "status": "success",
        "week_id": summary.get("week_id", ""),
        "html": html_str,
    })


# 與 FinanceFree-XQ-Pub 同源之安全金庫 SHA-256 雜湊值 (不以明文暴露密鑰)
DEFAULT_VAULT_SHA256 = "bdbb3eb181b1c97639b88949cfc07a7bcbf9137a8a9ec81b7431c77fd0350363"


@app.route("/api/auth/verify", methods=["POST"])
def verify_vault_passkey():
    """
    安全金庫通行密鑰驗證端點 (與 FinanceFree-XQ-Pub 一致)
    支援環境變數 REPORT_SECURITY_KEY 覆寫，預設採用 SHA-256 雜湊比對。
    """
    payload = request.get_json(silent=True) or {}
    passkey = str(payload.get("passkey") or "").strip()
    if not passkey:
        return jsonify({"status": "error", "authenticated": False, "message": "請輸入金庫通行密鑰"}), 401

    custom_key = os.environ.get("REPORT_SECURITY_KEY", "").strip()
    expected_sha256 = (
        hashlib.sha256(custom_key.encode("utf-8")).hexdigest()
        if custom_key
        else os.environ.get("REPORT_SECURITY_KEY_SHA256", DEFAULT_VAULT_SHA256).strip().lower()
    )
    actual_sha256 = hashlib.sha256(passkey.encode("utf-8")).hexdigest().lower()

    if actual_sha256 == expected_sha256:
        return jsonify({"status": "success", "authenticated": True})
    return jsonify({"status": "error", "authenticated": False, "message": "通行密鑰錯誤"}), 403


@app.route("/api/health", methods=["GET"])
def health_check():
    """伺服器健康檢查端點 (供開機自動啟動腳本偵測就緒狀態)"""
    return jsonify({"status": "ok", "service": "pinyin-magic-box"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    debug_mode = os.environ.get("FLASK_DEBUG", "0").strip() in ("1", "true", "True")
    auto_open = (
        "--open-browser" in sys.argv
        or os.environ.get("AUTO_OPEN_BROWSER", "0").strip() in ("1", "true", "True")
    )

    print("=" * 60)
    print("★ 注音魔法盒 (Pinyin Magic Box) 伺服器啟動中 ★")
    print(f"本地端瀏覽網址: http://localhost:{port}")
    print("API 規格: /api/questions, /api/categories, /api/verify, /api/health")
    print("獨立環境提示：已鎖定專屬 Port 8000 (絕不佔用 5000 Port)")
    print("=" * 60)

    if auto_open:
        def _open_browser():
            webbrowser.open(f"http://localhost:{port}")
        threading.Timer(1.2, _open_browser).start()

    app.run(host="0.0.0.0", port=port, debug=debug_mode)


