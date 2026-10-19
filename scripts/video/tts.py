"""Narration for the demo video with Kokoro (Apache-2.0 voices) via kokoro-onnx.

usage: python tts.py scenes.json out_dir model.onnx voices.bin
Writes one WAV per scene and durations.json.
"""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

scenes_path, out_dir, model, voices = sys.argv[1:5]
voice = os.environ.get('VOICE', 'af_heart')
k = Kokoro(model, voices)
os.makedirs(out_dir, exist_ok=True)
durations = {}
for scene in json.load(open(scenes_path)):
    samples, sr = k.create(scene['say'], voice=voice, speed=float(os.environ.get('SPEED', '1.05')), lang='en-us')
    sf.write(os.path.join(out_dir, scene['id'] + '.wav'), samples, sr)
    durations[scene['id']] = round(len(samples) / sr, 2)
    print(scene['id'], durations[scene['id']])
json.dump(durations, open(os.path.join(out_dir, 'durations.json'), 'w'), indent=1)
print('total', round(sum(durations.values()), 1))
