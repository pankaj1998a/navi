/**
 * Type declarations for bash-parser
 */

declare module "bash-parser" {
    function bashParser(command: string): unknown
    export default bashParser
}
