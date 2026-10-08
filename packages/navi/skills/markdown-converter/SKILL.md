---
name: markdown-converter
description: "Convert PDFs, Office docs (Word, Excel, PowerPoint), HTML, audio, and images to Markdown."
---

# Markdown Converter

Convert non-text files and rich documents into Markdown using `uvx --from "markitdown[all]" markitdown` without needing complex local dependencies.

## Usage

```bash
# Convert PDF, DOCX, or PPTX to Markdown on stdout
uvx --from "markitdown[all]" markitdown document.pdf

# Save directly to a markdown file
uvx --from "markitdown[all]" markitdown spreadsheet.xlsx -o output.md
uvx --from "markitdown[all]" markitdown presentation.pptx -o slides.md

# Convert from stdin with file extension hint
cat scan.pdf | uvx --from "markitdown[all]" markitdown -x .pdf > output.md
```

## Supported Types

- **Office**: Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`)
- **Documents**: PDF (`.pdf`), EPUB, ZIP (extracts file outlines)
- **Data**: CSV, JSON, XML, HTML
- **Media**: Image EXIF + OCR, Audio transcription
