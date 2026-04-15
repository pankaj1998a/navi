import { Show, Switch, Match } from "solid-js"
import { useLayout } from "@/context/layout"
import { Markdown } from "@navi-ai/ui/markdown"
import { Icon } from "@navi-ai/ui/icon"
import { Button } from "@navi-ai/ui/button"
import { ResizeHandle } from "@navi-ai/ui/resize-handle"

export function CanvasSidebar() {
  const layout = useLayout()

  return (
    <Show when={layout.canvas.opened()}>
      <div 
        class="relative h-full flex flex-col bg-background-base/90 backdrop-blur-xl border-l border-border-weak-base shadow-2xl z-30 transition-all duration-300 ease-in-out"
        style={{ width: `${layout.canvas.width()}px` }}
      >
        <ResizeHandle
          direction="horizontal"
          size={layout.canvas.width()}
          min={300}
          max={window.innerWidth * 0.6}
          onResize={layout.canvas.resize}
        />
        
        <div class="flex items-center justify-between px-4 h-12 border-b border-border-weak-base shrink-0">
          <div class="flex items-center gap-2">
            <Icon name="photo" class="text-icon-interactive-base" size="normal" />
            <span class="text-14-semibold">Canvas</span>
          </div>
          <Button variant="ghost" size="small" onClick={() => layout.canvas.close()}>
             <Icon name="stop" size="small" />
          </Button>
        </div>

        <div class="flex-1 overflow-y-auto p-6 scroll-smooth">
          <Switch>
            <Match when={layout.canvas.type() === "markdown"}>
              <Markdown text={layout.canvas.content()} />
            </Match>
            <Match when={layout.canvas.type() === "code"}>
              <Markdown text={`\`\`\`\n${layout.canvas.content()}\n\`\`\``} />
            </Match>
            <Match when={layout.canvas.type() === "dashboard"}>
               <div class="flex flex-col gap-4">
                  <div class="p-4 rounded-lg bg-surface-info-base/10 border border-surface-info-base/20 text-14-medium text-text-base">
                    Interactive Dashboard (Experimental)
                  </div>
                  <Markdown text={layout.canvas.content()} />
               </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  )
}
