export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    wait: number,
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | undefined

    return (...args: Parameters<T>) => {
        if (timeout !== undefined) {
            clearTimeout(timeout)
        }

        timeout = setTimeout(() => {
            fn(...args)
        }, wait)
    }
}

export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    limit: number,
): (...args: Parameters<T>) => void {
    let inThrottle: boolean
    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            fn(...args)
            inThrottle = true
            setTimeout(() => (inThrottle = false), limit)
        }
    }
}

