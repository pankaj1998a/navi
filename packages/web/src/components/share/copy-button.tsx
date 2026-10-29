import { createSignal } from "solid-js"
import { IconClipboard, IconCheckCircle } from "../icons"
import { copyAndFlash, useShareMessages } from "./common"
import styles from "./copy-button.module.css"

interface CopyButtonProps {
  text: string
}

export function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = createSignal(false)
  const messages = useShareMessages()

  function handleCopyClick() {
    if (props.text) {
      copyAndFlash(props.text, setCopied, 2000)
    }
  }

  return (
    <div data-component="copy-button" class={styles.root}>
      <button
        type="button"
        onClick={handleCopyClick}
        data-copied={copied() ? true : undefined}
        aria-label={copied() ? messages.copied : messages.copy}
        title={copied() ? messages.copied : messages.copy}
      >
        {copied() ? <IconCheckCircle width={16} height={16} /> : <IconClipboard width={16} height={16} />}
      </button>
    </div>
  )
}
