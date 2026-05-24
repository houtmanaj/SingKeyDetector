import librosa
import numpy as np

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Krumhansl-Schmuckler (1990) — perceptual study profiles
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

# Aarden-Essen (2003) — corpus-derived, generally more accurate for recorded music
AE_MAJOR = np.array([17.7661, 0.145624, 14.9265, 0.160186, 19.8049, 11.3587,
                     0.291248, 22.062, 0.145624, 8.15494, 0.232998, 4.95122])
AE_MINOR = np.array([18.2648, 0.737619, 14.0499, 16.8599, 0.702494, 14.4362,
                     0.702494, 18.6161, 4.56621, 1.93186, 7.37619, 1.75623])

# Tested against all 12 roots; Pearson correlation is scale-invariant so
# results are directly comparable across both profile sets.
PROFILES = [
    (KS_MAJOR, 'major'), (KS_MINOR, 'minor'),
    (AE_MAJOR, 'major'), (AE_MINOR, 'minor'),
]

SCALE_INTERVALS = {
    'major': [0, 2, 4, 5, 7, 9, 11],
    'minor': [0, 2, 3, 5, 7, 8, 10],
}


def detect_key(y: np.ndarray, sr: int) -> tuple[str, str, float]:
    # chroma_cqt gives good pitch resolution without the CPU cost of HPSS + chroma_cens,
    # which is too slow on Render's free-tier shared CPU.
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    mean_chroma = np.mean(chroma, axis=1)

    # Silent or uniform audio produces zero-variance chroma; corrcoef would return NaN
    if mean_chroma.std() < 1e-6:
        return 'C', 'major', 0.0

    best_corr = -np.inf
    best_key, best_mode = 'C', 'major'

    for i in range(12):
        for template, mode in PROFILES:
            corr = float(np.corrcoef(mean_chroma, np.roll(template, i))[0, 1])
            if corr > best_corr:
                best_corr = corr
                best_key = NOTE_NAMES[i]
                best_mode = mode

    return best_key, best_mode, best_corr


def get_scale_notes(key: str, mode: str) -> list[str]:
    root = NOTE_NAMES.index(key)
    return [NOTE_NAMES[(root + i) % 12] for i in SCALE_INTERVALS[mode]]


def detect_key_from_file(file_path: str) -> dict:
    # sr=11025 halves processing time vs the default 22050 Hz;
    # chroma features only need pitch content, not high-frequency detail.
    y, sr = librosa.load(file_path, mono=True, duration=30, sr=11025)
    key, mode, corr = detect_key(y, sr)
    scale = get_scale_notes(key, mode)
    # Clamp to [0, 1] to guard against NaN/inf reaching JSON serialization
    confidence = round(max(0.0, min(1.0, (corr + 1) / 2)), 3)
    return {'key': key, 'mode': mode, 'scale': scale, 'confidence': confidence}
