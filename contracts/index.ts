export type ProviderId = 'openai' | 'gemini' | 'claude' | 'lmstudio' | 'ollama';
export type RunState = 'idle' | 'listening' | 'transcribing' | 'processing' | 'awaiting_approval' | 'executing' | 'speaking' | 'completed' | 'error' | 'disconnected';
export interface Provider {
  id: ProviderId; name: string; local: boolean; enabled: boolean; base_url: string;
  model: string; status: string; models: Model[]; has_key: boolean;
  input_price: number | null; output_price: number | null; price_date: string;
}
export interface Model { id: string; name: string; capabilities: string[]; cloud?: boolean; kind?: string; state?: 'loaded' | 'unloaded' | 'unknown'; instance_ids?: string[]; size_bytes?: number | null; context_length?: number | null; metadata_source?: string; }
export interface JarvisSettings {
  local_only: boolean; mode: 'manual' | 'automatic' | 'collaborative';
  provider: ProviderId; daily_budget: number | null; max_output_tokens: number;
  personality: 'objective' | 'cordial' | 'witty' | 'supportive';
  voice_enabled: boolean; auto_speak: boolean; wake_word: boolean;
  wake_threshold: number;
  semantic_memory_enabled: boolean; embedding_provider: 'lmstudio' | 'ollama'; embedding_model: string;
  quality: 4000 | 8000 | 16000; reduced_motion: boolean;
  weather_enabled: boolean; city: string; latitude: number | null; longitude: number | null;
  allowed_roots: string[]; apps: Record<string, string>;
}
export interface Telemetry {
  timestamp: string; cpu_percent: number | null; cpu_cores: number; cpu_threads: number;
  ram_percent: number; ram_total: number; ram_used: number;
  disk_percent: number; disk_free: number; gpu_percent: number | null;
  gpu_name: string | null; gpu_temperature: number | null; cpu_temperature: number | null;
  source: string;
}
export interface Message { id: string; role: string; content: string; timestamp: string; provider?: string; model?: string; run_id?: string; }
export interface Run { id: string; state: RunState; provider?: string; model?: string; error?: string; }
export interface Approval { id: string; tool: string; args: Record<string, unknown>; summary: string; expires_at: string; status: string; }
export interface Memory { id: string; content: string; source: string; created_at: string; expires_at: string | null; }
export interface JarvisEvent { version: 1; event_id: string; sequence: number; timestamp: string; session_id: string; run_id: string | null; type: string; source: string; payload: Record<string, any>; }
export interface Snapshot {
  session_id: string; settings: JarvisSettings; providers: Provider[]; telemetry: Telemetry | null;
  messages: Message[]; runs: Run[]; approvals: Approval[]; memories: Memory[];
  usage: { input_tokens: number; output_tokens: number; estimated_cost: number; unpriced: number };
  voice: { available: boolean; model_ready: boolean; wake_available: boolean; wake_model_ready: boolean; reason: string; tts_voices: { name: string; portuguese: boolean }[]; tts_portuguese: boolean; piper_ready: boolean; tts_engine: string; tts_name: string };
  weather: { status: string; temperature?: number; description?: string; timestamp?: string; source?: string };
}
export type Action =
  | { type: 'snapshot' }
  | { type: 'message'; text: string }
  | { type: 'cancel' }
  | { type: 'settings'; settings: Partial<JarvisSettings> }
  | { type: 'provider'; provider: ProviderId; config: Partial<Provider> }
  | { type: 'models'; provider: ProviderId }
  | { type: 'lmstudio_load'; text: string }
  | { type: 'approve'; id: string; approved: boolean }
  | { type: 'tool'; tool: string; args: Record<string, unknown> }
  | { type: 'memory'; content: string; id?: string; expires_at?: string | null }
  | { type: 'memory_delete'; id: string }
  | { type: 'memory_index' }
  | { type: 'memory_search'; text: string }
  | { type: 'history_clear' }
  | { type: 'export' }
  | { type: 'voice_prepare' }
  | { type: 'voice_prepare_tts' | 'voice_prepare_wake' }
  | { type: 'weather_search'; text: string }
  | { type: 'weather_refresh' }
  | { type: 'voice_transcribe'; audio: number[]; sample_rate: number }
  | { type: 'voice_speak'; text: string }
  | { type: 'voice_stop' }
  | { type: 'wake_audio'; audio: number[] };
export interface Bridge {
  action: (action: Action) => Promise<any>;
  onEvent: (listener: (event: JarvisEvent) => void) => () => void;
  saveKey: (provider: ProviderId, key: string) => Promise<{ ok: boolean }>;
  removeKey: (provider: ProviderId) => Promise<{ ok: boolean }>;
  chooseFolder: () => Promise<string | null>;
  chooseApp: () => Promise<string | null>;
  exportData: () => Promise<boolean>;
}
declare global { interface Window { jarvis?: Bridge; } }
