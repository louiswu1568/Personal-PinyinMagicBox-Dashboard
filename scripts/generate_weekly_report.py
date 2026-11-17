#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小小魔法學習樂園 v3.0 — 家長週報產生器 (scripts/generate_weekly_report.py)
架構設計：
  1. build_weekly_summary(data: dict) -> dict  (純資料彙整層，與渲染層完全解耦)
  2. render_weekly_html(summary: dict) -> str  (自給式單檔 HTML 渲染層，內嵌 CSS，可直接用於 Email 寄送或部署至 Vercel)
輸出路徑：
  - Report/weekly/YYYY-Www_Parent_Report.html
  - Report/weekly/index.html
"""

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, List

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_EXPORT_PATH = ROOT_DIR / "Report" / "data" / "progress_export.json"
WEEKLY_DIR = ROOT_DIR / "Report" / "weekly"

SUBJECT_LABELS = {
    "bopomofo": "🪄 國語注音",
    "english": "🔤 英文樂園",
    "math": "🔢 數學城堡",
    "multiplication": "✖️ 99乘法表",
}


def create_default_sample_progress() -> Dict[str, Any]:
    """當尚無匯出檔時，建立一份預設的小公主學習進度結構供週報初始化"""
    today = datetime.now().strftime("%Y-%m-%d")
    return {
        "version": 3,
        "profile": {
            "nickname": "小公主",
            "createdAt": datetime.now().isoformat(),
            "soundEnabled": True,
            "animEnabled": True,
        },
        "questions": {},
        "daily": {
            today: {
                "seconds": 0,
                "answered": 0,
                "correct": 0,
                "prompted30m": False,
                "bySubject": {
                    "bopomofo": {"answered": 0, "correct": 0},
                    "english": {"answered": 0, "correct": 0},
                    "math": {"answered": 0, "correct": 0},
                    "multiplication": {"answered": 0, "correct": 0},
                },
            }
        },
        "rewards": {
            "stars": 0,
            "pets": ["unicorn_baby"],
            "stickers": [],
            "storyChapter": 1,
        },
        "streakDays": 1,
        "lastStudyDate": today,
    }


def build_weekly_summary(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    【資料彙整層】將 localStorage 匯出的進度 JSON 轉換為家長週報結構化摘要。
    完全不依賴檔案系統或 HTML 模板，方便未來直接由 API / Serverless Function 呼叫。
    """
    now = datetime.now()
    iso_year, iso_week, _ = now.isocalendar()
    week_id = f"{iso_year}-W{iso_week:02d}"

    profile = data.get("profile") or {}
    nickname = profile.get("nickname") or "小公主"
    rewards = data.get("rewards") or {}
    stars = int(rewards.get("stars") or 0)
    pets = rewards.get("pets") or ["unicorn_baby"]
    stickers = rewards.get("stickers") or []
    story_chapter = int(rewards.get("storyChapter") or 1)
    streak_days = int(data.get("streakDays") or 1)

    if stars >= 501:
        stage_name = "👑 第 4 階段：傳奇大魔法師"
    elif stars >= 201:
        stage_name = "🌟 第 3 階段：星光魔法師"
    elif stars >= 51:
        stage_name = "✨ 第 2 階段：魔法小學徒"
    else:
        stage_name = "🌱 第 1 階段：新手魔法師"

    # 統計最近 7 天每日學習時間與答題數
    daily_map = data.get("daily") or {}
    daily_rows: List[Dict[str, Any]] = []
    total_seconds = 0
    total_answered = 0
    total_correct = 0

    subject_totals = {
        k: {"label": v, "answered": 0, "correct": 0, "accuracy": 0}
        for k, v in SUBJECT_LABELS.items()
    }

    for i in range(6, -1, -1):
        d_str = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        slot = daily_map.get(d_str) or {}
        sec = int(slot.get("seconds") or 0)
        ans = int(slot.get("answered") or 0)
        cor = int(slot.get("correct") or 0)
        acc = round((cor / ans) * 100) if ans > 0 else 0

        total_seconds += sec
        total_answered += ans
        total_correct += cor

        by_subj = slot.get("bySubject") or {}
        for sk, s_stat in by_subj.items():
            if sk in subject_totals and isinstance(s_stat, dict):
                subject_totals[sk]["answered"] += int(s_stat.get("answered") or 0)
                subject_totals[sk]["correct"] += int(s_stat.get("correct") or 0)

        daily_rows.append({
            "date": d_str,
            "minutes": round(sec / 60, 1),
            "seconds": sec,
            "answered": ans,
            "correct": cor,
            "accuracy": acc,
        })

    for sk, st in subject_totals.items():
        st["accuracy"] = round((st["correct"] / st["answered"]) * 100) if st["answered"] > 0 else 0

    # 分析題目紀錄：找出最弱單元 Top 5 與待複習錯題清單
    questions_map = data.get("questions") or {}
    unit_stats: Dict[str, Dict[str, Any]] = {}
    wrong_items: List[Dict[str, Any]] = []

    for q_key, rec in questions_map.items():
        if not isinstance(rec, dict):
            continue
        subj = rec.get("subject", "bopomofo")
        cat = rec.get("category", "general")
        u_key = f"{SUBJECT_LABELS.get(subj, subj)}・{cat}"
        if u_key not in unit_stats:
            unit_stats[u_key] = {"unit": u_key, "seen": 0, "wrong": 0, "correct": 0}
        unit_stats[u_key]["seen"] += int(rec.get("seen") or 0)
        unit_stats[u_key]["wrong"] += int(rec.get("wrong") or 0)
        unit_stats[u_key]["correct"] += int(rec.get("correct") or 0)

        if int(rec.get("wrong") or 0) > 0 and int(rec.get("box") or 1) < 4:
            wrong_items.append({
                "subject": SUBJECT_LABELS.get(subj, subj),
                "title": rec.get("title") or str(rec.get("id")),
                "wrong": int(rec.get("wrong") or 0),
                "box": int(rec.get("box") or 1),
                "nextDue": rec.get("nextDue") or "",
                "explain": rec.get("explain") or "",
            })

    weak_units = sorted(
        [u for u in unit_stats.values() if u["wrong"] > 0],
        key=lambda x: (x["wrong"], -x["correct"]),
        reverse=True,
    )[:5]

    wrong_items.sort(key=lambda x: (-x["wrong"], x["box"]))
    overall_accuracy = round((total_correct / total_answered) * 100) if total_answered > 0 else 100

    # 產生下週學習建議
    recommendations = []
    if len(wrong_items) > 0:
        recommendations.append(f"目前錯題本共有 {len(wrong_items)} 題待加強，建議每天先點選「✨ 今日魔法複習」完成間隔複習。")
    else:
        recommendations.append("目前沒有積壓的錯題，保持得非常好！可以多挑戰三拼注音、20 以內進退位加減與九九乘法應用題。")

    if total_seconds < 7 * 15 * 60:
        recommendations.append("本週累計學習時間較有彈性，建議維持每日 15～30 分鐘的固定練習節奏，建立穩定學習習慣。")
    else:
        recommendations.append("本週學習時間非常充實！請持續注意用眼休息，每滿 30 分鐘望向遠方放鬆眼睛。")

    return {
        "week_id": week_id,
        "generated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "nickname": nickname,
        "stage_name": stage_name,
        "stars": stars,
        "pets_count": len(pets),
        "stickers_count": len(stickers),
        "story_chapter": story_chapter,
        "streak_days": streak_days,
        "total_minutes": round(total_seconds / 60, 1),
        "total_answered": total_answered,
        "total_correct": total_correct,
        "overall_accuracy": overall_accuracy,
        "daily_rows": daily_rows,
        "subject_totals": list(subject_totals.values()),
        "weak_units": weak_units,
        "wrong_items": wrong_items[:20],
        "recommendations": recommendations,
    }


