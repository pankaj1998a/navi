import type { RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as Gemini from "../protocols/gemini"

export const id = ProviderID.make("google-vertex")

export const routes = [Gemini.route]

export const model = (
  modelId: string | ModelID,
  options: Omit<RouteModelInput, "id" | "baseURL"> & { readonly baseURL?: string } = {},
) => Gemini.model({ ...options, id: modelId })

export const provider = Provider.make({
  id,
  model,
})
