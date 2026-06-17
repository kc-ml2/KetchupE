# KetchupE

[MARU-Lang](https://github.com/kc-ml2/marU-Lang/)을 활용한 KC 사내 서비스용 클라이언트입니다.

## 폴더 설명

프로젝트는 `Page–Feature–Component` 구조를 따르며, 웹(`src/`)과 Electron(`electron/`) 코드를 분리합니다.

- **src/app-types/**: 타입 정의 파일(TypeScript types)
- **src/config/**: 환경설정 및 상수
- **src/Contexts/**: 전역 상태를 위한 React Context
- **src/Features/**: 도메인(기능)별 로직과 UI (Page별 폴더)
  - **Chatbot/**: 챗봇 관련 feature (components, hooks)
  - **Sidebar/**: 사이드바 기능 선택 feature
  - **TeamDetail/**: 그룹/멤버/폴더 관리 feature
  - **Shared/**: 여러 feature에서 공통으로 사용하는 컴포넌트/훅
- **src/Pages/**: 라우팅되는 최상위 페이지 컴포넌트
- **src/lib/**: 공통 유틸리티 라이브러리
- **src/images/**: 이미지 에셋
- **src/App.tsx**: 앱 엔트리 포인트
- **electron/**: Electron 메인 프로세스 코드 (IPC, WebSocket, LanceDB 등)

```
.
├── src/
│   ├── app-types/            # TypeScript 타입 정의
│   ├── config/               # 환경설정 및 상수
│   ├── Contexts/             # 전역 상태(React Context)
│   ├── Features/
│   │   ├── Chatbot/
│   │   │   ├── components/    # Messages 등 UI
│   │   │   └── hooks/         # 상태/로직
│   │   ├── Sidebar/
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   ├── TeamDetail/
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   └── Shared/           # 공통 컴포넌트/훅
│   │       ├── components/
│   │       └── hooks/
│   ├── Pages/
│   │   ├── LoginPage.tsx
│   │   ├── ChatbotPage.tsx
│   │   └── TeamDetailPage.tsx
│   ├── images/
│   ├── lib/
│   ├── test/                 # 테스트 환경 설정
│   └── App.tsx
│
└── electron/                 # Electron 메인 프로세스
    ├── ipc/                  # IPC 핸들러
    ├── websocket/            # WebSocket 통신
    ├── lancedb/              # 로컬 벡터 DB
    ├── assets/
    └── build/
```

## vite

vite의 경우 build시 output directory는 `dist/`에 저장되어서 vite.config.ts에서 설정 변경함.

```
  build: {
    outDir: "build",
  },
```

## Testing

프로젝트는 Vitest와 React Testing Library를 사용하여 테스트를 작성합니다.

### 테스트 실행

```bash
# 테스트 실행 (watch mode)
npm test

# UI 인터페이스로 테스트 실행
npm run test:ui

# 커버리지 리포트와 함께 테스트 실행
npm run test:coverage
```

### 테스트 구조

```
src/
├── test/
│   └── setup.ts          # 테스트 환경 설정
├── Pages/
│   ├── LoginPage.tsx
│   └── LoginPage.test.tsx # LoginPage 컴포넌트 테스트
```

### 테스트 작성 예시

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MyComponent from './MyComponent'

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(
      <MemoryRouter>
        <MyComponent />
      </MemoryRouter>
    )

    expect(screen.getByText('Expected Text')).toBeInTheDocument()
  })
})
```

### 테스트 설정

- **vitest.config.ts**: Vitest 설정 파일로 jsdom 환경과 경로 alias 설정
- **src/test/setup.ts**: 테스트 환경 설정 및 @testing-library/jest-dom 매처 추가

### Notion - Github Action

- notion에서 DB 생성
- notion integration 생성
- Actions secrets and variables에 Repository secrets 추가
- .github 폴더의 내용대로 workflows 설정 , script 실행하도록
