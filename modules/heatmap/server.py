import io
import os
import sys
import base64
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from flask import Flask, request, jsonify
from flask_cors import CORS
from scipy.ndimage import gaussian_filter, label
from torchvision import transforms

VENDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor')
TRANSALNET_DIR = os.path.join(VENDOR_DIR, 'TranSalNet')
if os.path.isdir(TRANSALNET_DIR):
    sys.path.insert(0, TRANSALNET_DIR)

app = Flask(__name__)
CORS(app)

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = None

INPUT_W, INPUT_H = 384, 288

img_transform = transforms.Compose([
    transforms.Resize((INPUT_H, INPUT_W)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


def load_model():
    global model
    if model is not None:
        return model
    from TranSalNet_Dense import TranSalNet
    model = TranSalNet()
    weights_path = os.path.join(TRANSALNET_DIR, 'pretrained_models', 'TranSalNet_Dense.pth')
    state_dict = torch.load(weights_path, map_location=DEVICE, weights_only=True)
    model.load_state_dict(state_dict)
    model.to(DEVICE)
    model.eval()
    return model


COLORMAPS = {
    'jet': [
        (0.0, (0, 0, 128)), (0.1, (0, 0, 255)), (0.25, (0, 128, 255)),
        (0.4, (0, 255, 255)), (0.5, (128, 255, 128)), (0.6, (255, 255, 0)),
        (0.75, (255, 128, 0)), (0.9, (255, 0, 0)), (1.0, (128, 0, 0)),
    ],
    'hot': [
        (0.0, (0, 0, 0)), (0.33, (200, 0, 0)), (0.66, (255, 180, 0)),
        (1.0, (255, 255, 255)),
    ],
    'inferno': [
        (0.0, (0, 0, 4)), (0.25, (87, 16, 110)), (0.5, (188, 55, 84)),
        (0.75, (249, 142, 9)), (1.0, (252, 255, 164)),
    ],
    'viridis': [
        (0.0, (68, 1, 84)), (0.25, (59, 82, 139)), (0.5, (33, 145, 140)),
        (0.75, (94, 201, 98)), (1.0, (253, 231, 37)),
    ],
    'turbo': [
        (0.0, (48, 18, 59)), (0.15, (67, 95, 229)), (0.3, (29, 185, 199)),
        (0.45, (77, 233, 89)), (0.6, (208, 231, 28)), (0.75, (255, 162, 14)),
        (0.9, (222, 60, 10)), (1.0, (122, 4, 3)),
    ],
}


def apply_colormap_vectorized(data, colormap_name='jet'):
    stops = COLORMAPS.get(colormap_name, COLORMAPS['jet'])
    positions = np.array([s[0] for s in stops])
    colors = np.array([s[1] for s in stops], dtype=np.float32)

    h, w = data.shape
    flat = data.flatten()

    indices = np.searchsorted(positions, flat, side='right') - 1
    indices = np.clip(indices, 0, len(positions) - 2)

    t = (flat - positions[indices]) / (positions[indices + 1] - positions[indices] + 1e-8)
    t = np.clip(t, 0, 1)

    c0 = colors[indices]
    c1 = colors[indices + 1]
    rgb = (c0 * (1 - t[:, None]) + c1 * t[:, None]).astype(np.uint8)

    alpha = (flat * 255).astype(np.uint8)

    result = np.zeros((h * w, 4), dtype=np.uint8)
    result[:, :3] = rgb
    result[:, 3] = alpha

    return result.reshape(h, w, 4)


UX_PRINCIPLES = {
    'center_bias': {
        'name': 'Center Bias (중심 편향)',
        'ref': 'Tatler, B.W. (2007). The central fixation bias in scene viewing. Journal of Vision, 7(14):4',
        'url': 'https://doi.org/10.1167/7.14.4',
    },
    'f_pattern': {
        'name': 'F-Pattern Reading',
        'ref': 'Nielsen, J. (2006). F-Shaped Pattern For Reading Web Content. Nielsen Norman Group',
        'url': 'https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/',
    },
    'z_pattern': {
        'name': 'Z-Pattern Layout',
        'ref': 'Lidwell, W., Holden, K. & Butler, J. (2010). Universal Principles of Design. Rockport Publishers',
        'url': '',
    },
    'gutenberg': {
        'name': 'Gutenberg Diagram',
        'ref': 'Lidwell et al. (2010). 시선이 좌상→우상→좌하→우하 순서로 이동하는 레이아웃 모델',
        'url': '',
    },
    'von_restorff': {
        'name': 'Von Restorff Effect (고립 효과)',
        'ref': 'Von Restorff, H. (1933). Laws of UX — Jon Yablonski (lawsofux.com)',
        'url': 'https://lawsofux.com/von-restorff-effect/',
        'desc': '시각적으로 눈에 띄는 요소는 기억에 더 잘 남는다',
    },
    'hicks_law': {
        'name': "Hick's Law (힉의 법칙)",
        'ref': "Hick, W.E. (1952). Laws of UX — Jon Yablonski",
        'url': 'https://lawsofux.com/hicks-law/',
        'desc': '선택지가 많을수록 의사결정 시간이 증가한다',
    },
    'millers_law': {
        'name': "Miller's Law (밀러의 법칙)",
        'ref': 'Miller, G.A. (1956). The Magical Number Seven, Plus or Minus Two. Psychological Review',
        'url': 'https://lawsofux.com/millers-law/',
        'desc': '작업 기억에 담을 수 있는 항목은 7±2개',
    },
    'fitts_law': {
        'name': "Fitts's Law (피츠의 법칙)",
        'ref': 'Fitts, P.M. (1954). Laws of UX — Jon Yablonski',
        'url': 'https://lawsofux.com/fittss-law/',
        'desc': '타겟까지 도달 시간은 크기에 반비례, 거리에 비례',
    },
    'serial_position': {
        'name': 'Serial Position Effect (순서 위치 효과)',
        'ref': 'Ebbinghaus, H. (1885). Laws of UX — Jon Yablonski',
        'url': 'https://lawsofux.com/serial-position-effect/',
        'desc': '리스트의 처음과 마지막 항목이 가장 잘 기억된다',
    },
    'gestalt_proximity': {
        'name': 'Gestalt Law of Proximity (근접성의 법칙)',
        'ref': 'Wertheimer, M. (1923). Gestalt Psychology. Laws of UX — Jon Yablonski',
        'url': 'https://lawsofux.com/law-of-proximity/',
        'desc': '가까이 있는 요소는 하나의 그룹으로 인식된다',
    },
    'gestalt_similarity': {
        'name': 'Gestalt Law of Similarity (유사성의 법칙)',
        'ref': 'Wertheimer, M. (1923). Gestalt Psychology',
        'url': 'https://lawsofux.com/law-of-similarity/',
        'desc': '비슷하게 생긴 요소는 같은 그룹으로 인식된다',
    },
    'aesthetic_usability': {
        'name': 'Aesthetic-Usability Effect',
        'ref': 'Kurosu, M. & Kashimura, K. (1995). Laws of UX — Jon Yablonski',
        'url': 'https://lawsofux.com/aesthetic-usability-effect/',
        'desc': '미적으로 아름다운 디자인은 더 사용하기 쉽다고 인식된다',
    },
    'banner_blindness': {
        'name': 'Banner Blindness (배너 맹시)',
        'ref': 'Benway, J.P. (1998). Banner Blindness: Web Searchers Often Miss Obvious Links. Nielsen Norman Group',
        'url': 'https://www.nngroup.com/articles/banner-blindness-original-eyetracking/',
    },
    'visual_hierarchy': {
        'name': 'Visual Hierarchy (시각적 위계)',
        'ref': 'Lidwell et al. (2010). 크기·색상·대비·위치로 정보의 중요도를 시각적으로 전달',
        'url': '',
    },
    'peak_end_rule': {
        'name': 'Peak-End Rule',
        'ref': 'Kahneman, D. (1993). Laws of UX — Jon Yablonski',
        'url': 'https://lawsofux.com/peak-end-rule/',
        'desc': '경험의 평가는 가장 강렬한 순간과 마지막 순간으로 결정된다',
    },
    'cognitive_load': {
        'name': 'Cognitive Load Theory (인지 부하 이론)',
        'ref': 'Sweller, J. (1988). Cognitive Load During Problem Solving. Cognitive Science, 12(2)',
        'url': '',
        'desc': '인지 부하가 높으면 정보 처리와 의사결정이 어려워진다',
    },
    'transalnet': {
        'name': 'TranSalNet',
        'ref': 'Lou, J. et al. (2022). TranSalNet: Towards Perceptually Relevant Visual Saliency Prediction. Neurocomputing.',
        'url': 'https://github.com/LJOVO/TranSalNet',
    },
}


def generate_insights(heatmap, orig_h, orig_w):
    h, w = heatmap.shape
    insights = []

    peak_y, peak_x = np.unravel_index(np.argmax(heatmap), heatmap.shape)
    peak_rel_x = peak_x / w
    peak_rel_y = peak_y / h

    if peak_rel_y < 0.33:
        vpos = '상단'
    elif peak_rel_y < 0.66:
        vpos = '중앙'
    else:
        vpos = '하단'
    if peak_rel_x < 0.33:
        hpos = '좌측'
    elif peak_rel_x < 0.66:
        hpos = '중앙'
    else:
        hpos = '우측'

    if hpos == '중앙' and vpos == '중앙':
        pos_desc = '화면 중앙'
    elif hpos == '중앙':
        pos_desc = f'화면 {vpos}'
    elif vpos == '중앙':
        pos_desc = f'화면 {hpos}'
    else:
        pos_desc = f'화면 {vpos} {hpos}'

    p = UX_PRINCIPLES['visual_hierarchy']
    insights.append({
        'type': 'peak',
        'title': '최대 주목 지점',
        'desc': f'{pos_desc}에 시선이 가장 집중됩니다.',
        'detail': '높은 시각적 가중치(색상 대비, 크기, 위치)를 가진 요소가 이 영역에 위치합니다.',
        'principle': p['name'],
        'ref': p['ref'],
    })

    top_half = heatmap[:h // 2, :].mean()
    bottom_half = heatmap[h // 2:, :].mean()
    left_half = heatmap[:, :w // 2].mean()
    right_half = heatmap[:, w // 2:].mean()

    tl = heatmap[:h // 2, :w // 2].mean()
    tr = heatmap[:h // 2, w // 2:].mean()
    bl = heatmap[h // 2:, :w // 2].mean()
    br = heatmap[h // 2:, w // 2:].mean()

    if top_half > bottom_half * 1.5:
        p = UX_PRINCIPLES['gutenberg']
        insights.append({
            'type': 'pattern',
            'title': '상단 집중 — Gutenberg Diagram',
            'desc': '시선이 화면 상단에 강하게 집중됩니다.',
            'detail': 'Gutenberg Diagram에 따르면 사용자는 좌상단(Primary Optical Area)에서 시작해 우하단으로 이동합니다. 상단의 시각적 가중치가 높아 이 패턴이 강화되고 있습니다.',
            'principle': p['name'],
            'ref': p['ref'],
        })
    elif bottom_half > top_half * 1.3:
        p = UX_PRINCIPLES['von_restorff']
        insights.append({
            'type': 'pattern',
            'title': '하단 주목 — Von Restorff Effect',
            'desc': '하단 영역이 예상보다 높은 주목도를 보입니다.',
            'detail': '일반적으로 시선은 상단에 집중되지만, 하단에 시각적으로 독특한 요소(색상, 크기, 고립된 배치)가 있어 Von Restorff Effect(고립 효과)로 시선을 끌어내리고 있습니다.',
            'principle': p['name'],
            'ref': p['ref'],
        })

    if left_half > right_half * 1.3 and top_half > bottom_half * 1.2:
        p = UX_PRINCIPLES['f_pattern']
        insights.append({
            'type': 'pattern',
            'title': 'F-패턴 시선 흐름',
            'desc': '좌상단에서 시작하는 F-패턴 읽기 흐름이 감지됩니다.',
            'detail': f'Nielsen Norman Group(2006)의 아이트래킹 연구에서 발견된 F-패턴: 상단 가로 스캔 → 좌측 세로 스캔. 텍스트 중심 UI에서 일반적이며, 중요 정보는 좌측 상단에 배치해야 합니다.',
            'principle': p['name'],
            'ref': p['ref'],
        })
    elif left_half > right_half * 1.3:
        insights.append({
            'type': 'pattern',
            'title': '좌측 편향',
            'desc': '시선이 화면 좌측에 치우쳐 있습니다.',
            'detail': '좌→우 읽기 문화권에서 시선은 자연스럽게 좌측에서 시작합니다. 우측 영역의 중요 요소가 간과될 수 있습니다.',
            'principle': 'Reading Gravity (읽기 중력)',
            'ref': 'Nielsen, J. (2006). Nielsen Norman Group',
        })

    if tl > tr * 1.2 and tl > bl * 1.2 and br > bl * 0.8:
        p = UX_PRINCIPLES['gutenberg']
        insights.append({
            'type': 'pattern',
            'title': 'Z-패턴 레이아웃 적합',
            'desc': '좌상→우상→좌하→우하 순서의 Z-패턴 시선 흐름과 부합합니다.',
            'detail': 'Gutenberg Diagram의 4분면 모델과 일치하는 시선 분포입니다. CTA(Call-to-Action)를 우하단 Terminal Area에 배치하면 전환율 향상에 효과적입니다.',
            'principle': 'Z-Pattern / Gutenberg Diagram',
            'ref': 'Lidwell, W. et al. (2010). Universal Principles of Design',
        })

    high_attention = (heatmap > 0.5).astype(int)
    labeled, num_clusters = label(high_attention)

    if num_clusters == 1:
        insights.append({
            'type': 'distribution',
            'title': '단일 집중점 — 시각적 위계 명확',
            'desc': '주목도가 한 곳에 강하게 집중되어 있습니다.',
            'detail': '시각적 위계(Visual Hierarchy)가 명확하게 작동하여 사용자의 시선을 하나의 핵심 요소로 유도하고 있습니다. 단, 다른 중요 영역이 무시될 수 있으므로 보조 CTA의 가시성을 확인하세요.',
            'principle': UX_PRINCIPLES['visual_hierarchy']['name'],
            'ref': UX_PRINCIPLES['visual_hierarchy']['ref'],
        })
    elif 2 <= num_clusters <= 4:
        p = UX_PRINCIPLES['millers_law']
        insights.append({
            'type': 'distribution',
            'title': f'{num_clusters}개 주목 영역 — 적정 범위',
            'desc': f'{num_clusters}개의 주요 주목 영역이 감지되었습니다.',
            'detail': f"Miller's Law(7±2)에 비추어 {num_clusters}개의 주목점은 사용자의 작업 기억 용량 내에 있습니다. 정보 전달과 시선 분산 사이의 균형이 양호합니다.",
            'principle': p['name'],
            'ref': p['ref'],
        })
    elif num_clusters >= 5:
        p = UX_PRINCIPLES['hicks_law']
        insights.append({
            'type': 'distribution',
            'title': f'{num_clusters}개 경쟁 요소 — 인지 과부하 위험',
            'desc': f'{num_clusters}개의 주목 영역이 사용자의 시선을 분산시킵니다.',
            'detail': f"Hick's Law에 따르면 선택지가 많을수록 의사결정 시간이 로그적으로 증가합니다. {num_clusters}개의 경쟁 요소는 인지 부하를 높여 사용자 이탈을 유발할 수 있습니다.",
            'principle': p['name'],
            'ref': p['ref'],
        })

    focus_ratio = (heatmap > 0.5).sum() / heatmap.size

    if focus_ratio < 0.05:
        p = UX_PRINCIPLES['cognitive_load']
        insights.append({
            'type': 'coverage',
            'title': '극단적 집중 영역',
            'desc': f'전체 화면의 {focus_ratio:.1%}만 높은 주목도를 보입니다.',
            'detail': '대부분의 UI 요소가 시선을 받지 못하고 있습니다. 중요한 기능이 저주목 영역에 있다면, 시각적 강조(색상 대비, 크기 확대, 여백 활용)로 위계를 조정하세요.',
            'principle': p['name'],
            'ref': p['ref'],
        })
    elif focus_ratio > 0.3:
        insights.append({
            'type': 'coverage',
            'title': '넓은 주목 분포',
            'desc': f'전체 화면의 {focus_ratio:.1%}가 높은 주목도를 보입니다.',
            'detail': '시선이 고르게 분포되어 전반적인 정보 인지에 유리합니다. 다만 명확한 시각적 위계가 약할 수 있으므로 핵심 CTA의 차별화를 확인하세요.',
            'principle': UX_PRINCIPLES['visual_hierarchy']['name'],
            'ref': UX_PRINCIPLES['visual_hierarchy']['ref'],
        })

    edge_attention = np.concatenate([
        heatmap[0, :], heatmap[-1, :],
        heatmap[:, 0], heatmap[:, -1]
    ]).mean()
    center_region = heatmap[h // 4:3 * h // 4, w // 4:3 * w // 4].mean()

    if center_region > edge_attention * 3:
        p = UX_PRINCIPLES['center_bias']
        insights.append({
            'type': 'bias',
            'title': '중심부 편향 — Center Bias',
            'desc': '화면 가장자리 요소의 주목도가 현저히 낮습니다.',
            'detail': f"Tatler(2007)의 연구에 따르면 사람의 시선은 자연적으로 화면 중심을 향하는 경향(Center Bias)이 있습니다. 가장자리의 중요 기능은 시각적 강조(색상, 크기, 애니메이션)가 필요합니다.",
            'principle': p['name'],
            'ref': p['ref'],
        })

    right_edge = heatmap[:, int(w * 0.85):].mean()
    if right_edge < heatmap.mean() * 0.3:
        p = UX_PRINCIPLES['banner_blindness']
        insights.append({
            'type': 'bias',
            'title': '우측 영역 저주목 — Banner Blindness 가능성',
            'desc': '화면 우측 영역의 주목도가 매우 낮습니다.',
            'detail': 'Benway(1998)가 발견한 Banner Blindness 현상: 사용자는 광고가 자주 위치하는 우측 영역을 무의식적으로 회피합니다. 이 영역에 핵심 기능이 있다면 위치 재배치를 고려하세요.',
            'principle': p['name'],
            'ref': p['ref'],
        })

    top_strip = heatmap[:int(h * 0.08), :].mean()
    if top_strip < heatmap.mean() * 0.4 and top_half > bottom_half:
        insights.append({
            'type': 'bias',
            'title': '네비게이션 바 저주목',
            'desc': '최상단 영역(상위 8%)의 주목도가 낮습니다.',
            'detail': '고정된 네비게이션은 사용자가 익숙해지면서 무의식적으로 건너뛰는 경향이 있습니다. Jakob\'s Law: 사용자는 다른 사이트에서의 경험을 바탕으로 동작을 예측합니다.',
            'principle': "Jakob's Law (제이콥의 법칙)",
            'ref': "Nielsen, J. (2000). Laws of UX — Jon Yablonski (lawsofux.com/jakobs-law)",
        })

    insights.append({
        'type': 'model',
        'title': '분석 모델 정보',
        'desc': 'TranSalNet (DenseNet-161 + Transformer) 기반 시선 예측입니다.',
        'detail': 'CNN 특징 추출에 Transformer 인코더를 결합하여 장거리 시각적 관계를 포착합니다. SALICON 아이트래킹 데이터셋으로 학습되었습니다.',
        'principle': 'TranSalNet (Neurocomputing 2022)',
        'ref': 'Lou, J. et al. (2022). TranSalNet: Towards Perceptually Relevant Visual Saliency Prediction. Neurocomputing.',
    })

    return insights


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'model': 'TranSalNet (Dense)', 'device': str(DEVICE)})


@app.route('/analyze', methods=['POST'])
def analyze():
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400

    file = request.files['image']
    colormap = request.form.get('colormap', 'jet')
    blur_sigma = int(request.form.get('blur', 10))

    try:
        img = Image.open(file.stream).convert('RGB')
    except Exception as e:
        return jsonify({'error': f'Invalid image: {str(e)}'}), 400

    mdl = load_model()
    orig_w, orig_h = img.size

    img_tensor = img_transform(img).unsqueeze(0).to(DEVICE)

    with torch.no_grad():
        pred = mdl(img_tensor)

    heatmap = pred.squeeze().cpu().numpy()

    if blur_sigma > 0:
        heatmap = gaussian_filter(heatmap, sigma=blur_sigma)

    hmin, hmax = heatmap.min(), heatmap.max()
    if hmax - hmin > 1e-8:
        heatmap = (heatmap - hmin) / (hmax - hmin)
    else:
        heatmap = np.zeros_like(heatmap)

    insights = generate_insights(heatmap, orig_h, orig_w)

    heatmap_resized = np.array(
        Image.fromarray((heatmap * 255).astype(np.uint8)).resize((orig_w, orig_h), Image.LANCZOS)
    ).astype(np.float32) / 255.0

    colored = apply_colormap_vectorized(heatmap_resized, colormap)
    heatmap_img = Image.fromarray(colored, 'RGBA')

    buf = io.BytesIO()
    heatmap_img.save(buf, format='PNG')
    heatmap_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    peak = float(heatmap_resized.max())
    avg = float(heatmap_resized.mean())
    focus_pixels = (heatmap_resized > 0.5).sum()
    total_pixels = heatmap_resized.size
    focus_ratio = focus_pixels / total_pixels

    metrics = {
        'peak_attention': f'{peak:.1%}',
        'avg_attention': f'{avg:.1%}',
        'focus_ratio': f'{focus_ratio:.1%}',
    }

    return jsonify({
        'heatmap': heatmap_b64,
        'metrics': metrics,
        'insights': insights,
    })


if __name__ == '__main__':
    print('Loading TranSalNet (DenseNet-161 + Transformer) model...')
    load_model()
    print(f'Model loaded on {DEVICE}')
    print('Server running at http://localhost:5000')
    app.run(host='0.0.0.0', port=5000, debug=False)
