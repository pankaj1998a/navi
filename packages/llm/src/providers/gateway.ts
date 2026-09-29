import type { RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"

export const id = ProviderID.make("gateway")

export const routes = [OpenAICompatibleChat.route]

export const model = (
  modelId: string | ModelID,
  options: Omit<RouteModelInput, "id" | "provider" | "baseURL"> & { readonly baseURL?: string } = {},
) => OpenAICompatibleChat.model({ ...options, id: modelId, provider: id, baseURL: options.baseURL ?? "https://gateway.ai.cloudflare.com/v1" })

export const provider = Provider.make({
  id,
  model,
})
