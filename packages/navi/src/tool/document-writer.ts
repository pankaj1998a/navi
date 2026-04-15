import z from "zod"
import * as fs from "fs/promises"
import * as path from "path"
import { Tool } from "./tool"
import { Log } from "../util/log"

const log = Log.create({ service: "tool.document-writer" })

export const DocumentWriterTool = Tool.define("write_document", async () => {
    return {
        description: `Creates document files in various formats.

Supported formats:
- Excel (.xlsx) - From JSON arrays or markdown tables
- PDF (.pdf) - From text content
- Word (.docx) - From text content
- PowerPoint (.pptx) - From text or slide objects
- CSV (.csv) - From arrays or tables
- Markdown (.md) - Text or documentation
- JSON (.json) - Structured data
- Text (.txt) - Plain text

Use this to generate reports, spreadsheets, or documents.`,
        parameters: z.object({
            filePath: z.string().describe("Absolute path for the output file"),
            format: z.string().optional().describe("Output format (e.g., xlsx, pdf, docx, csv, txt, pptx, md, json). Auto-detected from extension if not provided."),
            content: z.any().describe("Content to write (string, array, or object)"),
            options: z.object({
                title: z.string().optional().describe("Document title (PDF, Word)"),
                author: z.string().optional().describe("Document author (PDF)"),
                sheetName: z.string().optional().describe("Sheet name (Excel)"),
            }).optional().describe("Format-specific options"),
        }),
        async execute(args, ctx) {
            const { filePath, format: explicitFormat, content, options } = args

            try {
                // Ensure directory exists
                await fs.mkdir(path.dirname(filePath), { recursive: true })

                // Detect format from extension if not provided, and normalize
                const ext = path.extname(filePath).toLowerCase().slice(1)
                let format = (explicitFormat?.toLowerCase().trim().replace(/^\./, "") || ext) as string

                // Map common aliases
                const mapping: Record<string, string> = {
                    "excel": "xlsx",
                    "word": "docx",
                    "powerpoint": "pptx",
                    "markdown": "md",
                    "text": "txt"
                }
                if (mapping[format]) format = mapping[format]

                log.info("writing document", { format, filePath })

                let bytesWritten: number

                switch (format) {
                    case "xlsx":
                        bytesWritten = await writeExcel(filePath, content, options?.sheetName)
                        break

                    case "pdf":
                        bytesWritten = await writePDF(filePath, content, options)
                        break

                    case "docx":
                        bytesWritten = await writeWord(filePath, content, options)
                        break

                    case "csv":
                        bytesWritten = await writeCSV(filePath, content)
                        break

                    case "pptx":
                        bytesWritten = await writePPTX(filePath, content, options)
                        break

                    case "txt":
                    default:
                        const textContent = typeof content === "string" ? content : JSON.stringify(content, null, 2)
                        await fs.writeFile(filePath, textContent, "utf-8")
                        bytesWritten = Buffer.byteLength(textContent, "utf-8")
                        break
                }

                return {
                    title: `Created ${format}: ${path.basename(filePath)}`,
                    output: `Successfully created ${format} document: ${path.basename(filePath)} (${bytesWritten} bytes)`,
                    metadata: { bytesWritten },
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                throw new Error(`Error writing document: ${errorMessage}`)
            }

        },
    }
})

async function writeExcel(filePath: string, content: any, sheetName?: string): Promise<number> {
    const XLSX = await import("xlsx")

    let data: unknown[][]
    if (typeof content === "string") {
        data = parseTableString(content)
    } else if (Array.isArray(content)) {
        data = content
    } else {
        data = objectToTable(content)
    }

    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1")

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
    await fs.writeFile(filePath, buffer)

    return buffer.length
}

async function writePDF(filePath: string, content: any, options?: { title?: string; author?: string }): Promise<number> {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")

    const pdfDoc = await PDFDocument.create()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    if (options?.title) pdfDoc.setTitle(options.title)
    if (options?.author) pdfDoc.setAuthor(options.author)

    const textContent = typeof content === "string" ? content : JSON.stringify(content, null, 2)
    const lines = textContent.split("\n")

    const fontSize = 12
    const lineHeight = fontSize * 1.5
    const margin = 50
    const pageWidth = 612
    const pageHeight = 792
    const linesPerPage = Math.floor((pageHeight - 2 * margin) / lineHeight)

    for (let i = 0; i < lines.length; i += linesPerPage) {
        const page = pdfDoc.addPage([pageWidth, pageHeight])
        const pageLines = lines.slice(i, i + linesPerPage)

        pageLines.forEach((line, index) => {
            page.drawText(line.substring(0, 80), {
                x: margin,
                y: pageHeight - margin - index * lineHeight,
                size: fontSize,
                font,
                color: rgb(0, 0, 0),
            })
        })
    }

    const pdfBytes = await pdfDoc.save()
    await fs.writeFile(filePath, pdfBytes)

    return pdfBytes.length
}

async function writeWord(filePath: string, content: any, options?: { title?: string }): Promise<number> {
    const docx = await import("docx")

    const textContent = typeof content === "string" ? content : JSON.stringify(content, null, 2)
    const paragraphs = textContent.split("\n").map(
        (line) =>
            new docx.Paragraph({
                children: [new docx.TextRun(line)],
            }),
    )

    const doc = new docx.Document({
        sections: [
            {
                properties: {},
                children: paragraphs,
            },
        ],
    })

    const buffer = await docx.Packer.toBuffer(doc)
    await fs.writeFile(filePath, buffer)

    return buffer.length
}

async function writePPTX(filePath: string, content: any, options?: { title?: string }): Promise<number> {
    const pptxgen = (await import("pptxgenjs")).default
    const pres = new pptxgen()

    if (options?.title) {
        pres.title = options.title
    }

    // If content is an array, treat each item as a slide
    const slides = Array.isArray(content) ? content : [content]

    for (const item of slides) {
        const slide = pres.addSlide()

        let text = ""
        if (typeof item === "string") {
            text = item
        } else if (typeof item === "object") {
            // If it's an object with title/body, use that
            if (item.title) {
                slide.addText(item.title, { x: 0.5, y: 0.5, w: "90%", fontSize: 24, bold: true, color: "363636" })
            }
            if (item.body) {
                text = item.body
            } else {
                text = JSON.stringify(item, null, 2)
            }
        } else {
            text = String(item)
        }

        if (text) {
            // Add text body
            // If title was added, push body down
            const yPos = (typeof item === "object" && item.title) ? 1.5 : 0.5
            slide.addText(text, { x: 0.5, y: yPos, w: "90%", fontSize: 14, color: "363636" })
        }
    }

    const buffer = await pres.write({ outputType: "nodebuffer" }) as Buffer
    await fs.writeFile(filePath, buffer)

    return buffer.length
}

async function writeCSV(filePath: string, content: any): Promise<number> {
    let csvContent: string

    if (typeof content === "string") {
        csvContent = content
    } else if (Array.isArray(content)) {
        csvContent = content.map((row) => (Array.isArray(row) ? row.join(",") : String(row))).join("\n")
    } else {
        const rows = objectToTable(content)
        csvContent = rows.map((row) => row.join(",")).join("\n")
    }

    await fs.writeFile(filePath, csvContent, "utf-8")
    return Buffer.byteLength(csvContent, "utf-8")
}

function parseTableString(content: string): unknown[][] {
    const lines = content.split("\n").filter((line) => line.trim())

    if (content.includes("|")) {
        return lines
            .filter((line) => !line.match(/^\s*\|[\s-]+\|/))
            .map((line) =>
                line
                    .split("|")
                    .map((cell) => cell.trim())
                    .filter((cell) => cell),
            )
    }

    return lines.map((line) => line.split(",").map((cell) => cell.trim()))
}

function objectToTable(obj: object): unknown[][] {
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === "object") {
        const keys = Object.keys(obj[0])
        const header = keys
        const rows = obj.map((item) => keys.map((key) => (item as Record<string, unknown>)[key]))
        return [header, ...rows]
    }

    const entries = Object.entries(obj)
    return [["Key", "Value"], ...entries]
}


