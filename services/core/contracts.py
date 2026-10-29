"""Validated boundary types. No provider-controlled value grants permissions."""
from datetime import datetime
from ipaddress import ip_address
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator

ProviderId = Literal['openai', 'gemini', 'claude', 'lmstudio', 'ollama']


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    local_only: bool = False
    mode: Literal['manual', 'automatic', 'collaborative'] = 'manual'
    provider: ProviderId = 'lmstudio'
    daily_budget: float | None = Field(default=None, gt=0, le=10000)
    max_output_tokens: int = Field(default=2048, ge=128, le=8192)
    personality: Literal['objective', 'cordial', 'witty', 'supportive'] = 'cordial'
    voice_enabled: bool = False
    auto_speak: bool = False
    wake_word: bool = False
    wake_threshold: float = Field(default=.65, ge=.3, le=.95)
    semantic_memory_enabled: bool = False
    embedding_provider: Literal['lmstudio', 'ollama'] = 'lmstudio'
    embedding_model: str = Field(default='', max_length=200, pattern=r'^[a-zA-Z0-9_./:@+\-]*$')
    quality: Literal[4000, 8000, 16000] = 8000
    reduced_motion: bool = False
    weather_enabled: bool = False
    city: str = Field(default='', max_length=120)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    allowed_roots: list[str] = Field(default_factory=list, max_length=20)
    apps: dict[str, str] = Field(default_factory=dict, max_length=30)


DEFAULT_URLS = {
    'openai': 'https://api.openai.com/v1',
    'gemini': 'https://generativelanguage.googleapis.com/v1beta',
    'claude': 'https://api.anthropic.com/v1',
    'lmstudio': 'http://127.0.0.1:1234/v1',
    'ollama': 'http://127.0.0.1:11434/api',
}


def local_url(value: str) -> str:
    url = urlsplit(value)
    host = url.hostname or ''
    try:
        loopback = host == 'localhost' or ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if not loopback or url.scheme not in ('http', 'https') or url.username or url.password or url.query or url.fragment:
        raise ValueError('O servidor local deve usar endereço de loopback, sem credenciais na URL.')
    return value.rstrip('/')


class ProviderConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: ProviderId
    name: str
    local: bool
    enabled: bool = False
    base_url: str
    model: str = Field(default='', max_length=200, pattern=r'^[a-zA-Z0-9_./:@+\-]*$')
    input_price: float | None = Field(default=None, ge=0, le=100000)
    output_price: float | None = Field(default=None, ge=0, le=100000)
    price_date: str = ''

    def checked(self):
        expected_local = self.id in ('lmstudio', 'ollama')
        if self.local != expected_local:
            raise ValueError('Tipo de provedor inválido.')
        if expected_local:
            local_url(self.base_url)
        elif self.base_url != DEFAULT_URLS[self.id]:
            raise ValueError('Endereço remoto não autorizado.')
        if self.price_date:
            datetime.fromisoformat(self.price_date)
        return self


class Action(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: str = Field(max_length=40)
    text: str = Field(default='', max_length=32000)
    settings: dict = Field(default_factory=dict)
    provider: ProviderId | None = None
    config: dict = Field(default_factory=dict)
    id: str = Field(default='', max_length=100)
    approved: bool = False
    tool: str = Field(default='', max_length=100)
    args: dict = Field(default_factory=dict)
    content: str = Field(default='', max_length=10000)
    expires_at: str | None = None
    audio: list[int] = Field(default_factory=list, max_length=960000)
    sample_rate: int = Field(default=16000, ge=8000, le=48000)

    @field_validator('audio')
    @classmethod
    def pcm_range(cls, value):
        if any(v < -32768 or v > 32767 for v in value):
            raise ValueError('Áudio PCM inválido.')
        return value
