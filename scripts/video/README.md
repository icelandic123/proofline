# Demo video

The video is generated, not screen-captured by hand, so it can be re-made after any UI change.

1. `storyboard.mjs` lists the scenes: the narration line and the on-screen actions.
2. `tts.py` speaks each line with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) through `kokoro-onnx`, writing one WAV per scene.
3. `record.mjs` runs the storyboard in Playwright against a running Proofline, records the screen, and uses ffmpeg to lay each line at the moment its scene starts.

```sh
pip install kokoro-onnx soundfile
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
node -e "import('./scripts/video/storyboard.mjs').then(m=>require('fs').writeFileSync('scenes.json',JSON.stringify(m.scenes.map(s=>({id:s.id,say:s.say})))))"
python scripts/video/tts.py scenes.json audio kokoro-v1.0.int8.onnx voices-v1.0.bin
node scripts/video/record.mjs https://<your-deployment> audio proofline.mp4
```

No music is used, and the voice and recording are generated, so the video carries no third-party audio.
