# Google Cloud Speech-to-Text API 설정 가이드

## 1. Google Cloud 프로젝트 생성

1. [Google Cloud Console](https://console.cloud.google.com/)에 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. 프로젝트 ID를 기록해 둡니다

## 2. Speech-to-Text API 활성화

1. Google Cloud Console에서 "API 및 서비스" > "라이브러리"로 이동
2. "Cloud Speech-to-Text API" 검색
3. API 활성화 클릭

## 3. 서비스 계정 생성 및 키 다운로드

1. "API 및 서비스" > "사용자 인증 정보"로 이동
2. "사용자 인증 정보 만들기" > "서비스 계정" 선택
3. 서비스 계정 이름 입력 (예: `email-assistant-speech`)
4. 역할에서 "Cloud Speech Client" 또는 "편집자" 선택
5. 서비스 계정 생성 완료
6. 생성된 서비스 계정 클릭
7. "키" 탭에서 "키 추가" > "새 키 만들기"
8. JSON 형식 선택하여 키 파일 다운로드

## 4. 환경 변수 설정

### Windows (PowerShell)
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\your\service-account-key.json"
```

### macOS/Linux
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
```

### 영구 설정 (macOS/Linux)
```bash
echo 'export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"' >> ~/.bashrc
source ~/.bashrc
```

## 5. Python 라이브러리 설치

```bash
cd email-manager/browser_use
pip install -r requirements.txt
```

## 6. 서버 실행

```bash
python server.py
```

## 7. 테스트

서버가 실행되면 다음 URL에서 상태 확인:
- http://localhost:8000/api/health
- http://localhost:8000/api/speech/status

## 주의사항

1. **보안**: 서비스 계정 키 파일을 절대 공개 저장소에 업로드하지 마세요
2. **비용**: Google Cloud Speech-to-Text는 사용량에 따라 요금이 부과됩니다
3. **할당량**: 무료 할당량을 확인하고 사용량을 모니터링하세요

## 문제 해결

### 인증 오류
- `GOOGLE_APPLICATION_CREDENTIALS` 환경 변수가 올바르게 설정되었는지 확인
- 서비스 계정 키 파일 경로가 정확한지 확인
- 서비스 계정에 적절한 권한이 있는지 확인

### API 오류
- Speech-to-Text API가 활성화되었는지 확인
- 프로젝트에 결제 계정이 연결되었는지 확인
- 할당량 한도를 초과하지 않았는지 확인

## 대안 설정 (개발용)

개발 및 테스트 목적으로 API 키를 사용할 수도 있습니다:

1. Google Cloud Console에서 "API 키" 생성
2. 서버 코드에서 API 키 사용하도록 수정

하지만 프로덕션 환경에서는 서비스 계정을 사용하는 것이 권장됩니다. 