def render_weekly_html(summary: Dict[str, Any]) -> str:
    """
    【HTML 渲染層】輸出自給式單檔 HTML（內嵌完整 CSS，不依賴任何本機圖片或外部檔案），
    可直接作為家長 Email 週報內文，或直接部署至 Vercel (vercel.app)。
    """
    daily_tr = "\n".join(
        f"""
        <tr>
            <td>{r['date']}</td>
            <td>{r['minutes']} 分鐘</td>
            <td>{r['answered']} 題</td>
            <td>{r['correct']} 題</td>
            <td><strong>{r['accuracy']}%</strong></td>
        </tr>
        """
        for r in summary["daily_rows"]
    )

    subj_tr = "\n".join(
        f"""
        <tr>
            <td><strong>{s['label']}</strong></td>
            <td>{s['answered']} 題</td>
            <td>{s['correct']} 題</td>
            <td><span class="pill">{s['accuracy']}%</span></td>
        </tr>
        """
        for s in summary["subject_totals"]
    )

    if summary["weak_units"]:
        weak_tr = "\n".join(
            f"<li><strong>{u['unit']}</strong>：累計答錯 {u['wrong']} 次（共練習 {u['seen']} 次）</li>"
            for u in summary["weak_units"]
        )
    else:
        weak_tr = "<li>🎉 本週各單元表現均衡，尚無明顯弱項單元！</li>"

    if summary["wrong_items"]:
        wrong_tr = "\n".join(
            f"""
            <tr>
                <td>{w['subject']}</td>
                <td><strong>{w['title']}</strong></td>
                <td>📦 盒子 {w['box']}（錯 {w['wrong']} 次）</td>
                <td>{w['nextDue']}</td>
                <td>{w['explain']}</td>
            </tr>
            """
            for w in summary["wrong_items"]
        )
    else:
        wrong_tr = """
        <tr>
            <td colspan="5" style="text-align:center; color:#059669; font-weight:700;">
                🌟 太棒了！目前錯題本是空的，所有練習過的題目都已經熟練掌握！
            </td>
        </tr>
        """

    rec_li = "\n".join(f"<li>{r}</li>" for r in summary["recommendations"])

    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>小小魔法學習樂園 — {summary['nickname']}的家長週報 ({summary['week_id']})</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif;
            background: linear-gradient(135deg, #fdf2f8 0%, #eff6ff 50%, #f5f3ff 100%);
            color: #1e293b;
            margin: 0;
            padding: 28px 16px 56px;
            line-height: 1.65;
        }}
        .wrap {{
            max-width: 980px;
            margin: 0 auto;
        }}
        .hero {{
            background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);
            color: #ffffff;
            border-radius: 24px;
            padding: 28px 32px;
            box-shadow: 0 12px 28px rgba(236, 72, 153, 0.22);
            margin-bottom: 24px;
        }}
        .hero h1 {{
            margin: 0 0 8px;
            font-size: 1.75rem;
        }}
        .hero p {{
            margin: 0;
            opacity: 0.95;
        }}
        .kpi-row {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 14px;
            margin-bottom: 24px;
        }}
        .kpi {{
            background: #ffffff;
            border-radius: 18px;
            padding: 18px 20px;
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
            border-top: 4px solid #ec4899;
        }}
        .kpi .label {{
            font-size: 0.86rem;
            color: #64748b;
            font-weight: 700;
        }}
        .kpi .val {{
            font-size: 1.75rem;
            font-weight: 900;
            color: #0f172a;
            margin: 4px 0;
        }}
        .card {{
            background: #ffffff;
            border-radius: 20px;
            padding: 24px 28px;
            margin-bottom: 22px;
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.05);
        }}
        .card h2 {{
            margin: 0 0 14px;
            font-size: 1.25rem;
            color: #9d174d;
            border-bottom: 2px solid #fce7f3;
            padding-bottom: 8px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 0.92rem;
        }}
        th, td {{
            text-align: left;
            padding: 10px 12px;
            border-bottom: 1px solid #e2e8f0;
        }}
        th {{
            background: #fdf2f8;
            color: #831843;
        }}
        .pill {{
            background: #d1fae5;
            color: #065f46;
            padding: 2px 10px;
            border-radius: 999px;
            font-weight: 800;
            font-size: 0.82rem;
        }}
        footer {{
            text-align: center;
            color: #64748b;
            font-size: 0.85rem;
            margin-top: 24px;
        }}
    </style>
