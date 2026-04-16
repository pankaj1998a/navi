import { encodingForModel, getEncoding } from 'js-tiktoken'

export class Tokens {
    private encoder = getEncoding('cl100k_base') // Default for GPT-4/Claude-3 approx

    count(text: string): number {
        return this.encoder.encode(text).length
    }

    encode(text: string): Uint32Array {
        return new Uint32Array(this.encoder.encode(text))
    }

    decode(tokens: Uint32Array | number[]): string {
        return this.encoder.decode(tokens as any)
    }

    truncate(text: string, maxTokens: number): string {
        const tokens = this.encoder.encode(text)
        if (tokens.length <= maxTokens) return text
        return this.encoder.decode(tokens.slice(0, maxTokens))
    }
}

export const tokens = new Tokens()
