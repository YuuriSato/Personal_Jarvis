"""Record resolved dependencies without copying unrelated packages into each lock."""
from importlib import metadata
from pathlib import Path
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

root = Path(__file__).resolve().parents[1] / 'services/core'
groups = {
    'core': ['fastapi', 'uvicorn', 'wsproto', 'httpx', 'psutil', 'pydantic', 'nvidia-ml-py', 'pytest', 'pytest-asyncio', 'pyinstaller'],
    'voice': ['faster-whisper', 'pyttsx3', 'openwakeword'],
}
for group, names in groups.items():
    found = {}
    pending = list(names)
    while pending:
        name = canonicalize_name(pending.pop())
        if name in found:
            continue
        distribution = metadata.distribution(name)
        found[name] = distribution.version
        for value in distribution.requires or []:
            requirement = Requirement(value)
            if requirement.marker is None or requirement.marker.evaluate({'extra': ''}):
                pending.append(requirement.name)
    (root / f'requirements-{group}.lock.txt').write_text('# Resolved on Windows / Python 3.13\n' + '\n'.join(f'{name}=={version}' for name, version in sorted(found.items())) + '\n', encoding='utf-8')