</head>
<body>
    <div class="wrap">
        <div class="hero">
            <h1>🎀 {summary['nickname']}的魔法學習家長週報（{summary['week_id']}）</h1>
            <p>河堤國小 × 康軒版（一上・一下 學習評量／新挑戰測驗卷）｜目前頭銜：{summary['stage_name']}｜產出時間：{summary['generated_at']}</p>
        </div>

        <div class="kpi-row">
            <div class="kpi">
                <div class="label">⏰ 本週學習時間</div>
                <div class="val">{summary['total_minutes']} 分鐘</div>
                <div class="label">每日目標 30 分鐘</div>
            </div>
            <div class="kpi">
                <div class="label">📝 本週完成題數</div>
                <div class="val">{summary['total_answered']} 題</div>
                <div class="label">答對 {summary['total_correct']} 題（{summary['overall_accuracy']}%）</div>
            </div>
            <div class="kpi">
                <div class="label">⭐ 累積魔法星星</div>
                <div class="val">{summary['stars']} 顆</div>
                <div class="label">連續學習 {summary['streak_days']} 天</div>
            </div>
            <div class="kpi">
                <div class="label">🦄 獎勵收藏進度</div>
                <div class="val">{summary['pets_count']} 寵 / {summary['stickers_count']} 貼紙</div>
                <div class="label">故事解鎖至第 {summary['story_chapter']} 章</div>
            </div>
        </div>

        <div class="card">
            <h2>一、四大主題學習館本週正確率統計</h2>
            <table>
                <thead>
                    <tr>
                        <th>學習館別</th>
                        <th>本週作答題數</th>
                        <th>答對題數</th>
                        <th>正確率</th>
                    </tr>
                </thead>
                <tbody>
                    {subj_tr}
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>二、最近 7 天每日學習紀錄</h2>
            <table>
                <thead>
                    <tr>
                        <th>日期</th>
                        <th>學習時間</th>
                        <th>作答題數</th>
                        <th>答對題數</th>
                        <th>正確率</th>
                    </tr>
                </thead>
                <tbody>
                    {daily_tr}
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>三、最需加強單元 Top 5 與下週學習建議</h2>
            <h3 style="font-size:1rem; color:#475569; margin:8px 0;">📌 重點加強單元：</h3>
            <ul>
                {weak_tr}
            </ul>
            <h3 style="font-size:1rem; color:#475569; margin:14px 0 8px;">💡 給家長的共學建議：</h3>
            <ul>
                {rec_li}
            </ul>
        </div>

        <div class="card">
            <h2>四、Leitner 錯題本與待複習題目明細</h2>
            <table>
                <thead>
                    <tr>
                        <th>科目</th>
                        <th>題目內容</th>
                        <th>Leitner 記憶盒狀態</th>
                        <th>下次複習日</th>
                        <th>魔法解析</th>
                    </tr>
                </thead>
                <tbody>
                    {wrong_tr}
                </tbody>
            </table>
        </div>

        <footer>
            小小魔法學習樂園 v3.0 · 單檔自給式 HTML 週報（支援直接寄送 Email 或部署至 Vercel 平台）
        </footer>
    </div>
