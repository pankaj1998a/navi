declare module "audio-capture-napi" {
    export function startNativeRecording(onData: (data: Buffer) => void, onEnd: () => void): void;
    export function stopNativeRecording(): void;
}

