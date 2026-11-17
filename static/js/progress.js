/**
 * 小小魔法學習樂園 v3.0 — 學習核心資料層 (Progress, Leitner Spaced Repetition, Timer & Staged Rewards)
 * 專為單一使用者（6 歲小一女生）設計，使用瀏覽器 localStorage 保存進度，無須註冊登入。
 */
(function (root) {
  "use strict";

  const STORAGE_KEY = "pmb_v3_state";
  const DAILY_TARGET_SECONDS = 30 * 60; // 每日 30 分鐘 (1800 秒)
  const ROUND_SIZE = 30;                // 每回合固定 30 題

  // Leitner 盒子間隔天數 (盒子 1~4 -> 1 / 3 / 7 / 14 天)
  const LEITNER_INTERVAL_DAYS = {
    1: 1,
    2: 3,
    3: 7,
    4: 14
  };

  // 階段式獎勵定義（收藏寵物 + 貼紙 + 故事關卡）
  const STAGES = [
    { stage: 1, name: "新手魔法師", minStars: 0, maxStars: 50, icon: "🌱" },
    { stage: 2, name: "魔法小學徒", minStars: 51, maxStars: 200, icon: "✨" },
    { stage: 3, name: "星光魔法師", minStars: 201, maxStars: 500, icon: "🌟" },
    { stage: 4, name: "傳奇大魔法師", minStars: 501, maxStars: 99999, icon: "👑" }
  ];

  const PETS_CATALOG = [
    {
      id: "unicorn_baby",
      name: "粉紅小獨角獸",
      emoji: "🦄",
      stage: 1,
      reqStars: 0,
      desc: "陪伴小公主進入河堤魔法學院的第一隻守護精靈！"
    },
    {
      id: "bunny_fairy",
      name: "月光絨毛兔",
      emoji: "🐰",
      stage: 2,
      reqStars: 50,
      desc: "最喜歡跳數與讀注音的可愛小兔子，耳朵會發光喔！"
    },
    {
      id: "kitten_star",
      name: "星光小花貓",
      emoji: "🐱",
      stage: 2,
      reqStars: 120,
      desc: "英文發音最標準的魔法喵喵，最愛唱 ABC 歌！"
    },
    {
      id: "dragon_star",
      name: "彩虹小奶龍",
      emoji: "🐲",
      stage: 3,
      reqStars: 220,
      desc: "住在數學城堡頂端的小飛龍，心算跟看時鐘都超快！"
    },
    {
      id: "swan_princess",
      name: "皇家天鵝公主",
      emoji: "🦢",
      stage: 4,
      reqStars: 500,
      desc: "傳奇大魔法師專屬的閃耀夥伴，戴著金色小皇冠！"
    }
  ];

  const STICKERS_CATALOG = [
    { id: "stk_sakura", name: "櫻花魔法印章", emoji: "🌸" },
    { id: "stk_strawberry", name: "草莓甜心貼紙", emoji: "🍓" },
    { id: "stk_rainbow", name: "彩虹微笑貼紙", emoji: "🌈" },
    { id: "stk_crown", name: "小公主金皇冠", emoji: "👑" },
    { id: "stk_lollipop", name: "繽紛棒棒糖", emoji: "🍭" },
    { id: "stk_ribbon", name: "粉紅蝴蝶結", emoji: "🎀" },
    { id: "stk_teddy", name: "抱抱小泰迪", emoji: "🧸" },
    { id: "stk_butterfly", name: "閃亮藍蝴蝶", emoji: "🦋" },
    { id: "stk_icecream", name: "甜筒冰淇淋", emoji: "🍦" },
    { id: "stk_music", name: "快樂小音符", emoji: "🎵" },
    { id: "stk_balloon", name: "夢想紅氣球", emoji: "🎈" },
    { id: "stk_trophy", name: "滿分小獎盃", emoji: "🏆" }
  ];

  const STORY_CHAPTERS = [
    {
      chapter: 1,
      title: "第 1 章：魔法盒的神秘邀請函",
      reqStars: 0,
      sceneEmoji: "💌🦄",
      content: "開學的第一天，小公主在書包裡發現了一個閃閃發光的粉紅魔法盒！粉紅小獨角獸跳出來說：「歡迎來到河堤魔法樂園！只要每天練習注音、英文與數學，就能收集魔法星星，點亮整座彩虹城堡喔！」"
    },
    {
      chapter: 2,
      title: "第 2 章：注音森林與發音精靈",
      reqStars: 50,
      sceneEmoji: "🌳🐰",
      content: "小公主收集到了 50 顆魔法星星！注音森林的大門打開了，月光絨毛兔帶著聲母、介母與韻母小精靈出來跳舞，還教小公主唸出清脆又標準的英文自然發音！"
    },
    {
      chapter: 3,
      title: "第 3 章：時鐘高塔與超市寶石",
      reqStars: 150,
      sceneEmoji: "🕰️💎",
      content: "來到數學城堡的時鐘高塔，小公主學會分辨長針與短針，還用 10 元和 50 元硬幣在魔法超市買到了美味的草莓蛋糕，獲得了發光的智慧寶石！"
    },
    {
      chapter: 4,
      title: "第 4 章：九九乘法的彩虹橋",
      reqStars: 300,
      sceneEmoji: "🌈🐲",
      content: "「二一得二、二二得四……」隨著小公主大聲唸出乘法口訣，天空架起了一座七彩光橋，彩虹小奶龍在橋上為小公主鼓掌喝采！"
    },
    {
      chapter: 5,
      title: "第 5 章：河堤魔法學院的榮耀皇冠",
      reqStars: 500,
      sceneEmoji: "👑🦢",
      content: "太不可思議了！小公主累積了滿滿的魔法星星，皇家天鵝公主親自為小公主戴上「傳奇大魔法師」榮耀皇冠，期中考與期末考都難不倒妳囉！"
    }
  ];

  function getTodayStr(dateObj) {
    const d = dateObj || new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function addDaysStr(baseDateStr, days) {
    const parts = String(baseDateStr || getTodayStr()).split("-").map(Number);
    const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    d.setDate(d.getDate() + Number(days || 0));
    return getTodayStr(d);
  }

  function createDefaultState() {
    const today = getTodayStr();
    return {
      version: 3,
      profile: {
        nickname: "小公主",
        createdAt: new Date().toISOString(),
        soundEnabled: true,
        animEnabled: true
      },
      questions: {},
      daily: {
        [today]: {
          seconds: 0,
          answered: 0,
          correct: 0,
          prompted30m: false,
          bySubject: {
            bopomofo: { answered: 0, correct: 0 },
            english: { answered: 0, correct: 0 },
            math: { answered: 0, correct: 0 },
            multiplication: { answered: 0, correct: 0 }
          }
        }
      },
      rewards: {
        stars: 0,
        pets: ["unicorn_baby"],
        stickers: [],
        storyChapter: 1
      },
      streakDays: 1,
      lastStudyDate: today
    };
  }

  const MagicProgress = {
    state: null,

    load() {
      try {
        if (typeof localStorage !== "undefined") {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              this.state = this._migrate(parsed);
              this._ensureTodaySlot();
              return this.state;
            }
          }
        }
      } catch (e) {
        console.warn("[MagicProgress] 讀取 localStorage 失敗，使用預設狀態:", e);
      }
      this.state = createDefaultState();
      this.save();
      return this.state;
    },

    _migrate(data) {
      const def = createDefaultState();
      const merged = Object.assign({}, def, data);
      merged.version = 3;
      merged.profile = Object.assign({}, def.profile, data.profile || {});
      merged.questions = data.questions && typeof data.questions === "object" ? data.questions : {};
      merged.daily = data.daily && typeof data.daily === "object" ? data.daily : def.daily;
      merged.rewards = Object.assign({}, def.rewards, data.rewards || {});
      if (!Array.isArray(merged.rewards.pets) || !merged.rewards.pets.length) {
        merged.rewards.pets = ["unicorn_baby"];
      }
      if (!Array.isArray(merged.rewards.stickers)) {
        merged.rewards.stickers = [];
      }
      return merged;
    },

    _ensureTodaySlot() {
      if (!this.state) this.load();
      const today = getTodayStr();
      if (!this.state.daily[today]) {
        this.state.daily[today] = {
          seconds: 0,
          answered: 0,
          correct: 0,
          prompted30m: false,
          bySubject: {
            bopomofo: { answered: 0, correct: 0 },
            english: { answered: 0, correct: 0 },
            math: { answered: 0, correct: 0 },
            multiplication: { answered: 0, correct: 0 }
          }
        };
      }
      // 更新連續學習天數
      if (this.state.lastStudyDate !== today) {
        const yesterday = addDaysStr(today, -1);
        if (this.state.lastStudyDate === yesterday) {
          this.state.streakDays = (this.state.streakDays || 1) + 1;
        } else if (this.state.lastStudyDate && this.state.lastStudyDate < yesterday) {
          this.state.streakDays = 1;
        }
        this.state.lastStudyDate = today;
      }
      return this.state.daily[today];
    },

    save() {
      if (!this.state) return;
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        }
      } catch (e) {
        console.warn("[MagicProgress] 儲存 localStorage 失敗:", e);
      }
    },

    reset() {
      this.state = createDefaultState();
      this.save();
      return this.state;
    },

    exportJSON() {
      if (!this.state) this.load();
      return JSON.stringify(this.state, null, 2);
    },

    importJSON(jsonStr) {
      const parsed = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("無效的進度 JSON 格式");
      }
      this.state = this._migrate(parsed);
      this._ensureTodaySlot();
      this._syncUnlockedRewards();
      this.save();
      return this.state;
    },

    getStageInfo(stars) {
      const s = stars !== undefined ? stars : (this.state ? this.state.rewards.stars : 0);
      let current = STAGES[0];
      for (const st of STAGES) {
        if (s >= st.minStars) current = st;
      }
      const nextStage = STAGES.find(st => st.stage === current.stage + 1) || null;
      return {
        current,
        nextStage,
        stars: s,
        progressPct: nextStage
          ? Math.min(100, Math.round(((s - current.minStars) / (nextStage.minStars - current.minStars)) * 100))
          : 100
      };
    },

    _syncUnlockedRewards() {
      if (!this.state) return [];
      const stars = this.state.rewards.stars || 0;
      const newlyUnlocked = [];

      PETS_CATALOG.forEach(pet => {
        if (stars >= pet.reqStars && !this.state.rewards.pets.includes(pet.id)) {
          this.state.rewards.pets.push(pet.id);
          newlyUnlocked.push({ type: "pet", item: pet });
        }
      });

      let maxChap = 1;
      STORY_CHAPTERS.forEach(ch => {
        if (stars >= ch.reqStars && ch.chapter > maxChap) {
          maxChap = ch.chapter;
        }
      });
      if (maxChap > (this.state.rewards.storyChapter || 1)) {
        this.state.rewards.storyChapter = maxChap;
        const chObj = STORY_CHAPTERS.find(c => c.chapter === maxChap);
        if (chObj) newlyUnlocked.push({ type: "story", item: chObj });
      }

      return newlyUnlocked;
    },

    addStars(amount) {
      if (!this.state) this.load();
      this.state.rewards.stars = Math.max(0, (this.state.rewards.stars || 0) + Number(amount || 0));
      const newlyUnlocked = this._syncUnlockedRewards();
      this.save();
      return {
        stars: this.state.rewards.stars,
        newlyUnlocked
      };
    },

    /**
     * 記錄單題作答結果並更新 Leitner 盒子 (1 -> 2 -> 3 -> 4)
     */
    recordAnswer(subject, qObj, isCorrect) {
      if (!this.state) this.load();
      const today = getTodayStr();
      const dailySlot = this._ensureTodaySlot();
      const qId = qObj && qObj.id !== undefined ? qObj.id : "unknown";
      const key = `${subject}:${qId}`;

      const prev = this.state.questions[key] || {
        subject,
        id: qId,
        category: (qObj && (qObj.category || qObj.type)) || "general",
        title: this.extractQuestionTitle(subject, qObj),
        explain: this.formatQuestionExplain(subject, qObj),
        seen: 0,
        correct: 0,
        wrong: 0,
        box: 1,
        nextDue: today,
        lastAt: null
      };

      const wasDueOrWrong = prev.seen > 0 && (prev.nextDue <= today || prev.wrong > 0);
      prev.seen = (prev.seen || 0) + 1;
      prev.lastAt = new Date().toISOString();
      prev.title = this.extractQuestionTitle(subject, qObj) || prev.title;
      prev.explain = this.formatQuestionExplain(subject, qObj) || prev.explain;

      let starsEarned = 0;
      if (isCorrect) {
        prev.correct = (prev.correct || 0) + 1;
        prev.box = Math.min(4, (prev.box || 1) + 1);
        const interval = LEITNER_INTERVAL_DAYS[prev.box] || 1;
        prev.nextDue = addDaysStr(today, interval);
        starsEarned = 1 + (wasDueOrWrong ? 1 : 0); // 答對 +1 星，複習題答對額外 +1 星
      } else {
        prev.wrong = (prev.wrong || 0) + 1;
        prev.box = 1;
        prev.nextDue = today; // 答錯降回盒子 1，今日立即到期複習
      }

      this.state.questions[key] = prev;

      // 更新每日統計
      dailySlot.answered += 1;
      if (isCorrect) dailySlot.correct += 1;
      if (!dailySlot.bySubject[subject]) {
        dailySlot.bySubject[subject] = { answered: 0, correct: 0 };
      }
      dailySlot.bySubject[subject].answered += 1;
      if (isCorrect) dailySlot.bySubject[subject].correct += 1;

      const rewardRes = starsEarned > 0 ? this.addStars(starsEarned) : { stars: this.state.rewards.stars, newlyUnlocked: [] };
      this.save();

      return {
        record: prev,
        starsEarned,
        totalStars: rewardRes.stars,
        newlyUnlocked: rewardRes.newlyUnlocked
      };
    },

    /**
     * 完成 30 題回合結算獎勵：完成 +5 星、全對 +10 星加成，並可抽取新貼紙
     */
    recordRoundComplete(subject, totalCount, correctCount) {
      if (!this.state) this.load();
      let bonusStars = 5;
      if (totalCount > 0 && correctCount >= totalCount) {
        bonusStars += 10;
      }
      const rewardRes = this.addStars(bonusStars);
      let newSticker = null;

      // 若已達第 2 階段 (或完成一回合)，抽取一張尚未擁有的貼紙
      const owned = new Set(this.state.rewards.stickers || []);
      const available = STICKERS_CATALOG.filter(s => !owned.has(s.id));
      if (available.length > 0 && correctCount >= Math.ceil(totalCount * 0.6)) {
        newSticker = available[Math.floor(Math.random() * available.length)];
        this.state.rewards.stickers.push(newSticker.id);
      }

      this.save();
      return {
        bonusStars,
        totalStars: this.state.rewards.stars,
        newSticker,
        newlyUnlocked: rewardRes.newlyUnlocked
      };
    },

    /**
     * 取得指定學科到期複習 (dueIds) 與易錯題 (weakIds)
     */
    getDueAndWeakIds(subject) {
      if (!this.state) this.load();
      const today = getTodayStr();
      const dueIds = [];
      const weakIds = [];

      Object.values(this.state.questions).forEach(rec => {
        if (subject && subject !== "all" && rec.subject !== subject) return;
        if (rec.nextDue && rec.nextDue <= today && rec.box < 4) {
          dueIds.push(rec.id);
        }
        if ((rec.wrong || 0) > 0 && rec.box < 4) {
          weakIds.push(rec.id);
        }
      });

      return { dueIds, weakIds };
    },

    /**
     * 取得錯題本清單 (wrong > 0 且未達盒子 4)
     */
    getWrongBookItems(subjectFilter = "all") {
      if (!this.state) this.load();
      return Object.values(this.state.questions)
        .filter(rec => {
          if (subjectFilter !== "all" && rec.subject !== subjectFilter) return false;
          return (rec.wrong || 0) > 0 && (rec.box || 1) < 4;
        })
        .sort((a, b) => (b.wrong - a.wrong) || (a.box - b.box));
    },

    /**
     * 取得今日到期複習題清單 (nextDue <= today 且 seen > 0)
     */
    getDueReviewItems(subjectFilter = "all") {
      if (!this.state) this.load();
      const today = getTodayStr();
      return Object.values(this.state.questions)
        .filter(rec => {
          if (subjectFilter !== "all" && rec.subject !== subjectFilter) return false;
          return rec.seen > 0 && rec.nextDue <= today && (rec.box || 1) < 4;
        })
        .sort((a, b) => (a.box - b.box) || (b.wrong - a.wrong));
    },

    /**
     * 累加今日學習秒數，回傳今日秒數與是否剛達成 30 分鐘溫馨提醒
     */
    addStudySeconds(seconds = 1) {
      if (!this.state) this.load();
      const slot = this._ensureTodaySlot();
      slot.seconds = Math.max(0, (slot.seconds || 0) + Number(seconds || 0));
      let justReached30m = false;
      if (slot.seconds >= DAILY_TARGET_SECONDS && !slot.prompted30m) {
        slot.prompted30m = true;
        justReached30m = true;
      }
      this.save();
      return {
        seconds: slot.seconds,
        targetSeconds: DAILY_TARGET_SECONDS,
        justReached30m
      };
    },

    getTodayStats() {
      if (!this.state) this.load();
      const slot = this._ensureTodaySlot();
      return {
        date: getTodayStr(),
        seconds: slot.seconds || 0,
        targetSeconds: DAILY_TARGET_SECONDS,
        answered: slot.answered || 0,
        correct: slot.correct || 0,
        bySubject: slot.bySubject || {}
      };
    },

    extractQuestionTitle(subject, q) {
      if (!q) return "";
      if (subject === "bopomofo") {
        return `${q.emoji || "🪄"} ${q.character || ""}（${q.word || ""}）`;
      } else if (subject === "english") {
        const w = q.word || q.sample_word || q.display || q.target || "";
        return `${q.emoji || "🔤"} ${w} ${q.meaning ? "— " + q.meaning : ""}`;
      } else if (subject === "math") {
        return `${q.formula || q.prompt || "數學練習"}`;
      } else if (subject === "multiplication") {
        return `${q.formula || (q.base + " × " + q.multiplier)}（${q.chant || "九九乘法"}）`;
      }
      return String(q.prompt || q.id || "");
    },

    /**
     * 產生兒童友善的答錯解析 (explain)
     */
    formatQuestionExplain(subject, q) {
      if (!q) return "再仔細看一次題目，慢慢想一定可以答對喔！";
      if (q.explain) return q.explain;

      if (subject === "bopomofo") {
        const py = `${q.initial || ""}${q.medial || ""}${q.final || ""}${q.tone_symbol || ""}`;
        const toneName = q.tone === "1" || !q.tone ? "一聲" : q.tone === "2" ? "二聲(ˊ)" : q.tone === "3" ? "三聲(ˇ)" : q.tone === "4" ? "四聲(ˋ)" : "輕聲(˙)";
        return `💡 魔法解析：「${q.character || ""}」（${q.word || ""}）的正確拼音是【${py}】，屬於${q.type === "3-pin" ? "三拼（有介母 " + q.medial + "）" : "二拼"}，聲調是${toneName}喔！`;
      }

      if (subject === "english") {
        const w = q.word || q.sample_word || q.target || q.display || "";
        const ans = q.answer || q.target || w;
        const meaning = q.meaning || "";
        return `💡 魔法解析：【${w}】的中文意思是「${meaning}」，正確答案選【${ans}】，跟著語音大聲唸一次更容易記住喔！`;
      }

      if (subject === "math") {
        if (q.category === "bonds") {
          return `💡 魔法解析：合十與分解小秘訣 — ${q.formula || ""}，想一想「幾加幾會湊成 10 或總數」，答案是【${q.answer}】喔！`;
        }
        if (q.category === "clock") {
          return `💡 魔法解析：看時鐘小口訣 — 短針指小時、長針指 12 是整點、指 6 是半點（30分），所以是【${q.answer}】！`;
        }
        if (q.category === "money") {
          return `💡 魔法解析：超市小玩家 — 先數大硬幣（50元、10元）再數小硬幣（5元、1元），算式：${q.formula || ""}，答案是【${q.answer}】！`;
        }
        return `💡 魔法解析：${q.formula ? "算式「" + q.formula + "」" : ""}${q.prompt || ""} 正確答案是【${q.answer}】，可以用手指或畫圈圈數數看喔！`;
      }

      if (subject === "multiplication") {
        const a = q.base || "";
        const b = q.multiplier || "";
        const chant = q.chant || "";
        return `💡 魔法解析：${a} × ${b} 代表「${b} 個 ${a} 相加」，背誦口訣【${chant}】，就能馬上算出答案是【${q.answer}】囉！`;
      }

      return "💡 魔法解析：看清楚題目提示，再試一次吧！";
    },

    getCatalogs() {
      return {
        stages: STAGES,
        pets: PETS_CATALOG,
        stickers: STICKERS_CATALOG,
        stories: STORY_CHAPTERS,
        roundSize: ROUND_SIZE,
        dailyTargetSeconds: DAILY_TARGET_SECONDS
      };
    }
  };

  root.MagicProgress = MagicProgress;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = MagicProgress;
  }
})(typeof window !== "undefined" ? window : globalThis);

