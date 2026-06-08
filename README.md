# LIMBUS TRPG · 실시간 공유 판정 시스템

캐릭터 생성 · 멀티 판정에 더해 **접속한 사람들끼리 화면을 실시간으로 공유**하는 기능이 들어갔습니다.

- 🖱 **마우스 커서 공유** — 접속자들의 커서가 실시간으로 보입니다.
- 🖼 **이미지 실시간 공유** — 마스터가 띄운 장면 이미지가 모두에게 즉시 보입니다. (드래그&드롭 지원)
- 🪞 **화면 미러링** — 마스터의 캐릭터·판정 결과·로그를 플레이어가 읽기 전용으로 같이 봅니다.

> Firebase 설정을 하지 않아도 사이트는 **오프라인 단독 모드**로 정상 작동합니다(혼자 사용·이미지 표시 OK, 실시간 공유만 비활성).

---

## 파일 구성

| 파일 | 역할 |
|------|------|
| `index.html` | 페이지 구조 |
| `style.css` | 스타일 |
| `app.js` | 캐릭터·판정·이미지 표시 로직 |
| `realtime.js` | 실시간 공유 (Firebase 연동) |
| `firebase-config.js` | **여기에 본인 Firebase 설정값을 넣습니다** |

---

## 1. 실시간 공유 켜기 — Firebase 설정 (무료, 약 5분)

GitHub Pages는 서버가 없는 정적 호스팅이라, 실시간 동기화에는 외부 실시간 DB가 필요합니다. 가장 간단한 무료 옵션이 **Firebase Realtime Database**입니다.

1. <https://console.firebase.google.com> 접속 → **프로젝트 추가** (구글 계정 필요).
2. 좌측 메뉴 **빌드 → Realtime Database → 데이터베이스 만들기**
   - 위치는 아무거나 (예: `asia-southeast1`)
   - 보안 규칙은 우선 **"테스트 모드로 시작"** 선택
3. 프로젝트 설정(⚙️) → **내 앱**에서 웹 앱(`</>`) 추가 → 표시되는 `firebaseConfig` 값 복사.
4. `firebase-config.js`를 열어 `YOUR_...` 부분을 본인 값으로 교체:

```js
window.FIREBASE_CONFIG = {
  apiKey:      "AIza...",
  authDomain:  "내프로젝트.firebaseapp.com",
  databaseURL: "https://내프로젝트-default-rtdb.firebaseio.com",
  projectId:   "내프로젝트",
  storageBucket:"내프로젝트.appspot.com",
  messagingSenderId:"...",
  appId:       "1:...:web:..."
};
```

`databaseURL`이 꼭 있어야 실시간 공유가 켜집니다.

### 보안 규칙 (선택, 권장)

테스트 모드는 일정 기간 후 잠깁니다. Realtime Database → **규칙** 탭에 아래를 넣으면 `rooms` 경로만 열어둘 수 있습니다(친구끼리 쓰는 캐주얼 용도 기준):

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

> 이 규칙은 방 코드를 아는 사람이면 읽고 쓸 수 있는 수준입니다. 더 엄격하게 하려면 Firebase 인증을 붙이세요.

---

## 2. GitHub Pages로 배포하기

1. GitHub에 새 저장소(repository)를 만들고 위 파일들을 모두 올립니다.
   ```bash
   git init
   git add .
   git commit -m "limbus trpg"
   git branch -M main
   git remote add origin https://github.com/<아이디>/<저장소>.git
   git push -u origin main
   ```
2. 저장소 **Settings → Pages** → Source를 `main` 브랜치 `/ (root)`로 설정 → 저장.
3. 잠시 후 `https://<아이디>.github.io/<저장소>/` 주소로 접속됩니다.

> `firebase-config.js`는 어차피 브라우저에 노출되는 공개 키라 GitHub에 올라가도 괜찮습니다(웹 API 키 특성). 다만 위 보안 규칙은 꼭 설정하세요.

---

## 3. 사용법

- **마스터**: 닉네임 입력 → **⬟ 마스터로 방 만들기**. 생성된 방 코드/초대 링크를 플레이어에게 공유합니다.
- **플레이어**: 받은 **초대 링크**를 열면 자동 참가됩니다. (또는 방 코드를 입력하고 "플레이어로 참가")
- **이미지 공유**: 공유 화면 패널에서 *이미지 띄우기* 버튼 또는 드래그&드롭. 마스터가 올린 이미지가 모두에게 보입니다.
- 플레이어는 마스터 화면을 **읽기 전용**으로 함께 봅니다(조작 불가, 관전 모드).

---

## 알려진 한계 / 메모

- 커서 위치는 **각자 화면 비율 기준**으로 표시됩니다(창 크기가 달라도 대략 같은 위치). 픽셀 단위 정밀 포인팅은 아닙니다.
- 공유 이미지는 전송 부담을 줄이려 자동으로 압축됩니다(긴 변 1400px, JPEG). 아주 큰 원본 화질이 필요하면 **Firebase Storage**에 올린 뒤 URL만 공유하도록 바꾸면 됩니다.
- 게임 상태의 "원본"은 **마스터**가 가집니다. 마스터가 나가면 진행 상태 동기화가 멈춥니다.
