/**
 * 注音魔法盒 (Pinyin Magic Box) - 旗艦版完整前端邏輯
 * 包含：
 * 1. 經典直式拼音盒 (Classic Magic Box, 支援點擊與滑鼠拖曳)
 * 2. 遊戲 1：🫧 魔法泡泡消消樂 (Bubble Pop)
 * 3. 遊戲 2：👾 聲調小怪獸肚子餓了 (Tone Monster)
 * 4. 遊戲 3：🏎️ 注音極速小賽車 (Speed Racer)
 * 5. 遊戲 4：🃏 記憶翻翻牌連連看 (Memory Match)
 * 6. 遊戲 5：🔨 注音小錘子地鼠敲敲樂 (Whack-a-Mole)
 * 7. 台灣真人語音與 Web Audio API 柔和音效
 */

(() => {
  "use strict";

  // =========================================================================
  // 1. 全域狀態管理
  // =========================================================================
  const state = {
    currentSubject: "bopomofo",  // 'bopomofo' | 'english' | 'math' | 'multiplication'
    currentGame: "classic",      // 'classic' | 'bubble' | 'monster' | 'racer' | 'memory' | 'mole'
    currentMode: "all",          // 'all' | '2-pin' | '3-pin'
    currentEngMode: "alphabet",  // 'alphabet' | 'phonics' | 'sight' | 'thematic'
    currentMathMode: "counting", // 'counting' | 'compare' | 'bonds' | 'add_sub' | 'clock' | 'money'
    currentMultMode: "skip2_5_10", // 'skip2_5_10' | 'tables_3_4' | 'tables_6_9' | 'visual_array' | 'explore_table'
    currentMultDigit: 2,         // 探索模式目前檢視的乘法數字 1~9
    currentQuestion: null,      // 目前經典模式題目
    currentEngQuestion: null,   // 目前英文題目
    currentMathQuestion: null,  // 目前數學題目
    currentMultQuestion: null,  // 目前乘法題目
    userSelection: {
      initial: "",
      medial: "",
      final: "",
      tone: "1",
      toneSymbol: ""
    },
    categories: null,
    activeTab: "initial",
    scoreStars: 0,
    streak: 0,
    isLocked: false,
    allQuestionsPool: [],        // 本地注音題庫快取
    allEngQuestionsPool: [],     // 本地英文題庫快取
    allMathQuestionsPool: []     // 本地數學題庫快取
  };

  // =========================================================================
  // ★ 實用工具函式 (Utilities) ★
  // =========================================================================
  const lastCorrectIndexByGame = {};
  const roundCountByGame = {};

  function shuffleArray(array) {
    if (!array || !Array.isArray(array)) return [];
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 智慧平衡隨機洗牌：
   * 1. 首題保證正確答案絕不落在第 1 個選項 (index 0)
   * 2. 連續題目保證正確答案位置不與上一題重複，均勻隨機分布於各選項
   */
  function shuffleOptionsBalanced(options, isCorrectFn, gameKey = "default") {
    const arr = shuffleArray(options);
    if (arr.length <= 1) return arr;

    const round = roundCountByGame[gameKey] || 0;
    const lastIdx = lastCorrectIndexByGame[gameKey];
    let correctIdx = arr.findIndex(isCorrectFn);

    if (correctIdx !== -1) {
      const mustAvoidZero = (round === 0 && correctIdx === 0);
      const isRepeatedPos = (lastIdx !== undefined && correctIdx === lastIdx);

      if (mustAvoidZero || isRepeatedPos) {
        const candidateIndices = [];
        for (let i = 0; i < arr.length; i++) {
          if (round === 0 && i === 0) continue;
          if (lastIdx !== undefined && i === lastIdx) continue;
          if (i !== correctIdx) candidateIndices.push(i);
        }
        if (candidateIndices.length > 0) {
          const targetIdx = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
          [arr[correctIdx], arr[targetIdx]] = [arr[targetIdx], arr[correctIdx]];
          correctIdx = targetIdx;
        }
      }
      lastCorrectIndexByGame[gameKey] = correctIdx;
      roundCountByGame[gameKey] = round + 1;
    }
    return arr;
  }

  /**
   * 點選選項後：其他選項全部反白 (.opt-unselected-white)，只有被點的選項呈現有顏色 (.opt-selected.correct / .wrong)
   */
  function highlightClickedOptionOnly(containerElem, clickedBtn, isCorrect) {
    if (!containerElem || !clickedBtn) return;
    Array.from(containerElem.children).forEach(child => {
      if (child === clickedBtn) {
        child.classList.remove("opt-unselected-white", "correct", "wrong");
        child.classList.add("opt-selected", isCorrect ? "correct" : "wrong");
      } else {
        child.classList.remove("opt-selected", "correct", "wrong", "active");
        child.classList.add("opt-unselected-white");
      }
    });
  }

  // =========================================================================
  // 2. 音效系統 (Web Speech 台灣語音 + Web Audio API 合成)
  // =========================================================================
  const SoundSystem = {
    audioCtx: null,
    preferredVoice: null,
    toneSpokenMap: {
      "—": "一聲", " ": "一聲", "ˊ": "二聲", "ˇ": "三聲", "ˋ": "四聲", "˙": "輕聲"
    },

    initContext() {
      if (!this.audioCtx) {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) this.audioCtx = new AudioClass();
      }
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }
    },

    getBestEnVoice() {
      if (!("speechSynthesis" in window)) return null;
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) return null;
      const preferredNames = ["Samantha", "Karen", "Daniel", "Victoria", "Flo", "Eddy"];
      for (const name of preferredNames) {
        const found = voices.find(v => v.name.includes(name) && /en/i.test(v.lang));
        if (found) return found;
      }
      return voices.find(v => /en[-_]US/i.test(v.lang)) || voices.find(v => /en/i.test(v.lang)) || null;
    },

    speakEnglish(text) {
      if (document.body.classList.contains("vault-locked")) return;
      if (window.MagicProgress && window.MagicProgress.state && window.MagicProgress.state.profile.soundEnabled === false) return;
      if (!("speechSynthesis" in window) || !text) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voice = this.getBestEnVoice();
      if (voice) utter.voice = voice;
      utter.lang = "en-US";
      utter.rate = 0.82;
      utter.pitch = 1.1;
      window.speechSynthesis.speak(utter);
    },

    getBestTwVoice() {
      if (!("speechSynthesis" in window)) return null;
      if (this.preferredVoice) return this.preferredVoice;
      const voices = window.speechSynthesis.getVoices() || [];
      if (!voices.length) return null;
      const preferredNames = ["Meijia", "美佳", "HsiaoChen", "曉臻", "HsiaoYu", "Yating", "Hanhan"];
      for (const name of preferredNames) {
        const found = voices.find(v => v.name.includes(name) && /zh[-_]TW/i.test(v.lang));
        if (found) {
          this.preferredVoice = found;
          return found;
        }
      }
      const twVoice = voices.find(v => /zh[-_]TW/i.test(v.lang)) || voices.find(v => /zh/i.test(v.lang));
      if (twVoice) this.preferredVoice = twVoice;
      return twVoice || null;
    },

    speak(text) {
      if (document.body.classList.contains("vault-locked")) return;
      if (window.MagicProgress && window.MagicProgress.state && window.MagicProgress.state.profile.soundEnabled === false) return;
      if (!("speechSynthesis" in window) || !text) return;
      window.speechSynthesis.cancel();
      const spokenText = this.toneSpokenMap[text] || text;
      const utter = new SpeechSynthesisUtterance(spokenText);
      const voice = this.getBestTwVoice();
      if (voice) utter.voice = voice;
      utter.lang = "zh-TW";
      utter.rate = 0.88;
      utter.pitch = 1.15;
      window.speechSynthesis.speak(utter);
    },

    play(type) {
      if (window.MagicProgress && window.MagicProgress.state && window.MagicProgress.state.profile.soundEnabled === false) return;
      this.initContext();
      if (type === "pop") this.synthPop();
      else if (type === "correct") this.synthCorrectFanfare();
      else if (type === "wrong") this.synthGentleBoop();
      else if (type === "bubble") this.synthBubblePop();
      else if (type === "hammer") this.synthHammer();
    },

    synthPop() {
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(540, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.18, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.08);
    },

    synthBubblePop() {
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(400, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1100, this.audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.1);
    },

    synthHammer() {
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(180, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(90, this.audioCtx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.25, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.12);
    },

    synthCorrectFanfare() {
      if (!this.audioCtx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        const start = this.audioCtx.currentTime + idx * 0.08;
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    },

    synthGentleBoop() {
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, this.audioCtx.currentTime);
      osc.frequency.linearRampToValueAtTime(260, this.audioCtx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.16, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.2);
    }
  };

  if ("speechSynthesis" in window && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => SoundSystem.getBestTwVoice();
  }

  // =========================================================================
  // 3. DOM 元素快取
  // =========================================================================
  const DOM = {
    // 頂端統計
    scoreStars: document.getElementById("score-stars"),
    scoreStreak: document.getElementById("score-streak"),
    mainLogoIcon: document.getElementById("main-logo-icon"),
    mainLogoTitle: document.getElementById("main-logo-title"),
    mainLogoSub: document.getElementById("main-logo-sub"),

    // ★ 頂層四大主學科頁籤 ★
    subjectTabBtns: document.querySelectorAll(".subject-tab-btn"),
    subjectSections: document.querySelectorAll(".subject-section"),

    // 遊戲大廳切換按鈕 (僅注音練習小遊戲)
    gameNavBtns: document.querySelectorAll("#section-bopomofo [data-game]"),
    gameViews: document.querySelectorAll(".game-view"),

    // 英文練習 DOM
    engUnitBadge: document.getElementById("eng-unit-badge"),
    engDisplayEmoji: document.getElementById("eng-display-emoji"),
    engDisplayText: document.getElementById("eng-display-text"),
    engSubPhonics: document.getElementById("eng-sub-phonics"),
    btnEngSpeak: document.getElementById("btn-eng-speak"),
    engPromptText: document.getElementById("eng-prompt-text"),
    engOptionsGrid: document.getElementById("eng-options-grid"),
    engFeedbackBanner: document.getElementById("eng-feedback-banner"),
    btnEngNext: document.getElementById("btn-eng-next"),
    engModeBtns: document.querySelectorAll("#section-english [data-eng-mode]"),

    // 數學練習 DOM
    mathUnitBadge: document.getElementById("math-unit-badge"),
    mathObjectsBoard: document.getElementById("math-objects-board"),
    mathFormulaLarge: document.getElementById("math-formula-large"),
    mathPromptText: document.getElementById("math-prompt-text"),
    mathOptionsGrid: document.getElementById("math-options-grid"),
    mathFeedbackBanner: document.getElementById("math-feedback-banner"),
    btnMathMarksNext: document.getElementById("btn-math-next"),
    mathModeBtns: document.querySelectorAll("#section-math [data-math-mode]"),

    // 99乘法表 DOM
    multUnitBadge: document.getElementById("mult-unit-badge"),
    multObjectsBoard: document.getElementById("mult-objects-board"),
    multFormulaLarge: document.getElementById("mult-formula-large"),
    multChantHint: document.getElementById("mult-chant-hint"),
    multPromptText: document.getElementById("mult-prompt-text"),
    multOptionsGrid: document.getElementById("mult-options-grid"),
    multFeedbackBanner: document.getElementById("mult-feedback-banner"),
    btnMultNext: document.getElementById("btn-mult-next"),
    multModeBtns: document.querySelectorAll("#section-multiplication [data-mult-mode]"),
    multQuizArea: document.getElementById("mult-quiz-area"),
    multTableArea: document.getElementById("mult-table-area"),
    multDigitSelector: document.getElementById("mult-digit-selector"),
    multTableCardsGrid: document.getElementById("mult-table-cards-grid"),
    btnMultReciteAll: document.getElementById("btn-mult-recite-all"),

    // 經典拼音盒
    modeBtns: document.querySelectorAll(".mode-btn"),
    targetEmoji: document.getElementById("target-emoji"),
    targetChar: document.getElementById("target-char"),
    targetWord: document.getElementById("target-word"),
    btnSpeakChar: document.getElementById("btn-speak-char"),
    slotInitial: document.getElementById("slot-initial"),
    slotMedial: document.getElementById("slot-medial"),
    slotFinal: document.getElementById("slot-final"),
    slotTone: document.getElementById("slot-tone"),
    contentInitial: document.getElementById("content-initial"),
    contentMedial: document.getElementById("content-medial"),
    contentFinal: document.getElementById("content-final"),
    contentTone: document.getElementById("content-tone"),
    feedbackBanner: document.getElementById("feedback-banner"),
    btnClear: document.getElementById("btn-clear"),
    btnSubmit: document.getElementById("btn-submit"),
    btnNext: document.getElementById("btn-next"),
    bankTabs: document.querySelectorAll(".tab-btn"),
    tilesContainer: document.getElementById("tiles-container"),

    // 彈出視窗
    modal: document.getElementById("celebration-modal"),
    modalTitle: document.getElementById("modal-title"),
    modalSpellDetail: document.getElementById("modal-spell-detail"),
    btnModalNext: document.getElementById("btn-modal-next"),

    // 遊戲 1：泡泡消消樂
    bubbleTargetEmoji: document.getElementById("bubble-target-emoji"),
    bubbleTargetChar: document.getElementById("bubble-target-char"),
    bubbleTargetWord: document.getElementById("bubble-target-word"),
    btnBubbleSpeak: document.getElementById("btn-bubble-speak"),
    bubbleProgress: document.getElementById("bubble-progress"),
    bubblePond: document.getElementById("bubble-pond"),
    bubbleHintMsg: document.getElementById("bubble-hint-msg"),
    btnBubbleNext: document.getElementById("btn-bubble-next"),
    bubbleRoundCount: document.getElementById("bubble-round-count"),

    // 遊戲 2：聲調小怪獸
    monsterAvatar: document.getElementById("monster-avatar"),
    monsterDialog: document.getElementById("monster-dialog"),
    monsterFoodGrid: document.getElementById("monster-food-grid"),
    monsterHintMsg: document.getElementById("monster-hint-msg"),
    btnMonsterNext: document.getElementById("btn-monster-next"),
    monsterFedCount: document.getElementById("monster-fed-count"),

    // 遊戲 3：極速小賽車
    racerFormula: document.getElementById("racer-formula"),
    racerLanes: document.getElementById("racer-lanes"),
    racerCarSprite: document.getElementById("racer-car-sprite"),
    racerScoreBadge: document.getElementById("racer-score-badge"),
    racerHintMsg: document.getElementById("racer-hint-msg"),
    btnRacerNext: document.getElementById("btn-racer-next"),

    // 遊戲 4：記憶翻翻牌
    memoryCardsGrid: document.getElementById("memory-cards-grid"),
    memoryMatchedCount: document.getElementById("memory-matched-count"),
    memoryHintMsg: document.getElementById("memory-hint-msg"),
    btnMemoryRestart: document.getElementById("btn-memory-restart"),

    // 遊戲 5：地鼠敲注音
    moleTargetSymbol: document.getElementById("mole-target-symbol"),
    btnMoleSpeak: document.getElementById("btn-mole-speak"),
    moleHolesContainer: document.getElementById("mole-holes-container"),
    moleScoreBadge: document.getElementById("mole-score-badge"),
    moleHintMsg: document.getElementById("mole-hint-msg"),
    btnMoleNext: document.getElementById("btn-mole-next"),

    // ★ v3.0 學習核心 DOM ★
    dailyTimerBox: document.getElementById("daily-timer-box"),
    dailyTimerText: document.getElementById("daily-timer-text"),
    dailyTimerFill: document.getElementById("daily-timer-fill"),
    timer30mToast: document.getElementById("timer-30m-toast"),
    timer30mMsg: document.getElementById("timer-30m-msg"),
    btnDismiss30mToast: document.getElementById("btn-dismiss-30m-toast"),

    btnOpenWrongBook: document.getElementById("btn-open-wrong-book"),
    headerWrongCount: document.getElementById("header-wrong-count"),
    btnOpenRewards: document.getElementById("btn-open-rewards"),
    headerStageName: document.getElementById("header-stage-name"),
    btnOpenSettings: document.getElementById("btn-open-settings"),

    roundModeBadge: document.getElementById("round-mode-badge"),
    roundStepNum: document.getElementById("round-step-num"),
    roundTotalNum: document.getElementById("round-total-num"),
    roundCorrectNum: document.getElementById("round-correct-num"),
    roundProgressFill: document.getElementById("round-progress-fill"),
    btnStartDailyReview: document.getElementById("btn-start-daily-review"),
    dueReviewCount: document.getElementById("due-review-count"),
    btnRestartRound: document.getElementById("btn-restart-round"),

    roundSummaryModal: document.getElementById("round-summary-modal"),
    summaryTitle: document.getElementById("summary-title"),
    summaryScoreLine: document.getElementById("summary-score-line"),
    summaryRewardBox: document.getElementById("summary-reward-box"),
    summaryWrongSection: document.getElementById("summary-wrong-section"),
    summaryWrongList: document.getElementById("summary-wrong-list"),
    btnSummaryRetryWrong: document.getElementById("btn-summary-retry-wrong"),
    btnSummaryNextRound: document.getElementById("btn-summary-next-round"),

    wrongBookModal: document.getElementById("wrong-book-modal"),
    btnCloseWrongBook: document.getElementById("btn-close-wrong-book"),
    wrongBookFilters: document.getElementById("wrong-book-filters"),
    wrongBookList: document.getElementById("wrong-book-list"),
    btnWbStartPractice: document.getElementById("btn-wb-start-practice"),

    rewardsModal: document.getElementById("rewards-modal"),
    btnCloseRewards: document.getElementById("btn-close-rewards"),
    rewardsStageTitle: document.getElementById("rewards-stage-title"),
    rewardsStageStars: document.getElementById("rewards-stage-stars"),
    rewardsStageFill: document.getElementById("rewards-stage-fill"),
    rewardsPanelPets: document.getElementById("rewards-panel-pets"),
    rewardsPanelStickers: document.getElementById("rewards-panel-stickers"),
    rewardsPanelStories: document.getElementById("rewards-panel-stories"),

    settingsModal: document.getElementById("settings-modal"),
    btnCloseSettings: document.getElementById("btn-close-settings"),
    inputNickname: document.getElementById("input-nickname"),
    chkSoundEnabled: document.getElementById("chk-sound-enabled"),
    chkAnimEnabled: document.getElementById("chk-anim-enabled"),
    btnSaveSettings: document.getElementById("btn-save-settings"),
    btnPreviewWeeklyReport: document.getElementById("btn-preview-weekly-report"),
    btnExportProgress: document.getElementById("btn-export-progress"),
    btnImportProgressTrigger: document.getElementById("btn-import-progress-trigger"),
    inputImportProgress: document.getElementById("input-import-progress"),
    settingsStatusMsg: document.getElementById("settings-status-msg"),

    // ★ 安全金庫與 LINE 訪客申辦 DOM (與 FinanceFree-XQ-Pub 同源) ★
    vaultPill: document.getElementById("vault-pill"),
    vaultStatusBadge: document.getElementById("vault-status-badge"),
    vaultModal: document.getElementById("vault-modal"),
    vaultPasskeyInput: document.getElementById("vault-passkey-input"),
    vaultToggleVisibility: document.getElementById("vault-toggle-visibility"),
    vaultErrorMsg: document.getElementById("vault-error-msg"),
    btnVaultUnlock: document.getElementById("btn-vault-unlock"),
    btnOpenLineApply: document.getElementById("btn-open-line-apply"),
    lineApplyModal: document.getElementById("line-apply-modal"),
    btnCloseLineModal: document.getElementById("btn-close-line-modal"),
    btnCancelLineModal: document.getElementById("btn-cancel-line-modal"),
    btnCopyLineId: document.getElementById("btn-copy-line-id")
  };

  // =========================================================================
  // ★ 安全金庫驗證模組 (與 FinanceFree-XQ-Pub 完全一致之 SHA-256 密鑰驗證與 1-Click Token) ★
  // =========================================================================
  const VaultAuth = {
    EXPECTED_SHA256: "bdbb3eb181b1c97639b88949cfc07a7bcbf9137a8a9ec81b7431c77fd0350363",
    STORAGE_KEY: "ff_auth_key",

    async sha256Hex(str) {
      const enc = new TextEncoder();
      const buf = await window.crypto.subtle.digest("SHA-256", enc.encode(String(str || "").trim()));
      return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    },

    async verifyPasskey(passkey) {
      const clean = String(passkey || "").trim();
      if (!clean) return false;
      try {
        if (window.crypto && window.crypto.subtle) {
          const digest = await this.sha256Hex(clean);
          if (digest === this.EXPECTED_SHA256) return true;
        }
      } catch (e) {
        console.warn("[VaultAuth] WebCrypto error, falling back to API:", e);
      }
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passkey: clean })
        });
        const data = await res.json();
        return Boolean(data && data.authenticated);
      } catch (e) {
        return false;
      }
    },

    setUnlockedState(isUnlocked, errorText = null) {
      if (isUnlocked) {
        document.body.classList.remove("vault-locked");
        if (DOM.vaultModal) DOM.vaultModal.style.display = "none";
        if (DOM.vaultStatusBadge) {
          DOM.vaultStatusBadge.className = "vault-badge-unlocked";
          DOM.vaultStatusBadge.textContent = "🔐 金庫已解鎖";
        }
      } else {
        document.body.classList.add("vault-locked");
        if (DOM.vaultModal) DOM.vaultModal.style.display = "flex";
        if (DOM.vaultStatusBadge) {
          DOM.vaultStatusBadge.className = "vault-badge-locked";
          DOM.vaultStatusBadge.textContent = "🔒 金庫未解鎖";
        }
        if (DOM.vaultErrorMsg) {
          if (errorText) {
            DOM.vaultErrorMsg.textContent = errorText;
            DOM.vaultErrorMsg.style.display = "block";
          } else {
            DOM.vaultErrorMsg.style.display = "none";
          }
        }
        if (DOM.vaultPasskeyInput) {
          setTimeout(() => DOM.vaultPasskeyInput.focus(), 100);
        }
      }
    },

    async handleUnlockSubmit(rawKey) {
      const key = String(rawKey || "").trim();
      if (!key) {
        this.setUnlockedState(false, "⚠️ 請輸入金庫通行密鑰！");
        return;
      }
      const ok = await this.verifyPasskey(key);
      if (ok) {
        sessionStorage.setItem(this.STORAGE_KEY, key);
        this.setUnlockedState(true);
        SoundSystem.play("correct");
        if (state.currentSubject === "bopomofo" && state.currentQuestion) {
          SoundSystem.speak(`${state.currentQuestion.character}，${state.currentQuestion.word || ""}`);
        }
      } else {
        SoundSystem.play("wrong");
        this.setUnlockedState(false, "⚠️ 通行密鑰錯誤，無法解鎖學習樂園，請重新確認！");
        if (DOM.vaultPasskeyInput) {
          DOM.vaultPasskeyInput.focus();
          DOM.vaultPasskeyInput.select();
        }
      }
    },

    promptRelock() {
      const currentKey = sessionStorage.getItem(this.STORAGE_KEY);
      if (currentKey) {
        if (window.confirm("是否要重新鎖定安全金庫？\n鎖定後將清除本機暫存金鑰並返回密碼驗證畫面。")) {
          sessionStorage.removeItem(this.STORAGE_KEY);
          if (DOM.vaultPasskeyInput) DOM.vaultPasskeyInput.value = "";
          this.setUnlockedState(false);
        }
      } else {
        this.setUnlockedState(false);
      }
    },

    async init() {
      // 本地端 localhost / 127.0.0.1 免密碼直接進入，僅雲端版本啟用安全金庫鎖定
      const isLocalhost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
      if (isLocalhost) {
        this.setUnlockedState(true);
        if (DOM.vaultPill) DOM.vaultPill.style.display = "none";
        return;
      }

      // 綁定 UI 事件
      if (DOM.vaultToggleVisibility && DOM.vaultPasskeyInput) {
        DOM.vaultToggleVisibility.addEventListener("click", () => {
          if (DOM.vaultPasskeyInput.type === "password") {
            DOM.vaultPasskeyInput.type = "text";
            DOM.vaultToggleVisibility.textContent = "🔒";
          } else {
            DOM.vaultPasskeyInput.type = "password";
            DOM.vaultToggleVisibility.textContent = "👁️";
          }
        });
      }

      if (DOM.btnVaultUnlock && DOM.vaultPasskeyInput) {
        DOM.btnVaultUnlock.addEventListener("click", () => {
          this.handleUnlockSubmit(DOM.vaultPasskeyInput.value);
        });
        DOM.vaultPasskeyInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            this.handleUnlockSubmit(DOM.vaultPasskeyInput.value);
          }
        });
      }

      if (DOM.vaultPill) {
        DOM.vaultPill.addEventListener("click", () => this.promptRelock());
      }

      if (DOM.btnOpenLineApply && DOM.lineApplyModal) {
        DOM.btnOpenLineApply.addEventListener("click", () => {
          DOM.lineApplyModal.style.display = "flex";
        });
      }
      if (DOM.btnCloseLineModal && DOM.lineApplyModal) {
        DOM.btnCloseLineModal.addEventListener("click", () => {
          DOM.lineApplyModal.style.display = "none";
        });
      }
      if (DOM.btnCancelLineModal && DOM.lineApplyModal) {
        DOM.btnCancelLineModal.addEventListener("click", () => {
          DOM.lineApplyModal.style.display = "none";
        });
      }
      if (DOM.btnCopyLineId) {
        DOM.btnCopyLineId.addEventListener("click", () => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText("@781imbvv");
          }
          window.alert("已複製 LINE 官方帳號 ID: @781imbvv");
        });
      }

      // 支援 URL 1-Click 快捷授權 (?auth= / ?key= / ?token=)
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get("auth") || urlParams.get("key") || urlParams.get("token");
      if (urlToken && urlToken.trim()) {
        sessionStorage.setItem(this.STORAGE_KEY, urlToken.trim());
        urlParams.delete("auth");
        urlParams.delete("key");
        urlParams.delete("token");
        const newQuery = urlParams.toString() ? "?" + urlParams.toString() : "";
        window.history.replaceState({}, document.title, window.location.pathname + newQuery + window.location.hash);
      }

      const savedKey = sessionStorage.getItem(this.STORAGE_KEY);
      if (savedKey) {
        const valid = await this.verifyPasskey(savedKey);
        if (valid) {
          this.setUnlockedState(true);
          return;
        }
        sessionStorage.removeItem(this.STORAGE_KEY);
        this.setUnlockedState(false, "⚠️ 上次儲存之密鑰已失效或有誤，請重新輸入！");
      } else {
        this.setUnlockedState(false);
      }
    }
  };

  // 全域累積星數增加輔助 (與 MagicProgress 同步)
  function addStars(num) {
    if (window.MagicProgress) {
      const res = window.MagicProgress.addStars(num);
      state.scoreStars = res.stars;
    } else {
      state.scoreStars += num;
    }
    state.streak += 1;
    DOM.scoreStars.textContent = state.scoreStars;
    DOM.scoreStreak.textContent = state.streak;
    if (window.V3Controller) window.V3Controller.refreshHeaderBadges();
  }

  // =========================================================================
  // ★ v3.0 學習核心控制器 (30題回合管理、Leitner 複習、每日30分計時、階段獎勵) ★
  // =========================================================================
  const V3Controller = {
    sessionQueue: [],
    sessionIndex: 0,
    sessionSize: 30,
    sessionCorrect: 0,
    sessionWrongItems: [],
    sessionMode: "standard", // 'standard' | 'review_only' | 'retry_wrong'
    lastInteractionTime: Date.now(),
    timerInterval: null,
    currentWbSubject: "all",

    init() {
      if (!window.MagicProgress) return;
      const st = window.MagicProgress.load();
      state.scoreStars = st.rewards.stars || 0;
      DOM.scoreStars.textContent = state.scoreStars;
      this.applySettingsToUI();
      this.refreshHeaderBadges();
      this.startDailyTimer();
      this.bindEvents();
    },

    applySettingsToUI() {
      if (!window.MagicProgress || !window.MagicProgress.state) return;
      const prof = window.MagicProgress.state.profile || {};
      if (DOM.inputNickname) DOM.inputNickname.value = prof.nickname || "小公主";
      if (DOM.chkSoundEnabled) DOM.chkSoundEnabled.checked = prof.soundEnabled !== false;
      if (DOM.chkAnimEnabled) DOM.chkAnimEnabled.checked = prof.animEnabled !== false;
      document.body.classList.toggle("no-bg-anim", prof.animEnabled === false);
    },

    refreshHeaderBadges() {
      if (!window.MagicProgress) return;
      const wrongList = window.MagicProgress.getWrongBookItems("all");
      const dueList = window.MagicProgress.getDueReviewItems("all");
      const stageInfo = window.MagicProgress.getStageInfo();

      if (DOM.headerWrongCount) DOM.headerWrongCount.textContent = wrongList.length;
      if (DOM.dueReviewCount) DOM.dueReviewCount.textContent = dueList.length;
      if (DOM.headerStageName) {
        DOM.headerStageName.textContent = `${stageInfo.current.name}`;
      }
      if (DOM.scoreStars) {
        DOM.scoreStars.textContent = stageInfo.stars;
      }
    },

    startDailyTimer() {
      const updateTimerDisplay = (seconds) => {
        const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
        const ss = String(seconds % 60).padStart(2, "0");
        if (DOM.dailyTimerText) DOM.dailyTimerText.textContent = `${mm}:${ss}`;
        const pct = Math.min(100, Math.round((seconds / 1800) * 100));
        if (DOM.dailyTimerFill) DOM.dailyTimerFill.style.width = `${pct}%`;
      };

      const todayStats = window.MagicProgress.getTodayStats();
      updateTimerDisplay(todayStats.seconds || 0);

      const markActive = () => {
        this.lastInteractionTime = Date.now();
      };
      ["pointerdown", "keydown", "touchstart"].forEach(ev => {
        window.addEventListener(ev, markActive, { passive: true });
      });

      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        if (document.hidden) return;
        // 閒置超過 60 秒暫停累計
        if (Date.now() - this.lastInteractionTime > 60000) return;

        const res = window.MagicProgress.addStudySeconds(1);
        updateTimerDisplay(res.seconds);

        if (res.justReached30m && DOM.timer30mToast) {
          const nick = (window.MagicProgress.state.profile && window.MagicProgress.state.profile.nickname) || "小公主";
          if (DOM.timer30mMsg) {
            DOM.timer30mMsg.textContent = `💖 ${nick}今天已經認真學習滿 30 分鐘囉，真棒！想休息可以休息一下，想繼續玩也可以隨時繼續喔～`;
          }
          DOM.timer30mToast.style.display = "flex";
          SoundSystem.speak(`${nick}今天已經學習滿三十分鐘囉，真棒！`);
        }
      }, 1000);
    },

    getActiveCategory(subject) {
      if (subject === "bopomofo") return state.currentMode || "all";
      if (subject === "english") return state.currentEngMode || "alphabet";
      if (subject === "math") return state.currentMathMode || "counting";
      if (subject === "multiplication") return state.currentMultMode || "skip2_5_10";
      return "all";
    },

    async startNewSession(subject, category, mode = "standard", customQuestions = null) {
      this.sessionMode = mode;
      this.sessionIndex = 0;
      this.sessionCorrect = 0;

      if (customQuestions && Array.isArray(customQuestions) && customQuestions.length > 0) {
        this.sessionQueue = customQuestions;
        this.sessionSize = customQuestions.length;
        this.sessionWrongItems = [];
        this.updateRoundProgressBar();
        return this.sessionQueue[0];
      }

      this.sessionWrongItems = [];
      this.sessionSize = 30;
      const { dueIds, weakIds } = window.MagicProgress
        ? window.MagicProgress.getDueAndWeakIds(subject)
        : { dueIds: [], weakIds: [] };

      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject,
            category: category || this.getActiveCategory(subject),
            size: 30,
            mode,
            due_ids: dueIds,
            weak_ids: weakIds
          })
        });
        const json = await res.json();
        if (json.status === "success" && Array.isArray(json.data) && json.data.length > 0) {
          this.sessionQueue = json.data;
          this.sessionSize = json.data.length;
        }
      } catch (e) {
        console.warn("[V3Controller] /api/session 取得失敗，使用本地題庫備援:", e);
      }

      this.updateRoundProgressBar();
      return this.getCurrentSessionQuestion();
    },

    getCurrentSessionQuestion() {
      if (!this.sessionQueue || !this.sessionQueue.length) return null;
      return this.sessionQueue[this.sessionIndex] || null;
    },

    updateRoundProgressBar() {
      const total = this.sessionSize || 30;
      const step = Math.min(total, this.sessionIndex + 1);
      if (DOM.roundStepNum) DOM.roundStepNum.textContent = step;
      if (DOM.roundTotalNum) DOM.roundTotalNum.textContent = total;
      if (DOM.roundCorrectNum) DOM.roundCorrectNum.textContent = this.sessionCorrect;
      const pct = Math.min(100, Math.max(3, Math.round((step / total) * 100)));
      if (DOM.roundProgressFill) DOM.roundProgressFill.style.width = `${pct}%`;

      if (DOM.roundModeBadge) {
        DOM.roundModeBadge.textContent =
          this.sessionMode === "review_only" ? "✨ 今日魔法複習回合" :
          this.sessionMode === "retry_wrong" ? "📕 錯題加強特訓回合" : "🎯 30題特訓回合";
      }
    },

    /**
     * 當一題作答完成時呼叫：更新 Leitner 盒子、錯題解析與回合進度
     */
    recordQuestionResult(subject, qObj, isCorrect) {
      if (!qObj) return { explain: "", roundFinished: false };
      let explain = qObj.explain || "";
      if (window.MagicProgress) {
        const res = window.MagicProgress.recordAnswer(subject, qObj, isCorrect);
        state.scoreStars = res.totalStars;
        explain = res.record.explain || explain;
      }

      if (isCorrect) {
        this.sessionCorrect += 1;
      } else {
        state.streak = 0;
        if (DOM.scoreStreak) DOM.scoreStreak.textContent = "0";
        const alreadyInWrong = this.sessionWrongItems.some(item => String(item.id) === String(qObj.id));
        if (!alreadyInWrong) {
          this.sessionWrongItems.push(Object.assign({}, qObj, { explain }));
        }
      }

      this.refreshHeaderBadges();
      this.updateRoundProgressBar();
      return { explain };
    },

    /**
     * 前往本回合下一題；若已完成第 30 題則彈出回合結算視窗
     */
    async advanceOrFinishRound(subject, loadNextCallback) {
      if (this.sessionQueue.length > 0 && this.sessionIndex + 1 >= this.sessionSize) {
        this.showRoundSummaryModal(subject);
        return true;
      }
      this.sessionIndex += 1;
      this.updateRoundProgressBar();
      if (typeof loadNextCallback === "function") {
        await loadNextCallback();
      }
      return false;
    },

    showRoundSummaryModal(subject) {
      const total = this.sessionSize || 30;
      const correct = this.sessionCorrect;
      const acc = total > 0 ? Math.round((correct / total) * 100) : 100;
      const rewardRes = window.MagicProgress
        ? window.MagicProgress.recordRoundComplete(subject, total, correct)
        : { bonusStars: 5, newSticker: null, newlyUnlocked: [] };

      state.scoreStars = rewardRes.totalStars || state.scoreStars;
      this.refreshHeaderBadges();

      const nick = (window.MagicProgress && window.MagicProgress.state.profile.nickname) || "小公主";
      if (DOM.summaryTitle) {
        DOM.summaryTitle.textContent = `🎉 恭喜${nick}完成 ${total} 題挑戰！`;
      }
      if (DOM.summaryScoreLine) {
        DOM.summaryScoreLine.textContent = `本回合答對 ${correct} / ${total} 題（正確率 ${acc}%）`;
      }
      if (DOM.summaryRewardBox) {
        let html = `⭐ 完成回合獎勵 <strong>+${rewardRes.bonusStars} 顆魔法星</strong>！`;
        if (rewardRes.newSticker) {
          html += `<br>🌸 恭喜抽中新貼紙：【${rewardRes.newSticker.emoji} ${rewardRes.newSticker.name}】！`;
        }
        if (rewardRes.newlyUnlocked && rewardRes.newlyUnlocked.length > 0) {
          rewardRes.newlyUnlocked.forEach(u => {
            if (u.type === "pet") {
              html += `<br>🦄 解鎖新魔法寵物：【${u.item.emoji} ${u.item.name}】！`;
            } else if (u.type === "story") {
              html += `<br>📖 解鎖新故事章節：【${u.item.title}】！`;
            }
          });
        }
        DOM.summaryRewardBox.innerHTML = html;
      }

      if (DOM.summaryWrongList && DOM.summaryWrongSection) {
        DOM.summaryWrongList.innerHTML = "";
        if (this.sessionWrongItems.length === 0) {
          DOM.summaryWrongList.innerHTML = `<div class="v3-wrong-card">🌟 太神啦！本回合全部答對，沒有任何錯題喔！</div>`;
          if (DOM.btnSummaryRetryWrong) DOM.btnSummaryRetryWrong.style.display = "none";
        } else {
          if (DOM.btnSummaryRetryWrong) DOM.btnSummaryRetryWrong.style.display = "inline-flex";
          this.sessionWrongItems.forEach(item => {
            const title = window.MagicProgress.extractQuestionTitle(subject, item);
            const card = document.createElement("div");
            card.className = "v3-wrong-card";
            card.innerHTML = `
              <div class="v3-wrong-card-top">
                <span>${title}</span>
                <span class="v3-box-badge">📦 已加入第 1 盒複習</span>
              </div>
              <div class="v3-wrong-explain">${item.explain || ""}</div>
            `;
            DOM.summaryWrongList.appendChild(card);
          });
        }
      }

      if (DOM.roundSummaryModal) DOM.roundSummaryModal.classList.add("show");
      SoundSystem.play("correct");
    },

    renderWrongBookModal(subjectFilter = "all") {
      this.currentWbSubject = subjectFilter;
      if (!window.MagicProgress || !DOM.wrongBookList) return;
      const items = window.MagicProgress.getWrongBookItems(subjectFilter);
      const dueItems = window.MagicProgress.getDueReviewItems(subjectFilter);

      // 合併錯題與到期題
      const mergedMap = new Map();
      [...dueItems, ...items].forEach(it => mergedMap.set(`${it.subject}:${it.id}`, it));
      const list = Array.from(mergedMap.values());

      DOM.wrongBookList.innerHTML = "";
      if (list.length === 0) {
        DOM.wrongBookList.innerHTML = `
          <div class="v3-wrong-card" style="background:#f0fdf4; border-color:#bbf7d0;">
            <strong>🎉 目前沒有待複習的錯題喔！</strong>
            <span class="v3-wrong-explain">繼續在四大主題館挑戰 30 題回合，答錯的題目會自動收錄到這裡幫助記憶！</span>
          </div>
        `;
        return;
      }

      list.forEach(rec => {
        const card = document.createElement("div");
        card.className = "v3-wrong-card";
        card.innerHTML = `
          <div class="v3-wrong-card-top">
            <span>${rec.title || rec.id}</span>
            <span class="v3-box-badge">📦 記憶盒 ${rec.box || 1} ・ 答錯 ${rec.wrong || 0} 次 ・ 下次複習：${rec.nextDue}</span>
          </div>
          <div class="v3-wrong-explain">${rec.explain || ""}</div>
        `;
        DOM.wrongBookList.appendChild(card);
      });
    },

    renderRewardsModal() {
      if (!window.MagicProgress) return;
      const stageInfo = window.MagicProgress.getStageInfo();
      const catalogs = window.MagicProgress.getCatalogs();
      const rewards = window.MagicProgress.state.rewards || { stars: 0, pets: [], stickers: [], storyChapter: 1 };

      if (DOM.rewardsStageTitle) {
        DOM.rewardsStageTitle.textContent = `${stageInfo.current.icon} 第 ${stageInfo.current.stage} 階段：${stageInfo.current.name}`;
      }
      if (DOM.rewardsStageStars) {
        const nextText = stageInfo.nextStage ? `（距離「${stageInfo.nextStage.name}」還差 ${stageInfo.nextStage.minStars - stageInfo.stars} 顆星）` : "（已達最高榮耀階段！）";
        DOM.rewardsStageStars.textContent = `目前累積 ${stageInfo.stars} 顆星 ${nextText}`;
      }
      if (DOM.rewardsStageFill) {
        DOM.rewardsStageFill.style.width = `${stageInfo.progressPct}%`;
      }

      // 1. 寵物面板
      if (DOM.rewardsPanelPets) {
        const grid = document.createElement("div");
        grid.className = "v3-reward-grid";
        catalogs.pets.forEach(pet => {
          const unlocked = rewards.pets.includes(pet.id) || stageInfo.stars >= pet.reqStars;
          const card = document.createElement("div");
          card.className = `v3-reward-item ${unlocked ? "unlocked" : "locked"}`;
          card.innerHTML = `
            <span class="v3-reward-emoji">${pet.emoji}</span>
            <strong>${pet.name}</strong>
            <span style="font-size:0.82rem; color:#be185d; font-weight:800;">
              ${unlocked ? "✅ 已解鎖陪伴中" : `🔒 需 ${pet.reqStars} 顆星解鎖`}
            </span>
            <p style="font-size:0.84rem; color:#475569;">${pet.desc}</p>
          `;
          grid.appendChild(card);
        });
        DOM.rewardsPanelPets.innerHTML = "";
        DOM.rewardsPanelPets.appendChild(grid);
      }

      // 2. 貼紙面板
      if (DOM.rewardsPanelStickers) {
        const grid = document.createElement("div");
        grid.className = "v3-reward-grid";
        catalogs.stickers.forEach(stk => {
          const unlocked = (rewards.stickers || []).includes(stk.id);
          const card = document.createElement("div");
          card.className = `v3-reward-item ${unlocked ? "unlocked" : "locked"}`;
          card.innerHTML = `
            <span class="v3-reward-emoji">${stk.emoji}</span>
            <strong>${stk.name}</strong>
            <span style="font-size:0.82rem; color:#64748b; font-weight:800;">
              ${unlocked ? "🌟 已收藏" : "🔒 完成 30 題回合可抽取"}
            </span>
          `;
          grid.appendChild(card);
        });
        DOM.rewardsPanelStickers.innerHTML = "";
        DOM.rewardsPanelStickers.appendChild(grid);
      }

      // 3. 故事關卡面板
      if (DOM.rewardsPanelStories) {
        DOM.rewardsPanelStories.innerHTML = "";
        catalogs.stories.forEach(ch => {
          const unlocked = stageInfo.stars >= ch.reqStars;
          const div = document.createElement("div");
          div.className = `v3-story-card ${unlocked ? "unlocked" : "locked"}`;
          div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:1.08rem; color:#92400e;">${ch.sceneEmoji} ${ch.title}</strong>
              <span class="v3-box-badge">${unlocked ? "📖 已解鎖" : `🔒 需 ${ch.reqStars} 顆星`}</span>
            </div>
            <p style="font-size:0.95rem; color:#334155; font-weight:700;">
              ${unlocked ? ch.content : "繼續收集魔法星星，就能解鎖這段精彩的魔法冒險故事喔！"}
            </p>
          `;
          if (unlocked) {
            div.style.cursor = "pointer";
            div.title = "點選聽故事朗讀";
            div.addEventListener("click", () => SoundSystem.speak(`${ch.title}。${ch.content}`));
          }
          DOM.rewardsPanelStories.appendChild(div);
        });
      }
    },

    async triggerNewRoundForCurrentSubject(mode = "standard", customQuestions = null) {
      const subj = state.currentSubject;
      await this.startNewSession(subj, this.getActiveCategory(subj), mode, customQuestions);
      if (subj === "bopomofo") {
        await fetchRandomClassicQuestion(true);
      } else if (subj === "english") {
        await EnglishGame.startRound(true);
      } else if (subj === "math") {
        await MathGame.startRound(true);
      } else if (subj === "multiplication") {
        await MultiplicationGame.startRound(true);
      }
    },

    bindEvents() {
      if (DOM.btnDismiss30mToast) {
        DOM.btnDismiss30mToast.addEventListener("click", () => {
          DOM.timer30mToast.style.display = "none";
        });
      }

      if (DOM.btnStartDailyReview) {
        DOM.btnStartDailyReview.addEventListener("click", () => {
          SoundSystem.play("pop");
          this.triggerNewRoundForCurrentSubject("review_only");
        });
      }

      if (DOM.btnRestartRound) {
        DOM.btnRestartRound.addEventListener("click", () => {
          SoundSystem.play("pop");
          this.triggerNewRoundForCurrentSubject("standard");
        });
      }

      if (DOM.btnSummaryNextRound) {
        DOM.btnSummaryNextRound.addEventListener("click", () => {
          DOM.roundSummaryModal.classList.remove("show");
          this.triggerNewRoundForCurrentSubject("standard");
        });
      }

      if (DOM.btnSummaryRetryWrong) {
        DOM.btnSummaryRetryWrong.addEventListener("click", () => {
          DOM.roundSummaryModal.classList.remove("show");
          if (this.sessionWrongItems.length > 0) {
            const retryCopy = [...this.sessionWrongItems];
            this.triggerNewRoundForCurrentSubject("retry_wrong", retryCopy);
          } else {
            this.triggerNewRoundForCurrentSubject("review_only");
          }
        });
      }

      // 錯題本彈窗
      if (DOM.btnOpenWrongBook) {
        DOM.btnOpenWrongBook.addEventListener("click", () => {
          SoundSystem.play("pop");
          this.renderWrongBookModal("all");
          DOM.wrongBookModal.classList.add("show");
        });
      }
      if (DOM.btnCloseWrongBook) {
        DOM.btnCloseWrongBook.addEventListener("click", () => DOM.wrongBookModal.classList.remove("show"));
      }
      if (DOM.wrongBookFilters) {
        DOM.wrongBookFilters.querySelectorAll("[data-wb-subject]").forEach(btn => {
          btn.addEventListener("click", () => {
            DOM.wrongBookFilters.querySelectorAll("[data-wb-subject]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            this.renderWrongBookModal(btn.dataset.wbSubject);
          });
        });
      }
      if (DOM.btnWbStartPractice) {
        DOM.btnWbStartPractice.addEventListener("click", () => {
          DOM.wrongBookModal.classList.remove("show");
          if (this.currentWbSubject && this.currentWbSubject !== "all") {
            switchSubject(this.currentWbSubject);
          }
          this.triggerNewRoundForCurrentSubject("review_only");
        });
      }

      // 獎勵館彈窗
      if (DOM.btnOpenRewards) {
        DOM.btnOpenRewards.addEventListener("click", () => {
          SoundSystem.play("pop");
          this.renderRewardsModal();
          DOM.rewardsModal.classList.add("show");
        });
      }
      if (DOM.btnCloseRewards) {
        DOM.btnCloseRewards.addEventListener("click", () => DOM.rewardsModal.classList.remove("show"));
      }
      document.querySelectorAll("[data-rw-tab]").forEach(tabBtn => {
        tabBtn.addEventListener("click", () => {
          document.querySelectorAll("[data-rw-tab]").forEach(b => b.classList.remove("active"));
          tabBtn.classList.add("active");
          const tab = tabBtn.dataset.rwTab;
          if (DOM.rewardsPanelPets) DOM.rewardsPanelPets.style.display = tab === "pets" ? "block" : "none";
          if (DOM.rewardsPanelStickers) DOM.rewardsPanelStickers.style.display = tab === "stickers" ? "block" : "none";
          if (DOM.rewardsPanelStories) DOM.rewardsPanelStories.style.display = tab === "stories" ? "block" : "none";
        });
      });

      // 設定與匯出/匯入彈窗
      if (DOM.btnOpenSettings) {
        DOM.btnOpenSettings.addEventListener("click", () => {
          SoundSystem.play("pop");
          this.applySettingsToUI();
          if (DOM.settingsStatusMsg) DOM.settingsStatusMsg.textContent = "";
          DOM.settingsModal.classList.add("show");
        });
      }
      if (DOM.btnCloseSettings) {
        DOM.btnCloseSettings.addEventListener("click", () => DOM.settingsModal.classList.remove("show"));
      }
      if (DOM.btnSaveSettings) {
        DOM.btnSaveSettings.addEventListener("click", () => {
          if (!window.MagicProgress) return;
          const prof = window.MagicProgress.state.profile;
          prof.nickname = (DOM.inputNickname.value || "小公主").trim();
          prof.soundEnabled = DOM.chkSoundEnabled.checked;
          prof.animEnabled = DOM.chkAnimEnabled.checked;
          window.MagicProgress.save();
          this.applySettingsToUI();
          if (DOM.settingsStatusMsg) DOM.settingsStatusMsg.textContent = "✅ 設定已儲存！";
        });
      }
      if (DOM.btnPreviewWeeklyReport) {
        DOM.btnPreviewWeeklyReport.addEventListener("click", async () => {
          if (!window.MagicProgress) return;
          try {
            const res = await fetch("/api/weekly-report/html", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: window.MagicProgress.exportJSON()
            });
            const data = await res.json();
            if (data.status === "success" && data.html) {
              const blob = new Blob([data.html], { type: "text/html;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              window.open(url, "_blank");
              if (DOM.settingsStatusMsg) {
                DOM.settingsStatusMsg.textContent = "📊 已在新分頁開啟本週家長週報 HTML！";
              }
            }
          } catch (err) {
            console.error("開啟線上週報失敗:", err);
          }
        });
      }
      if (DOM.btnExportProgress) {
        DOM.btnExportProgress.addEventListener("click", () => {
          if (!window.MagicProgress) return;
          const jsonStr = window.MagicProgress.exportJSON();
          const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "progress_export.json";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          if (DOM.settingsStatusMsg) {
            DOM.settingsStatusMsg.textContent = "📥 已匯出 progress_export.json！可放入 Report/data/ 產生家長週報。";
          }
        });
      }
      if (DOM.btnImportProgressTrigger && DOM.inputImportProgress) {
        DOM.btnImportProgressTrigger.addEventListener("click", () => DOM.inputImportProgress.click());
        DOM.inputImportProgress.addEventListener("change", (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              window.MagicProgress.importJSON(ev.target.result);
              this.applySettingsToUI();
              this.refreshHeaderBadges();
              if (DOM.settingsStatusMsg) DOM.settingsStatusMsg.textContent = "✅ 進度匯入成功！";
            } catch (err) {
              if (DOM.settingsStatusMsg) DOM.settingsStatusMsg.textContent = "❌ 匯入失敗：檔案格式不正確";
            }
          };
          reader.readAsText(file);
        });
      }
    }
  };
  window.V3Controller = V3Controller;

  // =========================================================================
  // 4. API 溝通與題庫預載
  // =========================================================================
  async function fetchCategories() {
    try {
      const res = await fetch("/api/categories");
      const json = await res.json();
      if (json.status === "success") {
        state.categories = json.data;
        renderBankTiles(state.activeTab);
      }
    } catch (err) {
      console.error("[API Error] 載入注音分類失敗:", err);
    }
  }

  async function preloadAllQuestions() {
    try {
      const res = await fetch("/api/questions?type=all");
      const json = await res.json();
      if (json.status === "success") {
        state.allQuestionsPool = json.data;
      }
    } catch (err) {
      console.error("[API Error] 預載題庫失敗:", err);
    }
  }

  function getRandomFromPool(filterFn = null) {
    let pool = state.allQuestionsPool;
    if (filterFn) pool = pool.filter(filterFn);
    if (!pool || !pool.length) pool = state.allQuestionsPool;
    if (!pool || !pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // =========================================================================
  // ★ 主學科切換邏輯 (Subject Switcher) ★
  // =========================================================================
  function switchSubject(subjectKey) {
    SoundSystem.play("pop");
    state.currentSubject = subjectKey;

    DOM.subjectTabBtns.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.subject === subjectKey);
    });

    DOM.subjectSections.forEach(section => {
      section.classList.toggle("active", section.id === `section-${subjectKey}`);
    });

    if (subjectKey === "bopomofo") {
      DOM.mainLogoIcon.textContent = "🪄";
      DOM.mainLogoTitle.textContent = "注音魔法盒";
      DOM.mainLogoSub.textContent = "💖 河堤國小 × 康軒版（一上首冊・一下 學習評量／新挑戰測驗卷）3000題";
      DOM.gameNavBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.game === state.currentGame));
      V3Controller.startNewSession("bopomofo", state.currentMode).then(() => fetchRandomClassicQuestion(true));
    } else if (subjectKey === "english") {
      DOM.mainLogoIcon.textContent = "🔤";
      DOM.mainLogoTitle.textContent = "英文歡樂樂園";
      DOM.mainLogoSub.textContent = "🌟 河堤國小 × 康軒版（字母・Phonics・教室用語・中英對照單字評量）";
      DOM.engModeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.engMode === state.currentEngMode));
      V3Controller.startNewSession("english", state.currentEngMode).then(() => EnglishGame.startRound(true));
    } else if (subjectKey === "math") {
      DOM.mainLogoIcon.textContent = "🔢";
      DOM.mainLogoTitle.textContent = "小小數學城堡";
      DOM.mainLogoSub.textContent = "🍓 河堤國小 × 康軒版（一上・一下 學習評量／新挑戰測驗卷）期中期末特訓";
      DOM.mathModeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.mathMode === state.currentMathMode));
      V3Controller.startNewSession("math", state.currentMathMode).then(() => MathGame.startRound(true));
    } else if (subjectKey === "multiplication") {
      DOM.mainLogoIcon.textContent = "✖️";
      DOM.mainLogoTitle.textContent = "99乘法冒險樂園";
      DOM.mainLogoSub.textContent = "🐰 河堤國小 × 康軒版（2/5/10 跳數銜接・生活乘法應用・九九口訣評量）";
      DOM.multModeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.multMode === state.currentMultMode));
      V3Controller.startNewSession("multiplication", state.currentMultMode).then(() => MultiplicationGame.startRound(true));
    }
  }

  // =========================================================================
  // 5. 遊戲視圖切換
  // =========================================================================
  function switchGameView(gameKey) {
    if (!gameKey) return;
    SoundSystem.play("pop");
    state.currentGame = gameKey;

    DOM.gameNavBtns.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.game === gameKey);
    });

    DOM.gameViews.forEach(view => {
      view.classList.toggle("active", view.id === `view-${gameKey}`);
    });

    // 啟動對應小遊戲初始回合
    if (gameKey === "bubble") BubbleGame.startRound();
    else if (gameKey === "monster") MonsterGame.startRound();
    else if (gameKey === "racer") RacerGame.startRound();
    else if (gameKey === "memory") MemoryGame.startRound();
    else if (gameKey === "mole") MoleGame.startRound();
  }

  // =========================================================================
  // 6. 經典模式：直式注音魔法盒
  // =========================================================================
  async function fetchRandomClassicQuestion(useSessionQueue = true) {
    state.isLocked = true;
    showFeedback("正在魔法抽取生活新題目...", "neutral");

    try {
      const sessionQ = useSessionQueue ? V3Controller.getCurrentSessionQuestion() : null;
      if (sessionQ && sessionQ.character) {
        state.currentQuestion = sessionQ;
        loadQuestionIntoClassicUI(state.currentQuestion);
        return;
      }

      const url = `/api/questions/random?type=${state.currentMode}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.status === "success" && json.data) {
        state.currentQuestion = json.data;
        loadQuestionIntoClassicUI(state.currentQuestion);
      }
    } catch (err) {
      console.error("[API Error] 獲取題目失敗:", err);
    } finally {
      state.isLocked = false;
    }
  }

  function loadQuestionIntoClassicUI(q) {
    clearSelection();
    DOM.targetEmoji.textContent = q.emoji || "📝";
    DOM.targetChar.textContent = q.character;
    DOM.targetWord.textContent = q.word || q.character;

    if (q.type === "2-pin") {
      DOM.slotMedial.classList.add("optional");
      DOM.slotMedial.title = "二拼字詞通常不需介母";
    } else {
      DOM.slotMedial.classList.remove("optional");
      DOM.slotMedial.title = "三拼必須包含介母 (ㄧ/ㄨ/ㄩ)";
    }

    const typeLabel = q.type === "3-pin" ? "三拼 (聲+介+韻)" : "二拼 (聲+韻)";
    const examTag = q.exam_tag ? `【${q.exam_tag}】` : "";
    showFeedback(`${examTag}請拼出詞語「${q.word || q.character}」中「${q.character}」的【${typeLabel}】`, "neutral");

    setTimeout(() => {
      SoundSystem.speak(`${q.character}，${q.word || ""}`);
    }, 350);
  }

  function renderBankTiles(categoryKey) {
    if (!state.categories) return;
    DOM.tilesContainer.innerHTML = "";

    const list = categoryKey === "initial" ? state.categories.initials :
                 categoryKey === "medial"  ? state.categories.medials :
                 categoryKey === "final"   ? state.categories.finals : [];

    if (categoryKey === "tone") {
      state.categories.tones.forEach(t => {
        DOM.tilesContainer.appendChild(createTileElement(t.symbol || "—", "tone", t.id, t.name));
      });
    } else {
      list.forEach(sym => {
        DOM.tilesContainer.appendChild(createTileElement(sym, categoryKey));
      });
    }
  }

  function createTileElement(symbol, type, toneId = null, title = null) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = `pinyin-tile tile-${type}`;
    tile.textContent = symbol;
    tile.title = title || `點擊填入或拖曳「${symbol}」`;
    tile.draggable = true;

    tile.dataset.type = type;
    tile.dataset.symbol = symbol;
    if (toneId) tile.dataset.toneId = toneId;

    tile.addEventListener("click", () => {
      SoundSystem.play("pop");
      Array.from(DOM.tilesContainer.children).forEach(t => t.classList.remove("active"));
      tile.classList.add("active");
      assignSymbolToSlot(type, symbol, toneId);
    });

    tile.addEventListener("dragstart", (e) => {
      tile.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/json", JSON.stringify({ type, symbol, toneId }));
    });

    tile.addEventListener("dragend", () => {
      tile.classList.remove("dragging");
    });

    return tile;
  }

  function assignSymbolToSlot(type, symbol, toneId = null) {
    if (type === "initial") {
      state.userSelection.initial = symbol;
      DOM.contentInitial.textContent = symbol;
      DOM.slotInitial.classList.add("filled");
    } else if (type === "medial") {
      state.userSelection.medial = symbol;
      DOM.contentMedial.textContent = symbol;
      DOM.slotMedial.classList.add("filled");
    } else if (type === "final") {
      state.userSelection.final = symbol;
      DOM.contentFinal.textContent = symbol;
      DOM.slotFinal.classList.add("filled");
    } else if (type === "tone") {
      state.userSelection.tone = toneId || "1";
      state.userSelection.toneSymbol = symbol === "—" ? "" : symbol;
      DOM.contentTone.textContent = state.userSelection.toneSymbol;
      DOM.slotTone.classList.add("filled");
    }
    updateSlotHints();
    if (symbol) SoundSystem.speak(symbol);
  }

  function clearSlot(type) {
    SoundSystem.play("pop");
    if (type === "initial") {
      state.userSelection.initial = "";
      DOM.contentInitial.textContent = "";
      DOM.slotInitial.classList.remove("filled");
    } else if (type === "medial") {
      state.userSelection.medial = "";
      DOM.contentMedial.textContent = "";
      DOM.slotMedial.classList.remove("filled");
    } else if (type === "final") {
      state.userSelection.final = "";
      DOM.contentFinal.textContent = "";
      DOM.slotFinal.classList.remove("filled");
    } else if (type === "tone") {
      state.userSelection.tone = "1";
      state.userSelection.toneSymbol = "";
      DOM.contentTone.textContent = "";
      DOM.slotTone.classList.remove("filled");
    }
    updateSlotHints();
  }

  function clearSelection() {
    clearSlot("initial");
    clearSlot("medial");
    clearSlot("final");
    clearSlot("tone");
  }

  function updateSlotHints() {
    document.getElementById("hint-rm-initial").textContent = state.userSelection.initial ? "✕點擊清空" : "";
    document.getElementById("hint-rm-medial").textContent = state.userSelection.medial ? "✕點擊清空" : "";
    document.getElementById("hint-rm-final").textContent = state.userSelection.final ? "✕點擊清空" : "";
    document.getElementById("hint-rm-tone").textContent = state.userSelection.toneSymbol ? "✕點擊清空" : "";
  }

  function showFeedback(msg, style = "neutral") {
    DOM.feedbackBanner.className = `feedback-banner ${style}`;
    DOM.feedbackBanner.innerHTML = `<span>${msg}</span>`;
  }

  async function submitVerification() {
    if (state.isLocked || !state.currentQuestion) return;
    SoundSystem.initContext();

    const payload = {
      question_id: state.currentQuestion.id,
      user_answer: {
        initial: state.userSelection.initial,
        medial: state.userSelection.medial,
        final: state.userSelection.final,
        tone: state.userSelection.tone
      }
    };

    if (!payload.user_answer.initial && !payload.user_answer.medial && !payload.user_answer.final) {
      SoundSystem.play("wrong");
      showFeedback("請先點選下方注音符號放入格子裡喔！", "gentle-error");
      return;
    }

    state.isLocked = true;
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.status === "success") {
        const v3Res = V3Controller.recordQuestionResult("bopomofo", state.currentQuestion, data.correct);
        if (data.correct) {
          addStars(1);
          SoundSystem.play("correct");
          showFeedback(`🎉 答對了！「${data.character}」讀作 ${data.full_pinyin}`, "success");
          setTimeout(() => SoundSystem.speak(`${data.character}，${data.full_pinyin}`), 300);
          showCelebrationModal(data);
        } else {
          state.streak = 0;
          DOM.scoreStreak.textContent = state.streak;
          SoundSystem.play("wrong");
          showFeedback(`💪 ${data.friendly_hint || "差一點點就成功囉！"}${v3Res.explain ? "<br>" + v3Res.explain : ""}`, "gentle-error");
          setTimeout(() => SoundSystem.speak("再想一想喔，你一定可以拼出來！"), 250);
        }
      }
    } catch (err) {
      console.error("[API Error] 驗證失敗:", err);
    } finally {
      state.isLocked = false;
    }
  }

  function showCelebrationModal(data) {
    DOM.modalTitle.textContent = "太厲害了！答對了！";
    DOM.modalSpellDetail.textContent = `國字：${data.character} ➔ 讀音：${data.full_pinyin}`;
    DOM.modal.classList.add("show");
  }

  function hideCelebrationModal() {
    DOM.modal.classList.remove("show");
  }

  // =========================================================================
  // 7. 遊戲 1：🫧 泡泡消消樂 (Bubble Pop)
  // =========================================================================
  const BubbleGame = {
    currentQ: null,
    sequence: [],
    currentIndex: 0,
    roundsWon: 0,

    startRound() {
      this.currentQ = getRandomFromPool();
      if (!this.currentQ) return;
      this.currentIndex = 0;

      // 目標分解序列
      this.sequence = [];
      if (this.currentQ.initial) this.sequence.push({ type: "聲母", symbol: this.currentQ.initial });
      if (this.currentQ.medial) this.sequence.push({ type: "介母", symbol: this.currentQ.medial });
      if (this.currentQ.final) this.sequence.push({ type: "韻母", symbol: this.currentQ.final });
      const toneSym = this.currentQ.tone_symbol || "—";
      this.sequence.push({ type: "聲調", symbol: toneSym });

      DOM.bubbleTargetEmoji.textContent = this.currentQ.emoji || "🫧";
      DOM.bubbleTargetChar.textContent = this.currentQ.character;
      DOM.bubbleTargetWord.textContent = this.currentQ.word || this.currentQ.character;
      DOM.bubbleRoundCount.textContent = this.roundsWon;

      this.renderProgress();
      this.renderBubbles();

      DOM.bubbleHintMsg.textContent = `💡 請先找到第 1 個發音「${this.sequence[0].symbol}」戳破它！`;
      setTimeout(() => SoundSystem.speak(`${this.currentQ.character}，${this.currentQ.word || ""}`), 300);
    },

    renderProgress() {
      DOM.bubbleProgress.innerHTML = "";
      this.sequence.forEach((item, idx) => {
        const badge = document.createElement("div");
        badge.className = "bubble-step-badge";
        if (idx < this.currentIndex) badge.classList.add("done");
        else if (idx === this.currentIndex) badge.classList.add("current");
        badge.textContent = `${item.type}: ${item.symbol}`;
        DOM.bubbleProgress.appendChild(badge);
      });
    },

    renderBubbles() {
      DOM.bubblePond.innerHTML = "";
      const neededSymbols = this.sequence.map(s => s.symbol);

      // 產生混淆泡泡
      const distractors = ["ㄅ", "ㄆ", "ㄇ", "ㄉ", "ㄊ", "ㄍ", "ㄧ", "ㄨ", "ㄚ", "ㄛ", "ㄞ", "ˊ", "ˇ", "ˋ"]
        .filter(s => !neededSymbols.includes(s));
      const distractorPool = shuffleArray(distractors).slice(0, 5);

      const allSymbols = shuffleOptionsBalanced(
        [...neededSymbols, ...distractorPool],
        s => s === this.sequence[0].symbol,
        "bubble"
      );

      allSymbols.forEach(symbol => {
        const bubble = document.createElement("div");
        bubble.className = "bubble-item";
        bubble.textContent = symbol;
        bubble.addEventListener("click", () => this.handlePop(bubble, symbol));
        DOM.bubblePond.appendChild(bubble);
      });
    },

    handlePop(bubbleElem, clickedSymbol) {
      const targetItem = this.sequence[this.currentIndex];
      if (clickedSymbol === targetItem.symbol) {
        SoundSystem.play("bubble");
        SoundSystem.speak(clickedSymbol);
        bubbleElem.classList.add("popped");
        setTimeout(() => bubbleElem.remove(), 280);

        this.currentIndex++;
        this.renderProgress();

        if (this.currentIndex >= this.sequence.length) {
          this.roundsWon++;
          addStars(3);
          DOM.bubbleRoundCount.textContent = this.roundsWon;
          SoundSystem.play("correct");
          DOM.bubbleHintMsg.textContent = `🎉 太棒了！完全拼出「${this.currentQ.character}」！獎勵 3 顆魔法星！`;
          setTimeout(() => this.startRound(), 1500);
        } else {
          DOM.bubbleHintMsg.textContent = `✨ 很好！下一個請找到「${this.sequence[this.currentIndex].symbol}」！`;
        }
      } else {
        SoundSystem.play("wrong");
        DOM.bubbleHintMsg.textContent = `💪 哎呀不是「${clickedSymbol}」喔，請找【${targetItem.type}: ${targetItem.symbol}】！`;
      }
    }
  };

  // =========================================================================
  // 8. 遊戲 2：👾 聲調小怪獸 (Tone Monster)
  // =========================================================================
  const MonsterGame = {
    targetTone: "1",
    targetToneName: "一聲",
    targetToneSymbol: "—",
    fedCount: 0,

    tonesConfig: [
      { id: "1", name: "一聲 (陰平)", symbol: "—" },
      { id: "2", name: "二聲 (陽平)", symbol: "ˊ" },
      { id: "3", name: "三聲 (上聲)", symbol: "ˇ" },
      { id: "4", name: "四聲 (去聲)", symbol: "ˋ" }
    ],

    startRound() {
      const chosenTone = this.tonesConfig[Math.floor(Math.random() * this.tonesConfig.length)];
      this.targetTone = chosenTone.id;
      this.targetToneName = chosenTone.name;
      this.targetToneSymbol = chosenTone.symbol;

      const monsterFaces = ["🦖", "👾", "🐻", "🐙", "🦄", "🐱"];
      DOM.monsterAvatar.textContent = monsterFaces[Math.floor(Math.random() * monsterFaces.length)];
      DOM.monsterDialog.innerHTML = `「咕嚕咕嚕～我想吃 <strong>${this.targetToneName} (${this.targetToneSymbol})</strong> 的生活食物！」`;
      DOM.monsterFedCount.textContent = `${this.fedCount} / 5`;
      DOM.monsterHintMsg.textContent = `💡 仔細唸唸看盤子裡的詞彙，找出是「${this.targetToneSymbol}」的字餵給怪獸！`;

      setTimeout(() => SoundSystem.speak(`我想吃${this.targetToneName}的食物`), 350);

      this.renderFoodOptions();
    },

    renderFoodOptions() {
      DOM.monsterFoodGrid.innerHTML = "";

      // 挑選 1 個正確食物 + 3 個其他聲調的食物
      const correctItem = getRandomFromPool(q => q.tone === this.targetTone);
      const wrongItems = [];
      const usedChars = new Set([correctItem.character]);

      while (wrongItems.length < 3) {
        const item = getRandomFromPool(q => q.tone !== this.targetTone && !usedChars.has(q.character));
        if (item) {
          usedChars.add(item.character);
          wrongItems.push(item);
        }
      }

      const options = shuffleOptionsBalanced(
        [correctItem, ...wrongItems],
        it => it.tone === this.targetTone,
        "monster"
      );

      options.forEach(item => {
        const card = document.createElement("div");
        card.className = "food-card";
        const fullPinyin = `${item.initial}${item.medial}${item.final}${item.tone_symbol || ""}`;
        card.innerHTML = `
          <span class="food-emoji">${item.emoji || "🍙"}</span>
          <span class="food-char">${item.character}</span>
          <span class="food-word">${item.word || item.character}</span>
          <span class="food-pinyin">${fullPinyin}</span>
        `;
        card.addEventListener("click", () => this.feedMonster(card, item, item.tone === this.targetTone));
        DOM.monsterFoodGrid.appendChild(card);
      });
    },

    feedMonster(cardElem, item, isCorrect) {
      highlightClickedOptionOnly(DOM.monsterFoodGrid, cardElem, isCorrect);
      if (isCorrect) {
        this.fedCount++;
        addStars(2);
        SoundSystem.play("correct");
        DOM.monsterAvatar.textContent = "😋";
        DOM.monsterDialog.innerHTML = `「阿姆阿姆～好吃！『<strong>${item.word}</strong>』真的是 ${this.targetToneSymbol} 喔！」`;
        DOM.monsterHintMsg.textContent = `🎉 小怪獸吃得好滿足！獲得 2 顆星！`;
        DOM.monsterFedCount.textContent = `${this.fedCount} / 5`;
        setTimeout(() => SoundSystem.speak(`好吃！${item.character}是${this.targetToneName}`), 300);
        setTimeout(() => this.startRound(), 1600);
      } else {
        SoundSystem.play("wrong");
        DOM.monsterAvatar.textContent = "😖";
        DOM.monsterDialog.innerHTML = `「嗚哇～『<strong>${item.word}</strong>』不是 ${this.targetToneSymbol} 啦！」`;
        DOM.monsterHintMsg.textContent = `💪 唸唸看「${item.character}」，再找找看哪一個是「${this.targetToneSymbol}」喔！`;
      }
    }
  };

  // =========================================================================
  // 9. 遊戲 3：🏎️ 極速小賽車 (Speed Racer)
  // =========================================================================
  const RacerGame = {
    currentQ: null,
    score: 0,

    startRound() {
      this.currentQ = getRandomFromPool();
      if (!this.currentQ) return;

      const parts = [this.currentQ.initial, this.currentQ.medial, this.currentQ.final].filter(Boolean);
      const toneSym = this.currentQ.tone_symbol || "—";
      parts.push(toneSym);
      DOM.racerFormula.textContent = parts.join(" + ") + " = ？";
      DOM.racerScoreBadge.textContent = `${this.score} 分`;
      DOM.racerHintMsg.textContent = "💡 點選正確的車道按鈕，賽車就會瞬間噴射加速！";

      this.renderLanes();
      setTimeout(() => SoundSystem.speak(`請問拼出什麼字呢？`), 300);
    },

    renderLanes() {
      DOM.racerLanes.innerHTML = "";

      const distractors = [];
      const usedChars = new Set([this.currentQ.character]);
      while (distractors.length < 2) {
        const item = getRandomFromPool(q => !usedChars.has(q.character));
        if (item) {
          usedChars.add(item.character);
          distractors.push(item);
        }
      }

      const laneOptions = shuffleOptionsBalanced(
        [this.currentQ, ...distractors],
        it => it.character === this.currentQ.character,
        "racer"
      );

      laneOptions.forEach((item, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "racer-lane-btn";
        btn.innerHTML = `
          <span class="lane-emoji">${item.emoji || "🏁"}</span>
          <span class="lane-char">${item.character}</span>
          <span class="lane-word">${item.word || item.character}</span>
        `;
        btn.addEventListener("click", () => this.handleLaneChoice(btn, item.character === this.currentQ.character, idx));
        DOM.racerLanes.appendChild(btn);
      });
    },

    handleLaneChoice(btnElem, isCorrect, laneIdx) {
      highlightClickedOptionOnly(DOM.racerLanes, btnElem, isCorrect);
      if (isCorrect) {
        this.score += 20;
        addStars(2);
        SoundSystem.play("correct");
        DOM.racerScoreBadge.textContent = `${this.score} 分`;
        DOM.racerHintMsg.textContent = `🚀 氮氣噴射！完全答對「${this.currentQ.character} (${this.currentQ.word})」！`;

        // 賽車衝刺動畫
        DOM.racerCarSprite.style.transform = `translateX(${(laneIdx - 1) * 120}px) scale(1.3)`;
        setTimeout(() => SoundSystem.speak(`${this.currentQ.character}，加速超車！`), 250);
        setTimeout(() => {
          DOM.racerCarSprite.style.transform = "none";
          this.startRound();
        }, 1400);
      } else {
        SoundSystem.play("wrong");
        DOM.racerHintMsg.textContent = "💪 撞到減速帶了！再看清楚上面的注音拼音喔！";
      }
    }
  };

  // =========================================================================
  // 10. 遊戲 4：🃏 記憶翻翻牌連連看 (Memory Match)
  // =========================================================================
  const MemoryGame = {
    cards: [],
    flippedCards: [],
    matchedCount: 0,

    startRound() {
      this.matchedCount = 0;
      this.flippedCards = [];
      DOM.memoryMatchedCount.textContent = "0 / 4 組";
      DOM.memoryHintMsg.textContent = "💡 集中注意力，記住每張牌藏在哪裡喔！";

      // 選出 4 個生活字詞
      const selected = [];
      const usedChars = new Set();
      while (selected.length < 4) {
        const item = getRandomFromPool(q => !usedChars.has(q.character));
        if (item) {
          usedChars.add(item.character);
          selected.push(item);
        }
      }

      this.cards = [];
      selected.forEach(item => {
        const fullPinyin = `${item.initial}${item.medial}${item.final}${item.tone_symbol || ""}`;
        // 卡片 A：國字與圖示
        this.cards.push({ id: item.id, type: "char", text: item.character, emoji: item.emoji, word: item.word });
        // 卡片 B：注音拼音
        this.cards.push({ id: item.id, type: "pinyin", text: fullPinyin, emoji: "🪄", word: item.word });
      });

      this.cards = shuffleArray(this.cards);
      this.renderCards();
    },

    renderCards() {
      DOM.memoryCardsGrid.innerHTML = "";
      this.cards.forEach((cardData, idx) => {
        const card = document.createElement("div");
        card.className = "memory-card";
        card.innerHTML = `
          <div class="memory-card-inner">
            <div class="memory-card-front">🎀</div>
            <div class="memory-card-back">
              <span class="card-back-emoji">${cardData.emoji}</span>
              <span class="${cardData.type === 'pinyin' ? 'card-back-pinyin' : 'card-back-text'}">${cardData.text}</span>
            </div>
          </div>
        `;
        card.addEventListener("click", () => this.handleFlip(card, cardData));
        DOM.memoryCardsGrid.appendChild(card);
      });
    },

    handleFlip(cardElem, cardData) {
      if (this.flippedCards.length >= 2) return;
      if (cardElem.classList.contains("flipped") || cardElem.classList.contains("matched")) return;

      SoundSystem.play("pop");
      cardElem.classList.add("flipped");
      SoundSystem.speak(cardData.text);
      this.flippedCards.push({ elem: cardElem, data: cardData });

      if (this.flippedCards.length === 2) {
        const [first, second] = this.flippedCards;
        if (first.data.id === second.data.id && first.data.type !== second.data.type) {
          // 配對成功！
          setTimeout(() => {
            SoundSystem.play("correct");
            first.elem.classList.add("matched");
            second.elem.classList.add("matched");
            this.matchedCount++;
            addStars(2);
            DOM.memoryMatchedCount.textContent = `${this.matchedCount} / 4 組`;
            DOM.memoryHintMsg.textContent = `🎉 配對成功！「${first.data.word || second.data.word}」！`;
            this.flippedCards = [];

            if (this.matchedCount >= 4) {
              addStars(4);
              DOM.memoryHintMsg.textContent = "🏆 哇！全部 4 組都成功配對通關了！獲得通關大獎 4 顆星！";
              setTimeout(() => this.startRound(), 2000);
            }
          }, 450);
        } else {
          // 配對失敗
          setTimeout(() => {
            SoundSystem.play("wrong");
            first.elem.classList.remove("flipped");
            second.elem.classList.remove("flipped");
            this.flippedCards = [];
          }, 900);
        }
      }
    }
  };

  // =========================================================================
  // 11. 遊戲 5：🔨 地鼠敲注音 (Whack-a-Mole)
  // =========================================================================
  const MoleGame = {
    targetSymbol: "ㄅ",
    scoreCount: 0,
    holesCount: 6,

    symbolsBank: [
      "ㄅ", "ㄆ", "ㄇ", "ㄈ", "ㄉ", "ㄊ", "ㄋ", "ㄌ",
      "ㄍ", "ㄎ", "ㄏ", "ㄐ", "ㄑ", "ㄒ", "ㄓ", "ㄔ",
      "ㄕ", "ㄖ", "ㄗ", "ㄘ", "ㄙ", "ㄧ", "ㄨ", "ㄩ",
      "ㄚ", "ㄛ", "ㄜ", "ㄝ", "ㄞ", "ㄟ", "ㄠ", "ㄡ",
      "ㄢ", "ㄣ", "ㄤ", "ㄥ", "ㄦ"
    ],

    startRound() {
      this.targetSymbol = this.symbolsBank[Math.floor(Math.random() * this.symbolsBank.length)];
      DOM.moleTargetSymbol.textContent = this.targetSymbol;
      DOM.moleScoreBadge.textContent = `${this.scoreCount} 隻`;
      DOM.moleHintMsg.textContent = `💡 看到帶有「${this.targetSymbol}」的地鼠，快速敲下去！`;

      setTimeout(() => SoundSystem.speak(`請找到${this.targetSymbol}`), 300);
      this.renderHoles();
    },

    renderHoles() {
      DOM.moleHolesContainer.innerHTML = "";

      // 產生 1 個正確洞穴 + 5 個干擾符號
      const distractors = shuffleArray(this.symbolsBank.filter(s => s !== this.targetSymbol)).slice(0, this.holesCount - 1);
      const holeSymbols = shuffleOptionsBalanced(
        [this.targetSymbol, ...distractors],
        s => s === this.targetSymbol,
        "mole"
      );

      for (let i = 0; i < this.holesCount; i++) {
        const symbol = holeSymbols[i];
        const hole = document.createElement("div");
        hole.className = "mole-hole up";
        hole.innerHTML = `
          <div class="mole-creature">
            <span class="mole-face">🐹</span>
            <span class="mole-symbol-badge">${symbol}</span>
          </div>
        `;
        const creature = hole.querySelector(".mole-creature");
        creature.addEventListener("click", () => this.hitMole(hole, symbol === this.targetSymbol, symbol));
        DOM.moleHolesContainer.appendChild(hole);
      }
    },

    hitMole(holeElem, isTarget, symbol) {
      if (isTarget) {
        SoundSystem.play("hammer");
        SoundSystem.speak(symbol);
        this.scoreCount++;
        addStars(2);
        DOM.moleScoreBadge.textContent = `${this.scoreCount} 隻`;
        DOM.moleHintMsg.textContent = `🔨 咚！準確擊中「${symbol}」！獲得 2 顆星！`;

        holeElem.classList.remove("up");
        setTimeout(() => this.startRound(), 900);
      } else {
        SoundSystem.play("wrong");
        DOM.moleHintMsg.textContent = `💪 哎呀！這是「${symbol}」，目標是要敲「${this.targetSymbol}」喔！`;
      }
    }
  };

  // =========================================================================
  // 12. 🔤 英文樂園練習模組 (English Practice Module)
  // =========================================================================
  const EnglishGame = {
    currentQ: null,

    async fetchQuestions() {
      try {
        const res = await fetch(`/api/english/questions?category=all`);
        const json = await res.json();
        if (json.status === "success") {
          state.allEngQuestionsPool = json.data;
        }
      } catch (e) {
        console.error("Fetch English questions error:", e);
      }
    },

    async startRound(useSessionQueue = true) {
      const sessionQ = useSessionQueue ? V3Controller.getCurrentSessionQuestion() : null;
      if (sessionQ && (sessionQ.category === "alphabet" || sessionQ.category === "phonics" || sessionQ.category === "sight_words" || sessionQ.category === "thematic")) {
        this.currentQ = sessionQ;
        state.currentEngQuestion = this.currentQ;
        this.renderQuestion(this.currentQ);
        return;
      }

      if (!state.allEngQuestionsPool || !state.allEngQuestionsPool.length) {
        await this.fetchQuestions();
      }
      let pool = state.allEngQuestionsPool;
      const mode = state.currentEngMode;
      if (mode === "sight" || mode === "sight_words") {
        pool = pool.filter(q => q.category === "sight_words");
      } else if (mode && mode !== "all") {
        pool = pool.filter(q => q.category === mode);
      }
      if (!pool || !pool.length) pool = state.allEngQuestionsPool;
      if (!pool || !pool.length) return;

      this.currentQ = pool[Math.floor(Math.random() * pool.length)];
      state.currentEngQuestion = this.currentQ;
      this.renderQuestion(this.currentQ);
    },

    renderQuestion(q) {
      DOM.engUnitBadge.textContent = q.exam_tag || (
        q.category === "alphabet" ? "🔤 河堤國小×康軒評量・字母認知" :
        q.category === "phonics"  ? "🐱 河堤國小×康軒評量・自然發音" :
        q.category === "sight_words" ? "⭐ 河堤國小×康軒評量・教室用語與常用字" : "🍓 河堤國小×康軒評量・主題核心單字"
      );

      DOM.engDisplayEmoji.textContent = q.emoji || "🔤";
      DOM.engFeedbackBanner.className = "feedback-banner neutral";
      DOM.engFeedbackBanner.innerHTML = "<span>💡 聽聽看發音，對照中文意思選出正確答案喔！</span>";

      if (q.category === "alphabet") {
        DOM.engDisplayText.textContent = q.display || q.target;
        DOM.engSubPhonics.textContent = `${q.sound || ""} • ${q.emoji || ""} ${q.sample_word || ""}（${q.meaning || ""}）`;
        DOM.engPromptText.textContent = q.prompt;
        this.renderOptions(q.options, q.target);
        setTimeout(() => {
          SoundSystem.speakEnglish(q.sample_word || q.target);
          if (q.sample_word && q.meaning) {
            setTimeout(() => SoundSystem.speak(`${q.sample_word}，${q.meaning}`), 700);
          }
        }, 300);
      } else if (q.category === "phonics") {
        DOM.engDisplayText.textContent = q.letters ? q.letters.join(" • ") : q.word;
        DOM.engSubPhonics.textContent = `${q.group || ""} ➔ 【${q.emoji} ${q.meaning}】`;
        DOM.engPromptText.textContent = q.prompt || `看到【${q.emoji} ${q.meaning}】，請選出正確的英文單字：`;
        this.renderOptions(q.options, q.answer || q.word);
        setTimeout(() => {
          SoundSystem.speakEnglish(q.word);
          setTimeout(() => SoundSystem.speak(q.meaning), 700);
        }, 300);
      } else if (q.category === "sight_words") {
        DOM.engDisplayText.textContent = q.word;
        DOM.engSubPhonics.textContent = `${q.example || ""}`;
        DOM.engPromptText.textContent = q.prompt || `常用字【${q.word}】是什麼意思呢？`;
        this.renderOptions(q.options, q.answer || q.meaning);
        setTimeout(() => {
          SoundSystem.speakEnglish(q.word);
          setTimeout(() => SoundSystem.speak(`${q.word}的意思是：${q.meaning}`), 700);
        }, 300);
      } else {
        // thematic
        DOM.engDisplayText.textContent = q.word;
        DOM.engSubPhonics.textContent = `【${q.emoji} ${q.meaning}】`;
        DOM.engPromptText.textContent = q.prompt || `看到「${q.emoji} ${q.meaning}」，請選出對應的英文單字：`;
        this.renderOptions(q.options, q.answer || q.word);
        setTimeout(() => {
          SoundSystem.speakEnglish(q.word);
          setTimeout(() => SoundSystem.speak(q.meaning), 700);
        }, 300);
      }
    },

    renderOptions(options, correctAns) {
      DOM.engOptionsGrid.innerHTML = "";
      const getOptVal = (opt) => (opt && typeof opt === "object") ? (opt.val !== undefined ? opt.val : opt.en) : opt;
      const shuffled = shuffleOptionsBalanced(
        options,
        opt => String(getOptVal(opt)) === String(correctAns),
        "english"
      );

      shuffled.forEach(opt => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "eng-opt-btn";

        let val, en, zh;
        if (opt && typeof opt === "object") {
          val = opt.val !== undefined ? opt.val : opt.en;
          en = opt.en || opt.val || "";
          zh = opt.zh || "";
        } else {
          val = opt;
          en = opt;
          zh = "";
        }

        btn.innerHTML = `
          <span class="eng-opt-en">${en}</span>
          ${zh ? `<span class="eng-opt-zh">${zh}</span>` : ""}
        `;

        btn.addEventListener("click", () => this.handleAnswer(btn, String(val) === String(correctAns), val, correctAns, opt));
        DOM.engOptionsGrid.appendChild(btn);
      });
    },

    handleAnswer(btnElem, isCorrect, chosen, correctAns, opt) {
      highlightClickedOptionOnly(DOM.engOptionsGrid, btnElem, isCorrect);
      const q = this.currentQ || {};
      const word = q.word || q.sample_word || q.target || q.display || "";
      const meaning = q.meaning || (opt && typeof opt === "object" ? opt.zh : "") || "";
      const v3Res = V3Controller.recordQuestionResult("english", q, isCorrect);

      if (isCorrect) {
        addStars(1);
        SoundSystem.play("correct");
        DOM.engFeedbackBanner.className = "feedback-banner success";
        DOM.engFeedbackBanner.innerHTML = `<span>🎉 Great job! 答對了！【${word}】的意思就是【${meaning}】喔！</span>`;

        SoundSystem.speakEnglish(word);
        if (meaning) {
          setTimeout(() => SoundSystem.speak(`答對了！${word} 就是 ${meaning}！`), 700);
        }

        setTimeout(() => {
          V3Controller.advanceOrFinishRound("english", () => this.startRound(true));
        }, 1700);
      } else {
        SoundSystem.play("wrong");
        DOM.engFeedbackBanner.className = "feedback-banner gentle-error";
        DOM.engFeedbackBanner.innerHTML = `<span>💪 Try again! 正確答案是【${correctAns}】（${meaning}）喔！${v3Res.explain ? "<br>" + v3Res.explain : ""}</span>`;
        if (meaning) {
          setTimeout(() => SoundSystem.speak(`再想一下喔，正確答案是 ${correctAns}，也就是 ${meaning}！`), 400);
        }
      }
    }
  };

  // =========================================================================
  // 13. 🔢 數學城堡練習模組 (Math Practice Module)
  // =========================================================================
  const MathGame = {
    currentQ: null,

    async fetchQuestions() {
      try {
        const res = await fetch(`/api/math/questions?category=all`);
        const json = await res.json();
        if (json.status === "success") {
          state.allMathQuestionsPool = json.data;
        }
      } catch (e) {
        console.error("Fetch Math questions error:", e);
      }
    },

    async startRound(useSessionQueue = true) {
      const sessionQ = useSessionQueue ? V3Controller.getCurrentSessionQuestion() : null;
      if (sessionQ && sessionQ.subject === "math") {
        this.currentQ = sessionQ;
        state.currentMathQuestion = this.currentQ;
        this.renderQuestion(this.currentQ);
        return;
      }

      if (!state.allMathQuestionsPool || !state.allMathQuestionsPool.length) {
        await this.fetchQuestions();
      }
      let pool = state.allMathQuestionsPool;
      if (state.currentMathMode === "add_sub") {
        pool = pool.filter(q => q.category === "addition" || q.category === "subtraction");
      } else if (state.currentMathMode !== "all") {
        pool = pool.filter(q => q.category === state.currentMathMode);
      }
      if (!pool || !pool.length) pool = state.allMathQuestionsPool;
      if (!pool || !pool.length) return;

      this.currentQ = pool[Math.floor(Math.random() * pool.length)];
      state.currentMathQuestion = this.currentQ;
      this.renderQuestion(this.currentQ);
    },

    renderQuestion(q) {
      DOM.mathFeedbackBanner.className = "feedback-banner neutral";
      DOM.mathFeedbackBanner.innerHTML = "<span>💡 動動小腦袋，仔細算算看喔！</span>";

      const defaultBadge =
        q.category === "counting" ? "🍓 康軒評量・數與量" :
        q.category === "compare"  ? "⚖️ 康軒評量・比大小與形狀" :
        q.category === "bonds"    ? "🍰 康軒評量・分與合(湊十拆十)" :
        (q.category === "addition" || q.category === "subtraction") ? "➕ 康軒評量・加減應用" :
        q.category === "clock"    ? "⏰ 康軒評量・時間與日曆" : "💰 康軒評量・錢幣與購物";

      DOM.mathUnitBadge.textContent = q.exam_tag || defaultBadge;

      if (q.category === "counting") {
        DOM.mathObjectsBoard.textContent = q.display || (q.emoji ? q.emoji.repeat(q.count || 1) : "🔢");
        DOM.mathFormulaLarge.textContent = q.formula || `數數看一共有幾個？`;
        DOM.mathPromptText.textContent = q.prompt;
        this.renderOptions(q.options, q.answer);
      } else if (q.category === "compare") {
        DOM.mathObjectsBoard.textContent = q.display || "⚖️";
        DOM.mathFormulaLarge.textContent = q.formula || `${q.num_a}   [ ? ]   ${q.num_b}`;
        DOM.mathPromptText.textContent = q.prompt;
        this.renderOptions(q.options, q.answer);
      } else if (q.category === "bonds") {
        DOM.mathObjectsBoard.textContent = q.display || "🍰 分一分・合一合";
        DOM.mathFormulaLarge.textContent = q.formula || `${q.total} ➔ ${q.part1} 和 [ ? ]`;
        DOM.mathPromptText.textContent = q.prompt;
        this.renderOptions(q.options, q.answer);
      } else if (q.category === "addition" || q.category === "subtraction") {
        DOM.mathObjectsBoard.textContent = q.display || (q.operator === "+" ? "⭐ 加法大挑戰" : "🎈 減法小偵探");
        DOM.mathFormulaLarge.textContent = q.formula || `${q.num_a} ${q.operator} ${q.num_b} = ？`;
        DOM.mathPromptText.textContent = q.prompt;
        this.renderOptions(q.options, q.answer);
      } else if (q.category === "clock") {
        DOM.mathObjectsBoard.textContent = q.display || `🕰️ ${q.time_str || ""}`;
        DOM.mathFormulaLarge.textContent = q.formula || `${q.time_str || ""}`;
        DOM.mathPromptText.textContent = q.prompt;
        this.renderOptions(q.options, q.answer);
      } else if (q.category === "money") {
        DOM.mathObjectsBoard.textContent = q.display || `${q.emoji || "🪙"} ${q.item_name || ""} ${q.price ? q.price + "元" : ""}`;
        DOM.mathFormulaLarge.textContent = q.formula || `付了 ${q.pay} 元 ➔ 找多少？`;
        DOM.mathPromptText.textContent = q.prompt;
        this.renderOptions(q.options, q.answer);
      }

      setTimeout(() => SoundSystem.speak(q.prompt), 350);
    },

    renderOptions(options, correctAns) {
      DOM.mathOptionsGrid.innerHTML = "";
      const shuffled = shuffleOptionsBalanced(
        options,
        opt => String(opt) === String(correctAns),
        "math"
      );
      shuffled.forEach(opt => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "math-opt-btn";
        btn.textContent = opt;
        btn.addEventListener("click", () => this.handleAnswer(btn, String(opt) === String(correctAns), opt, correctAns));
        DOM.mathOptionsGrid.appendChild(btn);
      });
    },

    handleAnswer(btnElem, isCorrect, chosen, correctAns) {
      highlightClickedOptionOnly(DOM.mathOptionsGrid, btnElem, isCorrect);
      const q = this.currentQ || {};
      const v3Res = V3Controller.recordQuestionResult("math", q, isCorrect);
      if (isCorrect) {
        addStars(1);
        SoundSystem.play("correct");
        DOM.mathFeedbackBanner.className = "feedback-banner success";
        DOM.mathFeedbackBanner.innerHTML = `<span>🎉 算對了！正確答案就是【${correctAns}】！</span>`;
        setTimeout(() => SoundSystem.speak("答對了！太厲害了！"), 200);
        setTimeout(() => {
          V3Controller.advanceOrFinishRound("math", () => this.startRound(true));
        }, 1400);
      } else {
        SoundSystem.play("wrong");
        DOM.mathFeedbackBanner.className = "feedback-banner gentle-error";
        DOM.mathFeedbackBanner.innerHTML = `<span>💪 再想想看喔！正確答案是【${correctAns}】！${v3Res.explain ? "<br>" + v3Res.explain : ""}</span>`;
      }
    }
  };

  // =========================================================================
  // ★ 99乘法表遊戲模組 (MultiplicationGame) ★
  // =========================================================================
  const MultiplicationGame = {
    currentQ: null,

    // 乘法口訣表
    chants: {
      "1x1": "一一得一", "1x2": "一二得二", "1x3": "一三得三", "1x4": "一四得四", "1x5": "一五得五",
      "1x6": "一六得六", "1x7": "一七得七", "1x8": "一八得八", "1x9": "一九得九",
      "2x1": "二一得二", "2x2": "二二得四", "2x3": "二三得六", "2x4": "二四得八", "2x5": "二五一十",
      "2x6": "二六十二", "2x7": "二七十四", "2x8": "二八十六", "2x9": "二九十八",
      "3x1": "三一得三", "3x2": "三二得六", "3x3": "三三得九", "3x4": "三四十二", "3x5": "三五十五",
      "3x6": "三六十八", "3x7": "三七二十一", "3x8": "三八二十四", "3x9": "三九二十七",
      "4x1": "四一得四", "4x2": "四二得八", "4x3": "四三十二", "4x4": "四四十六", "4x5": "四五二十",
      "4x6": "四六二十四", "4x7": "四七二十八", "4x8": "四八三十二", "4x9": "四九三十六",
      "5x1": "五一得五", "5x2": "五二一十", "5x3": "五三十五", "5x4": "五四二十", "5x5": "五五二十五",
      "5x6": "五六三十", "5x7": "五七三十五", "5x8": "五八四十", "5x9": "五九四十五",
      "6x1": "六一得六", "6x2": "六二十二", "6x3": "六三十八", "6x4": "六四二十四", "6x5": "六五三十",
      "6x6": "六六三十六", "6x7": "六七四十二", "6x8": "六八四十八", "6x9": "六九五十四",
      "7x1": "七一得七", "7x2": "七二十四", "7x3": "七三二十一", "7x4": "七四二十八", "7x5": "七五三十五",
      "7x6": "七六四十二", "7x7": "七七四十九", "7x8": "七八五十六", "7x9": "七九六十三",
      "8x1": "八一得八", "8x2": "八二十六", "8x3": "八三二十四", "8x4": "八四三十二", "8x5": "八五四十",
      "8x6": "八六四十八", "8x7": "八七五十六", "8x8": "八八六十四", "8x9": "八九七十二",
      "9x1": "九一得九", "9x2": "九二十八", "9x3": "九三二十七", "9x4": "九四三十六", "9x5": "九五四十五",
      "9x6": "九六五十四", "9x7": "九七六十三", "9x8": "九八七十二", "9x9": "九九八十一"
    },

    getChant(a, b) {
      return this.chants[`${a}x${b}`] || `${a} 乘 ${b} 等於 ${a * b}`;
    },

    async startRound(useSessionQueue = true) {
      if (state.currentMultMode === "explore_table") {
        DOM.multQuizArea.style.display = "none";
        DOM.multTableArea.style.display = "flex";
        this.renderTableExplorer(state.currentMultDigit || 2);
        return;
      }

      DOM.multQuizArea.style.display = "block";
      DOM.multTableArea.style.display = "none";

      DOM.multFeedbackBanner.className = "feedback-banner neutral";
      DOM.multFeedbackBanner.innerHTML = `<span>💡 動動小腦袋，用跳數或乘法算算看喔！</span>`;

      const sessionQ = useSessionQueue ? V3Controller.getCurrentSessionQuestion() : null;
      if (sessionQ && sessionQ.subject === "multiplication") {
        this.currentQ = sessionQ;
        state.currentMultQuestion = sessionQ;
        this.renderQuestion(sessionQ);
        return;
      }

      try {
        const res = await fetch(`/api/multiplication/questions/random?category=${state.currentMultMode}`);
        const json = await res.json();
        if (json.status === "success" && json.data) {
          this.currentQ = json.data;
          state.currentMultQuestion = json.data;
          this.renderQuestion(json.data);
        }
      } catch (err) {
        console.error("乘法題目取得失敗:", err);
      }
    },

    renderQuestion(q) {
      if (!q) return;
      DOM.multUnitBadge.textContent = q.exam_tag || (q.sub_unit ? `康軒評量・${q.sub_unit}` : "✖️ 康軒評量・99乘法應用題");
      DOM.multObjectsBoard.textContent = q.display || "";
      DOM.multFormulaLarge.textContent = q.formula || `${q.base} × ${q.multiplier} = ？`;
      DOM.multChantHint.textContent = q.chant ? `💡 口訣：${q.chant}` : `💡 算式：${q.base} × ${q.multiplier}`;
      DOM.multPromptText.textContent = q.prompt || "請選出正確答案：";

      this.renderOptions(q.options, q.answer, q.chant);
      setTimeout(() => SoundSystem.speak(q.prompt), 350);
    },

    renderOptions(options, correctAns, chant) {
      DOM.multOptionsGrid.innerHTML = "";
      const shuffled = shuffleOptionsBalanced(
        options,
        opt => String(opt) === String(correctAns),
        "multiplication"
      );
      shuffled.forEach(opt => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mult-opt-btn";
        btn.textContent = opt;
        btn.addEventListener("click", () => this.handleAnswer(btn, String(opt) === String(correctAns), opt, correctAns, chant));
        DOM.multOptionsGrid.appendChild(btn);
      });
    },

    handleAnswer(btnElem, isCorrect, chosen, correctAns, chant) {
      highlightClickedOptionOnly(DOM.multOptionsGrid, btnElem, isCorrect);
      const q = this.currentQ || {};
      const v3Res = V3Controller.recordQuestionResult("multiplication", q, isCorrect);
      if (isCorrect) {
        addStars(1);
        SoundSystem.play("correct");
        DOM.multFeedbackBanner.className = "feedback-banner success";
        DOM.multFeedbackBanner.innerHTML = `<span>🎉 答對了！${chant ? `『${chant}』！` : ""}太厲害了！</span>`;
        if (chant) {
          setTimeout(() => SoundSystem.speak(`答對了！${chant}！`), 150);
        } else {
          setTimeout(() => SoundSystem.speak("答對了！太厲害了！"), 150);
        }
        setTimeout(() => {
          V3Controller.advanceOrFinishRound("multiplication", () => this.startRound(true));
        }, 1500);
      } else {
        SoundSystem.play("wrong");
        DOM.multFeedbackBanner.className = "feedback-banner gentle-error";
        DOM.multFeedbackBanner.innerHTML = `<span>💪 再想想看喔！正確答案是【${correctAns}】${chant ? `（${chant}）` : ""}！${v3Res.explain ? "<br>" + v3Res.explain : ""}</span>`;
      }
    },

    renderTableExplorer(digit) {
      state.currentMultDigit = digit;
      // 1 到 9 數字切換按鈕
      DOM.multDigitSelector.innerHTML = "";
      for (let i = 1; i <= 9; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `mult-digit-btn ${i === digit ? "active" : ""}`;
        btn.textContent = i;
        btn.addEventListener("click", () => {
          SoundSystem.play("pop");
          this.renderTableExplorer(i);
        });
        DOM.multDigitSelector.appendChild(btn);
      }

      // 卡片列表
      DOM.multTableCardsGrid.innerHTML = "";
      for (let j = 1; j <= 9; j++) {
        const ans = digit * j;
        const chant = this.getChant(digit, j);
        const card = document.createElement("div");
        card.className = "mult-table-card";
        card.innerHTML = `
          <span class="card-formula">${digit} × ${j} = ${ans}</span>
          <span class="card-chant">${chant}</span>
          <span class="card-audio-icon">🔊</span>
        `;
        card.addEventListener("click", () => {
          SoundSystem.play("pop");
          Array.from(DOM.multTableCardsGrid.children).forEach(c => c.classList.remove("active"));
          card.classList.add("active");
          SoundSystem.speak(`${digit} 乘 ${j} 等於 ${ans}，${chant}`);
        });
        DOM.multTableCardsGrid.appendChild(card);
      }
    },

    reciteAllChants(digit) {
      SoundSystem.play("pop");
      const list = [];
      for (let j = 1; j <= 9; j++) {
        const chant = this.getChant(digit, j);
        list.push(`${chant}`);
      }
      const fullText = `${digit}的乘法表：` + list.join("，");
      SoundSystem.speak(fullText);
    }
  };

  // =========================================================================
  // 14. 拖曳與事件監聽設定
  // =========================================================================
  function setupDragAndDrop() {
    const slots = [DOM.slotInitial, DOM.slotMedial, DOM.slotFinal, DOM.slotTone];
    slots.forEach(slot => {
      slot.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        slot.classList.add("drag-over");
      });

      slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));

      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.classList.remove("drag-over");
        try {
          const raw = e.dataTransfer.getData("application/json");
          if (!raw) return;
          const data = JSON.parse(raw);
          if (slot.dataset.type === data.type) {
            SoundSystem.play("pop");
            assignSymbolToSlot(data.type, data.symbol, data.toneId);
          } else {
            SoundSystem.play("wrong");
            showFeedback("格子放錯囉，請放到對應的格子裡喔！", "gentle-error");
          }
        } catch (err) {
          console.error("Drop error:", err);
        }
      });

      slot.addEventListener("click", () => clearSlot(slot.dataset.type));
    });
  }

  function setupEventListeners() {
    // ★ 頂層四大主學科頁籤切換事件 ★
    DOM.subjectTabBtns.forEach(btn => {
      btn.addEventListener("click", () => switchSubject(btn.dataset.subject));
    });

    // 英文模式切換
    DOM.engModeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        SoundSystem.play("pop");
        DOM.engModeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentEngMode = btn.dataset.engMode;
        V3Controller.startNewSession("english", state.currentEngMode).then(() => EnglishGame.startRound(true));
      });
    });
    DOM.btnEngNext.addEventListener("click", () => {
      SoundSystem.play("pop");
      V3Controller.advanceOrFinishRound("english", () => EnglishGame.startRound(true));
    });
    DOM.btnEngSpeak.addEventListener("click", () => {
      if (EnglishGame.currentQ) {
        const q = EnglishGame.currentQ;
        const text = q.word || q.sample_word || q.display || q.target;
        SoundSystem.speakEnglish(text);
        if (q.meaning) {
          setTimeout(() => SoundSystem.speak(`${text}，${q.meaning}`), 700);
        }
      }
    });

    // 數學模式切換
    DOM.mathModeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        SoundSystem.play("pop");
        DOM.mathModeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentMathMode = btn.dataset.mathMode;
        V3Controller.startNewSession("math", state.currentMathMode).then(() => MathGame.startRound(true));
      });
    });
    DOM.btnMathMarksNext.addEventListener("click", () => {
      SoundSystem.play("pop");
      V3Controller.advanceOrFinishRound("math", () => MathGame.startRound(true));
    });

    // 99乘法表模式切換
    DOM.multModeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        SoundSystem.play("pop");
        DOM.multModeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentMultMode = btn.dataset.multMode;
        V3Controller.startNewSession("multiplication", state.currentMultMode).then(() => MultiplicationGame.startRound(true));
      });
    });
    DOM.btnMultNext.addEventListener("click", () => {
      SoundSystem.play("pop");
      V3Controller.advanceOrFinishRound("multiplication", () => MultiplicationGame.startRound(true));
    });
    DOM.btnMultReciteAll.addEventListener("click", () => {
      MultiplicationGame.reciteAllChants(state.currentMultDigit || 2);
    });

    // 遊戲大廳切換
    DOM.gameNavBtns.forEach(btn => {
      btn.addEventListener("click", () => switchGameView(btn.dataset.game));
    });

    // 經典模式題型分頁
    DOM.modeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        SoundSystem.play("pop");
        DOM.modeBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentMode = btn.dataset.mode;
        V3Controller.startNewSession("bopomofo", state.currentMode).then(() => fetchRandomClassicQuestion(true));
      });
    });

    // 符號分類切換
    DOM.bankTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        SoundSystem.play("pop");
        DOM.bankTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        state.activeTab = tab.dataset.tab;
        renderBankTiles(state.activeTab);
      });
    });

    // 經典模式按鈕
    DOM.btnClear.addEventListener("click", () => {
      SoundSystem.play("pop");
      clearSelection();
      showFeedback("已清空，請重新點選或拖曳注音喔！", "neutral");
    });
    DOM.btnSubmit.addEventListener("click", submitVerification);
    DOM.btnNext.addEventListener("click", () => {
      SoundSystem.play("pop");
      V3Controller.advanceOrFinishRound("bopomofo", () => fetchRandomClassicQuestion(true));
    });
    DOM.btnSpeakChar.addEventListener("click", () => {
      if (state.currentQuestion) {
        SoundSystem.speak(`${state.currentQuestion.character}，${state.currentQuestion.word || ""}`);
      }
    });

    // 彈窗「下一題」
    DOM.btnModalNext.addEventListener("click", () => {
      hideCelebrationModal();
      V3Controller.advanceOrFinishRound("bopomofo", () => fetchRandomClassicQuestion(true));
    });
    DOM.modal.addEventListener("click", (e) => {
      if (e.target === DOM.modal) hideCelebrationModal();
    });

    // 各小遊戲換題按鈕
    DOM.btnBubbleNext.addEventListener("click", () => BubbleGame.startRound());
    DOM.btnBubbleSpeak.addEventListener("click", () => {
      if (BubbleGame.currentQ) SoundSystem.speak(`${BubbleGame.currentQ.character}，${BubbleGame.currentQ.word || ""}`);
    });

    DOM.btnMonsterNext.addEventListener("click", () => MonsterGame.startRound());
    DOM.btnRacerNext.addEventListener("click", () => RacerGame.startRound());
    DOM.btnMemoryRestart.addEventListener("click", () => MemoryGame.startRound());
    DOM.btnMoleNext.addEventListener("click", () => MoleGame.startRound());
    DOM.btnMoleSpeak.addEventListener("click", () => SoundSystem.speak(`請找到${MoleGame.targetSymbol}`));

    // Enter 快捷鍵
    window.addEventListener("keydown", (e) => {
      if (document.body.classList.contains("vault-locked")) return;
      if (e.key === "Enter") {
        if (DOM.modal.classList.contains("show")) {
          hideCelebrationModal();
          V3Controller.advanceOrFinishRound("bopomofo", () => fetchRandomClassicQuestion(true));
        } else if (state.currentGame === "classic") {
          submitVerification();
        }
      }
    });
  }

  // =========================================================================
  // 13. 初始化
  // =========================================================================
  async function init() {
    await VaultAuth.init();
    V3Controller.init();
    setupDragAndDrop();
    setupEventListeners();
    await fetchCategories();
    await preloadAllQuestions();
    await V3Controller.startNewSession("bopomofo", state.currentMode);
    await fetchRandomClassicQuestion(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
