import { z } from "zod"

export const Oauth = z
    .object({
        type: z.literal("oauth"),
        refresh: z.string(),
        access: z.string(),
        expires: z.number(),
        accountId: z.string().optional(),
        resourceUrl: z.string().optional(),
        enterpriseUrl: z.string().optional(),
    })

export const Api = z
    .object({
        type: z.literal("api"),
        key: z.string(),
    })

export const WellKnown = z
    .object({
        type: z.literal("wellknown"),
        key: z.string(),
        token: z.string(),
    })

export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown])

const testObj = {
    "type": "oauth",
    "access": "eyJhbGciOiJFU...",
    "refresh": "eyJhb...",
    "expires": 1775445652348,
    "accountId": "roocode-user"
}

console.log("Safe Parse:", Info.safeParse(testObj))
