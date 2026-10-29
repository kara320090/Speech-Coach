"""Loopback-only, offline faster-whisper worker. Model files must already exist."""
import io
import json
import os
from pathlib import Path
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'

def main():
    from faster_whisper import WhisperModel
    import numpy as np
    model_dir = Path(os.environ.get('LOCAL_STT_MODEL_DIR', '')).resolve()
    if not (model_dir / 'model.bin').is_file():
        raise SystemExit('Set LOCAL_STT_MODEL_DIR to a prepared local CTranslate2 model directory.')
    model = WhisperModel(str(model_dir), device='cpu', compute_type='int8', cpu_threads=4, num_workers=1, local_files_only=True)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # No request bodies, transcripts, or access metadata in logs.

        def send_json(self, code, body):
            data = json.dumps(body, ensure_ascii=False).encode('utf8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            self.send_json(200 if self.path == '/health' else 404, {'ready': self.path == '/health'})

        def do_POST(self):
            if self.path != '/transcribe':
                return self.send_json(404, {'error': 'not-found'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 44 < size <= 4 * 1024 * 1024:
                    self.close_connection = True
                    return self.send_json(413, {'error': 'too-large'})
                self.connection.settimeout(15)
                body = self.rfile.read(size)
                if len(body) != size:
                    return self.send_json(400, {'error': 'incomplete'})
                with wave.open(io.BytesIO(body), 'rb') as wav:
                    if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
                        return self.send_json(415, {'error': 'not-wav'})
                    samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768
                segments, info = model.transcribe(samples, language='ko', beam_size=3, vad_filter=True, condition_on_previous_text=False)
                values = [{'text': s.text.strip(), 'startSecond': s.start, 'endSecond': s.end} for s in segments]
                self.send_json(200, {'text': ' '.join(s['text'] for s in values), 'segments': values, 'language': info.language})
            except (wave.Error, ValueError):
                self.send_json(400, {'error': 'invalid-audio'})
            except Exception:
                self.send_json(500, {'error': 'transcription-failed'})

    port = int(os.environ.get('LOCAL_STT_PORT', '8081'))
    server = HTTPServer(('127.0.0.1', port), Handler)
    server.timeout = 30
    print(f'Local transcription ready on 127.0.0.1:{port}', flush=True)
    server.serve_forever()

if __name__ == '__main__':
    main()
