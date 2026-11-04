# 프롬프트 보관함 (Prompt Vault)

변수(`{{이름}}`)가 있는 AI 프롬프트를 보관하고, 값을 채워 바로 복사하는 정적 웹 앱. 빌드 단계 없음, 외부 스크립트 없음.

- 실행: `python3 -m http.server 8013` 후 http://localhost:8013 접속
- 테스트: `node --test` (Node 22 기준, `tests/` 아래 `*.test.js` 자동 탐색)
- 구조: `logic.js` = 순수 함수(검증, 변수 추출, 검색/정렬, 가져오기 병합), `app.js` = DOM만 담당
- 데이터는 브라우저 localStorage에만 저장됩니다. JSON 내보내기/가져오기로 백업하세요.
