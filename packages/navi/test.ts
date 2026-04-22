import { WebSearchTool } from './src/tool/websearch'; WebSearchTool.execute({query:'test'}, {ask:()=>Promise.resolve(), abort: new AbortController().signal}).then(console.log).catch(console.error);
