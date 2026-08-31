import { codeToHtml, bundledLanguages } from "shiki"
import { createResource, Suspense } from "solid-js"
import { isServer } from "solid-js/web"
import DOMPurify from "dompurify"
import style from "./content-code.module.css"

function sanitize(html: string): string {
  if (isServer) return html
  return DOMPurify.isSupported ? DOMPurify.sanitize(html) : html
}

interface Props {
  code: string
  lang?: string
  flush?: boolean
}
export function ContentCode(props: Props) {
  const [html] = createResource(
    () => [props.code, props.lang],
    async ([code, lang]) => {
      // TODO: For testing delays
      // await new Promise((resolve) => setTimeout(resolve, 3000))
      const parsed = await codeToHtml(code || "", {
        lang: lang && lang in bundledLanguages ? lang : "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
      return sanitize(parsed)
    },
  )
  return (
    <Suspense>
      <div innerHTML={html()} class={style.root} data-flush={props.flush === true ? true : undefined} />
    </Suspense>
  )
}

