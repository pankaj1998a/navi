import { queryUser } from "./db"

export class AuthManager {
  validate() {}
}

export function checkAuth() {
  queryUser()
}
