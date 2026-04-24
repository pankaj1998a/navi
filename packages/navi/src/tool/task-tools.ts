import z from "zod"
import { Tool } from "./tool"
import { Todo } from "../session/todo"

function findTodoIndex(todos: Todo.Info[], ref: string) {
  const numeric = Number(ref)
  if (Number.isInteger(numeric) && numeric > 0 && numeric <= todos.length) {
    return numeric - 1
  }

  return todos.findIndex((t) => t.content === ref)
}

/**
 * TaskCreateTool adds a new task to the session's TODO list.
 */
export const TaskCreateTool = Tool.define("TaskCreate", {
  description: "Create a new task in the session TODO list.",
  parameters: z.object({
    content: z.string().describe("Brief description of the task"),
    priority: z.enum(["high", "medium", "low"]).default("medium").describe("Priority level of the task"),
  }),
  async execute(params, ctx) {
    const todos = await Todo.get(ctx.sessionID)
    const newTodo: Todo.Info = {
      content: params.content,
      status: "pending",
      priority: params.priority,
    }
    await Todo.update({
      sessionID: ctx.sessionID,
      todos: [...todos, newTodo],
    })
    return {
      title: "Task created",
      output: `Created task #${todos.length + 1}: ${newTodo.content} (${newTodo.priority})`,
      metadata: { todo: newTodo },
    }
  },
})

/**
 * TaskListTool retrieves all tasks in the current session.
 */
export const TaskListTool = Tool.define("TaskList", {
  description: "List all tasks in the current session.",
  parameters: z.object({
    status: z.enum(["all", "pending", "in_progress", "completed", "cancelled"]).default("all").optional(),
  }),
  async execute(params, ctx) {
    let todos = await Todo.get(ctx.sessionID)
    if (params.status && params.status !== "all") {
      todos = todos.filter((t) => t.status === params.status)
    }
    return {
      title: `Tasks: ${todos.length}`,
      output: todos.length > 0 
        ? todos.map((t, i) => `${i + 1}. (${t.status}) [${t.priority}] ${t.content}`).join("\n")
        : "No tasks found.",
      metadata: { todos },
    }
  },
})

async function updateTask(params: {
  id: string
  status?: "pending" | "in_progress" | "completed" | "cancelled"
  content?: string
  priority?: "high" | "medium" | "low"
}, ctx: any) {
  const todos = await Todo.get(ctx.sessionID)
  const index = findTodoIndex(todos, params.id)
  if (index === -1) {
    throw new Error(`Task with ID ${params.id} not found.`)
  }

  const updated = { ...todos[index] }
  if (params.status) updated.status = params.status as any
  if (params.content) updated.content = params.content
  if (params.priority) updated.priority = params.priority as any

  const nextTodos = [...todos]
  nextTodos[index] = updated

  await Todo.update({
    sessionID: ctx.sessionID,
    todos: nextTodos,
  })

  return {
    title: "Task updated",
    output: `Updated task ${params.id}: status=${updated.status}`,
    metadata: { todo: updated },
  }
}

/**
 * TaskUpdateTool updates the status or content of an existing task.
 */
export const TaskUpdateTool = Tool.define("TaskUpdate", {
  description: "Update an existing task's status, content, or priority.",
  parameters: z.object({
    id: z.string().describe("ID of the task to update"),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    content: z.string().optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
  }),
  async execute(params, ctx) {
    return updateTask(params as any, ctx)
  },
})

/**
 * TaskGetTool retrieves a specific task by ID.
 */
export const TaskGetTool = Tool.define("TaskGet", {
  description: "Get detailed information about a specific task.",
  parameters: z.object({
    id: z.string().describe("ID of the task to retrieve"),
  }),
  async execute(params, ctx) {
    const todos = await Todo.get(ctx.sessionID)
    const todo = todos[findTodoIndex(todos, params.id)]
    if (!todo) {
      throw new Error(`Task with ID ${params.id} not found.`)
    }
    return {
      title: "Task details",
      output: JSON.stringify(todo, null, 2),
      metadata: { todo },
    }
  },
})

/**
 * TaskStopTool marks a task as cancelled or completed. (Simplified TaskUpdate)
 */
export const TaskStopTool = Tool.define("TaskStop", {
  description: "Mark a task as completed or cancelled.",
  parameters: z.object({
    id: z.string().describe("ID of the task to stop"),
    completed: z.boolean().default(true).describe("True if completed, false if cancelled"),
  }),
  async execute(params, ctx) {
    return updateTask({
      id: params.id,
      status: params.completed ? "completed" : "cancelled",
    }, ctx)
  },
})


