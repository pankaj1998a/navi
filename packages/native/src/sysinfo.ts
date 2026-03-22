import os from 'os'

export interface SysInfo {
    cpuUsage: number
    totalMemory: number
    usedMemory: number
    freeMemory: number
    systemName: string
    kernelVersion: string
    osVersion: string
    hostName: string
    cpuModel?: string
    cpuCores?: number
    uptime?: number
}

/**
 * System Information implementation using Node.js os module
 */
export function getSysInfo(): SysInfo {
    const cpus = os.cpus()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()

    return {
        cpuUsage: 0, // Simplified
        totalMemory: totalMem,
        usedMemory: totalMem - freeMem,
        freeMemory: freeMem,
        systemName: os.type(),
        kernelVersion: os.release(),
        osVersion: `${os.type()} ${os.release()}`,
        hostName: os.hostname(),
        cpuModel: cpus[0]?.model,
        cpuCores: cpus.length,
        uptime: os.uptime()
    }
}
