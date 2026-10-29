export async function loadSDKFactory(packageName: string) {
    const mod = (await import(packageName)) as Record<string, unknown>
    const match = Object.keys(mod).find((name) => name.startsWith("create"))
    if (!match) throw new Error(`Package ${packageName} has no provider factory export`)
    return mod[match]
}
