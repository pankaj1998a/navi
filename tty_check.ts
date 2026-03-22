console.log({
    stdout: process.stdout.isTTY,
    stdin: process.stdin.isTTY,
    env: process.env.TERM
})
