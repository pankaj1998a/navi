import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import { Config } from "../config/config"
import { generateText } from "ai"
import { GlobalBus } from "@/bus/global"

const log = Log.create({ service: "voice.service" })

export namespace VoiceService {
    let recordingBuffer: Buffer[] = []
    let isRecording = false
    let autoStopTimer: any = null

    // Lazy load the native module like Claude does
    let audioNapi: any = null

    async function loadNativeModule() {
        if (audioNapi) return audioNapi
        try {
            // @ts-ignore
            audioNapi = await import("audio-capture-napi")
            return audioNapi
        } catch (e) {
            log.error("failed to load native audio module", { error: e })
            throw new Error("Native audio capture module (audio-capture-napi) failed to load. Ensure system dependencies are installed.")
        }
    }

    export async function start() {
        if (isRecording) return
        const napi = await loadNativeModule()
        
        recordingBuffer = []
        isRecording = true
        
        log.info("starting native recording")
        napi.startNativeRecording((data: Buffer) => {
            recordingBuffer.push(Buffer.from(data))
        }, () => {
            log.info("recording ended by native signal")
            isRecording = false
            if (autoStopTimer) clearTimeout(autoStopTimer)
        })

        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: "voice.recording.started",
            properties: {}
          } as any
        })

        // Safety timeout (60 seconds)
        autoStopTimer = setTimeout(() => {
          if (isRecording) {
            log.info("auto-stopping recording after timeout")
            stop()
          }
        }, 60000)
    }

    export async function stop(): Promise<string> {
        if (!isRecording) return ""
        const napi = await loadNativeModule()
        
        log.info("stopping native recording")
        napi.stopNativeRecording()
        isRecording = false
        if (autoStopTimer) clearTimeout(autoStopTimer)

        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: "voice.recording.stopped",
            properties: {}
          } as any
        })

        if (recordingBuffer.length === 0) {
            log.warn("no audio data captured")
            return ""
        }

        const fullAudio = Buffer.concat(recordingBuffer)
        return await transcribe(fullAudio)
    }

    async function transcribe(audioBuffer: Buffer): Promise<string> {
        log.info("transcribing captured audio", { bytes: audioBuffer.length })
        const config = await Config.get()
        if (!config.model) throw new Error("No model configured.")

        const { providerID, modelID } = Provider.parseModel(config.model)
        
        try {
            const modelInfo = await Provider.getModel(providerID, modelID)
            const language = await Provider.getLanguage(modelInfo)
            
            const { text } = await generateText({
                model: language,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Transcribe the following audio precisely. Respond ONLY with the transcription text." },
                            // @ts-ignore - The SDK content union is complex, but 'file' parts with 'data' and 'mimeType' are supported in multimodal models
                            { type: "file", data: audioBuffer, mimeType: "audio/wav" }
                        ]
                    }
                ]
            })
            return text.trim()
        } catch (error) {
            log.error("transcription failed", { error })
            return `[Transcription failed: ${(error as Error).message}]`
        }
    }
}

