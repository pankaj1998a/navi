import { Effect, Layer, Option, Schema, ServiceMap } from "effect"
import { AccessToken, AccountID, AccountRepoError, Info, OrgID, RefreshToken } from "./schema"
import { JsonlStorage } from "@/storage/jsonl"

const ACCOUNT_STATE_ID = "global"

export interface AccountRow {
  id: AccountID
  email: string
  url: string
  access_token: AccessToken
  refresh_token: RefreshToken
  token_expiry: number | null
}

export namespace AccountRepo {
  export interface Service {
    readonly active: () => Effect.Effect<Option.Option<Info>, AccountRepoError>
    readonly list: () => Effect.Effect<Info[], AccountRepoError>
    readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
    readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountRepoError>
    readonly getRow: (accountID: AccountID) => Effect.Effect<Option.Option<any>, AccountRepoError>
    readonly persistToken: (input: {
      accountID: AccountID
      accessToken: AccessToken
      refreshToken: RefreshToken
      expiry: Option.Option<number>
    }) => Effect.Effect<void, AccountRepoError>
    readonly persistAccount: (input: {
      id: AccountID
      email: string
      url: string
      accessToken: AccessToken
      refreshToken: RefreshToken
      expiry: number
      orgID: Option.Option<OrgID>
    }) => Effect.Effect<void, AccountRepoError>
  }
}

export class AccountRepo extends ServiceMap.Service<AccountRepo, AccountRepo.Service>()("@navi/AccountRepo") {
  static readonly layer: Layer.Layer<AccountRepo> = Layer.effect(
    AccountRepo,
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownSync(Info)

      const active = Effect.fn("AccountRepo.active")(() =>
        Effect.tryPromise({
          try: async () => {
            const state = await JsonlStorage.readItem<any>("account_state", ACCOUNT_STATE_ID)
            if (!state?.active_account_id) return Option.none()
            const account = await JsonlStorage.readItem<any>("accounts", state.active_account_id)
            if (!account) return Option.none()
            return Option.some(decode({ ...account, active_org_id: state.active_org_id ?? null }))
          },
          catch: (cause) => new AccountRepoError({ message: "Failed to get active account", cause }),
        }),
      )

      const list = Effect.fn("AccountRepo.list")(() =>
        Effect.tryPromise({
          try: async () => {
            const rows = await JsonlStorage.listItems<any>("accounts")
            return rows.map((row) => decode({ ...row, active_org_id: null }))
          },
          catch: (cause) => new AccountRepoError({ message: "Failed to list accounts", cause }),
        }),
      )

      const remove = Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
        Effect.tryPromise({
          try: async () => {
            const state = await JsonlStorage.readItem<any>("account_state", ACCOUNT_STATE_ID)
            if (state?.active_account_id === accountID) {
              await JsonlStorage.writeItem("account_state", ACCOUNT_STATE_ID, {
                ...state,
                active_account_id: null,
                active_org_id: null,
              })
            }
            await JsonlStorage.deleteItem("accounts", accountID)
          },
          catch: (cause) => new AccountRepoError({ message: "Failed to remove account", cause }),
        }),
      )

      const use = Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
        Effect.tryPromise({
          try: async () => {
            const id = Option.getOrNull(orgID)
            await JsonlStorage.writeItem("account_state", ACCOUNT_STATE_ID, {
              active_account_id: accountID,
              active_org_id: id,
            })
          },
          catch: (cause) => new AccountRepoError({ message: "Failed to use account", cause }),
        }),
      )

      const getRow = Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
        Effect.tryPromise({
          try: async () => {
            const item = await JsonlStorage.readItem<any>("accounts", accountID)
            return item ? Option.some(item) : Option.none()
          },
          catch: (cause) => new AccountRepoError({ message: "Failed to get account row", cause }),
        }),
      )

      const persistToken = Effect.fn("AccountRepo.persistToken")((input) =>
        Effect.tryPromise({
          try: async () => {
            const account = await JsonlStorage.readItem<any>("accounts", input.accountID)
            if (!account) throw new Error("Account not found")
            account.access_token = input.accessToken
            account.refresh_token = input.refreshToken
            account.token_expiry = Option.getOrNull(input.expiry)
            await JsonlStorage.writeItem("accounts", input.accountID, account)
          },
          catch: (cause) => new AccountRepoError({ message: "Failed to persist token", cause }),
        }),
      )

      const persistAccount = Effect.fn("AccountRepo.persistAccount")((input) =>
        Effect.tryPromise({
          try: async () => {
            const account = {
              id: input.id,
              email: input.email,
              url: input.url,
              access_token: input.accessToken,
              refresh_token: input.refreshToken,
              token_expiry: input.expiry,
            }
            await JsonlStorage.writeItem("accounts", input.id, account)
            const id = Option.getOrNull(input.orgID)
            await JsonlStorage.writeItem("account_state", ACCOUNT_STATE_ID, {
              active_account_id: input.id,
              active_org_id: id,
            })
          },
          catch: (cause) => new AccountRepoError({ message: "Failed to persist account", cause }),
        }),
      )

      return AccountRepo.of({
        active,
        list,
        remove,
        use,
        getRow,
        persistToken,
        persistAccount,
      })
    }),
  )
}
