/* ═══════════════════════════════════════════════════════════
   Firebase 설정 — 실시간 공유(마우스/이미지/화면)를 켜려면 채워주세요.

   1) https://console.firebase.google.com 에서 프로젝트 생성 (무료)
   2) 좌측 [빌드] → [Realtime Database] → "데이터베이스 만들기"
        - 위치: 아무거나 (예: asia-southeast1)
        - 보안 규칙: 처음엔 "테스트 모드로 시작" 선택
   3) 프로젝트 설정(⚙️) → "내 앱" → 웹 앱(</>) 추가 → 아래 값 복사
   4) 아래 YOUR_... 부분을 본인 값으로 교체

   ※ 비워두면(또는 YOUR_ 그대로면) 사이트는 "오프라인 단독 모드"로 동작합니다.
      (혼자 쓰기 / 이미지 표시는 정상 작동, 실시간 공유만 비활성)
   ═══════════════════════════════════════════════════════════ */

window.FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
