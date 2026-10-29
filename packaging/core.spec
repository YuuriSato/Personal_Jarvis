# Build a self-contained Windows service, including optional voice when installed.
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules, copy_metadata

root = Path(SPECPATH).parent
hidden = ['uvicorn.logging', 'uvicorn.loops.asyncio', 'uvicorn.protocols.http.h11_impl',
          'uvicorn.protocols.websockets.wsproto_impl', 'uvicorn.lifespan.on', 'pynvml',
          'pyttsx3.drivers.sapi5', 'comtypes.client', 'faster_whisper', 'openwakeword',
          'piper', 'piper.espeakbridge', 'sounddevice', '_sounddevice_data', 'sklearn.utils._cython_blas']
datas = []
binaries = []
datas += copy_metadata('piper-tts')
for package in ['faster_whisper', 'openwakeword', 'pyttsx3', 'piper', '_sounddevice_data', 'ctranslate2', 'onnxruntime', 'certifi']:
    datas += collect_data_files(package)
    binaries += collect_dynamic_libs(package)
a = Analysis([str(root / 'services/core/launcher.py')], pathex=[str(root)],
    binaries=binaries, datas=datas, hiddenimports=hidden,
    excludes=['pytest', 'tkinter', 'matplotlib', 'torch', 'tensorflow', 'IPython'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='jarvis-core', debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='jarvis-core')
