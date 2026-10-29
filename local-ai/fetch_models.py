"""Explicit one-time model download; never imported by the application server."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

MANIFEST = {
    'Qwen3-4B-Q4_K_M.gguf': {
        'url': 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf',
        'sha256': '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
        'license': 'Apache-2.0',
    },
    'faster-whisper-base/model.bin': {
        'url': 'https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/model.bin',
        'sha256': 'd01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9',
        'license': 'MIT',
    },
}
for name, digest in {
    'config.json': '56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a',
    'tokenizer.json': 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
    'vocabulary.txt': '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
    'README.md': 'b922acef3616e27b1d416260b63ba7114c732f0315012006781af2da69cd1ebf',
}.items():
    MANIFEST[f'faster-whisper-base/{name}'] = {
        'url': f'https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/{name}',
        'sha256': digest, 'license': 'MIT',
    }

def main():
    parser = argparse.ArgumentParser(description='Download pinned models (~2.65 GB) and verify SHA-256. Not run automatically.')
    parser.add_argument('--dir', type=Path, required=True)
    args = parser.parse_args()
    target = args.dir.resolve(); target.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(target).free < 3 * 1024**3 and not all((target / name).exists() for name in MANIFEST):
        raise SystemExit('At least 3 GiB free space is required for these downloads.')
    for name, info in MANIFEST.items():
        file = target / name; file.parent.mkdir(parents=True, exist_ok=True)
        if not file.exists():
            print(f'Downloading {name}', flush=True)
            partial = file.with_suffix(file.suffix + '.part')
            urllib.request.urlretrieve(info['url'], partial)
            partial.replace(file)
        with file.open('rb') as source:
            digest = hashlib.file_digest(source, 'sha256').hexdigest()
        if digest != info['sha256']:
            raise SystemExit(f'Checksum mismatch: {name}. Do not load this file.')
        print(f'Verified {name}', flush=True)
    (target / 'speech-coach-model-manifest.json').write_text(json.dumps(MANIFEST, indent=2), encoding='utf8')

if __name__ == '__main__':
    main()
