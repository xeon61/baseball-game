/* =========================================================
   미니 야구 — 순수 JS 게임 로직
   타자 모드 / 투수 모드, 각 9구
   ========================================================= */

(function () {
  "use strict";

  const TOTAL_PITCHES = 9;
  const $ = (sel) => document.querySelector(sel);

  /* ---------- 화면 전환 ---------- */
  const screens = {
    splash: $("#screen-splash"),
    team: $("#screen-team"),
    home: $("#screen-home"),
    bat: $("#screen-bat"),
    pitch: $("#screen-pitch"),
    inning: $("#screen-inning"),
    over: $("#screen-over"),
  };

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove("is-active"));
    screens[name].classList.add("is-active");
  }

  /* 모드 선택 */
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      const mode = card.dataset.mode;
      if (mode === "bat") startBat();
      else if (mode === "pitch") startPitch();
      else startInning();
    });
  });

  /* 뒤로/홈 버튼 */
  document.querySelectorAll("[data-back]").forEach((b) => {
    b.addEventListener("click", () => {
      bat.stop();
      inn.stop();
      show("home");
    });
  });

  /* 결과 팝업 헬퍼 */
  function popResult(el, text, kind) {
    el.className = "result-pop"; // reset
    el.textContent = text;
    void el.offsetWidth; // reflow
    if (kind === "out") el.classList.add("is-out");
    if (kind === "big") el.classList.add("is-big");
    el.classList.add("is-show");
  }

  /* 타격 결과 공통 판정
     acc: null=놓침 / 0~1=타이밍 정확도
     반환: { kind: "miss"|"whiff"|"out"|"hit", bases: 1~4, label } */
  function rollOutcome(acc) {
    if (acc === null) return { kind: "miss", label: "놓침! 루킹" };
    if (acc < 0.18) return { kind: "whiff", label: "헛스윙!" };
    const roll = acc * 0.75 + Math.random() * 0.25;
    if (roll > 0.94) return { kind: "hit", bases: 4, label: "홈런!" };
    if (roll > 0.82) return { kind: "hit", bases: 3, label: "3루타!" };
    if (roll > 0.66) return { kind: "hit", bases: 2, label: "2루타!" };
    if (roll > 0.46) return { kind: "hit", bases: 1, label: "1루타!" };
    return { kind: "out", label: Math.random() < 0.5 ? "플라이아웃" : "땅볼아웃" };
  }

  /* =======================================================
     사운드 (Web Audio — 외부 파일 없음)
     ======================================================= */
  const SFX = {
    ctx: null,
    muted: localStorage.getItem("mb_muted") === "1",

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    },

    tone(freq, dur, type = "sine", gain = 0.18) {
      if (this.muted) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    hit()    { this.tone(420, 0.12, "triangle", 0.22); },        // 딱! 타격
    homerun() {                                                    // 상승 아르페지오
      [523, 659, 784, 1046].forEach((f, i) =>
        setTimeout(() => this.tone(f, 0.18, "triangle", 0.2), i * 70));
    },
    whiff()  { this.tone(180, 0.16, "sawtooth", 0.12); },         // 헛스윙/아웃
    out()    { this.tone(140, 0.2, "sine", 0.14); },              // 실점/피안타
    strike() { this.tone(660, 0.1, "square", 0.16);
               setTimeout(() => this.tone(880, 0.1, "square", 0.16), 90); }, // 삼진
    click()  { this.tone(520, 0.05, "sine", 0.12); },            // UI

    toggle() {
      this.muted = !this.muted;
      localStorage.setItem("mb_muted", this.muted ? "1" : "0");
      this.paint();
      if (!this.muted) this.click();
    },
    paint() {
      const b = $("#sound-toggle");
      if (!b) return;
      b.textContent = this.muted ? "🔇" : "🔊";
      b.classList.toggle("is-muted", this.muted);
    },
  };
  SFX.paint();
  $("#sound-toggle").addEventListener("click", () => SFX.toggle());

  /* =======================================================
     연출 (화면 흔들림 / 플래시 / 진동)
     ======================================================= */
  function vibrate(ms) {
    if (navigator.vibrate) try { navigator.vibrate(ms); } catch {}
  }
  function shake(fieldEl) {
    fieldEl.classList.remove("is-shake");
    void fieldEl.offsetWidth;
    fieldEl.classList.add("is-shake");
  }
  function flash(flashEl) {
    flashEl.classList.remove("is-on");
    void flashEl.offsetWidth;
    flashEl.classList.add("is-on");
  }

  /* =======================================================
     난이도 (타자 모드 공 속도에 반영)
     ======================================================= */
  const DIFF = {
    easy:   { mult: 1.35, label: "쉬움" },
    normal: { mult: 1.0,  label: "보통" },
    hard:   { mult: 0.7,  label: "어려움" },
  };
  let difficulty = localStorage.getItem("mb_diff") || "normal";
  function paintDiff() {
    document.querySelectorAll(".diff-btn").forEach((b) =>
      b.classList.toggle("is-on", b.dataset.diff === difficulty));
  }
  document.querySelectorAll(".diff-btn").forEach((b) => {
    b.addEventListener("click", () => {
      difficulty = b.dataset.diff;
      localStorage.setItem("mb_diff", difficulty);
      paintDiff();
      SFX.click();
    });
  });
  paintDiff();

  /* =======================================================
     최고 기록 (localStorage)
     bat: 점수(타점) 기준 / pitch: 아웃 - 실점 기준
     ======================================================= */
  const BEST = {
    get(mode) {
      const v = localStorage.getItem("mb_best_" + mode);
      return v ? JSON.parse(v) : null;
    },
    save(mode, rec) {
      localStorage.setItem("mb_best_" + mode, JSON.stringify(rec));
    },
    paint() {
      const b = this.get("bat");
      const p = this.get("pitch");
      const i = this.get("inning");
      $("#best-bat").textContent = b
        ? `최고 ${b.score}점 · 안타 ${b.hits}`
        : "최고 기록 —";
      $("#best-pitch").textContent = p
        ? `최고 ${(p.score || 0).toLocaleString()}점 · 삼진 ${p.k || 0}`
        : "최고 기록 —";
      $("#best-inning").textContent = i
        ? `최고 ${i.runs}득점 · 안타 ${i.hits}`
        : "최고 기록 —";
    },
  };
  BEST.paint();

  /* =======================================================
     타이틀(표지) 화면 — 탭하면 홈으로
     ======================================================= */
  function overallBest() {
    const b = BEST.get("bat"), p = BEST.get("pitch");
    return Math.max((b && b.score) || 0, (p && p.score) || 0);
  }
  function paintSplashBest() {
    const el = $("#splash-best");
    if (el) el.textContent = overallBest().toLocaleString();
  }
  paintSplashBest();

  $("#screen-splash").addEventListener("click", () => {
    SFX.ensure();   // 첫 사용자 제스처 → 오디오 활성화
    SFX.click();
    if (getTeam()) show("home");
    else openTeamSelect();   // 최초 실행 → 응원팀 선택
  });

  /* =======================================================
     응원팀 선택 (KBO 10개 구단)
     ======================================================= */
  const TEAMS = [
    { id: "lg",      name: "LG 트윈스",    short: "LG",  color: "#C30452" },
    { id: "doosan",  name: "두산 베어스",   short: "두산", color: "#131230" },
    { id: "kt",      name: "KT 위즈",      short: "KT",  color: "#151515" },
    { id: "ssg",     name: "SSG 랜더스",   short: "SSG", color: "#CE0E2D" },
    { id: "nc",      name: "NC 다이노스",  short: "NC",  color: "#315288" },
    { id: "kia",     name: "KIA 타이거즈", short: "KIA", color: "#EA0029" },
    { id: "samsung", name: "삼성 라이온즈", short: "삼성", color: "#074CA1" },
    { id: "lotte",   name: "롯데 자이언츠", short: "롯데", color: "#041E42" },
    { id: "hanwha",  name: "한화 이글스",   short: "한화", color: "#FF6600" },
    { id: "kiwoom",  name: "키움 히어로즈", short: "키움", color: "#820024" },
  ];
  const teamGrid = $("#team-grid");
  const teamConfirm = $("#team-confirm");
  let pendingTeam = -1;

  function getTeam() {
    const id = localStorage.getItem("mb_team");
    return id ? TEAMS.find((t) => t.id === id) || null : null;
  }
  function paintHomeTeam() {
    const t = getTeam();
    $("#home-team-dot").style.background = t ? t.color : "var(--muted)";
    $("#home-team-name").textContent = t ? t.name : "팀 선택";
    // 플레이 화면 포인트 컬러(--pt)를 팀 대표색으로
    document.documentElement.style.setProperty("--pt", t ? t.color : "#0017ac");
  }

  // 팀 카드 렌더
  TEAMS.forEach((t, i) => {
    const card = document.createElement("button");
    card.className = "team-card";
    card.dataset.idx = i;
    card.innerHTML =
      `<span class="team-badge" style="background:${t.color}">${t.short}</span>` +
      `<span class="team-name">${t.name}</span>`;
    card.addEventListener("click", () => selectTeam(i));
    teamGrid.appendChild(card);
  });

  function markSelected(i) {
    teamGrid.querySelectorAll(".team-card").forEach((c, idx) =>
      c.classList.toggle("is-sel", idx === i));
    teamConfirm.disabled = i < 0;
    teamConfirm.textContent = i >= 0 ? `${TEAMS[i].name}로 시작` : "팀을 선택하세요";
  }
  function selectTeam(i) {
    pendingTeam = i;
    markSelected(i);
    SFX.click();
  }
  function openTeamSelect() {
    const cur = getTeam();
    pendingTeam = cur ? TEAMS.findIndex((t) => t.id === cur.id) : -1;
    markSelected(pendingTeam);
    show("team");
  }

  teamConfirm.addEventListener("click", () => {
    if (pendingTeam < 0) return;
    localStorage.setItem("mb_team", TEAMS[pendingTeam].id);
    paintHomeTeam();
    SFX.click();
    show("home");
  });
  $("#home-team").addEventListener("click", openTeamSelect);
  paintHomeTeam();

  /* 콤보 배지 헬퍼 */
  function showCombo(el, n) {
    if (n >= 2) {
      el.hidden = false;
      el.textContent = `🔥 ${n} 콤보`;
      el.classList.remove("is-bump");
      void el.offsetWidth;
      el.classList.add("is-bump");
    } else {
      el.hidden = true;
    }
  }

  /* =======================================================
     타자 모드
     ======================================================= */
  const bat = {
    field: $("#bat-field"),
    flash: $("#bat-flash"),
    ball: $("#bat-ball"),
    zone: $("#bat-zone"),
    pop: $("#bat-pop"),
    combo: $("#bat-combo"),
    hint: $("#bat-hint"),
    action: $("#bat-action"),
    elNo: $("#bat-pitch-no"),
    elHits: $("#bat-hits"),
    elHr: $("#bat-hr"),
    elOuts: $("#bat-outs"),
    elScore: $("#bat-score"),
    elBest: $("#bat-best"),
    dots: Array.from(document.querySelectorAll("#screen-bat .out-dots i")),
    missionWrap: $("#bat-mission"),
    missionCount: $("#bat-mission-count"),
    missionFill: $("#bat-mission-fill"),
    feedback: $("#bat-feedback"),
    grid: $("#bat-zonegrid"),
    cells: Array.from(document.querySelectorAll("#bat-zonegrid .zonecell")),

    targetCell: 4,
    pitchNo: 0,
    hits: 0,
    hr: 0,
    outs: 0,
    score: 0,
    streak: 0,

    live: false,        // 공이 날아오는 중
    swung: false,       // 이번 공에 스윙했는지
    running: false,     // 자동 진행 중(9구 세션)
    autoTimer: 0,       // 다음 공 예약 타이머
    startTime: 0,
    duration: 0,
    raf: 0,
    inWindowSince: -1,

    // 타이밍 상수: 공이 타깃 칸에 도착하는 순간(≈0.95)이 최적 타이밍
    T_HIT: 0.95,
    T_HALF: 0.3,

    resetBall() {
      this.ball.style.left = "";
      this.ball.style.top = "";
      this.ball.style.transform = "translate(-50%, -50%) scale(0.4)";
    },

    clearCells() {
      this.cells.forEach((c) =>
        c.classList.remove("is-target", "is-hit", "is-miss"));
    },

    reset() {
      this.pitchNo = 0;
      this.hits = this.hr = this.outs = this.score = 0;
      this.streak = 0;
      this.live = false;
      this.swung = false;
      this.elHits.textContent = "0";
      this.elHr.textContent = "0";
      this.elOuts.textContent = "0";
      this.elScore.textContent = "0";
      this.elNo.textContent = "1";
      this.ball.classList.remove("is-live");
      this.clearCells();
      this.resetBall();
      this.combo.hidden = true;
      this.setFeedback(-1);
      this.syncHud();
      this.running = false;
      clearTimeout(this.autoTimer);
      this.hint.textContent = "화면을 탭하면 시작 · 9구 자동 진행";
      this.action.textContent = "▶ 플레이 시작";
      this.action.hidden = false;
      this.action.disabled = false;
    },

    stop() {
      this.live = false;
      this.running = false;
      clearTimeout(this.autoTimer);
      cancelAnimationFrame(this.raf);
      this.ball.classList.remove("is-live");
      this.zone.classList.remove("is-on");
    },

    // 화면/버튼 탭(공이 없을 때): 시작 또는 결과
    tapIdle() {
      if (this.running || this.live) return;      // 진행/자동 대기 중이면 무시
      if (this.pitchNo >= TOTAL_PITCHES) { finishBat(); return; }
      this.begin();
    },

    // 세션 시작 → 첫 공 자동 투구
    begin() {
      if (this.running || this.live) return;
      this.running = true;
      this.nextPitch();
    },

    // HUD(점수·최고·아웃·미션) 동기화
    syncHud() {
      this.elScore.textContent = this.score;
      const best = BEST.get("bat");
      this.elBest.textContent = (best ? best.score : 0).toLocaleString();
      this.dots.forEach((d, i) => d.classList.toggle("is-on", this.outs > i));
      const m = Math.min(this.hits, 3);
      this.missionCount.textContent = m;
      this.missionFill.style.width = (m / 3) * 100 + "%";
      this.missionWrap.classList.toggle("is-complete", this.hits >= 3);
    },

    // 스윙 타이밍 피드백 (-1=없음, 0=미스, 1=늦음/빗맞음, 2=굿, 3=퍼펙트)
    setFeedback(level) {
      const fb = this.feedback;
      fb.classList.remove("is-bad", "is-good", "is-perfect");
      const n = Math.max(0, level);
      fb.querySelectorAll("i").forEach((i, idx) => i.classList.toggle("is-on", idx < n));
      if (level <= 1) fb.classList.add("is-bad");
      else if (level === 2) fb.classList.add("is-good");
      else if (level >= 3) fb.classList.add("is-perfect");
    },

    nextPitch() {
      if (this.pitchNo >= TOTAL_PITCHES) {
        finishBat();
        return;
      }
      this.pitchNo++;
      this.elNo.textContent = this.pitchNo;
      this.swung = false;
      this.live = true;
      this.action.hidden = true;
      this.clearCells();

      // 이번 공이 향할 칸을 랜덤 선택 → 해당 칸 강조
      this.targetCell = Math.floor(Math.random() * 9);
      this.cells[this.targetCell].classList.add("is-target");
      this.hint.textContent = "공이 오는 칸을 타이밍 맞춰 터치!";

      // 공 비행 시간 (난이도 반영)
      this.duration = (1100 + Math.random() * 700) * DIFF[difficulty].mult;
      this.startTime = performance.now();
      this.ball.classList.add("is-live");

      // 스테이지 기준으로 릴리스 지점(그리드 중앙 상단) → 타깃 칸 중심 좌표 계산
      const sR = this.field.getBoundingClientRect();
      const gR = this.grid.getBoundingClientRect();
      const cw = gR.width / 3, ch = gR.height / 3;
      const col = this.targetCell % 3, row = (this.targetCell / 3) | 0;
      const relX = gR.left - sR.left + gR.width * 0.5;
      const relY = gR.top - sR.top + gR.height * 0.14;
      const endX = gR.left - sR.left + (col + 0.5) * cw;
      const endY = gR.top - sR.top + (row + 0.5) * ch;

      const animate = (now) => {
        if (!this.live) return;
        const t = (now - this.startTime) / this.duration;
        const e = t * t; // 타자 쪽으로 갈수록 가속
        const x = relX + (endX - relX) * e;
        const y = relY + (endY - relY) * e;
        const s = 0.35 + t * 1.15; // 점점 커짐
        this.ball.style.left = x + "px";
        this.ball.style.top = y + "px";
        this.ball.style.transform = `translate(-50%, -50%) scale(${s})`;

        if (t >= 1) {
          this.live = false;
          this.ball.classList.remove("is-live");
          this.clearCells();
          this.resetBall();
          if (!this.swung) this.judge(null); // 놓침
          return;
        }
        this.raf = requestAnimationFrame(animate);
      };
      this.raf = requestAnimationFrame(animate);
    },

    // 타깃 칸과의 거리로 위치 정확도 계수 산출
    locFactor(cell) {
      if (cell === this.targetCell) return 1;
      if (cell < 0) return 0.28; // 빈 곳(와일드 스윙)
      const dc = Math.abs((cell % 3) - (this.targetCell % 3));
      const dr = Math.abs(((cell / 3) | 0) - ((this.targetCell / 3) | 0));
      return Math.max(dc, dr) === 1 ? 0.62 : 0.28; // 인접 / 먼 칸
    },

    // 칸(cell)을 터치해 스윙 — 위치 × 타이밍 정확도로 판정
    swingAt(cell) {
      if (!this.live || this.swung) return;
      this.swung = true;
      const t = (performance.now() - this.startTime) / this.duration;
      const timing = Math.max(0, 1 - Math.abs(t - this.T_HIT) / this.T_HALF);
      const acc = timing * this.locFactor(cell);

      if (cell >= 0) {
        this.cells[cell].classList.remove("is-target");
        this.cells[cell].classList.add(
          cell === this.targetCell ? "is-hit" : "is-miss");
      }

      this.live = false;
      cancelAnimationFrame(this.raf);
      this.ball.classList.remove("is-live");
      this.cells.forEach((c) => c.classList.remove("is-target"));
      this.resetBall();
      this.judge(acc);
    },

    // 손동작 스윙: 위치는 타깃으로 자동, 타이밍만 반영
    swing() {
      this.swingAt(this.targetCell);
    },

    // acc: null=놓침, 0~1=정확도
    judge(acc) {
      let result, kind = "";
      let isHit = false, isHR = false;

      if (acc === null) {
        result = "놓침! 루킹";
        kind = "out";
        // 놓침은 아웃으로 카운트하지 않음 (그냥 헛스윙 없음)
      } else if (acc < 0.18) {
        result = "헛스윙!";
        kind = "out";
        this.outs++;
        this.elOuts.textContent = this.outs;
      } else {
        // 정확도 + 약간의 운으로 결과 분기
        const roll = acc * 0.75 + Math.random() * 0.25;
        if (roll > 0.94) {
          result = "홈런!";
          kind = "big";
          isHit = isHR = true;
          this.hr++; this.hits++; this.score += 1;
          this.elHr.textContent = this.hr;
        } else if (roll > 0.82) {
          result = "3루타!";
          isHit = true;
          this.hits++; this.score += 1;
        } else if (roll > 0.66) {
          result = "2루타!";
          isHit = true;
          this.hits++; this.score += 1;
        } else if (roll > 0.46) {
          result = "1루타!";
          isHit = true;
          this.hits++;
        } else {
          result = "플라이아웃";
          kind = "out";
          this.outs++;
          this.elOuts.textContent = this.outs;
        }
        if (kind !== "out") {
          this.elHits.textContent = this.hits;
          this.elScore.textContent = this.score;
        }
      }

      // 콤보 + 사운드 + 연출
      if (isHit) {
        this.streak++;
        // 3콤보부터 타점 보너스 +1
        if (this.streak >= 3) {
          this.score += 1;
          this.elScore.textContent = this.score;
        }
        showCombo(this.combo, this.streak);
        if (isHR) {
          SFX.homerun(); flash(this.flash); shake(this.field); vibrate([0, 40, 30, 60]);
          result = this.streak >= 3 ? `홈런! ${this.streak}연타` : result;
        } else {
          SFX.hit(); vibrate(25);
        }
      } else {
        this.streak = 0;
        this.combo.hidden = true;
        SFX.whiff();
      }

      // 스윙 타이밍 피드백
      this.setFeedback(acc === null ? 0 : isHR ? 3 : isHit ? 2 : 1);

      popResult(this.pop, result, kind);
      this.syncHud();

      const done = this.pitchNo >= TOTAL_PITCHES;
      if (done) {
        // 경기 종료 → 결과 버튼 노출
        this.running = false;
        this.hint.textContent = "9구 종료!";
        this.action.textContent = "결과 보기";
        setTimeout(() => {
          this.action.hidden = false;
          this.action.disabled = false;
          this.hint.textContent = "결과 보기 버튼을 누르세요";
        }, 900);
      } else {
        // 자동으로 다음 공 (약 3초 간격)
        this.hint.textContent = "다음 공 준비…";
        clearTimeout(this.autoTimer);
        this.autoTimer = setTimeout(() => {
          if (this.running) this.nextPitch();
        }, 1700);
      }
    },
  };

  // 3x3 칸 터치 = 공이 오면 그 칸 스윙 / 대기 중이면 시작·결과
  bat.cells.forEach((cell) => {
    cell.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation(); // 스테이지 탭과 중복 방지
      if (bat.live) bat.swingAt(Number(cell.dataset.cell));
      else bat.tapIdle();
    });
  });

  // 존 바깥(빈 곳) 탭 = 와일드 스윙 / 대기 중이면 시작·결과
  bat.field.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (bat.live) bat.swingAt(-1);
    else bat.tapIdle();
  });

  // 중앙 시작/결과 버튼 (pointerdown은 필드로 전파 차단, click으로만 처리)
  bat.action.addEventListener("pointerdown", (e) => e.stopPropagation());
  bat.action.addEventListener("click", (e) => {
    e.stopPropagation();
    bat.tapIdle();
  });

  function startBat() {
    bat.reset();
    show("bat");
  }

  function finishBat() {
    bat.stop();
    const rec = { score: bat.score, hits: bat.hits, hr: bat.hr };
    const prev = BEST.get("bat");
    const isNew = !prev || rec.score > prev.score ||
      (rec.score === prev.score && rec.hits > prev.hits);
    if (isNew) { BEST.save("bat", rec); BEST.paint(); }
    showOver("타자 기록", [
      ["안타", bat.hits + "개"],
      ["홈런", bat.hr + "개"],
      ["아웃", bat.outs + "개"],
      ["타점", bat.score + "점"],
    ], gradeBatter(bat), "bat", isNew);
  }

  function gradeBatter(b) {
    const avg = b.hits / TOTAL_PITCHES;
    if (b.hr >= 2 || avg >= 0.6) return { g: "S", t: "전설의 타자!" };
    if (avg >= 0.45) return { g: "A", t: "강타자" };
    if (avg >= 0.3) return { g: "B", t: "준수한 타격" };
    if (avg >= 0.15) return { g: "C", t: "조금 더 분발!" };
    return { g: "D", t: "연습이 필요해요" };
  }

  /* =======================================================
     투수 모드
     ======================================================= */
  // 구종: 구속/제구 표시 + 헛스윙·피안타 확률 배수
  const PITCH_TYPES = [
    { name: "직구",   speed: 148, control: "좋음",     whiffMul: 0.85, hitMul: 1.12 },
    { name: "슬라이더", speed: 137, control: "보통",     whiffMul: 1.28, hitMul: 0.86 },
    { name: "커브",   speed: 121, control: "까다로움",   whiffMul: 1.45, hitMul: 0.80 },
    { name: "체인지업", speed: 129, control: "보통",     whiffMul: 1.16, hitMul: 0.74 },
  ];

  const pitch = {
    grid: $("#abs-grid"),
    field: $("#pitch-field"),
    flash: $("#pitch-flash"),
    pop: $("#pitch-pop"),
    combo: $("#pitch-combo"),
    hint: $("#pitch-hint"),
    reset: $("#pitch-reset"),
    elNo: $("#pitch-no"),
    elK: $("#pitch-k"),
    elOuts: $("#pitch-outs"),
    elHits: $("#pitch-hits"),
    elRuns: $("#pitch-runs"),
    elScore: $("#pitch-score"),
    elScore2: $("#pitch-score2"),
    elBest: $("#pitch-best"),
    elLeft: $("#pitch-left"),
    elType: $("#pitch-type"),
    elSpeed: $("#pitch-speed"),
    elControl: $("#pitch-control"),
    dots: Array.from(document.querySelectorAll("#pitch-out-dots i")),
    missionWrap: $("#pitch-mission"),
    missionCount: $("#pitch-mission-count"),
    missionFill: $("#pitch-mission-fill"),
    typeBtn: $("#pitch-type-btn"),

    cells: Array.from(document.querySelectorAll(".abs__cell")),

    pitchNo: 0,
    k: 0,
    outs: 0,
    hits: 0,
    runs: 0,
    score: 0,
    streak: 0,
    typeIndex: 0,
    busy: false,

    init() {
      this.pitchNo = 0;
      this.k = this.outs = this.hits = this.runs = this.score = 0;
      this.streak = 0;
      this.busy = false;
      this.elNo.textContent = "1";
      this.elK.textContent = "0";
      this.elOuts.textContent = "0";
      this.elHits.textContent = "0";
      this.elRuns.textContent = "0";
      this.combo.hidden = true;
      this.paintType();
      this.syncHud();
      this.hint.textContent = "존을 선택하여 투구하세요";
      this.reset.hidden = true;
      this.grid.classList.remove("is-locked");
      this.cells.forEach((c) => c.classList.remove("is-pick"));
    },

    // HUD/패널 동기화
    syncHud() {
      this.elScore.textContent = this.score.toLocaleString();
      this.elScore2.textContent = this.score.toLocaleString();
      const best = BEST.get("pitch");
      this.elBest.textContent = (best && best.score ? best.score : 0).toLocaleString();
      this.elLeft.textContent = TOTAL_PITCHES - this.pitchNo;
      this.dots.forEach((d, i) => d.classList.toggle("is-on", Math.min(this.outs, 3) > i));
      const m = Math.min(this.k, 3);
      this.missionCount.textContent = m;
      this.missionFill.style.width = (m / 3) * 100 + "%";
      this.missionWrap.classList.toggle("is-complete", this.k >= 3);
    },

    // 현재 구종 정보 표시
    paintType() {
      const t = PITCH_TYPES[this.typeIndex];
      this.elType.textContent = t.name;
      this.elSpeed.textContent = t.speed + " km/h";
      this.elControl.textContent = t.control;
    },
    // 구종 변경
    cycleType() {
      if (this.busy) return;
      this.typeIndex = (this.typeIndex + 1) % PITCH_TYPES.length;
      this.paintType();
      SFX.click();
      this.hint.textContent = PITCH_TYPES[this.typeIndex].name + " 선택 · 존을 골라 투구!";
    },

    // 제스처 조준 하이라이트 (실제 투구 전)
    setHover(i) {
      if (this.busy) return;
      this.cells.forEach((c, idx) => c.classList.toggle("is-hover", idx === i));
    },
    clearHover() {
      this.cells.forEach((c) => c.classList.remove("is-hover"));
    },

    throwTo(cellIndex) {
      if (this.busy) return;
      this.busy = true;
      this.grid.classList.add("is-locked");
      this.cells.forEach((c) => c.classList.remove("is-pick"));
      this.cells[cellIndex].classList.add("is-pick");

      // 셀별 위험도(가운데=4가 가장 맞기 쉬움). 가장자리/모서리는 볼/헛스윙 확률↑
      const edge = [1, 3, 5, 7];
      let whiff, hitChance;
      if (cellIndex === 4) {        // 한가운데
        whiff = 0.15; hitChance = 0.7;
      } else if (edge.includes(cellIndex)) { // 상하좌우 가장자리
        whiff = 0.4; hitChance = 0.42;
      } else {                       // 모서리
        whiff = 0.55; hitChance = 0.3;
      }

      // 구종 보정 + 구속 표시(약간의 변동)
      const t = PITCH_TYPES[this.typeIndex];
      whiff = Math.min(0.85, whiff * t.whiffMul);
      hitChance = Math.max(0.05, Math.min(0.9, hitChance * t.hitMul));
      this.elSpeed.textContent = (t.speed + Math.floor(Math.random() * 5) - 2) + " km/h";

      setTimeout(() => {
        this.resolve(whiff, hitChance);
      }, 420);
    },

    resolve(whiff, hitChance) {
      this.pitchNo++;
      const r = Math.random();
      let result, kind = "";
      let isOut = false, isK = false, isHR = false;
      let pts = 0;

      if (r < whiff) {
        // 헛스윙/루킹 → 삼진성
        result = "삼진 아웃!";
        kind = "big";
        isOut = isK = true;
        pts = 300;
        this.k++; this.outs++;
        this.elK.textContent = this.k;
        this.elOuts.textContent = this.outs;
      } else if (r < whiff + (1 - whiff) * (1 - hitChance)) {
        // 인플레이 아웃 (플라이/땅볼)
        result = Math.random() < 0.5 ? "플라이 아웃" : "땅볼 아웃";
        kind = "big";
        isOut = true;
        pts = 150;
        this.outs++;
        this.elOuts.textContent = this.outs;
      } else {
        // 피안타 — 가운데일수록 장타 위험 큼
        const hitRoll = Math.random() * (0.5 + hitChance);
        if (hitRoll > 0.92) {
          result = "피홈런…"; kind = "out";
          isHR = true; pts = -160;
          this.runs += 1;
        } else if (hitRoll > 0.78) {
          result = "3루타 허용"; kind = "out";
          pts = -100;
          this.runs += 1;
        } else if (hitRoll > 0.6) {
          result = "2루타 허용"; kind = "out";
          pts = -60;
        } else {
          result = "1루타 허용"; kind = "out";
          pts = -30;
        }
        this.hits++;
        this.elHits.textContent = this.hits;
        this.elRuns.textContent = this.runs;
      }

      this.score = Math.max(0, this.score + pts);

      // 콤보(연속 아웃) + 사운드 + 연출
      if (isOut) {
        this.streak++;
        showCombo(this.combo, this.streak);
        if (isK) { SFX.strike(); vibrate(20); }
        else SFX.out();
      } else {
        this.streak = 0;
        this.combo.hidden = true;
        if (isHR) { SFX.whiff(); shake(this.field); flash(this.flash); vibrate([0, 50, 40, 70]); }
        else SFX.whiff();
      }

      popResult(this.pop, result, kind);
      this.syncHud();

      if (this.pitchNo >= TOTAL_PITCHES) {
        this.hint.textContent = "9구 종료! 결과를 확인하세요";
        this.reset.hidden = false;
        this.reset.textContent = "결과 보기";
        this.reset.onclick = finishPitch;
      } else {
        this.elNo.textContent = this.pitchNo + 1;
        this.hint.textContent = "다음 공을 던질 곳을 선택하세요";
        setTimeout(() => {
          this.busy = false;
          this.grid.classList.remove("is-locked");
          this.cells.forEach((c) => c.classList.remove("is-pick"));
        }, 950);
      }
    },
  };

  pitch.cells.forEach((cell) => {
    cell.addEventListener("click", () => pitch.throwTo(Number(cell.dataset.cell)));
  });
  pitch.typeBtn.addEventListener("click", () => pitch.cycleType());

  function startPitch() {
    pitch.init();
    show("pitch");
  }

  function finishPitch() {
    const rec = { score: pitch.score, outs: pitch.outs, runs: pitch.runs, k: pitch.k };
    const prev = BEST.get("pitch");
    const isNew = !prev || (prev.score || 0) < rec.score;
    if (isNew) { BEST.save("pitch", rec); BEST.paint(); }
    showOver("투수 기록", [
      ["점수", pitch.score.toLocaleString() + "점"],
      ["삼진", pitch.k + "개"],
      ["아웃", pitch.outs + "개"],
      ["실점", pitch.runs + "점"],
    ], gradePitcher(pitch), "pitch", isNew);
  }

  function gradePitcher(p) {
    if (p.runs === 0 && p.k >= 3) return { g: "S", t: "무실점 압도!" };
    if (p.runs <= 1 && p.outs >= 5) return { g: "A", t: "에이스" };
    if (p.outs >= 4) return { g: "B", t: "안정적 투구" };
    if (p.outs >= 2) return { g: "C", t: "흔들린 마운드" };
    return { g: "D", t: "난타당했어요" };
  }

  /* =======================================================
     이닝제 모드 — 3회, 3아웃 교대, 주자 진루로 득점
     ======================================================= */
  const TOTAL_INNINGS = 3;
  const inn = {
    field: $("#inn-field"),
    flash: $("#inn-flash"),
    ball: $("#inn-ball"),
    zone: $("#inn-zone"),
    pop: $("#inn-pop"),
    hint: $("#inn-hint"),
    action: $("#inn-action"),
    bases: [$("#inn-b1"), $("#inn-b2"), $("#inn-b3")],
    outsDots: Array.from(document.querySelectorAll("#inn-outs-dots i")),
    elNo: $("#inn-no"),
    elInning: $("#inn-inning"),
    elOuts: $("#inn-outs"),
    elHits: $("#inn-hits"),
    elRuns: $("#inn-runs"),

    T_HIT: 0.82,
    T_HALF: 0.26,

    inning: 1,
    outs: 0,
    hits: 0,
    runs: 0,
    runners: [false, false, false], // 1·2·3루 주자
    done: false,
    running: false,   // 자동 진행 중
    autoTimer: 0,

    live: false,
    swung: false,
    startTime: 0,
    duration: 0,
    raf: 0,

    paintBases() {
      this.bases.forEach((b, i) => b.classList.toggle("is-on", this.runners[i]));
    },
    paintOuts() {
      this.outsDots.forEach((d, i) => d.classList.toggle("is-on", this.outs > i));
    },

    resetBall() {
      this.ball.style.transform = "translate(-50%, -50%) scale(0.4)";
    },

    reset() {
      this.inning = 1;
      this.outs = this.hits = this.runs = 0;
      this.runners = [false, false, false];
      this.done = false;
      this.running = false;
      clearTimeout(this.autoTimer);
      this.live = false;
      this.swung = false;
      this.elNo.textContent = "1";
      this.elInning.textContent = "1";
      this.elOuts.textContent = "0";
      this.elHits.textContent = "0";
      this.elRuns.textContent = "0";
      this.paintBases();
      this.paintOuts();
      this.ball.classList.remove("is-live");
      this.zone.classList.remove("is-on");
      this.resetBall();
      this.hint.textContent = "화면을 탭하면 시작 · 3회 자동 진행";
      this.action.textContent = "▶ 경기 시작";
      this.action.hidden = false;
      this.action.disabled = false;
    },

    stop() {
      this.live = false;
      this.running = false;
      clearTimeout(this.autoTimer);
      cancelAnimationFrame(this.raf);
      this.ball.classList.remove("is-live");
      this.zone.classList.remove("is-on");
    },

    // 화면/버튼 탭(공이 없을 때): 시작 또는 결과
    tapIdle() {
      if (this.running || this.live) return;
      if (this.done) { finishInning(); return; }
      this.begin();
    },
    begin() {
      if (this.running || this.live) return;
      this.running = true;
      this.nextPitch();
    },

    // 주자 진루 (n루타: 모든 주자 + 타자 n칸 전진) → 득점 수 반환
    advanceRunners(n) {
      let scored = 0;
      const next = [false, false, false];
      for (let b = 0; b < 3; b++) {
        if (!this.runners[b]) continue;
        const base = b + 1 + n; // 도달 베이스 번호 (4 이상=홈인)
        if (base >= 4) scored++;
        else next[base - 1] = true;
      }
      if (n >= 4) scored++;           // 타자 홈런
      else next[n - 1] = true;        // 타자 출루
      this.runners = next;
      return scored;
    },

    nextPitch() {
      if (this.done || this.live) return;
      this.swung = false;
      this.live = true;
      this.action.hidden = true;
      this.hint.textContent = "지금! 타이밍 맞춰 화면 탭!";
      this.zone.classList.add("is-on");

      this.duration = (1100 + Math.random() * 700) * DIFF[difficulty].mult;
      this.startTime = performance.now();
      this.ball.classList.add("is-live");

      const H = this.field.clientHeight;
      const travel = H * 0.40; // 릴리스(42%) → 플레이트(82%)
      const animate = (now) => {
        if (!this.live) return;
        const t = (now - this.startTime) / this.duration;
        const y = t * travel;
        const s = 0.4 + t * 1.2;
        this.ball.style.transform =
          `translate(-50%, -50%) translateY(${y}px) scale(${s})`;
        if (t >= 1) {
          this.live = false;
          this.ball.classList.remove("is-live");
          this.zone.classList.remove("is-on");
          this.resetBall();
          if (!this.swung) this.resolve(null);
          return;
        }
        this.raf = requestAnimationFrame(animate);
      };
      this.raf = requestAnimationFrame(animate);
    },

    swing() {
      if (!this.live || this.swung) return;
      this.swung = true;
      const t = (performance.now() - this.startTime) / this.duration;
      const acc = Math.max(0, 1 - Math.abs(t - this.T_HIT) / this.T_HALF);

      this.live = false;
      cancelAnimationFrame(this.raf);
      this.ball.classList.remove("is-live");
      this.zone.classList.remove("is-on");
      this.resetBall();
      this.resolve(acc);
    },

    resolve(acc) {
      const o = rollOutcome(acc);
      let kind = "", label = o.label;

      if (o.kind === "hit") {
        this.hits++;
        this.elHits.textContent = this.hits;
        const scored = this.advanceRunners(o.bases);
        this.runs += scored;
        this.elRuns.textContent = this.runs;
        this.paintBases();
        if (o.bases === 4) {
          kind = "big";
          label = scored > 1 ? `${scored}점 홈런!` : "홈런!";
          SFX.homerun(); flash(this.flash); shake(this.field); vibrate([0, 40, 30, 60]);
        } else {
          if (scored > 0) { kind = "big"; label += ` ${scored}득점`; }
          SFX.hit(); vibrate(20);
        }
      } else {
        // miss / whiff / out → 모두 아웃 처리
        this.outs++;
        this.elOuts.textContent = this.outs;
        this.paintOuts();
        kind = "out";
        if (o.kind === "miss") label = "놓침 — 아웃";
        SFX.whiff();
      }
      popResult(this.pop, label, kind);

      const inningOver = this.outs >= 3;
      this.done = inningOver && this.inning >= TOTAL_INNINGS;

      if (this.done) {
        // 경기 종료 → 결과 버튼
        this.running = false;
        this.hint.textContent = "경기 종료!";
        this.action.textContent = "결과 보기";
        setTimeout(() => {
          this.action.hidden = false;
          this.action.disabled = false;
          this.hint.textContent = "결과 보기 버튼을 누르세요";
        }, 900);
      } else {
        // 자동으로 다음 타석 (이닝 교대 시 텀을 더 둔다)
        this.hint.textContent = inningOver ? "체인지! 다음 회 준비…" : "다음 공 준비…";
        clearTimeout(this.autoTimer);
        this.autoTimer = setTimeout(() => {
          if (inningOver) {
            this.inning++;
            this.outs = 0;
            this.runners = [false, false, false];
            this.elInning.textContent = this.inning;
            this.elNo.textContent = this.inning;
            this.elOuts.textContent = "0";
            this.paintBases();
            this.paintOuts();
            popResult(this.pop, `${this.inning}회 시작 ⚾`, "");
          }
          if (this.running) this.nextPitch();
        }, inningOver ? 1900 : 1600);
      }
    },
  };

  // 화면 탭 = 스윙 / 대기 중이면 시작·결과
  inn.field.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (inn.live) inn.swing();
    else inn.tapIdle();
  });
  // 중앙 시작/결과 버튼 (pointerdown 전파 차단, click으로만)
  inn.action.addEventListener("pointerdown", (e) => e.stopPropagation());
  inn.action.addEventListener("click", (e) => {
    e.stopPropagation();
    inn.tapIdle();
  });

  function startInning() {
    inn.reset();
    show("inning");
  }

  function finishInning() {
    inn.stop();
    const rec = { runs: inn.runs, hits: inn.hits };
    const prev = BEST.get("inning");
    const isNew = !prev || rec.runs > prev.runs ||
      (rec.runs === prev.runs && rec.hits > prev.hits);
    if (isNew) { BEST.save("inning", rec); BEST.paint(); }
    showOver("이닝 경기 기록", [
      ["득점", inn.runs + "점"],
      ["안타", inn.hits + "개"],
      ["이닝", TOTAL_INNINGS + "회"],
    ], gradeInning(inn), "inning", isNew);
  }

  function gradeInning(g) {
    if (g.runs >= 10) return { g: "S", t: "홈런 군단!" };
    if (g.runs >= 6) return { g: "A", t: "막강 타선" };
    if (g.runs >= 3) return { g: "B", t: "쏠쏠한 공격" };
    if (g.runs >= 1) return { g: "C", t: "한 점이라도" };
    return { g: "D", t: "무득점…" };
  }

  /* =======================================================
     결과 화면
     ======================================================= */
  const overTitle = $("#over-title");
  const overSummary = $("#over-summary");
  const overReplay = $("#over-replay");
  let lastMode = "bat";

  function showOver(title, rows, grade, mode, isNew) {
    lastMode = mode;
    overTitle.textContent = title;
    let html = `<div class="over-grade">${grade.g}<small>${grade.t}</small></div>`;
    if (isNew) html += `<div class="over-new-best">🏆 신기록 달성!</div>`;
    rows.forEach(([k, v]) => {
      html += `<div class="over-row"><span>${k}</span><b>${v}</b></div>`;
    });
    overSummary.innerHTML = html;
    if (isNew) { SFX.homerun(); vibrate([0, 60, 40, 60, 40, 80]); }
    show("over");
  }

  overReplay.addEventListener("click", () => {
    if (lastMode === "bat") startBat();
    else if (lastMode === "pitch") startPitch();
    else startInning();
  });

  /* =======================================================
     외부(제스처) 제어용 공개 API
     ======================================================= */
  window.Game = {
    // 현재 활성 화면 이름: "home" | "bat" | "pitch" | "over"
    screen() {
      for (const k in screens) {
        if (screens[k].classList.contains("is-active")) return k;
      }
      return null;
    },
    bat: {
      isLive: () => bat.live,
      canAct: () => !bat.live && !bat.action.disabled,
      swing: () => bat.swing(),
      advance: () => { if (!bat.action.disabled) bat.action.click(); },
    },
    inning: {
      isLive: () => inn.live,
      canAct: () => !inn.live && !inn.action.disabled,
      swing: () => inn.swing(),
      advance: () => { if (!inn.action.disabled) inn.action.click(); },
    },
    pitch: {
      isBusy: () => pitch.busy,
      hover: (i) => pitch.setHover(i),
      clearHover: () => pitch.clearHover(),
      throwTo: (i) => pitch.throwTo(i),
    },
  };
})();
