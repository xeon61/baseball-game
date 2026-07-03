/* =========================================================
   손동작 조작 — MediaPipe Tasks Vision (GestureRecognizer)
   타자·이닝제: ✊ 스윙 / ✋ 다음 타석
   투수: ☝️ 검지로 조준 / ✊ 투구
   카메라는 사용자가 켤 때만 로드 (개인정보·성능 고려)
   ========================================================= */

import {
  GestureRecognizer,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

const NAMES = {
  Closed_Fist: "✊ 주먹",
  Open_Palm: "✋ 손바닥",
  Pointing_Up: "☝️ 검지",
  Victory: "✌️ 브이",
  Thumb_Up: "👍 따봉",
  Thumb_Down: "👎",
  ILoveYou: "🤟",
};

/* ---------- DOM 헬퍼 ---------- */
function el(tag, opts = {}) {
  const n = document.createElement(tag);
  for (const k in opts) {
    if (k === "text") n.textContent = opts[k];
    else if (k === "hidden") n.hidden = opts[k];
    else n[k] = opts[k];
  }
  return n;
}

/* ---------- 카메라 위젯 만들기 ---------- */
const app = document.getElementById("app");

const dock = el("div", { id: "cam-dock", hidden: true });
const preview = el("div", { id: "cam-preview", hidden: true });
const video = el("video", {
  id: "cam-video",
  autoplay: true,
  playsInline: true,
  muted: true,
});
const label = el("span", { id: "cam-gesture", text: "" });
preview.append(video, label);

const toggle = el("button", {
  id: "cam-toggle",
  text: "✋",
  title: "손동작 켜기",
  type: "button",
});
dock.append(preview, toggle);
app.append(dock);

/* ---------- 상태 ---------- */
let recognizer = null;
let stream = null;
let running = false;
let rafId = 0;
let lastVideoTime = -1;
let prevGesture = "";
let lastFist = 0;
let lastPalm = 0;
let hoverIdx = -1;

/* ---------- 모델/카메라 준비 ---------- */
async function ensureRecognizer() {
  if (recognizer) return recognizer;
  label.textContent = "모델 로딩…";
  const vision = await FilesetResolver.forVisionTasks(WASM);
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1,
  });
  return recognizer;
}

async function startCam() {
  if (!navigator.mediaDevices?.getUserMedia) {
    label.textContent = "카메라 미지원";
    preview.hidden = false;
    return;
  }
  try {
    toggle.disabled = true;
    preview.hidden = false;
    label.textContent = "모델 로딩…";
    await ensureRecognizer();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    lastVideoTime = -1;
    toggle.classList.add("is-on");
    toggle.title = "손동작 끄기";
    label.textContent = "손을 보여주세요";
    loop();
  } catch (e) {
    console.error("[gesture]", e);
    label.textContent = "카메라 사용 불가";
    stopCam();
  } finally {
    toggle.disabled = false;
  }
}

function stopCam() {
  running = false;
  cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  toggle.classList.remove("is-on");
  toggle.title = "손동작 켜기";
  preview.hidden = true;
  window.Game?.pitch?.clearHover();
}

toggle.addEventListener("click", () => (running ? stopCam() : startCam()));

/* ---------- 인식 루프 ---------- */
function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);

  const screen = window.Game?.screen?.();
  if (screen !== "bat" && screen !== "pitch" && screen !== "inning") return; // 게임 화면에서만 처리
  if (video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  let res;
  try {
    res = recognizer.recognizeForVideo(video, performance.now());
  } catch {
    return;
  }

  const g = res.gestures?.[0]?.[0];
  const name = g && g.score > 0.45 ? g.categoryName : "";
  const lm = res.landmarks?.[0];

  label.textContent = name ? NAMES[name] || name : "손 인식 중…";

  if (screen === "bat") handleBat(window.Game?.bat, name);
  else if (screen === "inning") handleBat(window.Game?.inning, name);
  else if (screen === "pitch") handlePitch(name, lm);

  prevGesture = name;
}

/* ---------- 타자 / 이닝제 모드 (✊ 스윙, ✋ 다음 타석) ---------- */
function handleBat(G, name) {
  if (!G) return;
  const now = performance.now();

  // ✊ 주먹(상승 에지) = 스윙
  if (name === "Closed_Fist" && prevGesture !== "Closed_Fist") {
    if (G.isLive() && now - lastFist > 500) {
      G.swing();
      lastFist = now;
      label.textContent = "스윙!";
    }
  }
  // ✋ 손바닥(상승 에지) = 다음 공 / 시작
  if (name === "Open_Palm" && prevGesture !== "Open_Palm") {
    if (G.canAct() && now - lastPalm > 700) {
      G.advance();
      lastPalm = now;
    }
  }
}

/* ---------- 투수 모드 ---------- */
function handlePitch(name, lm) {
  const G = window.Game?.pitch;
  if (!G) return;
  const now = performance.now();

  // 검지 끝(landmark 8)으로 3x3 칸 조준 — 화면은 거울이므로 x 반전
  if (lm && lm[8]) {
    const x = 1 - lm[8].x;
    const y = lm[8].y;
    const col = Math.min(2, Math.max(0, Math.floor(x * 3)));
    const row = Math.min(2, Math.max(0, Math.floor(y * 3)));
    hoverIdx = row * 3 + col;
    if (!G.isBusy()) G.hover(hoverIdx);
  }

  // ✊ 주먹(상승 에지) = 조준한 칸으로 투구
  if (name === "Closed_Fist" && prevGesture !== "Closed_Fist") {
    if (!G.isBusy() && hoverIdx >= 0 && now - lastFist > 600) {
      G.throwTo(hoverIdx);
      lastFist = now;
      label.textContent = "던졌다!";
    }
  }
}

/* ---------- 화면에 따라 위젯 표시 + 게임 밖이면 카메라 정지 ---------- */
function uiTick() {
  const screen = window.Game?.screen?.();
  const inGame = screen === "bat" || screen === "pitch" || screen === "inning";
  dock.hidden = !inGame;
  if (!inGame && running) stopCam(); // 홈/결과 화면으로 나가면 카메라 끔
  requestAnimationFrame(uiTick);
}
uiTick();
