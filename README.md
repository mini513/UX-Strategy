# UX Strategy Toolkit

> 측정 → 분석 → 비교 → 보고를 한 곳에서

UX 전략 수립과 성과 측정을 위한 웹 기반 툴킷입니다.  
순수 HTML + JavaScript + Chart.js로 구현되어 **설치 없이 브라우저에서 바로 사용**할 수 있습니다.

## 모듈

### 📊 정량 평가
| 모듈 | 설명 |
|------|------|
| **SUS 분석기** | System Usability Scale 10문항 → 점수 · 등급 · 차트 |
| **휴리스틱 평가** | 닐슨 10원칙 체크리스트 → 심각도 매트릭스 · 레이더 차트 |
| **카노 모델 분석기** | 기능/역기능 설문 → 매력적 · 당연 · 일원적 · 무관심 분류 |

### 🧪 사용자 테스트
| 모듈 | 설명 |
|------|------|
| **퍼스트 클릭 테스트** | 화면 + 과제 → 첫 클릭 위치 수집 → 히트맵 시각화 |
| **5초 테스트** | 화면 5초 노출 → 인지 요소 수집 → 키워드 빈도 분석 |

### 🎯 의사결정 · 성과
| 모듈 | 설명 |
|------|------|
| **우선순위 매트릭스** | Impact × Effort → 4사분면 자동 배치 |
| **Before/After 비교기** | AS-IS · TO-BE 수치 → 개선율 차트 |
| **성과 대시보드** | 전체 측정 이력 → 지표 추이 · 보고서 |

## 시작하기

```bash
# 클론
git clone https://github.com/mini513/UX-Strategy.git

# 브라우저에서 열기 (서버 불필요)
open index.html
```

또는 VS Code의 Live Server 확장으로 실행하면 됩니다.

## 기술 스택

- **프론트엔드**: 순수 HTML + CSS + JavaScript (프레임워크 없음)
- **차트**: [Chart.js 4](https://www.chartjs.org/)
- **데이터 저장**: LocalStorage (브라우저 내 저장, 서버 불필요)
- **외부 의존성**: CDN을 통한 Chart.js만 사용

## 프로젝트 구조

```
UX-Strategy/
├── index.html              # 메인 허브
├── shared/
│   ├── style.css           # 공통 디자인 시스템
│   └── storage.js          # LocalStorage · 차트 · 내보내기 유틸
├── modules/
│   ├── sus/                # SUS 분석기
│   ├── heuristic/          # 휴리스틱 평가
│   ├── kano/               # 카노 모델 분석기
│   ├── first-click/        # 퍼스트 클릭 테스트
│   ├── five-second/        # 5초 테스트
│   ├── priority-matrix/    # 우선순위 매트릭스
│   ├── before-after/       # Before/After 비교기
│   └── dashboard/          # 성과 대시보드
└── README.md
```

## 핵심 흐름

```
AS-IS 측정 → 개선 활동 → TO-BE 재측정 → 성과 보고
     ↑                                      │
     └──────────── 같은 도구로 반복 ──────────┘
```

## 연관 프로젝트

- [UX-Heatmap](https://github.com/mini513/UX-Heatmap) — DeepGaze IIE 기반 AI 시선 예측 히트맵

## 라이선스

MIT License
