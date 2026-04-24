import z from "zod"
import * as fs from "fs/promises"
import * as path from "path"
import { Tool } from "./tool"
import { Log } from "../util/log"

const log = Log.create({ service: "tool.document-reader" })

export const DocumentReaderTool = Tool.define("read_document", async () => {
    return {
        description: `Reads document files and extracts their content.

Supported formats:
- Excel (.xlsx, .xls) - Returns data as markdown table
- PDF (.pdf) - Extracts text content
- Word (.docx) - Extracts text content
- PowerPoint (.pptx) - Extracts text from slides
- CSV (.csv) - Returns as markdown table
- Text (.txt) - Returns raw content

Use this to analyze spreadsheets, read reports, or process documents.`,
        parameters: z.object({
            filePath: z.string().describe("Absolute path to the document file"),
            format: z.enum(["xlsx", "pdf", "docx", "pptx", "csv", "txt"]).optional().describe("Document format (auto-detected from extension if not provided)"),
            options: z.object({
                sheet: z.union([z.string(), z.number()]).optional().describe("For Excel: sheet name or index (0-based)"),
                pages: z.number().array().optional().describe("For PDF: specific pages to read"),
                maxPages: z.number().optional().describe("For PDF: maximum pages to read"),
            }).optional().describe("Format-specific options"),
        }),
        async execute(args, ctx) {
            const { filePath, format: explicitFormat, options } = args

            try {
                // Verify file exists
                await fs.access(filePath)

                // Detect format from extension if not provided
                const ext = path.extname(filePath).toLowerCase().slice(1)
                const format = (explicitFormat || ext) as any

                log.info("reading document", { format, filePath })

                let content: string
                let metadata: any = { format }

                switch (format) {
                    case "xlsx":
                    case "xls":
                        const xlsxResult = await readExcel(filePath, options?.sheet)
                        content = xlsxResult.content
                        metadata.sheets = xlsxResult.sheets
                        break

                    case "pdf":
                        const pdfResult = await readPDF(filePath, options?.pages, options?.maxPages)
                        content = pdfResult.content
                        metadata.pages = pdfResult.pages
                        break

                    case "docx":
                        content = await readWord(filePath)
                        break

                    case "pptx":
                        content = await readPowerPoint(filePath)
                        break

                    case "csv":
                        content = await readCSV(filePath)
                        break

                    case "txt":
                    default:
                        content = await fs.readFile(filePath, "utf-8")
                        break
                }

                return {
                    title: `Read ${format} document: ${path.basename(filePath)}`,
                    output: `Document content from ${path.basename(filePath)}:\n\n${content}`,
                    metadata,
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                throw new Error(`Error reading document: ${errorMessage}`)
            }

        },
    }
})

async function readExcel(filePath: string, sheet?: string | number): Promise<{ content: string; sheets: string[] }> {
    const XLSX = await import("xlsx")
    const buffer = await fs.readFile(filePath)
    const workbook = XLSX.read(buffer, { type: "buffer" })

    const sheets = workbook.SheetNames
    const targetSheet = typeof sheet === "number" ? sheets[sheet] : sheet || sheets[0]

    if (!workbook.Sheets[targetSheet]) {
        throw new Error(`Sheet "${targetSheet}" not found. Available: ${sheets.join(", ")}`)
    }

    const data = XLSX.utils.sheet_to_json(workbook.Sheets[targetSheet], { header: 1 })
    const content = formatTableData(data as unknown[][])

    return { content, sheets }
}

async function readPDF(filePath: string, pages?: number[], maxPages?: number): Promise<{ content: string; pages: number }> {
    const pdfParse = await import("pdf-parse")
    const buffer = await fs.readFile(filePath)
    const parseFn = (pdfParse as any).default ?? pdfParse
    const data = await parseFn(buffer, {
        max: maxPages || 0,
    })


    return {
        content: data.text,
        pages: data.numpages,
    }
}

async function readWord(filePath: string): Promise<string> {
    const mammoth = await import("mammoth")
    const result = await mammoth.extractRawText({ path: filePath })
    return result.value
}

async function readPowerPoint(filePath: string): Promise<string> {
    const JSZip = await import("jszip")
    const buffer = await fs.readFile(filePath)
    const zip = await JSZip.loadAsync(buffer)

    const slides: string[] = []
    const slideFiles = Object.keys(zip.files)
        .filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/))
        .sort()

    for (const slideFile of slideFiles) {
        const content = await zip.files[slideFile].async("string")
        const text = content
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        if (text) {
            slides.push(`--- Slide ${slides.length + 1} ---\n${text}`)
        }
    }

    return slides.join("\n\n")
}

async function readCSV(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, "utf-8")
    const lines = content.split("\n").map((line) => line.split(","))
    return formatTableData(lines)
}

function formatTableData(data: unknown[][]): string {
    if (data.length === 0) return "Empty document"

    const headers = data[0] as string[]
    const rows = data.slice(1) as string[][]

    let table = "| " + headers.join(" | ") + " |\n"
    table += "| " + headers.map(() => "---").join(" | ") + " |\n"

    for (const row of rows.slice(0, 100)) {
        table += "| " + row.join(" | ") + " |\n"
    }

    if (rows.length > 100) {
        table += `\n... (${rows.length - 100} more rows)`
    }

    return table
}


