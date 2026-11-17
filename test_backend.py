import unittest
import json
from app import app

class FlaskAppTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_index_route(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"<!DOCTYPE html>", response.data)
        self.assertIn("注音魔法盒".encode('utf-8'), response.data)

    def test_categories_api(self):
        response = self.client.get('/api/categories')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertIn('initials', data['data'])
        self.assertIn('medials', data['data'])
        self.assertIn('finals', data['data'])
        self.assertIn('tones', data['data'])

    def test_questions_api(self):
        response = self.client.get('/api/questions?type=2-pin')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertTrue(len(data['data']) > 0)
        for q in data['data']:
            self.assertEqual(q['type'], '2-pin')

    def test_random_question_api(self):
        response = self.client.get('/api/questions/random?type=3-pin')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertEqual(data['data']['type'], '3-pin')

    def test_verify_answer_correct(self):
        payload = {
            "question_id": 1,  # "天" -> ㄊ + ㄧ + ㄢ (一聲)
            "user_answer": {
                "initial": "ㄊ",
                "medial": "ㄧ",
                "final": "ㄢ",
                "tone": "1"
            }
        }
        response = self.client.post('/api/verify',
                                    data=json.dumps(payload),
                                    content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertTrue(data['correct'])

    def test_verify_answer_incorrect(self):
        payload = {
            "question_id": 1,
            "user_answer": {
                "initial": "ㄅ",
                "medial": "ㄧ",
                "final": "ㄢ",
                "tone": "1"
            }
        }
        response = self.client.post('/api/verify',
                                    data=json.dumps(payload),
                                    content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertFalse(data['correct'])
        self.assertIn("聲母", data['friendly_hint'])

    def test_health_api(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['service'], 'pinyin-magic-box')

    def test_english_api(self):
        response = self.client.get('/api/english/questions?category=alphabet')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertTrue(len(data['data']) > 0)

        rand_resp = self.client.get('/api/english/questions/random')
        self.assertEqual(rand_resp.status_code, 200)
        rand_data = rand_resp.get_json()
        self.assertEqual(rand_data['status'], 'success')
        self.assertTrue('category' in rand_data['data'])

    def test_math_api(self):
        response = self.client.get('/api/math/questions?category=counting')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertTrue(len(data['data']) > 0)

        rand_resp = self.client.get('/api/math/questions/random')
        self.assertEqual(rand_resp.status_code, 200)
        rand_data = rand_resp.get_json()
        self.assertEqual(rand_data['status'], 'success')
        self.assertTrue('category' in rand_data['data'])

    def test_multiplication_api(self):
        response = self.client.get('/api/multiplication/questions?category=skip2_5_10')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['status'], 'success')
        self.assertTrue(len(data['data']) > 0)

        rand_resp = self.client.get('/api/multiplication/questions/random')
        self.assertEqual(rand_resp.status_code, 200)
        rand_data = rand_resp.get_json()
        self.assertEqual(rand_data['status'], 'success')
        self.assertTrue('category' in rand_data['data'])

    def test_session_api_v3_round_30(self):
        """驗證 v3.0 /api/session：每回 30 題、不重複、due/weak 優先(<=40%)、選項平衡洗牌與 explain 解析"""
        for subj in ["bopomofo", "english", "math", "multiplication"]:
            payload = {
                "subject": subj,
                "category": "all",
                "size": 30,
                "due_ids": [1, 2, 3, 4, 5],
                "weak_ids": [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            }
            resp = self.client.post(
                "/api/session",
                data=json.dumps(payload),
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertEqual(body["status"], "success")
            self.assertEqual(body["count"], 30)
            self.assertLessEqual(body["review_count"], 12)  # 40% of 30 = 12
            self.assertGreaterEqual(body["new_count"], 18)  # 60% of 30 = 18

            questions = body["data"]
            ids = [str(q.get("id")) for q in questions]
            self.assertEqual(len(set(ids)), 30, f"{subj} 回合內不可有重複題目")

            last_correct_idx = None
            for idx, q in enumerate(questions):
                self.assertTrue(q.get("explain"), f"{subj} 題目缺少 explain 解析: {q}")
                opts = q.get("options")
                if isinstance(opts, list) and len(opts) > 1:
                    target = q.get("answer") if q.get("answer") is not None else q.get("target")
                    c_idx = -1
                    for i, opt in enumerate(opts):
                        val = (opt.get("val") if opt.get("val") is not None else opt.get("en")) if isinstance(opt, dict) else opt
                        if str(val) == str(target):
                            c_idx = i
                            break
                    if c_idx != -1:
                        if idx == 0:
                            self.assertNotEqual(c_idx, 0, f"{subj} 首題正解不可在 index 0")
                        if last_correct_idx is not None:
                            self.assertNotEqual(c_idx, last_correct_idx, f"{subj} 連續兩題正解位置不可重複")
                        last_correct_idx = c_idx

    def test_weekly_report_html_api(self):
        """驗證線上即時生成家長週報 HTML API (/api/weekly-report/html)，相容本地與 Vercel 雲端環境"""
        resp = self.client.post(
            "/api/weekly-report/html",
            data=json.dumps({"profile": {"nickname": "小公主"}, "rewards": {"stars": 88}}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["status"], "success")
        self.assertIn("<!DOCTYPE html>", body["html"])
        self.assertIn("小公主", body["html"])
        self.assertIn("88 顆", body["html"])

if __name__ == '__main__':
    unittest.main()
