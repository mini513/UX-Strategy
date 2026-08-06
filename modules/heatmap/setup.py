"""
UX Heatmap — 오프라인 설치 스크립트
원본 저장소가 사라져도 이 스크립트로 모든 의존성과 모델을 설치할 수 있습니다.
"""

import subprocess
import sys
import os
import urllib.request
import hashlib

CHECKPOINTS_DIR = os.path.join(os.path.expanduser("~"), ".cache", "torch", "hub", "checkpoints")

MODEL_WEIGHTS = [
    {
        "name": "DeepGaze IIE 본체",
        "filename": "deepgaze2e.pth",
        "url": "https://github.com/matthias-k/DeepGaze/releases/download/v1.0.0/deepgaze2e.pth",
        "size_mb": 400,
    },
    {
        "name": "ResNet50 (Texture-vs-Shape)",
        "filename": "resnet50_finetune_60_epochs_lr_decay_after_30_start_resnet50_train_45_epochs_combined_IN_SF-ca06340c.pth.tar",
        "url": "https://bitbucket.org/robert_geirhos/texture-vs-shape-pretrained-models/raw/60b770e128fffcbd8562a3ab3546c1a735432d03/resnet50_finetune_60_epochs_lr_decay_after_30_start_resnet50_train_45_epochs_combined_IN_SF-ca06340c.pth.tar",
        "size_mb": 195,
    },
    {
        "name": "EfficientNet-B5",
        "filename": "efficientnet-b5-b6417697.pth",
        "url": "https://github.com/lukemelas/EfficientNet-PyTorch/releases/download/1.0/efficientnet-b5-b6417697.pth",
        "size_mb": 117,
    },
    {
        "name": "DenseNet201",
        "filename": "densenet201-c1103571.pth",
        "url": "https://download.pytorch.org/models/densenet201-c1103571.pth",
        "size_mb": 77,
    },
    {
        "name": "ResNeXt50",
        "filename": "resnext50_32x4d-7cdf4587.pth",
        "url": "https://download.pytorch.org/models/resnext50_32x4d-7cdf4587.pth",
        "size_mb": 96,
    },
]

PIP_PACKAGES = [
    "flask>=3.0",
    "flask-cors>=4.0",
    "torch>=2.0",
    "torchvision>=0.15",
    "scipy>=1.10",
    "numpy>=1.24",
    "Pillow>=10.0",
    "boltons",
    "einops",
]

CLIP_URL = "git+https://github.com/openai/CLIP.git"


def install_pip_packages():
    print("\n[1/3] Python 패키지 설치 중...")
    for pkg in PIP_PACKAGES:
        print(f"  설치: {pkg}")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", pkg, "-q"],
            stdout=subprocess.DEVNULL,
        )
    print(f"  설치: CLIP (OpenAI)")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", CLIP_URL, "-q"],
        stdout=subprocess.DEVNULL,
    )
    print("  완료!")


def install_vendor_package():
    print("\n[2/3] vendor/deepgaze_pytorch 로컬 패키지 설치 중...")
    vendor_dir = os.path.join(os.path.dirname(__file__), "vendor")
    site_packages = os.path.join(
        os.path.dirname(os.path.dirname(sys.executable)),
        "Lib", "site-packages", "deepgaze_pytorch"
    )
    if not os.path.exists(site_packages):
        import shutil
        src = os.path.join(vendor_dir, "deepgaze_pytorch")
        shutil.copytree(src, site_packages)
        print(f"  복사: {src} → {site_packages}")
    else:
        print("  이미 설치됨, 건너뜀")
    print("  완료!")


def download_model_weights():
    print("\n[3/3] 모델 가중치 다운로드 중...")
    os.makedirs(CHECKPOINTS_DIR, exist_ok=True)

    total_mb = sum(w["size_mb"] for w in MODEL_WEIGHTS)
    downloaded = 0

    for w in MODEL_WEIGHTS:
        filepath = os.path.join(CHECKPOINTS_DIR, w["filename"])
        if os.path.exists(filepath):
            size = os.path.getsize(filepath) / (1024 * 1024)
            if size > w["size_mb"] * 0.9:
                downloaded += w["size_mb"]
                print(f"  [건너뜀] {w['name']} ({w['size_mb']}MB) — 이미 존재")
                continue

        print(f"  [다운로드] {w['name']} ({w['size_mb']}MB)...")
        try:
            _download_with_progress(w["url"], filepath, w["size_mb"])
            downloaded += w["size_mb"]
        except Exception as e:
            print(f"  [실패] {w['name']}: {e}")
            print(f"         수동 다운로드: {w['url']}")
            print(f"         저장 위치: {filepath}")

    print(f"\n  전체: {downloaded}/{total_mb} MB 완료")


def _download_with_progress(url, filepath, expected_mb):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    response = urllib.request.urlopen(req)
    total = int(response.headers.get("Content-Length", 0))

    with open(filepath, "wb") as f:
        downloaded = 0
        block_size = 1024 * 256
        while True:
            data = response.read(block_size)
            if not data:
                break
            f.write(data)
            downloaded += len(data)
            if total:
                pct = downloaded / total * 100
                mb = downloaded / (1024 * 1024)
                print(f"\r    {mb:.0f}/{expected_mb}MB ({pct:.0f}%)", end="", flush=True)
    print()


def verify():
    print("\n검증 중...")
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "vendor"))
        import deepgaze_pytorch
        model = deepgaze_pytorch.DeepGazeIIE(pretrained=True)
        print("DeepGaze IIE 모델 로드 성공!")
        return True
    except Exception as e:
        print(f"검증 실패: {e}")
        return False


if __name__ == "__main__":
    print("=" * 50)
    print("UX Heatmap — 오프라인 설치")
    print("=" * 50)

    install_pip_packages()
    install_vendor_package()
    download_model_weights()

    print("\n" + "=" * 50)
    if verify():
        print("\n설치 완료! 서버를 시작하려면:")
        print("  python server.py")
        print("  브라우저에서 index.html 열기")
    else:
        print("\n설치에 문제가 있습니다. 위 에러를 확인하세요.")
    print("=" * 50)
