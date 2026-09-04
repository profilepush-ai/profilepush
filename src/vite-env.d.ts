/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_ONESIGNAL_APP_ID?: string;
	readonly VITE_PULSE_CACHE_WORKER_URL?: string;
	readonly VITE_PULSE_CACHE_WORKER_TOKEN?: string;
	readonly VITE_SCREENING_WORKER_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