</body>
</html>
"""


def render_weekly_index_html(report_files: List[str], generated_at: str) -> str:
    rows = "\n".join(
        f'<li><a href="{fname}">{fname}</a></li>'
        for fname in sorted(report_files, reverse=True)
    )
    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>小小魔法學習樂園 — 歷次家長週報索引</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif;
            background: #fdf2f8;
            color: #1e293b;
            padding: 36px 20px;
        }}
        .box {{
            max-width: 760px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 20px;
            padding: 28px 32px;
            box-shadow: 0 8px 24px rgba(236, 72, 153, 0.12);
        }}
        h1 {{ color: #be185d; margin-top: 0; }}
        li {{ margin: 10px 0; font-size: 1.05rem; font-weight: 700; }}
        a {{ color: #2563eb; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
    </style>
</head>
<body>
    <div class="box">
        <h1>📊 小小魔法學習樂園 — 歷次家長週報清單</h1>
        <p>最後更新時間：{generated_at}</p>
        <ul>
            {rows}
        </ul>
    </div>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description="產生小小魔法學習樂園 HTML 家長週報")
    parser.add_argument(
        "--input",
        type=str,
        default=str(DEFAULT_EXPORT_PATH),
        help="前端匯出的進度 JSON 路徑 (預設: Report/data/progress_export.json)",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        input_path.parent.mkdir(parents=True, exist_ok=True)
        sample_data = create_default_sample_progress()
        input_path.write_text(json.dumps(sample_data, ensure_ascii=False, indent=2), encoding="utf-8")
        data = sample_data
    else:
        data = json.loads(input_path.read_text(encoding="utf-8"))

    WEEKLY_DIR.mkdir(parents=True, exist_ok=True)

    summary = build_weekly_summary(data)
    html_str = render_weekly_html(summary)

    weekly_filename = f"{summary['week_id']}_Parent_Report.html"
    weekly_path = WEEKLY_DIR / weekly_filename
    weekly_path.write_text(html_str, encoding="utf-8")

    existing_reports = [
        p.name for p in WEEKLY_DIR.glob("*_Parent_Report.html")
    ]
    index_path = WEEKLY_DIR / "index.html"
    index_path.write_text(
        render_weekly_index_html(existing_reports, summary["generated_at"]),
        encoding="utf-8",
    )

    print("[OK] Generated Parent Weekly Reports:")
    print(f"  - {weekly_path}")
    print(f"  - {index_path}")


if __name__ == "__main__":
    main()

